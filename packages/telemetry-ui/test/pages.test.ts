// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { NOT_USED } from '../src/app/dom'
import { PAGES, renderPage, type PageId } from '../src/app/pages'
import { SeriesStore } from '../src/app/series'
import { sampleSnapshot } from '../src/fixture'
import type { TelemetrySnapshot } from '../src/schema'

let root: HTMLElement

beforeEach(() => {
  document.body.replaceChildren()
  root = document.createElement('main')
  document.body.appendChild(root)
})

function render(page: PageId, snapshot: TelemetrySnapshot = sampleSnapshot()): string {
  const series = new SeriesStore()
  series.push(snapshot)
  renderPage(root, page, snapshot, { series })
  return root.textContent ?? ''
}

function globalSnapshot(): TelemetrySnapshot {
  return sampleSnapshot({
    server: { kind: 'global', instanceId: 'global-eu-1' },
    sources: { relays: null, frontier: null, wantsOpen: null },
    queries: { fieldCache: { hits: 900, misses: 100, bytes: 2048 } },
    graph: { impl: { segments: 12, pinned_bytes: 4096 } },
    config: {
      membership: {
        counts: { read: 40, write: 3, admin: 1 },
        members: [{ pubkey: 'f'.repeat(64), roles: ['admin', 'write'] }],
      },
    },
  })
}

const EXPECTED: Record<PageId, string[]> = {
  overview: ['Ready', 'personal', 'dtp-resolver/1', 'dtp-wot/1', 'corpus-2026.09', 'personal-7f3a9c', '1d 2h', '4,812', 'Epoch lag', 'Source down', 'Operations per second'],
  graph: ['15,230', '48,211', '9,140', '2,311', 'Hinted statements', 'Delete floors', '12.0 MiB', '219.4', 'Implementation', 'v8_heap_bytes', '40.0 MiB'],
  ingest: ['32009 trust', '10011 identity claim', '2.4/s', '48,900', 'duplicate', '1,296', 'NIP-09 deletions', '3 / 10,000', 'Pending OKs', 'a1b2c3d4…8f90'],
  sources: ['wss://relay.example.com', 'backoff', '30m 0s', 'nodeBudget', '1,024', 'Open wants', 'a1b2c3d4…8f90'],
  queries: ['trust', '4.2/s', '90,210', 'trust (warm)', 'trust (cold)', '1.2 ms', '61.0 ms', 'timeBudget', 'Background completions', 'Root-field cache'],
  connections: ['Anonymous reader', 'Member reader', 'Writer', 'Admin', 'Extension', 'Native app', 'Authentications', 'Slow-client disconnects'],
  memory: ['512.0 MiB', '180.0 MiB', '35.2 %', 'ok', 'ingestQueue', 'Implementation', 'page_cache_resident_bytes'],
  roots: ['Active roots', 'Warming', 'Coverage pushes sent', '31'],
  logs: ['invalid signature', 'backoff 60s', 'error', 'warn'],
  config: ['admin.auth', 'local', '[redacted]', 'supported_nips', 'dtp-personal', 'Membership'],
}

