import type { AlertRow, RelayRow, TelemetrySnapshot, WriterRow } from '../schema'
import { append, emptyState, h, implSection, kvTable, section, subsection, table, type Child } from './dom'
import {
  formatBytes,
  formatDuration,
  formatLatency,
  formatNumber,
  formatPercent,
  formatRate,
  formatRelative,
  formatTimestamp,
  NA,
  shortPubkey,
} from './format'
import type { SeriesName, SeriesStore } from './series'
import { drawSparklines, sparkline } from './sparkline'

export const PAGES = [
  { id: 'overview', title: 'Overview' },
  { id: 'graph', title: 'Graph' },
  { id: 'ingest', title: 'Ingest' },
  { id: 'sources', title: 'Sources' },
  { id: 'queries', title: 'Queries' },
  { id: 'connections', title: 'Connections' },
  { id: 'memory', title: 'Memory' },
  { id: 'roots', title: 'Roots' },
  { id: 'logs', title: 'Logs' },
  { id: 'config', title: 'Config' },
] as const

export type PageId = (typeof PAGES)[number]['id']

export const DEFAULT_PAGE: PageId = 'overview'

export function isPageId(value: string): value is PageId {
  return PAGES.some((page) => page.id === value)
}

export function pageTitle(page: PageId): string {
  return PAGES.find((entry) => entry.id === page)?.title ?? page
}

export interface RenderContext {
  series?: SeriesStore
}

export const ALERT_LABELS: Record<AlertRow['name'], string> = {
  'not-ready': 'Not ready',
  'memory-pressure': 'Memory pressure',
  'ingest-backlog': 'Ingest backlog',
  'guardrail-storm': 'Guardrail storm',
  'source-down': 'Source down',
  'slow-queries': 'Slow queries',
}

const CHARTS: Record<SeriesName, { label: string; format: (value: number) => string }> = {
  ops: { label: 'Operations per second', format: formatRate },
  ingest: { label: 'Accepted events per second', format: formatRate },
  rss: { label: 'RSS', format: formatBytes },
  edges: { label: 'Edges', format: formatNumber },
}

const INGEST_KINDS = ['32009', '32014', '10011', '5'] as const
const KIND_LABELS: Record<(typeof INGEST_KINDS)[number], string> = {
  '32009': '32009 trust',
  '32014': '32014 rating',
  '10011': '10011 identity claim',
  '5': '5 deletion',
}

/** Render `page` for `snapshot` into `root`, replacing its content. */
export function renderPage(root: HTMLElement, page: PageId, snapshot: TelemetrySnapshot, context: RenderContext = {}): void {
  const heading = h('h1', { id: 'page-title', tabindex: '-1' }, pageTitle(page))
  let content: Child[]
  try {
    content = pageContent(page, snapshot, context)
  } catch (error) {
    content = [
      section(
        'Could not render this page',
        h('p', { class: 'error' }, error instanceof Error ? error.message : String(error)),
      ),
    ]
  }
  root.replaceChildren(heading)
  append(root, content)
  drawSparklines(root)
}

function pageContent(page: PageId, s: TelemetrySnapshot, context: RenderContext): Child[] {
  switch (page) {
    case 'overview':
      return overviewPage(s, context)
    case 'graph':
      return graphPage(s, context)
    case 'ingest':
      return ingestPage(s, context)
    case 'sources':
      return sourcesPage(s)
    case 'queries':
      return queriesPage(s, context)
    case 'connections':
      return connectionsPage(s)
    case 'memory':
      return memoryPage(s, context)
    case 'roots':
      return rootsPage(s)
    case 'logs':
      return logsPage(s)
    case 'config':
      return configPage(s)
    default: {
      const unhandled: never = page
      throw new Error(`unknown page ${String(unhandled)}`)
    }
  }
}

function chart(context: RenderContext, name: SeriesName): HTMLElement {
  const spec = CHARTS[name]
  return sparkline(spec.label, context.series?.get(name) ?? [], spec.format)
}

