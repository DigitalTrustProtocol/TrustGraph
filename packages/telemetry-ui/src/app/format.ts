/** Display formatting for telemetry values. Timestamps are unix seconds. */

export const NA = 'n/a'

type Maybe = number | null | undefined

const isNum = (value: Maybe): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const grouping = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

export function formatNumber(value: Maybe): string {
  return isNum(value) ? grouping.format(value) : NA
}

const BYTE_UNITS = ['KiB', 'MiB', 'GiB', 'TiB']

export function formatBytes(value: Maybe): string {
  if (!isNum(value)) return NA
  const sign = value < 0 ? '-' : ''
  let size = Math.abs(value)
  if (size < 1024) return `${sign}${Math.round(size)} B`
  let unit = -1
  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${sign}${size.toFixed(1)} ${BYTE_UNITS[unit]}`
}

/** Whole-second duration such as `3d 4h`, `2h 5m`, `5m 3s`, `42s`. */
export function formatDuration(seconds: Maybe): string {
  if (!isNum(seconds)) return NA
  const total = Math.max(0, Math.floor(seconds))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${secs}s`
  return `${secs}s`
}

/** Rate with one decimal, e.g. `12.5/s`. */
export function formatRate(value: Maybe): string {
  return isNum(value) ? `${value.toFixed(1)}/s` : NA
}

/** Ratio 0..1 as a percentage with one decimal. */
export function formatPercent(ratio: Maybe): string {
  return isNum(ratio) ? `${(ratio * 100).toFixed(1)} %` : NA
}

/** Latency in seconds as `ms` below one second. */
export function formatLatency(seconds: Maybe): string {
  if (!isNum(seconds)) return NA
  if (seconds < 1) return `${(seconds * 1000).toFixed(1)} ms`
  return `${seconds.toFixed(2)} s`
}

function toMillis(timestamp: number): number {
  // Tolerate servers that send milliseconds.
  return timestamp > 1e12 ? timestamp : timestamp * 1000
}

export function formatTimestamp(timestamp: Maybe): string {
  if (!isNum(timestamp)) return NA
  const date = new Date(toMillis(timestamp))
  if (Number.isNaN(date.getTime())) return NA
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** `5m ago` / `in 5m` relative to `nowSeconds`. */
export function formatRelative(timestamp: Maybe, nowSeconds: number): string {
  if (!isNum(timestamp)) return NA
  const delta = nowSeconds - toMillis(timestamp) / 1000
  if (Math.abs(delta) < 1) return 'now'
  const text = formatDuration(Math.abs(delta))
  return delta > 0 ? `${text} ago` : `in ${text}`
}

/** Shortened pubkey for writers and members only. */
export function shortPubkey(pubkey: string | null | undefined): string {
  if (!pubkey) return 'anonymous'
  if (pubkey.length <= 16) return pubkey
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`
}