describe('renderPage', () => {
  it.each(PAGES.map((page) => page.id))('renders %s from sampleSnapshot()', (page) => {
    const text = render(page)
    expect(root.querySelector('h1')?.textContent).toBe(PAGES.find((entry) => entry.id === page)?.title)
    for (const expected of EXPECTED[page]) expect(text).toContain(expected)
    expect(root.querySelectorAll('h2').length).toBeGreaterThan(0)
  })

  it('uses scoped table headers everywhere', () => {
    for (const { id } of PAGES) {
      render(id)
      for (const th of Array.from(root.querySelectorAll('th'))) {
        expect(['col', 'row']).toContain(th.getAttribute('scope'))
      }
    }
  })

  it('shows the empty state for null sections on the personal server', () => {
    expect(render('queries')).toContain(NOT_USED)
    expect(render('config')).toContain(NOT_USED)
  })

  it('renders a global-flavour snapshot', () => {
    const snapshot = globalSnapshot()
    const sources = render('sources', snapshot)
    expect(sources.split(NOT_USED).length - 1).toBe(3)
    expect(sources).toContain('a1b2c3d4…8f90')
    const queries = render('queries', snapshot)
    expect(queries).toContain('90.0 %')
    expect(queries).toContain('2.0 KiB')
    expect(queries).not.toContain(NOT_USED)
    const config = render('config', snapshot)
    expect(config).toContain('ffffffff…ffff')
    expect(config).toContain('admin, write')
    expect(config).toContain('40')
    expect(config).not.toContain(NOT_USED)
    expect(render('graph', snapshot)).toContain('segments')
    expect(render('overview', snapshot)).toContain('global-eu-1')
  })

  it('renders null numbers as n/a', () => {
    const snapshot = sampleSnapshot({
      graph: { epochLagSeconds: null, bytes: { total: null, resident: null, pinned: null }, bytesPerEdge: null },
      memory: { limitBytes: null },
      sources: { relays: [{ url: 'wss://r.example', state: 'idle', lastEoseAt: null, cursorLagSeconds: null, errors: 0, retryAt: null }] },
    })
    render('overview', snapshot)
    const epoch = Array.from(root.querySelectorAll('tr')).find((tr) => tr.textContent?.startsWith('Epoch lag'))
    expect(epoch?.querySelector('td')?.textContent).toBe('n/a')
    const graph = render('graph', snapshot)
    expect(graph.match(/n\/a/g)?.length).toBeGreaterThanOrEqual(4)
    expect(render('memory', snapshot)).toContain('n/a')
    expect(render('sources', snapshot).match(/n\/a/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('shows not-ready state and reason', () => {
    const text = render('overview', sampleSnapshot({ health: { ready: false, stateSinceSeconds: 200, notReadyReason: 'warming corpus' } }))
    expect(text).toContain('Not ready')
    expect(text).toContain('warming corpus')
    expect(text).toContain('3m 20s')
  })

  it('shows empty states for empty lists', () => {
    const snapshot = sampleSnapshot({
      logs: [],
      alerts: [],
      ingest: { writers: [] },
      sources: { relays: [] },
    })
    snapshot.ingest.rejectsByPrefix = {}
    expect(render('logs', snapshot)).toContain('No warnings or errors')
    expect(render('overview', snapshot)).toContain('No active alerts')
    const ingest = render('ingest', snapshot)
    expect(ingest).toContain('No writer connections')
    expect(ingest).toContain('No rejects')
    expect(render('sources', snapshot)).toContain('No relays configured')
  })

  it('renders hostile strings as text, never as HTML', () => {
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>'
    const snapshot = sampleSnapshot({
      logs: [{ ts: 1, level: 'error', message: payload }],
      health: { ready: false, notReadyReason: payload },
      server: { version: payload },
      sources: { relays: [{ url: payload, state: 'error', lastEoseAt: null, cursorLagSeconds: null, errors: 1, retryAt: null }] },
      queries: { opsPerSecond: { [payload]: 1 } },
      config: { effective: { [payload]: payload }, nip11: { name: payload } },
    })
    for (const page of ['logs', 'overview', 'sources', 'queries', 'config'] as const) {
      const text = render(page, snapshot)
      expect(text).toContain(payload)
      expect(root.querySelector('img')).toBeNull()
      expect(root.querySelector('script')).toBeNull()
    }
  })

  it('does not crash on a malformed snapshot', () => {
    const broken = { ...sampleSnapshot(), queries: null } as unknown as TelemetrySnapshot
    expect(() => render('queries', broken)).not.toThrow()
    expect(root.textContent).toContain('Could not render this page')
  })

  it('shows sparkline numbers next to the chart', () => {
    render('overview')
    const figures = root.querySelectorAll('figure.spark')
    expect(figures.length).toBe(4)
    expect(figures[0].querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true')
    expect(figures[0].textContent).toContain('5.6/s')
    expect(figures[2].textContent).toContain('180.0 MiB')
  })
})
