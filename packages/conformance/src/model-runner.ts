/**
 * TypeScript model runner: builds a heap from a case's records / ops and
 * runs its queries through `@dtp/trust-query` (which calls the one walk,
 * `IndexResolver`). Output is canonicalized per conformance.md.
 */

import { Graph, indexResolver, type ITrustEvent } from '@dtp/trust-graph'
import {
  DEFAULT_RESOLVE_BOUNDS,
  SlotFloors,
  applyWithFloors,
  deleteSlotAt,
  deleteWinner,
  executeRatingQuery,
  executeTrustQuery,
  lookupCounts,
  lookupPage,
  neighborhoodLookup,
  positiveAuthorFrontier,
  sortClaims,
  sortStatements,
  type GraphPathView,
  type GraphVisId,
  type LookupCountsParams,
  type LookupParams,
  type RatingQuery,
  type TrustQuery,
} from '@dtp/trust-query'
import type { CorpusClaim, CorpusOp, CorpusOwnEvidence, CorpusQuery, CorpusRecord, ModelCase } from './types'

export type BindingMode = 'lenient' | 'strict'

export interface ModelState {
  graph: Graph
  floors: SlotFloors
  /** Claims are recorded but unused by today's heap (gap G8). */
  claims: Map<string, Set<string>>
  own: CorpusOwnEvidence[]
  graphVersion: number
}

export function defaultAddressKey(record: CorpusRecord): string {
  return `${record.kind}:${record.pubkey}:${record.subjectType}:${record.subject}:${record.context ?? ''}`
}

/** Corpus record (model field names) → heap edge record (extension column names). */
export function toEdgeRecord(record: CorpusRecord): ITrustEvent {
  return {
    id: record.id,
    pubkey: record.pubkey.toLowerCase(),
    created_at: record.created_at,
    kind: record.kind,
    content: record.content ?? '',
    addressKey: record.addressKey ?? defaultAddressKey(record),
    subject: record.subject.toLowerCase(),
    subjectType: record.subjectType,
    c_tag: record.context ?? '',
    ...(record.value !== undefined ? { nValue: record.value } : {}),
    ...(record.dTag !== undefined ? { addressableId: record.dTag } : {}),
    ...(record.activate !== undefined ? { activate: record.activate } : {}),
    ...(record.expire !== undefined ? { expire: record.expire } : {}),
    ...(record.labels !== undefined ? { labels: [...record.labels] } : {}),
    ...(record.labelHints !== undefined ? { labelHints: { ...record.labelHints } } : {}),
    ...(record.scopeRank !== undefined ? { scopeRank: record.scopeRank } : {}),
    ...(record.hintPubkey !== undefined ? { hintPubkey: record.hintPubkey } : {}),
  }
}

export function defaultOps(testCase: ModelCase): CorpusOp[] {
  if (testCase.ops) return testCase.ops
  return [
    ...(testCase.records ?? []).map((record): CorpusOp => ({ op: 'apply', record })),
    ...(testCase.claims ?? []).map((claim: CorpusClaim): CorpusOp => ({ op: 'claim', claim })),
    ...(testCase.ownEvidence ?? []).map((evidence): CorpusOp => ({ op: 'own', evidence })),
  ]
}