function charts(context: RenderContext, ...names: SeriesName[]): HTMLElement {
  return h('div', { class: 'charts' }, ...names.map((name) => chart(context, name)))
}

function when(timestamp: number | null, now: number): Child {
  if (timestamp === null || timestamp === undefined) return NA
  return h('time', { datetime: formatTimestamp(timestamp), title: formatTimestamp(timestamp) }, formatRelative(timestamp, now))
}

function pubkeyCell(pubkey: string | null): Child {
  return h('span', { class: 'mono', title: pubkey ?? undefined }, shortPubkey(pubkey))
}

function meter(value: number, max: number | null, label: string): Child {
  if (max === null || !Number.isFinite(max) || max <= 0) return null
  return h('meter', { min: '0', max: String(max), value: String(Math.min(value, max)), high: String(max * 0.85), 'aria-label': label })
}

function ratio(value: number | null, max: number | null): number | null {
  if (value === null || max === null || !Number.isFinite(max) || max <= 0) return null
  return value / max
}

function sumBy<T>(rows: Iterable<T>, pick: (row: T) => number): number {
  let total = 0
  for (const row of rows) total += pick(row) || 0
  return total
}

function numberMapTable(caption: string, keyLabel: string, values: Record<string, number>, empty: string): Child {
  const entries = Object.entries(values)
  if (entries.length === 0) return emptyState(empty)
  return table(caption, [keyLabel, 'Count'], entries.map(([key, value]) => [key, formatNumber(value)]))
}

function writersTable(writers: WriterRow[], now: number): Child {
  if (writers.length === 0) return emptyState('No writer connections')
  return table(
    'Writer connections',
    ['Writer', 'Connected since', 'Events', 'Rejects'],
    writers.map((row) => [pubkeyCell(row.pubkey), when(row.connectedSince, now), formatNumber(row.events), formatNumber(row.rejects)]),
    { numericFrom: 2 },
  )
}

function overviewPage(s: TelemetrySnapshot, context: RenderContext): Child[] {
  const now = s.generatedAt
  const active = s.alerts.filter((alert) => alert.active)
  const ready = s.health.ready
  return [
    h(
      'p',
      { class: ready ? 'banner ok' : 'banner bad' },
      h('strong', null, ready ? 'Ready' : 'Not ready'),
      ` for ${formatDuration(s.health.stateSinceSeconds)}`,
      !ready && s.health.notReadyReason ? ` — ${s.health.notReadyReason}` : null,
    ),
    section(
      'Server',
      kvTable('Server identity and health', [
        ['Status', ready ? 'Ready' : 'Not ready'],
        ['Server kind', s.server.kind],
        ['Version', s.server.version],
        ['API', s.server.api],
        ['Model', s.server.model],
        ['Corpus', s.server.corpus],
        ['Instance ID', h('span', { class: 'mono' }, s.server.instanceId)],
        ['Started', when(s.server.startedAt, now)],
        ['Uptime', formatDuration(s.server.uptimeSeconds)],
        ['Graph version', formatNumber(s.graph.graphVersion)],
        ['Epoch lag', s.graph.epochLagSeconds === null ? NA : formatDuration(s.graph.epochLagSeconds)],
        ['Snapshot', when(s.generatedAt, now)],
      ]),
    ),
    section(
      'Active alerts',
      active.length === 0
        ? emptyState('No active alerts')
        : table(
            'Active alerts',
            ['Alert', 'Since'],
            active.map((alert) => [ALERT_LABELS[alert.name] ?? alert.name, when(alert.since, now)]),
          ),
    ),
    section('Live', charts(context, 'ops', 'ingest', 'rss', 'edges')),
  ]
}

