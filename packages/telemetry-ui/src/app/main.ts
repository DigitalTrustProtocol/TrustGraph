import { createApp, type TelemetryApp } from './app'
import { parseHistory, SERIES_NAMES, type SeriesName } from './series'
import { safeStorage } from './theme'

export const TELEMETRY_URL = '/admin/api/telemetry'
export const STREAM_URL = '/admin/api/stream'
export const HISTORY_WINDOW_SECONDS = 3600
export const historyUrl = (series: SeriesName, windowSeconds = HISTORY_WINDOW_SECONDS): string =>
  `/admin/api/history?series=${encodeURIComponent(series)}&window=${windowSeconds}`

export interface StartOptions {
  root?: HTMLElement
  fetch?: typeof fetch
  /** `null` disables the live stream. */
  EventSource?: typeof EventSource | null
  storage?: Storage | null
  /** Delay before reopening a stream the browser gave up on (EventSource CLOSED). */
  reconnectDelayMs?: number
}

export interface RunningApp extends TelemetryApp {
  /** Resolves once the initial snapshot and history requests settle. */
  readonly ready: Promise<void>
  stop(): void
}

/**
 * Bootstrap: initial `GET /admin/api/telemetry`, optional history, then the
 * `/admin/api/stream` SSE (`event: snapshot`, data = full snapshot JSON).
 */
export function start(options: StartOptions = {}): RunningApp {
  const root = options.root ?? document.getElementById('app') ?? document.body
  const app = createApp(root, { storage: options.storage === undefined ? safeStorage() : options.storage })
  const fetchImpl = options.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)
  const EventSourceImpl = options.EventSource === undefined ? globalThis.EventSource : options.EventSource
  const reconnectDelayMs = options.reconnectDelayMs ?? 5000
  let source: EventSource | null = null
  let retry: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const getJson = async (url: string): Promise<unknown> => {
    if (!fetchImpl) throw new Error('fetch is unavailable')
    const response = await fetchImpl(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
    return response.json()
  }

  const loadSnapshot = async () => {
    try {
      if (!app.update(await getJson(TELEMETRY_URL)) && !app.snapshot) {
        app.showError(`${TELEMETRY_URL} did not return a dtp-telemetry/1 snapshot`)
      }
    } catch (error) {
      app.showError(`Could not load ${TELEMETRY_URL}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const loadHistory = async (name: SeriesName) => {
    try {
      const points = parseHistory(await getJson(historyUrl(name)), name)
      if (points) app.series.mergeHistory(name, points)
    } catch {
      // History is optional (404 on servers without ring buffers).
    }
  }

  const connect = () => {
    if (stopped) return
    if (!EventSourceImpl) {
      app.setStatus('offline')
      return
    }
    const stream = new EventSourceImpl(STREAM_URL)
    source = stream
    stream.onopen = () => app.setStatus('live')
    stream.addEventListener('snapshot', (event) => {
      try {
        app.update(JSON.parse((event as MessageEvent<string>).data))
        app.setStatus('live')
      } catch {
        // Ignore a malformed frame; the next one replaces it.
      }
    })
    stream.onerror = () => {
      if (stream.readyState === EventSourceImpl.CLOSED) {
        app.setStatus('offline')
        stream.close()
        if (source === stream) source = null
        retry = setTimeout(connect, reconnectDelayMs)
      } else {
        app.setStatus('reconnecting')
      }
    }
  }

  const ready = Promise.all([loadSnapshot(), ...SERIES_NAMES.map(loadHistory)]).then(() => undefined)
  connect()

  return Object.assign(Object.create(app) as TelemetryApp, {
    ready,
    stop() {
      stopped = true
      clearTimeout(retry)
      source?.close()
      source = null
      app.destroy()
    },
  })
}