export function applyOp(state: ModelState, op: CorpusOp): void {
  switch (op.op) {
    case 'apply':
      applyWithFloors(state.graph, state.floors, toEdgeRecord(op.record))
      break
    case 'remove':
      state.graph.removeTrustEvent({ addressKey: op.addressKey } as ITrustEvent)
      break
    case 'claim': {
      const set = state.claims.get(op.claim.pubkey) ?? new Set<string>()
      set.add(op.claim.twitterId)
      state.claims.set(op.claim.pubkey, set)
      break
    }
    case 'unclaim':
      state.claims.delete(op.pubkey)
      break
    case 'own':
      // Today's heap binds globally, for every root (gap G8).
      state.own.push(op.evidence)
      state.graph.bindIdentity(op.evidence.iKey, op.evidence.pubkey)
      break
    case 'unown':
      // No unbind in today's heap (gap G6); cases using it are tagged gap:G6.
      state.own = state.own.filter((o) => !(o.root === op.root && o.iKey === op.iKey))
      break
    case 'delete': {
      if (op.addressKey) {
        if (op.addressKey.split(':')[1] === op.author.toLowerCase()) {
          deleteSlotAt(state.graph, state.floors, op.addressKey, op.created_at)
        }
      } else if (op.eventId) {
        const winner = state.graph.edgesList.find((edge) => edge?.id === op.eventId)
        if (winner) deleteWinner(state.graph, state.floors, winner, op.author)
      }
      break
    }
    default: {
      const _exhaustive: never = op
      throw new Error(`unknown op ${JSON.stringify(_exhaustive)}`)
    }
  }
  state.graphVersion += 1
}

export function buildState(testCase: ModelCase, ops = defaultOps(testCase)): ModelState {
  const state: ModelState = {
    graph: new Graph(),
    floors: new SlotFloors(),
    claims: new Map(),
    own: [],
    graphVersion: 0,
  }
  for (const op of ops) applyOp(state, op)
  return state
}

// ---- canonical output -------------------------------------------------

function subjectKey(subject: { type: string; value: string } | undefined): string {
  return subject ? `${subject.type}:${subject.value}` : '?'
}

export function canonicalPathView(view: GraphPathView | undefined): unknown {
  if (!view) return { nodes: [], edges: [] }
  const byId = new Map<GraphVisId, string>()
  for (const node of view.nodes) byId.set(node.id, subjectKey(node.subject))
  return {
    nodes: view.nodes
      .map((node) => ({ subject: subjectKey(node.subject), depth: node.depth }))
      .sort((a, b) => (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0)),
    edges: view.edges
      .map((edge) => ({
        eventId: edge.eventId,
        from: byId.get(edge.from) ?? String(edge.from),
        to: byId.get(edge.to) ?? String(edge.to),
        value: edge.value,
      }))
      .sort((a, b) => (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0)),
  }
}

function trustInput(input: Record<string, unknown>): TrustQuery {
  return input as unknown as TrustQuery
}

export function runTrust(state: ModelState, input: Record<string, unknown>): Record<string, unknown> {
  const result = executeTrustQuery(state.graph, indexResolver, trustInput(input), state.graphVersion)
  return {
    connected: result.connected,
    degree: result.degree,
    trust: result.trust,
    distrust: result.distrust,
    neutral: result.neutral ?? 0,
    trustValue: result.trustValue,
    resolution: result.resolution,
    statements: sortStatements(result.statements),
    direct: result.direct ?? null,
    sourceEventIds: [...result.sourceEventIds].sort(),
    pathView: canonicalPathView(result.pathView),
    followTrustThreshold: result.followTrustThreshold,
    followTrustRed: result.followTrustRed,
  }
}

export function runRating(state: ModelState, input: Record<string, unknown>): Record<string, unknown> {
  const result = executeRatingQuery(
    state.graph,
    indexResolver,
    input as unknown as RatingQuery,
    state.graphVersion,
    DEFAULT_RESOLVE_BOUNDS,
  )
  const view = canonicalPathView(result.pathView) as { nodes: Array<{ subject: string }> }
  const bySubjectIndex = new Map<GraphVisId, string>()
  for (const node of result.pathView?.nodes ?? []) bySubjectIndex.set(node.id, subjectKey(node.subject))
  return {
    degree: result.degree,
    claimCount: result.claimCount,
    averageScore: result.averageScore,
    claims: sortClaims(result.claims),
    own: result.own ?? null,
    sourceEventIds: [...result.sourceEventIds].sort(),
    pathView: view,
    ratingEdges: (result.ratingEdges ?? [])
      .map((edge) => ({
        eventId: edge.eventId,
        from: bySubjectIndex.get(edge.from) ?? String(edge.from),
        to: bySubjectIndex.get(edge.to) ?? String(edge.to),
        value: edge.value,
      }))
      .sort((a, b) => (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0)),
  }
}

