// Ported from AttentionX src/graph/query.ts (imports rewritten for @dtp/* packages).
/**
 * Maps IndexResolver Score[] → Attention TrustQueryResult.
 */

import { graphSubjectId } from './adapter'
import { IDENTITY_TRUST_CONTEXT } from './shared/trust-context'
import { WOT_MAX_DEGREE_HARD_CAP } from './shared/wot-max-degree'
import { trustScoreResolution } from './shared/trust-score'
import {
  clampFollowTrustRed,
  clampFollowTrustThreshold,
} from './shared/wot-follow-trust-threshold'
import { cloneLabelHints, TRUST_STATEMENT_KIND } from '@dtp/trust-protocol'
import { trustEdgeValue } from '@dtp/trust-graph'
import {
  DEFAULT_RESOLVE_BOUNDS,
  normalizeResolveBounds,
} from './bounds'
import { EMPTY_PATH_VIEW, scoresToPathView } from './path-view'
import { trustScoreCounts } from './score-read'
import type { Graph } from '@dtp/trust-graph'
import type { IResolveStrategy } from '@dtp/trust-graph'
import { TrustScore, type Score } from '@dtp/trust-graph'
import type {
  ResolvedStatement,
  TrustQuery,
  TrustQueryResult,
} from './types'

export {
  DEFAULT_GRAPH_BOUNDS,
  DEFAULT_RESOLVE_BOUNDS,
  normalizeBounds,
  normalizeResolveBounds,
} from './bounds'

function emptyResult(
  query: TrustQuery,
  graphVersion: number,
  now: number,
  followTrustThreshold: number,
  followTrustRed: number,
): TrustQueryResult {
  return {
    subject: { ...query.subject },
    context: query.context ?? '',
    resolution: 'none',
    trust: 0,
    distrust: 0,
    trustValue: 0,
    degree: 0,
    connected: false,
    statements: [],
    paths: [],
    pathView: EMPTY_PATH_VIEW,
    sourceEventIds: [],
    computedAt: now,
    graphVersion,
    truncated: false,
    followTrustThreshold,
    followTrustRed,
  }
}

function statementDistance(
  graph: Graph,
  scores: readonly Score[],
  author: string,
  root: string,
  subjectDegree: number,
): number {
  if (author.toLowerCase() === root) return 0
  const authorIndex = graph.nodesIndex.get(author.toLowerCase())
  if (authorIndex !== undefined) {
    const hop = scores.find((score) => score.subjectIndex === authorIndex)
    if (hop) return hop.degree
  }
  return Math.max(0, subjectDegree - 1)
}

function statementFromEdge(
  graph: Graph,
  scores: readonly Score[],
  edgeIndex: number,
  subject: TrustQuery['subject'],
  requestedContext: string,
  root: string,
  subjectDegree: number,
): ResolvedStatement | undefined {
  const edge = graph.edgesList[edgeIndex]
  if (!edge) return undefined
  const value = trustEdgeValue(edge)
  if (value === undefined) return undefined
  const labelHints = cloneLabelHints(edge.labelHints)
  const distance = statementDistance(
    graph,
    scores,
    edge.pubkey,
    root,
    subjectDegree,
  )
  return {
    eventId: edge.id,
    connectionKey: edge.addressKey,
    author: edge.pubkey,
    subject: { ...subject },
    context: edge.c_tag ?? '',
    requestedContext,
    contextMatch:
      (edge.c_tag ?? '') === requestedContext
        ? 'exact'
        : (edge.c_tag ?? '') === ''
          ? 'general'
          : 'parent',
    value,
    createdAt: edge.created_at,
    ...(edge.activate !== undefined ? { activeFrom: edge.activate } : {}),
    ...(edge.expire !== undefined ? { activeUntil: edge.expire } : {}),
    ...(edge.content !== undefined && edge.content !== ''
      ? { content: edge.content }
      : {}),
    ...(edge.labels !== undefined && edge.labels.length > 0
      ? { labels: [...edge.labels] }
      : {}),
    ...(labelHints !== undefined ? { labelHints } : {}),
    distance,
  }
}

/**
 * Runs the injected IResolveStrategy (default IndexResolver) and maps to TrustQueryResult.
 */
export function executeTrustQuery(
  graph: Graph,
  resolver: IResolveStrategy,
  query: TrustQuery,
  graphVersion: number,
): TrustQueryResult {
  const context = query.context ?? ''
  const now = query.now ?? Math.floor(Date.now() / 1_000)
  if (!Number.isFinite(now)) {
    throw new RangeError('now must be finite')
  }

  const bounds = normalizeResolveBounds({
    ...DEFAULT_RESOLVE_BOUNDS,
    ...query.bounds,
  })

  const subjectId = graphSubjectId(query.subject)
  const root = query.rootPubkey.toLowerCase()
  const format = query.format ?? 'default'
  const followTrustThreshold = clampFollowTrustThreshold(
    query.followTrustThreshold,
  )
  const followTrustRed = clampFollowTrustRed(
    query.followTrustRed,
    followTrustThreshold,
  )
  const band = { red: followTrustRed, green: followTrustThreshold }

  const scores = resolver.resolve(root, subjectId, {
    graph,
    trustContext: IDENTITY_TRUST_CONTEXT,
    scoreContext: context,
    maxDepth: Math.min(bounds.maxDepth, WOT_MAX_DEGREE_HARD_CAP),
    format,
    followTrustThreshold,
    now,
    kind: TRUST_STATEMENT_KIND,
  })

  if (scores.length === 0) {
    return emptyResult(
      query,
      graphVersion,
      now,
      followTrustThreshold,
      followTrustRed,
    )
  }

  const subjectScore =
    scores.find((s) => s instanceof TrustScore && s.subject === subjectId) ??
    scores.find((s) => s instanceof TrustScore) ??
    scores[0]!

  const { trust, distrust, trustValue, neutral } = trustScoreCounts(
    subjectScore,
  )
  const degree = subjectScore.degree
  const connected = subjectScore.connected || subjectScore.count > 0

  const statements: ResolvedStatement[] = []
  const sourceEventIds: string[] = []

  if (subjectScore.edges) {
    for (const edgeIndex of subjectScore.edges) {
      const resolved = statementFromEdge(
        graph,
        scores,
        edgeIndex,
        query.subject,
        context,
        root,
        degree,
      )
      if (!resolved) continue
      statements.push(resolved)
      sourceEventIds.push(resolved.eventId)
    }
  }

  let direct: ResolvedStatement | undefined
  const own = statements.find((s) => s.author.toLowerCase() === root)
  if (own) {
    direct = { ...own, distance: 0 }
  }

  const pathView =
    format === 'path' ? scoresToPathView(graph, scores) : EMPTY_PATH_VIEW

  return {
    subject: { ...query.subject },
    context,
    resolution: trustScoreResolution(trust, distrust, connected, band),
    trust,
    distrust,
    ...(neutral > 0 ? { neutral } : {}),
    trustValue,
    degree,
    connected,
    ...(direct !== undefined ? { direct } : {}),
    statements,
    paths: [],
    pathView,
    sourceEventIds: [...new Set(sourceEventIds)].sort(),
    computedAt: now,
    graphVersion,
    truncated: false,
    followTrustThreshold,
    followTrustRed,
  }
}
