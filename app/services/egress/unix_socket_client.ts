// @no-test: covered indirectly via tests/unit/services/egress/outcall_provider.test.ts,
// which spins a fake outcalld over a Unix socket and exercises every code path
// in this client. A dedicated mirror test would just re-test http.request semantics.
import http from 'node:http'

/**
 * Minimal HTTP-over-Unix-socket client. Outcall's host API listens on
 * `/run/outcall/host.sock`; this lets us issue `GET`/`POST` requests
 * against it without pulling in a heavier dep.
 *
 * Why not `fetch` (Node 24)?
 *   Node's global fetch + undici don't expose a `socketPath` option on
 *   the request init. Going through `node:http` directly keeps the
 *   surface area small and avoids the dispatcher-injection dance.
 */

export interface UnixSocketResponse {
  status: number
  body: string
}

export interface UnixSocketRequestInit {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  /** JSON-encoded request body. Sets `content-type: application/json`. */
  json?: unknown
  /** Per-request timeout (ms). Defaults to 5000. */
  timeoutMs?: number
}

/**
 * Tiny HTTP-over-Unix-socket request. Resolves with `{status, body}`
 * — caller parses JSON when it expects to.
 */
export async function unixSocketRequest(
  socketPath: string,
  path: string,
  init: UnixSocketRequestInit = {}
): Promise<UnixSocketResponse> {
  const method = init.method ?? 'GET'
  const timeoutMs = init.timeoutMs ?? 5_000
  const body = init.json !== undefined ? JSON.stringify(init.json) : undefined

  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {}
    if (body !== undefined) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(Buffer.byteLength(body))
    }

    const req = http.request(
      {
        socketPath,
        path,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
        res.on('error', reject)
      }
    )

    req.on('timeout', () => {
      req.destroy(new Error(`unix-socket request to ${socketPath}${path} exceeded ${timeoutMs}ms`))
    })
    req.on('error', reject)

    if (body !== undefined) req.write(body)
    req.end()
  })
}
