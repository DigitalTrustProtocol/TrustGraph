// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, parseRoute, type TelemetryApp } from '../src/app/app'
import { historyUrl, start, STREAM_URL, TELEMETRY_URL, type RunningApp } from '../src/app/main'
import { THEME_STORAGE_KEY } from '../src/app/theme'
import { sampleSnapshot } from '../src/fixture'

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
}

class FakeEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static instances: FakeEventSource[] = []
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSED = 2
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  private readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>()

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  close() {
    this.readyState = 2
  }
  open() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }
  fail(state: number) {
    this.readyState = state
    this.onerror?.(new Event('error'))
  }
  emit(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data }))
  }
}

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response

let root: HTMLElement
let app: TelemetryApp | RunningApp | null = null

function setHash(hash: string) {
  window.location.hash = hash
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

const statusText = () => root.querySelector('.conn')?.textContent
const heading = () => root.querySelector('h1')?.textContent

beforeEach(() => {
  window.location.hash = ''
  document.documentElement.removeAttribute('data-theme')
  document.body.replaceChildren()
  root = document.createElement('div')
  document.body.appendChild(root)
  FakeEventSource.instances = []
})

afterEach(() => {
  if (app && 'stop' in app) app.stop()
  else app?.destroy()
  app = null
})

describe('parseRoute', () => {
  it('maps hashes to pages', () => {
    expect(parseRoute('')).toBe('overview')
    expect(parseRoute('#/')).toBe('overview')
    expect(parseRoute('#/graph')).toBe('graph')
    expect(parseRoute('#/logs?x=1')).toBe('logs')
    expect(parseRoute('#/nope')).toBe('overview')
    expect(parseRoute('#main')).toBeNull()
  })
})

describe('createApp', () => {
  it('renders nav links and switches pages on hashchange', () => {
    app = createApp(root)
    app.update(sampleSnapshot())
    const links = Array.from(root.querySelectorAll('nav a'))
    expect(links.map((link) => link.getAttribute('href'))).toContain('#/config')
    expect(links).toHaveLength(10)
    expect(heading()).toBe('Overview')
    expect(root.querySelector('a[aria-current="page"]')?.textContent).toBe('Overview')

    setHash('#/graph')
    expect(app.page).toBe('graph')
    expect(heading()).toBe('Graph')
    expect(root.querySelectorAll('[aria-current]')).toHaveLength(1)
    expect(root.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('#/graph')
    expect(document.activeElement?.id).toBe('page-title')
    expect(document.title).toContain('Graph')

    setHash('#main')
    expect(app.page).toBe('graph')

    setHash('#/unknown')
    expect(app.page).toBe('overview')
  })

  it('starts on the page in the URL', () => {
    window.location.hash = '#/memory'
    app = createApp(root)
    app.update(sampleSnapshot())
    expect(heading()).toBe('Memory')
  })

  it('navigate() updates the hash', () => {
    app = createApp(root)
    app.update(sampleSnapshot())
    app.navigate('logs')
    expect(window.location.hash).toBe('#/logs')
    expect(heading()).toBe('Logs')
  })

  it('rejects invalid and stale snapshots', () => {
    app = createApp(root)
    expect(app.update({ schema: 'other' })).toBe(false)
    expect(app.update(sampleSnapshot({ generatedAt: 100 }))).toBe(true)
    expect(app.update(sampleSnapshot({ generatedAt: 99 }))).toBe(false)
    expect(app.snapshot?.generatedAt).toBe(100)
  })

  it('shows connection status', () => {
    app = createApp(root)
    expect(statusText()).toContain('Connecting')
    app.setStatus('live')
    expect(statusText()).toContain('Live')
    expect(root.querySelector('.conn')?.getAttribute('data-status')).toBe('live')
  })

  it('toggles and persists the theme', () => {
    const storage = new MemoryStorage()
    app = createApp(root, { storage })
    const button = root.querySelector<HTMLButtonElement>('button.theme')
    expect(button).not.toBeNull()
    button?.click()
    const first = document.documentElement.dataset.theme
    expect(first === 'dark' || first === 'light').toBe(true)
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe(first)
    button?.click()
    expect(document.documentElement.dataset.theme).not.toBe(first)
    expect(button?.getAttribute('aria-label')).toMatch(/^Switch to (light|dark) theme$/)
  })

  it('applies a stored theme and works without storage', () => {
    const storage = new MemoryStorage()
    storage.setItem(THEME_STORAGE_KEY, 'dark')
    app = createApp(root, { storage })
    expect(document.documentElement.dataset.theme).toBe('dark')
    app.destroy()

    document.documentElement.removeAttribute('data-theme')
    app = createApp(root, { storage: null })
    const button = root.querySelector<HTMLButtonElement>('button.theme')
    button?.click()
    const first = document.documentElement.dataset.theme
    button?.click()
    expect(document.documentElement.dataset.theme).not.toBe(first)
  })
})

describe('start', () => {
  it('loads the snapshot and history, then follows the stream', async () => {
    const requested: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      requested.push(url)
      if (url === TELEMETRY_URL) return jsonResponse(sampleSnapshot())
      if (url === historyUrl('ops')) {
        return jsonResponse({ series: 'ops', points: [[1_789_999_000, 1], [1_789_999_500, 2], 'junk'] })
      }
      return jsonResponse({ error: 'not found' }, 404)
    }) as typeof fetch

    const running = start({ root, fetch: fetchImpl, EventSource: FakeEventSource as unknown as typeof EventSource, storage: null, reconnectDelayMs: 1 })
    app = running
    await running.ready

    expect(requested).toContain(TELEMETRY_URL)
    expect(requested).toContain('/admin/api/history?series=rss&window=3600')
    expect(heading()).toBe('Overview')
    expect(root.textContent).toContain('personal-7f3a9c')
    expect(running.series.get('ops')).toHaveLength(3)
    expect(running.series.get('rss')).toHaveLength(1)

    const stream = FakeEventSource.instances[0]
    expect(stream.url).toBe(STREAM_URL)
    stream.open()
    expect(statusText()).toContain('Live')

    stream.emit('snapshot', JSON.stringify(sampleSnapshot({ generatedAt: 1_790_000_002, server: { instanceId: 'next-instance' } })))
    expect(root.textContent).toContain('next-instance')
    expect(running.series.get('ops')).toHaveLength(4)

    stream.emit('snapshot', '{not json')
    expect(root.textContent).toContain('next-instance')

    stream.fail(FakeEventSource.CONNECTING)
    expect(statusText()).toContain('Reconnecting')

    stream.fail(FakeEventSource.CLOSED)
    expect(statusText()).toContain('Offline')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it('shows an error when the snapshot cannot be loaded', async () => {
    const fetchImpl = (async () => jsonResponse({}, 503)) as typeof fetch
    const running = start({ root, fetch: fetchImpl, EventSource: FakeEventSource as unknown as typeof EventSource, storage: null })
    app = running
    await running.ready
    expect(heading()).toBe('Telemetry unavailable')
    expect(root.textContent).toContain('HTTP 503')

    FakeEventSource.instances[0].emit('snapshot', JSON.stringify(sampleSnapshot()))
    expect(heading()).toBe('Overview')
  })

  it('reports offline without EventSource support', async () => {
    const fetchImpl = (async () => jsonResponse(sampleSnapshot())) as typeof fetch
    const running = start({ root, fetch: fetchImpl, EventSource: null, storage: null })
    app = running
    await running.ready
    expect(statusText()).toContain('Offline')
    expect(root.textContent).toContain('personal-7f3a9c')
  })
})
