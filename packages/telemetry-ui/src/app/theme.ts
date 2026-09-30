export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'dtp-telemetry-theme'

/** `localStorage`, or `null` where it is unavailable (privacy mode, sandbox). */
export function safeStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage
    if (!storage) return null
    storage.getItem(THEME_STORAGE_KEY)
    return storage
  } catch {
    return null
  }
}

export function storedTheme(storage: Storage | null): Theme | null {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function prefersDark(): boolean {
  try {
    return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/** Stored choice, else the system preference. */
export function effectiveTheme(storage: Storage | null): Theme {
  return storedTheme(storage) ?? (prefersDark() ? 'dark' : 'light')
}

/** `null` follows `prefers-color-scheme` (CSS media query). */
export function applyTheme(doc: Document, theme: Theme | null): void {
  if (theme) doc.documentElement.dataset.theme = theme
  else delete doc.documentElement.dataset.theme
}

export function currentTheme(doc: Document, storage: Storage | null): Theme {
  const applied = doc.documentElement.dataset.theme
  return applied === 'light' || applied === 'dark' ? applied : effectiveTheme(storage)
}

export function toggleTheme(doc: Document, storage: Storage | null): Theme {
  const next: Theme = currentTheme(doc, storage) === 'dark' ? 'light' : 'dark'
  applyTheme(doc, next)
  try {
    storage?.setItem(THEME_STORAGE_KEY, next)
  } catch {
    // Not persisted; the choice still applies to this page.
  }
  return next
}
