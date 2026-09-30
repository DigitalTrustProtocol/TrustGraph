import type { TelemetrySnapshot } from '../schema'

/** `[unixSeconds, value]`, as returned by `/admin/api/history`. */
export type Point = [number, number]

export const SERIES_NAMES = ['ops', 'ingest', 'rss', 'edges'] as const
export type SeriesName = (typeof SERIES_NAMES)[number]

/** One hour of 2 s live points plus history. */
export const SERIES_CAPACITY = 2000

const sum = (values: Record<string, number>): number =>
  Object.values(values).reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0)

export function seriesValue(name: SeriesName, snapshot: TelemetrySnapshot): number {
  switch (name) {
    case 'ops':
      return sum(snapshot.queries.opsPerSecond)
    case 'ingest':
      return sum(snapshot.ingest.eventsPerSecond)
    case 'rss':
      return snapshot.memory.rssBytes
    case 'edges':
      return snapshot.graph.edges['32009'] + snapshot.graph.edges['32014']
    default: {
      const unhandled: never = name
      throw new Error(`unknown series ${String(unhandled)}`)
    }
  }
}

/** Bounded in-memory series fed by live snapshots and optional history. */
export class SeriesStore {
  private readonly data = new Map<SeriesName, Point[]>()

  constructor(private readonly capacity = SERIES_CAPACITY) {
    for (const name of SERIES_NAMES) this.data.set(name, [])
  }

  get(name: SeriesName): readonly Point[] {
    return this.data.get(name) ?? []
  }

  push(snapshot: TelemetrySnapshot): void {
    for (const name of SERIES_NAMES) {
      const points = this.data.get(name) ?? []
      let value: number
      try {
        value = seriesValue(name, snapshot)
      } catch {
        continue
      }
      if (!Number.isFinite(value)) continue
      const point: Point = [snapshot.generatedAt, value]
      const last = points[points.length - 1]
      if (last && last[0] >= point[0]) points[points.length - 1] = point
      else points.push(point)
      this.trim(points)
      this.data.set(name, points)
    }
  }

  /** Merge history points older than the first live point. */
  mergeHistory(name: SeriesName, history: readonly Point[]): void {
    const points = this.data.get(name) ?? []
    const firstLive = points.length > 0 ? points[0][0] : Number.POSITIVE_INFINITY
    const older = history.filter(
      (point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) && point[0] < firstLive,
    )
    const merged = [...older, ...points]
    this.trim(merged)
    this.data.set(name, merged)
  }

  private trim(points: Point[]): void {
    if (points.length > this.capacity) points.splice(0, points.length - this.capacity)
  }
}

/** Parse a `/admin/api/history` body; `null` when it is not usable. */
export function parseHistory(body: unknown, name: SeriesName): Point[] | null {
  if (typeof body !== 'object' || body === null) return null
  const { series, points } = body as { series?: unknown; points?: unknown }
  if (series !== name || !Array.isArray(points)) return null
  return points.filter(
    (point): point is Point =>
      Array.isArray(point) && point.length >= 2 && typeof point[0] === 'number' && typeof point[1] === 'number',
  )
}
