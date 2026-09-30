// Ported from AttentionX src/graph/path-view.ts (imports rewritten for @dtp/* packages).
/**
 * Maps IndexResolver / PathStrategyJson Score[] onto heap-index Graph View.
 */

import { classifyTrustSubject, heapIndexId } from './adapter'
import { trustEdgeValue } from '@dtp/trust-graph'
import type { Graph } from '@dtp/trust-graph'
import type { Node } from '@dtp/trust-graph'
import type { Score } from '@dtp/trust-graph'
import type {
  GraphPathView,
  GraphPathViewEdge,
  GraphPathViewNode,
  GraphVisId,
  TrustSubject,
} from './types'

export const EMPTY_PATH_VIEW: GraphPathView = { nodes: [], edges: [] }

export function heapNodeSubject(node: Node): TrustSubject {
  return { type: node.type, value: node.id }
}

export function viewNodeFromHeap(
  node: Node,
  depth: number,
): GraphPathViewNode {
  const subject = heapNodeSubject(node)
  const meta = classifyTrustSubject(subject)
  return {
    id: heapIndexId(node.index),
    kind: meta.kind,
    depth,
    label: meta.label,
    subject,
  }
}

function ensureViewNode(
  nodes: Map<GraphVisId, GraphPathViewNode>,
  node: Node,
  depth: number,
): GraphPathViewNode {
  const id = heapIndexId(node.index)
  const existing = nodes.get(id)
  if (existing) {
    if (depth < existing.depth) existing.depth = depth
    return existing
  }
  const created = viewNodeFromHeap(node, depth)
  nodes.set(id, created)
  return created
}

/**
 * Iterate PathStrategyJson scores (or a lone subject score) into vis nodes
 * and edges keyed by heap indexes.
 */
export function scoresToPathView(
  graph: Graph,
  scores: readonly Score[],
): GraphPathView {
  const nodes = new Map<GraphVisId, GraphPathViewNode>()
  const edges: GraphPathViewEdge[] = []
  const seenEdges = new Set<GraphVisId>()

  for (const score of scores) {
    if (score.subjectIndex === undefined) continue
    const node = graph.nodesList[score.subjectIndex]
    if (!node) continue
    ensureViewNode(nodes, node, score.degree)
    if (!score.edges) continue
    for (const edgeIndex of score.edges) {
      const edge = graph.edgesList[edgeIndex]
      if (!edge) continue
      const value = trustEdgeValue(edge)
      if (value === undefined) continue
      const fromIndex = graph.nodesIndex.get(edge.pubkey.toLowerCase())
      if (fromIndex === undefined) continue
      const fromNode = graph.nodesList[fromIndex]
      if (!fromNode) continue
      ensureViewNode(nodes, fromNode, Math.max(0, score.degree - 1))
      const id = heapIndexId(edge.index ?? edgeIndex)
      if (seenEdges.has(id)) continue
      seenEdges.add(id)
      edges.push({
        id,
        from: heapIndexId(fromIndex),
        to: heapIndexId(node.index),
        value,
        context: edge.c_tag ?? '',
        eventId: edge.id,
        depth: score.degree,
      })
    }
  }

  return {
    nodes: [...nodes.values()],
    edges,
  }
}

export function unionPathViews(
  views: readonly GraphPathView[],
): GraphPathView {
  const nodes = new Map<GraphVisId, GraphPathViewNode>()
  const edges = new Map<GraphVisId, GraphPathViewEdge>()
  for (const view of views) {
    for (const node of view.nodes) {
      const existing = nodes.get(node.id)
      if (!existing) {
        nodes.set(node.id, {
          ...node,
          ...(node.subject ? { subject: { ...node.subject } } : {}),
        })
        continue
      }
      if (node.depth < existing.depth) existing.depth = node.depth
    }
    for (const edge of view.edges) {
      if (!edges.has(edge.id)) edges.set(edge.id, { ...edge })
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}
