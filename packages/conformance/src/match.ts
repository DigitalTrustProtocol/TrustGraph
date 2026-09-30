/**
 * Expectation matching. An expectation is a partial object: every key it
 * names must match; keys it omits are not compared. Arrays match element
 * by element and must have the same length. Numbers match within 1e-9
 * (conformance.md § Canonical comparison, `averageScore`).
 */

export const NUMBER_TOLERANCE = 1e-9

export function matchPartial(actual: unknown, expected: unknown, path = '$'): string[] {
  if (expected === null) {
    return actual === null || actual === undefined ? [] : [`${path}: expected null, got ${show(actual)}`]
  }
  if (typeof expected === 'number') {
    return typeof actual === 'number' && Math.abs(actual - expected) <= NUMBER_TOLERANCE
      ? []
      : [`${path}: expected ${expected}, got ${show(actual)}`]
  }
  if (typeof expected !== 'object') {
    return Object.is(actual, expected) ? [] : [`${path}: expected ${show(expected)}, got ${show(actual)}`]
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: expected array, got ${show(actual)}`]
    if (actual.length !== expected.length) {
      return [`${path}: expected ${expected.length} items, got ${actual.length}: ${show(actual)}`]
    }
    return expected.flatMap((item, i) => matchPartial(actual[i], item, `${path}[${i}]`))
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    return [`${path}: expected object, got ${show(actual)}`]
  }
  const record = actual as Record<string, unknown>
  return Object.entries(expected as Record<string, unknown>).flatMap(([key, value]) => {
    if (value === undefined) return []
    return matchPartial(record[key], value, `${path}.${key}`)
  })
}

function show(value: unknown): string {
  const text = JSON.stringify(value)
  return text === undefined ? String(value) : text.length > 300 ? `${text.slice(0, 300)}…` : text
}
