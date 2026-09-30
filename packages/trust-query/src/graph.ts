// Ported from AttentionX src/graph/graph.ts (imports rewritten for @dtp/* packages).
/**
 * Heap neighborhood (Graph.out / Graph.in) for Graph View expand.
 */

import {
  classifyTrustSubject,
  heapIndexId,
  parseHeapIndexId,
  visIdRecordKey,
  ratingScoreToEdgeValue,
} from './adapter'
import { trustEdgeValue } from '@dtp/trust-graph'
import type { Graph } from '@dtp/trust-graph'
import { RATING_STATEMENT_KIND } from '@dtp/trust-protocol'
import { viewNodeFromHeap } from './path-view'
import type {
  GraphPathViewEdge,
  GraphPathViewNode,
  GraphVisId,
} from './types'

export type { GraphNodeKind } from './types'

export type GraphViewNode = GraphPathViewNode
export type GraphViewEdge = GraphPathViewEdge

export type NeighborhoodDirection = 'out' | 'in' | 'both'
export type NeighborhoodValueFilter = 'trust' | 'distrust' | 'both'

function valueMatches(
  value: 1 | 0 | -1,
  filter: NeighborhoodValueFilter,
): boolean {
  if (filter === 'both') return true
  if (filter === 'trust') return value === 1
  if (filter === 'distrust') return value === -1
  return false
}

export type NeighborhoodOptions = {
  direction?: NeighborhoodDirection
  valueFilter?: NeighborhoodValueFilter
  context?: string
  now?: number
  limit?: number
  outboundPubkeys?: readonly string[]
  ratingContext?: string
}

export type NeighborhoodResult = {
  graphVersion: number
  centerId: GraphVisId
  truncated: boolean
  nodes: GraphViewNode[]
  edges: GraphViewEdge[]
}

/** One-hop neighborhood via Graph.out / Graph.in (Trust viz expand model). */
export function neighborhoodFromHeap(
  graph: Graph,
  graphVersion: number,
  centerId: GraphVisId,
  options: NeighborhoodOptions = {},
): NeighborhoodResult {
  const empty: NeighborhoodResult = {
    graphVersion,
    centerId,
    truncated: false,
    nodes: [],
    edges: [],
  }
  const direction = options.direction ?? 'both'
  const valueFilter = options.valueFilter ?? 'both'
  const now = options.now ?? Math.floor(Date.now() / 1_000)
  const limit = Math.max(1, Math.min(options.limit ?? 200, 500))
  const centerIndex = parseHeapIndexId(centerId)
  if (centerIndex === undefined) return empty
  const centerNode = graph.nodesList[centerIndex]
  if (!centerNode) return empty

  const centerView = viewNodeFromHeap(centerNode, 0)
  const nodes = new Map<GraphVisId, GraphViewNode>([[centerView.id, centerView]])
  const edges: GraphViewEdge[] = []
  const edgeKeys = new Set<GraphVisId>()
  let truncated = false

  const ensureHeapNode = (
    index: number,
    depth: number,
  ): GraphViewNode | undefined => {
    const node = graph.nodesList[index]
    if (!node) return undefined
    const id = heapIndexId(index)
    const existing = nodes.get(id)
    if (existing) {
      if (depth < existing.depth) existing.depth = depth
      return existing
    }
    const created = viewNodeFromHeap(node, depth)
    nodes.set(id, created)
    return created
  }

  const pushTrustConnection = (
    fromIndex: number,
    toIndex: number,
    edgeIndex: number,
  ): void => {
    const edge = graph.edgesList[edgeIndex]
    if (!edge) return
    const value = trustEdgeValue(edge)
    if (value === undefined) return
    if (!valueMatches(value, valueFilter)) return
    const id = heapIndexId(edge.index ?? edgeIndex)
    if (edgeKeys.has(id)) return
    if (edges.length >= limit) {
      truncated = true
      return
    }
    if (!ensureHeapNode(fromIndex, fromIndex === centerIndex ? 0 : 1)) return
    if (!ensureHeapNode(toIndex, toIndex === centerIndex ? 0 : 1)) return
    edges.push({
      id,
      from: heapIndexId(fromIndex),
      to: heapIndexId(toIndex),
      value,
      context: edge.c_tag ?? '',
      eventId: edge.id,
      depth: 1,
    })
    edgeKeys.add(id)
  }

  const wantOut = direction === 'out' || direction === 'both'
  const wantIn = direction === 'in' || direction === 'both'
  const connOpts = {
    context: options.context,
    now,
    includeInactive: false,
  }

  const outboundAuthors = [
    ...new Set(
      [
        centerNode.type === 'p' ? centerNode.id : undefined,
        ...(options.outboundPubkeys ?? []).map((pk) => pk.toLowerCase()),
      ].filter((pk): pk is string => typeof pk === 'string' && pk.length > 0),
    ),
  ]

  if (wantOut) {
    outer: for (const author of outboundAuthors) {
      const fromIndex = graph.nodesIndex.get(author)
      if (fromIndex === undefined) continue
      for (const conn of graph.out(author, connOpts)) {
        const toIndex = graph.nodesIndex.get(conn.subject.toLowerCase())
        const edgeIndex = graph.edgesIndex.get(conn.edge.addressKey)
        if (toIndex === undefined || edgeIndex === undefined) continue
        pushTrustConnection(fromIndex, toIndex, edgeIndex)
        if (truncated) break outer
      }
    }
  }

  if (wantIn) {
    for (const conn of graph.in(centerNode.id, connOpts)) {
      const fromIndex = graph.nodesIndex.get(conn.author.toLowerCase())
      const edgeIndex = graph.edgesIndex.get(conn.edge.addressKey)
      if (fromIndex === undefined || edgeIndex === undefined) continue
      pushTrustConnection(fromIndex, centerIndex, edgeIndex)
      if (truncated) break
    }
  }

  if (wantIn && centerNode.type !== 'p' && !truncated) {
    const meta = classifyTrustSubject({
      type: centerNode.type,
      value: centerNode.id,
    })
    if (meta.kind === 'post') {
      const ratingContext = options.ratingContext ?? ''
      const seenFrom = new Set(
        edges
          .filter((edge) => edge.to === centerView.id)
          .map((edge) => edge.from),
      )
      for (const conn of graph.in(centerNode.id, {
        context: ratingContext,
        kind: RATING_STATEMENT_KIND,
        now,
        includeInactive: false,
      })) {
        const score = conn.edge.nValue
        if (score === undefined) continue
        const value = ratingScoreToEdgeValue(score)
        if (!valueMatches(value, valueFilter)) continue
        const fromIndex = graph.nodesIndex.get(conn.author.toLowerCase())
        if (fromIndex === undefined) continue
        const fromId = heapIndexId(fromIndex)
        if (seenFrom.has(fromId)) continue
        if (edges.length >= limit) {
          truncated = true
          break
        }
        if (!ensureHeapNode(fromIndex, 1)) continue
        seenFrom.add(fromId)
        const eventId = conn.edge.eventId ?? conn.edge.dTag
        edges.push({
          id: eventId,
          from: fromId,
          to: centerView.id,
          value,
          context: conn.edge.context,
          eventId,
          depth: 1,
        })
      }
    }
  }

  const nodeList = [...nodes.values()].sort(
    (a, b) =>
      a.depth - b.depth ||
      visIdRecordKey(a.id).localeCompare(visIdRecordKey(b.id)),
  )
  return {
    graphVersion,
    centerId: centerView.id,
    truncated,
    nodes: nodeList,
    edges,
  }
}
