/**
 * Session suite (conformance.md § One API: the session suite): scripted
 * WebSocket sessions run against a started server. Each step sends one
 * frame and lists the frames it expects back, in order (or in any order with
 * `unordered`). Expectations are partial (see match.ts); numbers compare
 * within NUMBER_TOLERANCE, so `1.5e-6` and `0.0000015` are the same value.
 * Matcher objects for values a server chooses: `{ "$prefix": "invalid:" }`,
 * `{ "$type": "string" }`, `{ "$any": true }`, and `{ "$unordered": [...] }`
 * for arrays whose order is implementation-local.
 *
 * Capability gating: a session or step may list `requires` entries. An
 * operation name must appear in the server's `dtp.capabilities`; `fixed:Gn`
 * holds when `dtp.gaps` does not list `Gn`. When a requirement fails, the
 * step asserts `otherwise` if given, else it is skipped.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { corpusDir, expandPlaceholders, loadManifest } from './corpus'
import { NUMBER_TOLERANCE } from './match'

export interface SessionStep {
  note?: string
  send: unknown[]
  expect: unknown[][]
  /** Frames may arrive in any order. */
  unordered?: boolean
  requires?: string[]
  /** Asserted instead of `expect` when a requirement is not met. */
  otherwise?: unknown[][]
}

export interface SessionCase {
  id: string
  api: string
  description?: string
  /** Server settings the session assumes (e.g. `auth.reads: open`). */
  config: Record<string, unknown>
  requires?: string[]
  steps: SessionStep[]
}

/** What a server says it supports: `dtp.capabilities` and `dtp.gaps`. */
export interface ServerFeatures {
  capabilities: readonly string[]
  gaps?: readonly string[]
}

export function loadSessions(dir = corpusDir): Array<{ file: string; session: SessionCase }> {
  const manifest = loadManifest(dir) as { sessions?: string[] }
  return (manifest.sessions ?? []).map((file) => ({
    file,
    session: expandPlaceholders(JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as SessionCase),
  }))
}

export function requirementMet(requirement: string, features: ServerFeatures): boolean {
  if (requirement.startsWith('fixed:')) return !(features.gaps ?? []).includes(requirement.slice('fixed:'.length))
  return features.capabilities.includes(requirement)
}

function isMatcher(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).some((k) => k.startsWith('$'))
}

/** Pairs every pattern with a distinct item (small arrays; backtracking). */
function matchUnordered(actual: unknown[], patterns: unknown[], path: string, match: typeof matchFrame): string[] {
  if (actual.length !== patterns.length) return [`${path}: expected ${patterns.length} items, got ${actual.length}`]
  const used = new Array<boolean>(actual.length).fill(false)
  const assign = (p: number): boolean => {
    if (p === patterns.length) return true
    for (let a = 0; a < actual.length; a++) {
      if (used[a] || match(actual[a], patterns[p], path).length > 0) continue
      used[a] = true
      if (assign(p + 1)) return true
      used[a] = false
    }
    return false
  }
  return assign(0) ? [] : [`${path}: no order of ${JSON.stringify(actual).slice(0, 300)} matches the expected items`]
}

/** Partial match with `$prefix` / `$type` / `$any` / `$unordered` matchers. */
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
    if (Array.isArray(expected.$unordered)) {
      if (!Array.isArray(actual)) return [`${path}: expected array`]
      return matchUnordered(actual, expected.$unordered, path, matchFrame)
    }
    return [`${path}: unknown matcher`]
  }
  if (typeof expected === 'number') {
    return typeof actual === 'number' && Math.abs(actual - expected) <= NUMBER_TOLERANCE
      ? []
      : [`${path}: expected ${expected}, got ${JSON.stringify(actual)?.slice(0, 200)}`]
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
  /** A requirement was not met and the step has no `otherwise`. */
  skipped?: boolean
  errors: string[]
}

interface MinimalSocket {
  send(data: string): void
  close(): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  addEventListener(type: 'open' | 'error' | 'close', listener: () => void): void
}

const FEATURES_REQ_ID = '$features'

function needsFeatures(session: SessionCase): boolean {
  return (session.requires?.length ?? 0) > 0 || session.steps.some((step) => (step.requires?.length ?? 0) > 0)
}

/**
 * Run one session against `url`; the socket's AUTH challenge is ignored.
 * `DTP-PUSH` frames are matched only by steps that expect one; other pushes
 * are dropped. When the session has requirements and `features` is not
 * given, the runner first asks the server with `info`.
 */
export async function runSession(
  url: string,
  session: SessionCase,
  options: { WebSocket?: new (url: string) => MinimalSocket; timeoutMs?: number; features?: ServerFeatures } = {},
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

  const collect = async (count: number, wantsPush: boolean): Promise<unknown[][]> => {
    const until = Date.now() + timeoutMs
    const dropPushes = () => {
      if (wantsPush) return
      for (let i = inbox.length - 1; i >= 0; i--) if (inbox[i]![0] === 'DTP-PUSH') inbox.splice(i, 1)
    }
    dropPushes()
    while (inbox.length < count && Date.now() < until) {
      await new Promise<void>((r) => {
        wake = r
        setTimeout(r, 50)
      })
      dropPushes()
    }
    return inbox.splice(0, count)
  }

  const outcomes: SessionOutcome[] = []
  try {
    let features = options.features
    if (!features && needsFeatures(session)) {
      ws.send(JSON.stringify(['DTP', FEATURES_REQ_ID, 'info', {}]))
      const [frame] = await collect(1, false)
      const info = frame && frame[0] === 'DTP-OK' && frame[1] === FEATURES_REQ_ID ? (frame[2] as Partial<ServerFeatures>) : undefined
      if (!info || !Array.isArray(info.capabilities)) throw new Error(`info did not answer with capabilities: ${JSON.stringify(frame)}`)
      features = { capabilities: info.capabilities, ...(Array.isArray(info.gaps) ? { gaps: info.gaps } : {}) }
    }
    const met = (requires: string[] | undefined) => (requires ?? []).every((r) => requirementMet(r, features!))
    const sessionMet = met(session.requires)

    for (const [index, step] of session.steps.entries()) {
      const base = { step: index, ...(step.note ? { note: step.note } : {}) }
      const stepMet = sessionMet && met(step.requires)
      const expected = stepMet ? step.expect : step.otherwise
      if (!expected) {
        outcomes.push({ ...base, skipped: true, errors: [] })
        continue
      }
      ws.send(JSON.stringify(step.send))
      const got = await collect(expected.length, expected.some((frame) => frame[0] === 'DTP-PUSH'))
      const errors =
        got.length < expected.length
          ? [`expected ${expected.length} frames, got ${got.length}: ${JSON.stringify(got).slice(0, 300)}`]
          : step.unordered
            ? matchUnordered(got, expected, 'frames', matchFrame)
            : expected.flatMap((frame, i) => matchFrame(got[i], frame, `frame[${i}]`))
      outcomes.push({ ...base, errors })
    }
  } finally {
    ws.close()
  }
  return outcomes
}
