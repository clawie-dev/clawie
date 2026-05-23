#!/usr/bin/env node
/**
 * Mirror-test gate (spec 031-FR-001/002).
 *
 * Every production source file under `app/` MUST have a mirrored unit-test
 * file under `tests/unit/`. The mirror convention:
 *
 *   app/<path>/<name>.ts         →  tests/unit/<path>/<name>.test.ts
 *
 * Opt-out: add `// @no-test: <reason>` as a comment on the first 5 lines
 * of the source file. Reason is logged.
 *
 * Exit codes: 0 = clean. 1 = missing mirrors found.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const REPO_ROOT = new URL('../', import.meta.url).pathname
const APP_DIR = 'app'
const UNIT_DIR = 'tests/unit'

interface Result {
  sourcePath: string
  expectedTest: string
  hasTest: boolean
  optOutReason?: string
}

async function walk(dir: string): Promise<string[]> {
  let out: string[] = []
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  for (const name of entries) {
    const path = join(dir, name)
    const s = await stat(path)
    if (s.isDirectory()) {
      out = out.concat(await walk(path))
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(path)
    }
  }
  return out
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readOptOut(path: string): Promise<string | undefined> {
  const text = await readFile(path, 'utf8')
  const head = text.split('\n').slice(0, 5).join('\n')
  const match = head.match(/@no-test:\s*(.+)$/m)
  return match ? match[1].trim() : undefined
}

async function main(): Promise<void> {
  const sources = await walk(join(REPO_ROOT, APP_DIR))
  const results: Result[] = []

  for (const sourceAbs of sources) {
    const sourceRel = relative(REPO_ROOT, sourceAbs)
    const inApp = sourceRel.startsWith(APP_DIR + '/')
    if (!inApp) continue
    const tail = sourceRel.slice(APP_DIR.length + 1).replace(/\.ts$/, '.test.ts')
    const expectedTest = join(UNIT_DIR, tail)
    const expectedAbs = join(REPO_ROOT, expectedTest)
    const hasTest = await fileExists(expectedAbs)
    const optOutReason = hasTest ? undefined : await readOptOut(sourceAbs)
    results.push({ sourcePath: sourceRel, expectedTest, hasTest, optOutReason })
  }

  const missing = results.filter((r) => !r.hasTest && !r.optOutReason)
  const optedOut = results.filter((r) => !r.hasTest && r.optOutReason)
  const covered = results.filter((r) => r.hasTest)

  console.log(
    `Mirror-test check: ${covered.length} covered, ${optedOut.length} opted-out, ${missing.length} missing`
  )
  if (optedOut.length > 0) {
    console.log('\nOpted out:')
    for (const r of optedOut) {
      console.log(`  - ${r.sourcePath}  (reason: ${r.optOutReason})`)
    }
  }
  if (missing.length > 0) {
    console.log('\nMISSING test mirrors:')
    for (const r of missing) {
      console.log(`  ✗ ${r.sourcePath}  →  expected ${r.expectedTest}`)
    }
    console.log(
      '\nFix by either adding the test file, or adding `// @no-test: <reason>` to the first 5 lines of the source.'
    )
    process.exit(1)
  }
  console.log('OK')
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
