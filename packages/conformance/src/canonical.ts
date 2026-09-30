/**
 * Order-insensitive fields (conformance.md § Canonical comparison): both the
 * actual output and the expectation are sorted the same way before matching,
 * so expectations may list set-valued arrays in any order.
 */

type Json = unknown

function byString<T>(key: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const x = key(a)
    const y = key(b)
    return x < y ? -1 : x > y ? 1 : 0
  }
}

const str = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value))

function sortInPlace(record: Record<string, Json>, field: string, compare: (a: Json, b: Json) => number): void {
  const value = record[field]
  if (Array.isArray(value)) record[field] = [...value].sort(compare)
}

function field(item: Json, name: string): string {
  return item && typeof item === 'object' ? str((item as Record<string, Json>)[name]) : str(item)
}

/** Sort the set-valued arrays of one query output (or expectation) in place. */
export function canonicalizeSets(type: string, value: Json): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const out = structuredClone(value) as Record<string, Json>
  sortInPlace(out, 'sourceEventIds', byString(str))
  sortInPlace(out, 'reasons', byString(str))
  const view = out.pathView
  if (view && typeof view === 'object') {
    sortInPlace(view as Record<string, Json>, 'nodes', byString((n) => field(n, 'subject')))
    sortInPlace(view as Record<string, Json>, 'edges', byString((e) => field(e, 'eventId')))
  }
  sortInPlace(out, 'ratingEdges', byString((e) => field(e, 'eventId')))
  if (type === 'neighborhood') {
    sortInPlace(out, 'nodes', byString((n) => field(n, 'subject')))
    sortInPlace(out, 'edges', byString((e) => field(e, 'eventId')))
  }
  if (type === 'frontier') {
    sortInPlace(out, 'authors', byString((a) => field(a, 'pubkey')))
  }
  return out
}
