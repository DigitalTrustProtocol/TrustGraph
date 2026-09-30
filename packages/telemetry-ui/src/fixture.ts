import { TELEMETRY_SCHEMA, type TelemetrySnapshot } from './schema'

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T

export type SnapshotOverrides = DeepPartial<TelemetrySnapshot>

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function merge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base
  if (!isPlainObject(base) || !isPlainObject(override)) return override
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) out[key] = merge(base[key], value)
  return out
}

const counts = (accepted: number, duplicate = 0, invalid = 0) => ({
  accepted,
  duplicate,
  invalid,
  blocked: 0,
  rate_limited: 0,
  deleted: 0,
})

const NOW = 1_790_000_000
const WRITER = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'

/**
 * A complete, valid Personal Server snapshot (relay sync present, root-field
 * cache and membership `null`). Plain-object `overrides` merge deeply;
 * arrays and `null` replace.
 */
export function sampleSnapshot(overrides: SnapshotOverrides = {}): TelemetrySnapshot {
  const base: TelemetrySnapshot = {
    schema: TELEMETRY_SCHEMA,
    generatedAt: NOW,
    server: {
      kind: 'personal',
      version: '0.1.0',
      api: 'dtp-resolver/1',
      model: 'dtp-wot/1',
      corpus: 'corpus-2026.09',
      instanceId: 'personal-7f3a9c',
      startedAt: NOW - 93_784,
      uptimeSeconds: 93_784,
    },
    health: { ready: true, stateSinceSeconds: 93_700, notReadyReason: null },
    graph: {
      graphVersion: 4812,
      epochLagSeconds: 3,
      nodes: 15_230,
      edges: { '32009': 48_211, '32014': 9_140 },
      claims: 2_311,
      hintedStatements: 57,
      deleteFloors: 12,
      bytes: { total: 12_582_912, resident: 12_582_912, pinned: null },
      bytesPerEdge: 219.4,
      impl: { v8_heap_bytes: 41_943_040, index_generation: 7 },
    },
    ingest: {
      eventsPerSecond: { '32009': 2.4, '32014': 0.6, '10011': 0.1, '5': 0 },
      byKind: {
        '32009': counts(48_900, 1_204, 3),
        '32014': counts(9_300, 80),
        '10011': counts(2_400, 12, 1),
        '5': { ...counts(41), deleted: 41 },
      },
      rejectsByPrefix: { duplicate: 1_296, invalid: 4 },
      deletions: 41,
      queueDepth: 3,
      queueCap: 10_000,
      pendingOks: 1,
      writers: [{ pubkey: WRITER, connectedSince: NOW - 3_600, events: 210, rejects: 2 }],
    },
    sources: {
      relays: [
        { url: 'wss://relay.example.com', state: 'live', lastEoseAt: NOW - 20, cursorLagSeconds: 2, errors: 0, retryAt: null },
        { url: 'wss://relay.backup.example', state: 'backoff', lastEoseAt: NOW - 1_800, cursorLagSeconds: 1_800, errors: 5, retryAt: NOW + 60 },
      ],
      frontier: { size: 1_024, truncationReasons: ['nodeBudget'] },
      writers: [{ pubkey: WRITER, connectedSince: NOW - 3_600, events: 210, rejects: 2 }],
      wantsOpen: 2,
    },
    queries: {
      opsPerSecond: { trust: 4.2, rating: 1.1, neighborhood: 0.3 },
      totals: {
        trust: { ok: 90_210, busy: 3, rate_limited: 0, invalid: 12, error: 0 },
        rating: { ok: 20_110, busy: 0, rate_limited: 1, invalid: 2, error: 0 },
        neighborhood: { ok: 4_020, busy: 1, rate_limited: 0, invalid: 0, error: 1 },
      },
      latency: {
        trust: { warm: { p50: 0.0012, p95: 0.004, p99: 0.011, count: 88_000 }, cold: { p50: 0.018, p95: 0.061, p99: 0.12, count: 2_210 } },
        rating: { warm: { p50: 0.0009, p95: 0.003, p99: 0.008, count: 19_900 }, cold: { p50: null, p95: null, p99: null, count: 0 } },
        neighborhood: { warm: { p50: 0.021, p95: 0.08, p99: 0.2, count: 3_900 }, cold: { p50: 0.3, p95: 1.2, p99: 2.4, count: 120 } },
      },
      inFlight: 1,
      guardrailHits: { timeBudget: 4, nodeBudget: 17 },
      backgroundCompletions: 9,
      fieldCache: null,
    },
    connections: {
      open: 5,
      byRole: { anonymous_reader: 3, member_reader: 0, writer: 1, admin: 1 },
      byOrigin: { extension: 3, native: 1, other: 1 },
      authentications: 14,
      slowClientDisconnects: 0,
    },
    memory: {
      limitBytes: 536_870_912,
      rssBytes: 188_743_680,
      shares: {
        graph: { bytes: 12_582_912, limit: 134_217_728 },
        ingestQueue: { bytes: 65_536, limit: 16_777_216 },
        responses: { bytes: 1_048_576, limit: null },
      },
      watchdog: 'ok',
      impl: { v8_heap_bytes: 41_943_040, page_cache_resident_bytes: null },
    },
    roots: { active: 2, warming: 0, coveragePushes: 31 },
    logs: [
      { ts: NOW - 600, level: 'warn', message: 'relay wss://relay.backup.example backoff 60s' },
      { ts: NOW - 120, level: 'error', message: 'ingest rejected 1 event: invalid signature' },
    ],
    config: {
      effective: {
        listen: '127.0.0.1:3870',
        admin: { listen: '127.0.0.1:3871', auth: 'local' },
        relays: ['wss://relay.example.com', 'wss://relay.backup.example'],
        vault: { passphrase: '[redacted]' },
      },
      nip11: { name: 'dtp-personal', software: 'dtp-personal', version: '0.1.0', supported_nips: [1, 9, 11, 42] },
      membership: null,
    },
    alerts: [
      { name: 'not-ready', active: false, since: null },
      { name: 'memory-pressure', active: false, since: null },
      { name: 'ingest-backlog', active: false, since: null },
      { name: 'guardrail-storm', active: false, since: null },
      { name: 'source-down', active: true, since: NOW - 1_800 },
      { name: 'slow-queries', active: false, since: null },
    ],
  }
  return merge(base, overrides) as TelemetrySnapshot
}
