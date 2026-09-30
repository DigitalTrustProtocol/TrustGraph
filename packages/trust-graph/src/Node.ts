/**
 * Vendored from DigitalTrustProtocol/Trust (src/lib/trust/graph/Node.ts).
 * Attention: `out`/`in` renamed to outbound/inbound (reserved-word safe for Oxc).
 * Context buckets are kind-prefixed; 32009 and 32014 do not share an index.
 * A peer may still hold multiple same-kind edge indexes in one bucket.
 */

import type { Graph } from './Graph'
import type { Identity, SubjectType } from './types'

/** contextIndex → peerNodeIndex → edge indexes (same kind). */
export type PeerEdgeMap = Map<number, number[]>

function pushPeerEdge(
  map: PeerEdgeMap,
  peerIndex: number,
  edgeIndex: number,
): void {
  let edges = map.get(peerIndex)
  if (!edges) {
    edges = []
    map.set(peerIndex, edges)
  }
  if (!edges.includes(edgeIndex)) edges.push(edgeIndex)
}

export function removePeerEdge(
  map: PeerEdgeMap,
  peerIndex: number,
  edgeIndex: number,
): void {
  const edges = map.get(peerIndex)
  if (!edges) return
  const next = edges.filter((index) => index !== edgeIndex)
  if (next.length === 0) map.delete(peerIndex)
  else map.set(peerIndex, next)
}

export function* eachPeerEdge(
  map: PeerEdgeMap,
): IterableIterator<[number, number]> {
  for (const [peerIndex, edges] of map) {
    for (const edgeIndex of edges) yield [peerIndex, edgeIndex]
  }
}

export class Node {
  index: number = 0
  id: string = ''
  type: SubjectType = 'p'
  identity?: Identity

  outbound: Map<number, PeerEdgeMap> = new Map()
  inbound: Map<number, PeerEdgeMap> = new Map()

  edges: Set<number> = new Set()

  constructor(id: string, type: SubjectType) {
    this.id = id
    this.type = type
  }

  get out(): Map<number, PeerEdgeMap> {
    return this.outbound
  }

  get in(): Map<number, PeerEdgeMap> {
    return this.inbound
  }

  *getOut(contextIndexes: number[]): IterableIterator<[number, number]> {
    for (const contextIndex of contextIndexes) {
      const outMap = this.outbound.get(contextIndex)
      if (!outMap) continue
      yield* eachPeerEdge(outMap)
    }
  }

  addOut(contextIndex: number, subjectIndex: number, edgeIndex: number): void {
    let outMap = this.outbound.get(contextIndex)
    if (!outMap) {
      outMap = new Map()
      this.outbound.set(contextIndex, outMap)
    }
    pushPeerEdge(outMap, subjectIndex, edgeIndex)
  }

  addIn(contextIndex: number, subjectIndex: number, edgeIndex: number): void {
    let inMap = this.inbound.get(contextIndex)
    if (!inMap) {
      inMap = new Map()
      this.inbound.set(contextIndex, inMap)
    }
    pushPeerEdge(inMap, subjectIndex, edgeIndex)
  }

  removeOut(
    graph: Graph,
    contextIndex: number,
    subjectIndex: number,
    createdAt: number,
    kind: number,
  ): void {
    const contextMap = this.outbound.get(contextIndex)
    if (!contextMap) return
    const edges = contextMap.get(subjectIndex)
    if (!edges) return
    const keep: number[] = []
    for (const edgeIndex of edges) {
      const edge = graph.edgesList[edgeIndex]
      if (
        edge &&
        edge.kind === kind &&
        edge.created_at <= createdAt
      ) {
        continue
      }
      keep.push(edgeIndex)
    }
    if (keep.length === 0) contextMap.delete(subjectIndex)
    else contextMap.set(subjectIndex, keep)
    if (contextMap.size === 0) this.outbound.delete(contextIndex)
  }

  removeIn(
    graph: Graph,
    contextIndex: number,
    subjectIndex: number,
    createdAt: number,
    kind: number,
  ): void {
    const inMap = this.inbound.get(contextIndex)
    if (!inMap) return
    const edges = inMap.get(subjectIndex)
    if (!edges) return
    const keep: number[] = []
    for (const edgeIndex of edges) {
      const edge = graph.edgesList[edgeIndex]
      if (
        edge &&
        edge.kind === kind &&
        edge.created_at <= createdAt
      ) {
        continue
      }
      keep.push(edgeIndex)
    }
    if (keep.length === 0) inMap.delete(subjectIndex)
    else inMap.set(subjectIndex, keep)
    if (inMap.size === 0) this.inbound.delete(contextIndex)
  }
}
