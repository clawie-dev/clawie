import { DateTime } from 'luxon'

/**
 * Phase 9 cron parser. Standard 5-field form with `*`, `n`, `a,b,c`, `a-b`,
 * and a step on a wildcard or range (`* / n`, `a-b / n`). A step on a bare
 * value (`n / n`) is rejected — it has no upper bound. No predefined macros
 * (`@daily` etc.) yet — operators
 * write the explicit cron string. The parser is intentionally small;
 * we accept the tradeoff of less expressive power for zero deps.
 *
 *   minute  hour  day-of-month  month  day-of-week
 *
 * day-of-month uses 1-31, day-of-week uses 0-6 (Sunday=0). When both
 * are specified (not `*`), POSIX cron treats them as OR — we do the
 * same.
 */

interface ParsedField {
  raw: string
  matches: Set<number>
}

interface ParsedCron {
  minute: ParsedField
  hour: ParsedField
  dayOfMonth: ParsedField
  month: ParsedField
  dayOfWeek: ParsedField
}

const FIELD_RANGES = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 6],
} as const

export function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(
      `cron expression must have 5 fields (minute hour dayOfMonth month dayOfWeek), got ${parts.length}`
    )
  }
  return {
    minute: parseField(parts[0], FIELD_RANGES.minute),
    hour: parseField(parts[1], FIELD_RANGES.hour),
    dayOfMonth: parseField(parts[2], FIELD_RANGES.dayOfMonth),
    month: parseField(parts[3], FIELD_RANGES.month),
    dayOfWeek: parseField(parts[4], FIELD_RANGES.dayOfWeek),
  }
}

function parseField(field: string, [min, max]: readonly [number, number]): ParsedField {
  const matches = new Set<number>()
  for (const segment of field.split(',')) {
    let step = 1
    let range = segment
    const slashIdx = segment.indexOf('/')
    if (slashIdx !== -1) {
      step = Number.parseInt(segment.slice(slashIdx + 1), 10)
      range = segment.slice(0, slashIdx)
      if (!Number.isInteger(step) || step <= 0) {
        throw new Error(`invalid step in cron segment "${segment}"`)
      }
    }
    let from: number
    let to: number
    if (range === '*') {
      from = min
      to = max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map((v) => Number.parseInt(v, 10))
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        throw new Error(`invalid range in cron segment "${segment}"`)
      }
      from = a
      to = b
    } else {
      const single = Number.parseInt(range, 10)
      if (!Number.isInteger(single)) {
        throw new Error(`invalid value in cron segment "${segment}"`)
      }
      if (slashIdx !== -1) {
        // A step on a bare value (e.g. "5/15") has no upper bound, so it
        // would silently match only the single value. Require an explicit
        // range instead, e.g. "5-59/15".
        throw new Error(
          `step needs "*" or a range in cron segment "${segment}"; write e.g. "${single}-${max}/${step}"`
        )
      }
      from = single
      to = single
    }
    if (from < min || to > max || from > to) {
      throw new Error(`cron segment "${segment}" outside range [${min}, ${max}]`)
    }
    for (let i = from; i <= to; i += step) matches.add(i)
  }
  return { raw: field, matches }
}

/**
 * Compute the next time after `from` (inclusive of the *minute* after
 * `from`) that the cron expression matches. Iterates minute by minute
 * with early skips, bounded to 366 days as a safety cap.
 */
export function nextFiring(expression: string, from: DateTime = DateTime.utc()): DateTime {
  const parsed = parseCron(expression)
  let cursor = from.startOf('minute').plus({ minutes: 1 })
  const limit = cursor.plus({ days: 366 })
  while (cursor < limit) {
    if (matchesField(parsed.minute, cursor.minute) && matchesField(parsed.hour, cursor.hour)) {
      const domMatch = matchesField(parsed.dayOfMonth, cursor.day)
      const dowMatch = matchesField(parsed.dayOfWeek, cursor.weekday % 7) // luxon: 1..7 Mon..Sun
      const bothRestrictive = parsed.dayOfMonth.raw !== '*' && parsed.dayOfWeek.raw !== '*'
      const dayOk = bothRestrictive ? domMatch || dowMatch : domMatch && dowMatch
      if (dayOk && matchesField(parsed.month, cursor.month)) {
        return cursor
      }
    }
    cursor = cursor.plus({ minutes: 1 })
  }
  throw new Error(`no cron firing within 366 days for "${expression}"`)
}

function matchesField(field: ParsedField, value: number): boolean {
  return field.matches.has(value)
}
