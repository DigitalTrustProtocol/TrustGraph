import { TELEMETRY_SCHEMA, type TelemetrySnapshot } from '../schema'
import { h } from './dom'
import { DEFAULT_PAGE, isPageId, PAGES, pageTitle, renderPage, type PageId } from './pages'
import { SeriesStore } from './series'
import { applyTheme, currentTheme, storedTheme, toggleTheme, type Theme } from './theme'

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline'

export const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
}

export interface TelemetryApp {
  readonly series: SeriesStore
  readonly page: PageId
  readonly snapshot: TelemetrySnapshot | null
  readonly status: ConnectionStatus
  /** Accepts a full snapshot; returns false when it is invalid or older than the current one. */
  update(snapshot: unknown): boolean
  setStatus(status: ConnectionStatus): void
  showError(message: string): void
  navigate(page: PageId): void
  destroy(): void
}

export function isSnapshot(value: unknown): value is TelemetrySnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { schema?: unknown }).schema === TELEMETRY_SCHEMA &&
    typeof (value as { generatedAt?: unknown }).generatedAt === 'number'
  )
}

/**
 * `#/graph` → `graph`; empty or unknown `#/…` → default page; other hashes
 * (for example the skip link `#main`) → `null`, meaning "stay".
 */
export function parseRoute(hash: string): PageId | null {
  if (hash === '' || hash === '#' || hash === '#/') return DEFAULT_PAGE
  if (!hash.startsWith('#/')) return null
  const id = hash.slice(2).split(/[/?]/)[0]
  return isPageId(id) ? id : DEFAULT_PAGE
}

/** Build the shell (header, nav, main) inside `root` and wire hash routing. */
export function createApp(root: HTMLElement, options: { storage?: Storage | null } = {}): TelemetryApp {
  const doc = root.ownerDocument
  const win = doc.defaultView
  const storage = options.storage ?? null
  const series = new SeriesStore()
  let page: PageId = parseRoute(win?.location.hash ?? '') ?? DEFAULT_PAGE
  let snapshot: TelemetrySnapshot | null = null
  let status: ConnectionStatus = 'connecting'

  applyTheme(doc, storedTheme(storage))

  const statusText = h('span', null, STATUS_LABELS[status])
  const statusEl = h('span', { class: 'conn', 'data-status': status, role: 'status', 'aria-live': 'polite' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), statusText)
  const themeButton = h('button', { type: 'button', class: 'theme' })
  const syncThemeButton = (theme: Theme) => {
    const next = theme === 'dark' ? 'light' : 'dark'
    themeButton.textContent = theme === 'dark' ? 'Light theme' : 'Dark theme'
    themeButton.setAttribute('aria-label', `Switch to ${next} theme`)
  }
  syncThemeButton(currentTheme(doc, storage))
  themeButton.addEventListener('click', () => {
    syncThemeButton(toggleTheme(doc, storage))
    render()
  })

  const links = new Map<PageId, HTMLAnchorElement>()
  const navList = h('ul', null)
  for (const entry of PAGES) {
    const link = h('a', { href: `#/${entry.id}` }, entry.title)
    links.set(entry.id, link)
    navList.appendChild(h('li', null, link))
  }
  const main = h('main', { id: 'main', tabindex: '-1' }, h('p', { class: 'empty' }, 'Loading telemetry…'))

  root.replaceChildren(
    h('a', { class: 'skip', href: '#main' }, 'Skip to content'),
    h('header', { class: 'top' }, h('span', { class: 'brand' }, 'DTP telemetry'), statusEl, themeButton),
    h('div', { class: 'layout' }, h('nav', { 'aria-label': 'Pages' }, navList), main),
  )

  const syncNav = () => {
    for (const [id, link] of links) {
      if (id === page) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
    }
    doc.title = `${pageTitle(page)} · DTP telemetry`
  }

  const render = () => {
    if (snapshot) renderPage(main, page, snapshot, { series })
  }

  const navigate = (next: PageId) => {
    if (next === page) return
    page = next
    syncNav()
    render()
    doc.getElementById('page-title')?.focus()
  }

  const onHashChange = () => {
    const next = parseRoute(win?.location.hash ?? '')
    if (next) navigate(next)
    else if (win?.location.hash === '#main') main.focus()
  }
  win?.addEventListener('hashchange', onHashChange)
  syncNav()

  return {
    series,
    get page() {
      return page
    },
    get snapshot() {
      return snapshot
    },
    get status() {
      return status
    },
    update(next: unknown): boolean {
      if (!isSnapshot(next)) return false
      if (snapshot && next.generatedAt < snapshot.generatedAt) return false
      snapshot = next
      series.push(next)
      render()
      return true
    },
    setStatus(next: ConnectionStatus) {
      if (next === status) return
      status = next
      statusEl.dataset.status = next
      statusText.textContent = STATUS_LABELS[next]
    },
    showError(message: string) {
      if (snapshot) return
      main.replaceChildren(h('h1', null, 'Telemetry unavailable'), h('p', { class: 'error' }, message))
    },
    navigate(next: PageId) {
      if (win && win.location.hash !== `#/${next}`) win.location.hash = `#/${next}`
      navigate(next)
    },
    destroy() {
      win?.removeEventListener('hashchange', onHashChange)
    },
  }
}
