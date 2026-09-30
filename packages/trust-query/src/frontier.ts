/**
 * Sync frontier (wot-model.md §8): whose events to fetch. Ported from
 * AttentionX `GraphManager.positiveChildren` / `positiveAuthorFrontier`;
 * adds each author's depth and one `via` parent to the result.
 * Not a trust result: it ignores the hop threshold.
 */

import type { Graph, GraphTrustConnectionOptions } from '@dtp/trust-graph'
import { IDENTITY_TRUST_CONTEXT } from './shared/trust-context'

const PUBKEY_HEX = /^[0-9a-f]{64}$/

export interface FrontierLimits {
  maxDepth: number
  maxAuthorsPerLevel: number
  maxTotalAuthors: number
}

export type FrontierReason = 'maxDepth' | 'maxAuthorsPerLevel' | 'maxTotalAuthors'

export interface FrontierAuthor {
  pubkey: string
  depth: number
  /** Lowest-sorted author at `depth - 1` with an active positive statement for this pubkey. */
  via?: string
}

export interface FrontierResult {
  authors: FrontierAuthor[]
  reasons: FrontierReason[]
}

/**
 * Positive, active, heap-resolved pubkey hops from these authors, including
 * `user:id` aliases bound onto a pubkey node. Returns child → first parent.
 */
export function positiveChildren(
  graph: Graph,
  authors: readonly string[],
  nowSeconds: number,
): Map<string, string> {
  const out = new Map<string, string>()
  const opts: GraphTrustConnectionOptions = {
    context: IDENTITY_TRUST_CONTEXT,
    value: 1,
    includeInactive: false,
    now: nowSeconds,
  }
  for (const author of authors) {
    const hex = author.trim().toLowerCase()
    if (!PUBKEY_HEX.test(hex)) continue
    for (const conn of graph.out(hex, opts)) {
      let child: string | undefined
      if (conn.subjectType === 'p' && PUBKEY_HEX.test(conn.subject)) {
        child = conn.subject.toLowerCase()
      } else if (conn.subjectType === 'i') {
        const bound = graph.iToP.get(conn.subject.toLowerCase())
        if (bound && PUBKEY_HEX.test(bound)) child = bound
      }
      if (child !== undefined && !out.has(child)) out.set(child, hex)
    }
  }
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

export function positiveAuthorFrontier(
  graph: Graph,
  roots: readonly string[],
  limits: FrontierLimits,
  nowSeconds = Math.floor(Date.now() / 1_000),
): FrontierResult {
  const reasons = new Set<FrontierReason>()
  let current = [
    ...new Set(
      roots
        .map((root) => root.trim().toLowerCase())
        .filter((root) => PUBKEY_HEX.test(root)),
    ),
  ].sort()
  if (current.length > limits.maxAuthorsPerLevel) {
    current = current.slice(0, limits.maxAuthorsPerLevel)
    reasons.add('maxAuthorsPerLevel')
  }
  if (current.length > limits.maxTotalAuthors) {
    current = current.slice(0, limits.maxTotalAuthors)
    reasons.add('maxTotalAuthors')
  }
  const discovered = new Map<string, FrontierAuthor>(
    current.map((pubkey) => [pubkey, { pubkey, depth: 0 }]),
  )
  for (let depth = 0; depth <= limits.maxDepth; depth += 1) {
    const children = [...positiveChildren(graph, current, nowSeconds)].filter(
      ([pubkey]) => !discovered.has(pubkey),
    )
    if (depth === limits.maxDepth) {
      if (children.length > 0) reasons.add('maxDepth')
      break
    }
    let next = children
    if (next.length > limits.maxAuthorsPerLevel) {
      next = next.slice(0, limits.maxAuthorsPerLevel)
      reasons.add('maxAuthorsPerLevel')
    }
    const remaining = limits.maxTotalAuthors - discovered.size
    if (next.length > remaining) {
      next = next.slice(0, Math.max(0, remaining))
      reasons.add('maxTotalAuthors')
    }
    for (const [pubkey, via] of next) {
      discovered.set(pubkey, { pubkey, depth: depth + 1, via })
    }
    current = next.map(([pubkey]) => pubkey)
    if (current.length === 0) break
  }
  return { authors: [...discovered.values()], reasons: [...reasons] }
}
