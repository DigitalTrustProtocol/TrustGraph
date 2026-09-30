/**
 * `graph.field` (resolver-api.md): the walk's level structure from one root
 * with no subject, shaped `{ graphVersion, completeDepth, levels, binds }`.
 * Levels come from `IndexResolver.field`, the same walk as trust queries.
 */

import type { FieldBind, Graph, IResolveStrategy, WalkTruncation } from '@dtp/trust-graph'
import { DEFAULT_RESOLVE_BOUNDS, normalizeResolveBounds } from './bounds'
import { walkOptions } from './query'
import { IDENTITY_TRUST_CONTEXT } from './shared/trust-context'
import { clampFollowTrustThreshold } from './shared/wot-follow-trust-threshold'
import { WOT_MAX_DEGREE_HARD_CAP } from './shared/wot-max-degree'
import type { WalkQueryOptions } from './types'

export interface FieldQuery extends WalkQueryOptions {
  rootPubkey: string
  /** Hop threshold percent; default as for trust queries. */
  followTrustThreshold?: number
  maxDepth?: number
  now?: number
}

export interface FieldQueryResult {
  graphVersion: number
  completeDepth: number
  levels: string[][]
  binds: FieldBind[]
  truncated?: true
  truncatedReasons?: WalkTruncation[]
}

export function executeFieldQuery(
  graph: Graph,
  resolver: IResolveStrategy,
  query: FieldQuery,
  graphVersion: number,
): FieldQueryResult {
  const now = query.now ?? Math.floor(Date.now() / 1_000)
  if (!Number.isFinite(now)) throw new RangeError('now must be finite')
  const bounds = normalizeResolveBounds({
    ...DEFAULT_RESOLVE_BOUNDS,
    ...(query.maxDepth !== undefined ? { maxDepth: query.maxDepth } : {}),
  })
  const field = resolver.field(query.rootPubkey.toLowerCase(), {
    graph,
    trustContext: IDENTITY_TRUST_CONTEXT,
    maxDepth: Math.min(bounds.maxDepth, WOT_MAX_DEGREE_HARD_CAP),
    followTrustThreshold: clampFollowTrustThreshold(query.followTrustThreshold),
    now,
    ...walkOptions(query),
  })
  return {
    graphVersion,
    completeDepth: field.completeDepth,
    levels: field.levels,
    binds: field.binds,
    ...(field.truncated !== undefined ? { truncated: true, truncatedReasons: [field.truncated] } : {}),
  }
}
