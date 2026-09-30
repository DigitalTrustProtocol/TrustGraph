/**
 * Vendored from DigitalTrustProtocol/Trust (src/lib/trust/graph/Edge.ts).
 * Attention: the heap edge is the EventRecord. Validity is a module function.
 */

import type { ITrustEvent } from './types'

export type IEdge = ITrustEvent

export function isValidAt(
  edge: IEdge,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (edge.activate !== undefined && now < edge.activate) return false
  if (edge.expire !== undefined && now > edge.expire) return false
  return true
}

export function trustEdgeValue(edge: IEdge): -1 | 0 | 1 | undefined {
  if (edge.nValue === 1 || edge.nValue === 0 || edge.nValue === -1) {
    return edge.nValue
  }
  return undefined
}