function graphPage(s: TelemetrySnapshot, context: RenderContext): Child[] {
  const g = s.graph
  return [
    section(
      'Graph size',
      charts(context, 'edges'),
      kvTable('Graph counts', [
        ['Nodes', formatNumber(g.nodes)],
        ['Edges 32009 (trust)', formatNumber(g.edges['32009'])],
        ['Edges 32014 (rating)', formatNumber(g.edges['32014'])],
        ['10011 claims', formatNumber(g.claims)],
        ['Hinted statements', formatNumber(g.hintedStatements)],
        ['Delete floors', formatNumber(g.deleteFloors)],
        ['Graph version', formatNumber(g.graphVersion)],
      ]),
    ),
    section(
      'Graph bytes',
      kvTable('Graph memory', [
        ['Total', formatBytes(g.bytes.total)],
        ['Resident', formatBytes(g.bytes.resident)],
        ['Pinned', formatBytes(g.bytes.pinned)],
        ['Bytes per edge', formatNumber(g.bytesPerEdge)],
      ]),
      implSection(g.impl),
    ),
  ]
}

function ingestPage(s: TelemetrySnapshot, context: RenderContext): Child[] {
  const i = s.ingest
  const now = s.generatedAt
  return [
    section(
      'Accepted events',
      charts(context, 'ingest'),
      table(
        'Events by kind',
        ['Kind', 'Accepted/s', 'Accepted', 'Duplicate', 'Invalid', 'Blocked', 'Rate-limited', 'Deleted'],
        INGEST_KINDS.map((kind) => {
          const counts = i.byKind[kind]
          return [
            KIND_LABELS[kind],
            formatRate(i.eventsPerSecond[kind]),
            formatNumber(counts?.accepted),
            formatNumber(counts?.duplicate),
            formatNumber(counts?.invalid),
            formatNumber(counts?.blocked),
            formatNumber(counts?.rate_limited),
            formatNumber(counts?.deleted),
          ]
        }),
      ),
    ),
    section('Rejects', numberMapTable('Rejects by OK prefix', 'Prefix', i.rejectsByPrefix, 'No rejects')),
    section(
      'Queue',
      kvTable('Ingest queue', [
        ['NIP-09 deletions', formatNumber(i.deletions)],
        ['Queue depth', h('span', null, `${formatNumber(i.queueDepth)} / ${formatNumber(i.queueCap)} `, meter(i.queueDepth, i.queueCap, 'Queue fill'))],
        ['Queue fill', formatPercent(ratio(i.queueDepth, i.queueCap))],
        ['Pending OKs', formatNumber(i.pendingOks)],
      ]),
    ),
    section('Writers', writersTable(i.writers, now)),
  ]
}

function relaysTable(relays: RelayRow[], now: number): Child {
  if (relays.length === 0) return emptyState('No relays configured')
  return table(
    'Relay sync',
    ['Relay', 'State', 'Last EOSE', 'Cursor lag', 'Errors', 'Retry at'],
    relays.map((relay) => [
      h('span', { class: 'mono' }, relay.url),
      h('span', { class: `state state-${relay.state}` }, relay.state),
      when(relay.lastEoseAt, now),
      relay.cursorLagSeconds === null ? NA : formatDuration(relay.cursorLagSeconds),
      formatNumber(relay.errors),
      when(relay.retryAt, now),
    ]),
    { numericFrom: 4 },
  )
}

function sourcesPage(s: TelemetrySnapshot): Child[] {
  const src = s.sources
  const now = s.generatedAt
  return [
    section('Relay sync', src.relays === null ? emptyState() : relaysTable(src.relays, now)),
    section(
      'Frontier',
      src.frontier === null
        ? emptyState()
        : [
            kvTable('Sync frontier', [['Frontier size', formatNumber(src.frontier.size)]]),
            subsection(
              'Truncation reasons',
              src.frontier.truncationReasons.length === 0
                ? emptyState('Not truncated')
                : h('ul', null, ...src.frontier.truncationReasons.map((reason) => h('li', null, reason))),
            ),
          ],
    ),
    section('Writers', src.writers === null ? emptyState() : writersTable(src.writers, now)),
    section(
      'Open want demands',
      src.wantsOpen === null ? emptyState() : kvTable('Want demands', [['Open wants', formatNumber(src.wantsOpen)]]),
    ),
  ]
}