export function runLookup(
  state: ModelState,
  direction: 'incoming' | 'outgoing',
  input: Record<string, unknown>,
): Record<string, unknown> {
  const page = lookupPage(state.graph, state.graphVersion, direction, input as unknown as LookupParams)
  return {
    items: page.items,
    nextCursor: page.nextCursor !== undefined,
    totals: page.totals ?? null,
    truncated: page.truncated === true,
  }
}

/** Every page at `limit`, following cursors. */
export function runLookupPages(
  state: ModelState,
  direction: 'incoming' | 'outgoing',
  input: Record<string, unknown>,
  limit: number,
  maxPages = 1_000,
): Array<{ items: unknown[]; nextCursor: boolean }> {
  const pages: Array<{ items: unknown[]; nextCursor: boolean }> = []
  let cursor: string | undefined
  for (let i = 0; i < maxPages; i += 1) {
    const page = lookupPage(state.graph, state.graphVersion, direction, {
      ...(input as unknown as LookupParams),
      limit,
      ...(cursor !== undefined ? { cursor } : {}),
    })
    pages.push({ items: page.items, nextCursor: page.nextCursor !== undefined })
    if (page.nextCursor === undefined) return pages
    cursor = page.nextCursor
  }
  throw new Error('lookup paging did not terminate')
}

export function runCounts(state: ModelState, input: Record<string, unknown>): Record<string, unknown> {
  const result = lookupCounts(state.graph, state.graphVersion, input as unknown as LookupCountsParams)
  return { counts: result.counts, truncated: result.truncated === true }
}

export function runNeighborhood(state: ModelState, input: Record<string, unknown>): Record<string, unknown> {
  const result = neighborhoodLookup(state.graph, state.graphVersion, input, 500)
  const bySubject = new Map<GraphVisId, string>()
  for (const node of result.nodes) bySubject.set(node.id, subjectKey(node.subject))
  return {
    center: bySubject.get(result.centerId) ?? null,
    truncated: result.truncated,
    nodes: result.nodes
      .map((node) => ({ subject: subjectKey(node.subject), depth: node.depth }))
      .sort((a, b) => (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0)),
    edges: result.edges
      .map((edge) => ({
        eventId: edge.eventId,
        from: bySubject.get(edge.from) ?? String(edge.from),
        to: bySubject.get(edge.to) ?? String(edge.to),
        value: edge.value,
      }))
      .sort((a, b) => (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0)),
  }
}

export function runFrontier(state: ModelState, input: Record<string, unknown>): Record<string, unknown> {
  const roots = (input.roots as string[]) ?? []
  const result = positiveAuthorFrontier(
    state.graph,
    roots,
    {
      maxDepth: (input.maxDepth as number) ?? 3,
      maxAuthorsPerLevel: (input.maxAuthorsPerLevel as number) ?? 500,
      maxTotalAuthors: (input.maxTotalAuthors as number) ?? 5_000,
    },
    (input.now as number) ?? Math.floor(Date.now() / 1000),
  )
  return { authors: result.authors, reasons: [...result.reasons].sort() }
}

/** Run one query (single mode) and return its canonical output. */
export function runQuery(state: ModelState, query: CorpusQuery, input = query.input): unknown {
  switch (query.type) {
    case 'trust':
      return runTrust(state, input)
    case 'rating':
      return runRating(state, input)
    case 'lookup-incoming':
      return runLookup(state, 'incoming', input)
    case 'lookup-outgoing':
      return runLookup(state, 'outgoing', input)
    case 'lookup-counts':
      return runCounts(state, input)
    case 'neighborhood':
      return runNeighborhood(state, input)
    case 'frontier':
      return runFrontier(state, input)
    default: {
      const _exhaustive: never = query.type
      throw new Error(`unknown query type ${String(_exhaustive)}`)
    }
  }
}
