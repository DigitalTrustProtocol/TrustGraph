/**
 * Telemetry snapshot `dtp-telemetry/1` (telemetry.md § Data endpoints).
 * Same field names on every server; a section or field that does not apply
 * to a server is `null`, never missing. JSON Schema:
 * `TrustGraph/schemas/telemetry.v1.json` (kept in sync by a test).
 *
 * Privacy (telemetry.md § Privacy): counts and histograms only; never
 * subjects, query parameters, result contents, queried roots, or IPs.
 */

export const TELEMETRY_SCHEMA = 'dtp-telemetry/1'

export type ServerKind = 'personal' | 'global' | 'sync'

export interface LatencySummary {
  p50: number | null
  p95: number | null
  p99: number | null
  count: number
}

export interface IngestResultCounts {
  accepted: number
  duplicate: number
  invalid: number
  blocked: number
  rate_limited: number
  deleted: number
}

export interface OperationResultCounts {
  ok: number
  busy: number
  rate_limited: number
  invalid: number
  error: number
}

export interface WriterRow {
  /** Writer pubkey when authenticated, else `null` (anonymous writer connection). */
  pubkey: string | null
  connectedSince: number
  events: number
  rejects: number
}

export interface RelayRow {
  url: string
  state: 'idle' | 'connecting' | 'syncing' | 'live' | 'backoff' | 'error'
  lastEoseAt: number | null
  cursorLagSeconds: number | null
  errors: number
  retryAt: number | null
}

export interface AlertRow {
  name: 'not-ready' | 'memory-pressure' | 'ingest-backlog' | 'guardrail-storm' | 'source-down' | 'slow-queries'
  active: boolean
  since: number | null
}

export interface LogLine {
  ts: number
  level: 'warn' | 'error'
  message: string
}

export interface MemberRow {
  pubkey: string
  roles: string[]
}

export interface TelemetrySnapshot {
  schema: typeof TELEMETRY_SCHEMA
  generatedAt: number
  server: {
    kind: ServerKind
    version: string
    api: string
    model: string
    corpus: string
    instanceId: string
    startedAt: number
    uptimeSeconds: number
  }
  health: {
    ready: boolean
    /** Seconds since `ready` last changed. */
    stateSinceSeconds: number
    notReadyReason: string | null
  }
  graph: {
    graphVersion: number
    epochLagSeconds: number | null
    nodes: number
    edges: { '32009': number; '32014': number }
    claims: number
    hintedStatements: number
    deleteFloors: number
    bytes: { total: number | null; resident: number | null; pinned: number | null }
    bytesPerEdge: number | null
    impl: Record<string, number | string | null>
  }
  ingest: {
    /** Accepted events per second over the last minute, by kind. */
    eventsPerSecond: { '32009': number; '32014': number; '10011': number; '5': number }
    byKind: { '32009': IngestResultCounts; '32014': IngestResultCounts; '10011': IngestResultCounts; '5': IngestResultCounts }
    /** Rejections by NIP-01 `OK` prefix. */
    rejectsByPrefix: Record<string, number>
    deletions: number
    queueDepth: number
    queueCap: number
    pendingOks: number
    writers: WriterRow[]
  }
  sources: {
    relays: RelayRow[] | null
    frontier: { size: number; truncationReasons: string[] } | null
    writers: WriterRow[] | null
    wantsOpen: number | null
  }
  queries: {
    opsPerSecond: Record<string, number>
    totals: Record<string, OperationResultCounts>
    latency: Record<string, { warm: LatencySummary; cold: LatencySummary }>
    inFlight: number
    guardrailHits: Record<string, number>
    backgroundCompletions: number
    fieldCache: { hits: number; misses: number; bytes: number } | null
  }
  connections: {
    open: number
    byRole: { anonymous_reader: number; member_reader: number; writer: number; admin: number }
    byOrigin: { extension: number; native: number; other: number }
    authentications: number
    slowClientDisconnects: number
  }
  memory: {
    limitBytes: number | null
    rssBytes: number
    shares: Record<string, { bytes: number; limit: number | null }>
    watchdog: 'ok' | 'pressure' | 'critical'
    impl: Record<string, number | string | null>
  }
  roots: { active: number; warming: number; coveragePushes: number }
  logs: LogLine[]
  config: {
    effective: Record<string, unknown>
    nip11: Record<string, unknown>
    membership: { counts: { read: number; write: number; admin: number }; members: MemberRow[] } | null
  }
  alerts: AlertRow[]
}

/** Shared Prometheus metric names (telemetry.md § Metric names) with their labels. */
export const SHARED_METRICS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  dtp_up: [],
  dtp_ready: [],
  dtp_graph_version: [],
  dtp_epoch_lag_seconds: [],
  dtp_graph_nodes: [],
  dtp_graph_edges: ['kind'],
  dtp_graph_bytes: ['tier'],
  dtp_ingest_events_total: ['kind', 'result'],
  dtp_ingest_queue_depth: [],
  dtp_ingest_pending_oks: [],
  dtp_source_state: ['source', 'type'],
  dtp_want_open: [],
  dtp_operations_total: ['op', 'result'],
  dtp_operation_duration_seconds: ['op', 'temperature'],
  dtp_operations_inflight: [],
  dtp_guardrail_hits_total: ['reason'],
  dtp_background_completions_total: [],
  dtp_field_cache_hits_total: [],
  dtp_field_cache_misses_total: [],
  dtp_field_cache_bytes: [],
  dtp_connections: ['role', 'origin'],
  dtp_memory_bytes: ['share'],
  dtp_memory_limit_bytes: [],
  dtp_rss_bytes: [],
  dtp_roots: ['state'],
  dtp_alert: ['name'],
})

/** Top-level sections, in page order. */
export const TELEMETRY_SECTIONS = [
  'server',
  'health',
  'graph',
  'ingest',
  'sources',
  'queries',
  'connections',
  'memory',
  'roots',
  'logs',
  'config',
  'alerts',
] as const