function queriesPage(s: TelemetrySnapshot, context: RenderContext): Child[] {
  const q = s.queries
  const ops = [...new Set([...Object.keys(q.opsPerSecond), ...Object.keys(q.totals), ...Object.keys(q.latency)])].sort()
  const totals = Object.values(q.totals)
  const latencyRows: Child[][] = []
  for (const op of ops) {
    const latency = q.latency[op]
    if (!latency) continue
    for (const temperature of ['warm', 'cold'] as const) {
      const row = latency[temperature]
      latencyRows.push([
        `${op} (${temperature})`,
        formatLatency(row?.p50),
        formatLatency(row?.p95),
        formatLatency(row?.p99),
        formatNumber(row?.count),
      ])
    }
  }
  const cache = q.fieldCache
  return [
    section(
      'Operations',
      charts(context, 'ops'),
      ops.length === 0
        ? emptyState('No operations yet')
        : table(
            'Operations by op',
            ['Op', 'Ops/s', 'OK', 'Busy', 'Rate-limited', 'Invalid', 'Error'],
            ops.map((op) => {
              const counts = q.totals[op]
              return [
                op,
                formatRate(q.opsPerSecond[op] ?? null),
                formatNumber(counts?.ok),
                formatNumber(counts?.busy),
                formatNumber(counts?.rate_limited),
                formatNumber(counts?.invalid),
                formatNumber(counts?.error),
              ]
            }),
          ),
      kvTable('Load', [
        ['In flight', formatNumber(q.inFlight)],
        ['Busy answers', formatNumber(sumBy(totals, (row) => row.busy))],
        ['Rate-limited answers', formatNumber(sumBy(totals, (row) => row.rate_limited))],
        ['Background completions', formatNumber(q.backgroundCompletions)],
      ]),
    ),
    section(
      'Latency',
      latencyRows.length === 0
        ? emptyState('No latency samples yet')
        : table('Latency by op, warm and cold', ['Op', 'p50', 'p95', 'p99', 'Count'], latencyRows),
    ),
    section('Guardrails', numberMapTable('Guardrail hits by reason', 'Reason', q.guardrailHits, 'No guardrail hits')),
    section(
      'Root-field cache',
      cache === null
        ? emptyState()
        : kvTable('Root-field cache', [
            ['Hit rate', formatPercent(cache.hits + cache.misses > 0 ? cache.hits / (cache.hits + cache.misses) : null)],
            ['Hits', formatNumber(cache.hits)],
            ['Misses', formatNumber(cache.misses)],
            ['Bytes', formatBytes(cache.bytes)],
          ]),
    ),
  ]
}

function connectionsPage(s: TelemetrySnapshot): Child[] {
  const c = s.connections
  return [
    section(
      'Connections',
      kvTable('Connection totals', [
        ['Open', formatNumber(c.open)],
        ['Authentications', formatNumber(c.authentications)],
        ['Slow-client disconnects', formatNumber(c.slowClientDisconnects)],
      ]),
    ),
    section(
      'By role',
      table('Open connections by role', ['Role', 'Open'], [
        ['Anonymous reader', formatNumber(c.byRole.anonymous_reader)],
        ['Member reader', formatNumber(c.byRole.member_reader)],
        ['Writer', formatNumber(c.byRole.writer)],
        ['Admin', formatNumber(c.byRole.admin)],
      ]),
    ),
    section(
      'By origin',
      table('Open connections by origin class', ['Origin', 'Open'], [
        ['Extension', formatNumber(c.byOrigin.extension)],
        ['Native app', formatNumber(c.byOrigin.native)],
        ['Other', formatNumber(c.byOrigin.other)],
      ]),
    ),
  ]
}

