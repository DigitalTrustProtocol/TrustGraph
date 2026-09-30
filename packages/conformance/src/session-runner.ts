/**
 * Session suite (conformance.md § One API: the session suite): scripted
 * WebSocket sessions run against a started server. Each step sends one
 * frame and lists the frames it expects back, in order. Expectations are
 * partial (see match.ts) with three matcher objects for values a server
 * chooses: `{ "$prefix": "invalid:" }`, `{ "$type": "string" }`,
 * `{ "$any": true }`.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { corpusDir, expandPlaceholders, loadManifest } from './corpus'

export interface SessionStep {
  note?: string
  send: unknown[]
  expect: unknown[][]
}

export interface SessionCase {
  id: string
  api: string
  description?: string
  /** Server settings the session assumes (e.g. `auth.reads: open`). */
  config: Record<string, unknown>
  steps: SessionStep[]
}

export function loadSessions(dir = corpusDir): Array<{ file: string; session: SessionCase }> {
  const manifest = loadManifest(dir) as { sessions?: string[] }
  return (manifest.sessions ?? []).map((file) => ({
    file,
    session: expandPlaceholders(JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as SessionCase),
  }))
}

function isMatcher(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).some((k) => k.startsWith('$'))
}

/** Partial match with `$prefix` / `$type` / `$any` matchers. */
export function matchFrame(actual: unknown, expected: unknown, path = '$'): string[] {
  if (isMatcher(expected)) {
    if (expected.$any === true) return []
    if (typeof expected.$prefix === 'string') {
      return typeof actual === 'string' && actual.startsWith(expected.$prefix)
        ? []
        : [`${path}: expected prefix ${expected.$prefix}, got ${JSON.stringify(actual)}`]
    }
    if (typeof expected.$type === 'string') {
      const type = Array.isArray(actual) ? 'array' : actual === null ? 'null' : typeof actual
      return type === expected.$type ? [] : [`${path}: expected ${expected.$type}, got ${type}`]
    }
    return [`${path}: unknown matcher`]
  }
  if (expected === null || typeof expected !== 'object') {
    return Object.is(actual, expected) ? [] : [`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)?.slice(0, 200)}`]
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: expected array`]
    if (actual.length !== expected.length) return [`${path}: expected ${expected.length} items, got ${actual.length}`]
    return expected.flatMap((item, i) => matchFrame(actual[i], item, `${path}[${i}]`))
  }
  if (!actual || typeof actual !== 'object') return [`${path}: expected object, got ${JSON.stringify(actual)?.slice(0, 200)}`]
  return Object.entries(expected).flatMap(([key, value]) =>
    matchFrame((actual as Record<string, unknown>)[key], value, `${path}.${key}`),
  )
}

export interface SessionOutcome {
  step: number
  note?: string
  errors: string[]
}

interface MinimalSocket {
  send(data: string): void
  close(): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  addEventListener(type: 'open' | 'error' | 'close', listener: () => void): void
}

/** Run one session against `url`; the socket's AUTH challenge is ignored. */
export async function runSession(
  url: string,
  session: SessionCase,
  options: { WebSocket?: new (url: string) => MinimalSocket; timeoutMs?: number } = {},
): Promise<SessionOutcome[]> {
  const Ctor = options.WebSocket ?? (globalThis.WebSocket as unknown as new (url: string) => MinimalSocket)
  const ws = new Ctor(url)
  const inbox: unknown[][] = []
  let wake: (() => void) | undefined
  ws.addEventListener('message', (event) => {
    const frame = JSON.parse(String(event.data)) as unknown[]
    if (frame[0] === 'AUTH') return
    inbox.push(frame)
    wake?.()
  })
  await new Promise<void>((resolveOpen, reject) => {
    ws.addEventListener('open', () => resolveOpen())
    ws.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)))
  })
  const timeoutMs = options.timeoutMs ?? 5_000
  const outcomes: SessionOutcome[] = []
  try {
    for (const [index, step] of session.steps.entries()) {
      ws.send(JSON.stringify(step.send))
      const until = Date.now() + timeoutMs
      while (inbox.length < step.expect.length && Date.now() < until) {
        await new Promise<void>((r) => {
          wake = r
          setTimeout(r, 50)
        })
      }
      const got = inbox.splice(0, step.expect.length)
      const errors =
        got.length < step.expect.length
          ? [`expected ${step.expect.length} frames, got ${got.length}: ${JSON.stringify(got).slice(0, 300)}`]
          : step.expect.flatMap((frame, i) => matchFrame(got[i], frame, `frame[${i}]`))
      outcomes.push({ step: index, ...(step.note ? { note: step.note } : {}), errors })
    }
  } finally {
    ws.close()
  }
  return outcomes
}