function memoryPage(s: TelemetrySnapshot, context: RenderContext): Child[] {
  const m = s.memory
  const shares = Object.entries(m.shares)
  return [
    section(
      'Process',
      charts(context, 'rss'),
      kvTable('Process memory', [
        ['Limit', formatBytes(m.limitBytes)],
        ['RSS', h('span', null, `${formatBytes(m.rssBytes)} `, meter(m.rssBytes, m.limitBytes, 'RSS of limit'))],
        ['RSS of limit', formatPercent(ratio(m.rssBytes, m.limitBytes))],
        ['Watchdog', h('span', { class: `watchdog watchdog-${m.watchdog}` }, m.watchdog)],
      ]),
    ),
    section(
      'Budget shares',
      shares.length === 0
        ? emptyState('No budget shares reported')
        : table(
            'Budget shares vs limit',
            ['Share', 'Bytes', 'Limit', 'Of limit'],
            shares.map(([name, share]) => {
              const used = ratio(share.bytes, share.limit)
              return [
                name,
                formatBytes(share.bytes),
                formatBytes(share.limit),
                h('span', { class: used !== null && used > 1 ? 'over' : undefined }, formatPercent(used)),
              ]
            }),
          ),
      implSection(m.impl),
    ),
  ]
}

function rootsPage(s: TelemetrySnapshot): Child[] {
  return [
    section(
      'Roots',
      kvTable('Root counts', [
        ['Active roots', formatNumber(s.roots.active)],
        ['Warming', formatNumber(s.roots.warming)],
        ['Coverage pushes sent', formatNumber(s.roots.coveragePushes)],
      ]),
    ),
  ]
}

function logsPage(s: TelemetrySnapshot): Child[] {
  const now = s.generatedAt
  const lines = [...s.logs].sort((a, b) => b.ts - a.ts).slice(0, 1000)
  return [
    section(
      'Warnings and errors',
      lines.length === 0
        ? emptyState('No warnings or errors')
        : table(
            `Last ${lines.length} warn / error lines, newest first`,
            ['Time', 'Level', 'Message'],
            lines.map((line) => [
              when(line.ts, now),
              h('span', { class: `level level-${line.level}` }, line.level),
              h('span', { class: 'msg' }, line.message),
            ]),
            { numericFrom: 99 },
          ),
    ),
  ]
}

function flatten(value: unknown, prefix: string, out: Array<[string, string]>, depth = 0): void {
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && depth < 8) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0 && prefix) out.push([prefix, '{}'])
    for (const [key, child] of entries) flatten(child, prefix ? `${prefix}.${key}` : key, out, depth + 1)
    return
  }
  out.push([prefix, typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value))])
}

function configPage(s: TelemetrySnapshot): Child[] {
  const effective: Array<[string, string]> = []
  flatten(s.config.effective, '', effective)
  const membership = s.config.membership
  return [
    section(
      'Effective settings',
      effective.length === 0
        ? emptyState('No settings reported')
        : kvTable('Effective settings (secrets redacted by the server)', effective.map(([key, value]) => [key, value])),
    ),
    section('NIP-11 document', h('pre', { class: 'json', tabindex: '0' }, JSON.stringify(s.config.nip11 ?? null, null, 2))),
    section(
      'Membership',
      membership === null
        ? emptyState()
        : [
            table('Members per role', ['Role', 'Members'], [
              ['Read', formatNumber(membership.counts.read)],
              ['Write', formatNumber(membership.counts.write)],
              ['Admin', formatNumber(membership.counts.admin)],
            ]),
            membership.members.length === 0
              ? emptyState('No members')
              : table(
                  'Members (public in the 13534 membership list)',
                  ['Member', 'Roles'],
                  membership.members.map((member) => [pubkeyCell(member.pubkey), member.roles.join(', ')]),
                  { numericFrom: 99 },
                ),
          ],
    ),
  ]
}
