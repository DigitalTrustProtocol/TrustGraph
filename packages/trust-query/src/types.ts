// Ported from AttentionX src/graph/types.ts (imports rewritten for @dtp/* packages).
import type { BindingMode, BindSource, WalkBudgets, WalkTruncation } from '@dtp/trust-graph'
import { trustScoreResolution } from './shared/trust-score'
import {
  DEFAULT_FOLLOW_TRUST_BAND,
  type FollowTrustBand,
} from './shared/wot-follow-trust-threshold'

export type TrustValue = -1 | 0 | 1

/** Active graph evidence, including Neutral (`0`). Tombstones never enter the graph. */
export type ActiveTrustValue = TrustValue

export type TrustSubject =
  | { type: 'p'; value: string }
  | { type: 'e'; value: string }
  | { type: 'i'; value: string }

export type ContextMatch = 'exact' | 'parent' | 'general'

export interface ResolvedStatement {
  eventId: string
  /** Storage addressKey (kind:pubkey:d). Page UI key for this connection. */
  connectionKey?: string
  author: string
  subject: TrustSubject
  context: string
  requestedContext: string
  contextMatch: ContextMatch
  value: ActiveTrustValue
  createdAt: number
  activeFrom?: number
  activeUntil?: number
  content?: string
  labels?: string[]
  /** Display-only sanitized descriptions keyed by label token. Not a WoT input. */
  labelHints?: Record<string, string>
  /** Number of positive pubkey hops from the query root to the evidence author. */
  distance: number
}

export interface TrustPath {
  /** Ordered pubkeys from the root through the statement author. */
  authors: string[]
  subject: TrustSubject
  /** Traversal event IDs followed by the terminal evidence event ID. */
  sourceEventIds: string[]
}

export type GraphNodeKind = 'pubkey' | 'twitter_id' | 'post' | 'other'

/**
 * Canvas / RPC vis id: heap `node.index` / `edgesList` index as a number,
 * or a synthetic string (`agg:…`, rating `eventId`, ego-snapshot wire ids).
 */
export type GraphVisId = number | string

/** Serializable Graph/Path vis node. Heap Path/neighborhood `id` is `node.index`. */
export interface GraphPathViewNode {
  id: GraphVisId
  kind: GraphNodeKind
  depth: number
  label: string
  subject?: TrustSubject
}

/** Serializable Graph/Path vis edge. Heap kind 32009 `id` is the edgesList index. */
export interface GraphPathViewEdge {
  id: GraphVisId
  from: GraphVisId
  to: GraphVisId
  value: 1 | 0 | -1
  context: string
  eventId: string
  depth: number
}

export interface GraphPathView {
  nodes: GraphPathViewNode[]
  edges: GraphPathViewEdge[]
}

export type TrustResolution = 'trusted' | 'distrusted' | 'mixed' | 'none'

export type TrustQueryFormat = 'default' | 'path'

export interface TrustQueryResult {
  subject: TrustSubject
  context: string
  resolution: TrustResolution
  /** Count of +1 edges at the hitting degree. */
  trust: number
  /** Count of -1 edges at the hitting degree. */
  distrust: number
  /**
   * Count of Neutral (`0`) edges at the hitting degree.
   * Not included in `trust` / `distrust` / percent. Missing means 0.
   */
  neutral?: number
  /** Sum of edge values (trust − distrust). */
  trustValue: number
  /** Hitting degree (Me=0, direct trust in subject = 1). */
  degree: number
  connected: boolean
  direct?: ResolvedStatement
  statements: ResolvedStatement[]
  /** @deprecated Path UI uses `pathView`. Kept empty for RPC compat. */
  paths: TrustPath[]
  /** Heap-index vis for Path (`format: 'path'`). */
  pathView?: GraphPathView
  sourceEventIds: string[]
  computedAt: number
  graphVersion: number
  /** True when a walk budget stopped the walk (wot-model.md §6.2). */
  truncated: boolean
  /** Present with `truncated`: the walk budget that stopped it. */
  truncatedReasons?: WalkTruncation[]
  /** Deepest complete level; only on results a walk budget truncated. */
  completeDepth?: number
  /** For `user:id` subjects: the bind the evidence was counted under. */
  binding?: BindingProvenance
  /** Clamped hop peer trust-score percent used for this resolve (green knob). */
  followTrustThreshold: number
  /** Red/yellow boundary percent used for this resolve. */
  followTrustRed: number
}

/** identity-binding.md §8. */
export interface BindingProvenance {
  mode: BindingMode
  pubkey?: string
  source: BindSource | 'none'
  confirmed: boolean
  witnessEventId?: string
  witnessDegree?: number
  claimEventId?: string
  cutCandidate?: string
  cutReason?: 'no-claim' | 'false-hint'
}

/** Walk options shared by trust and rating queries. */
export interface WalkQueryOptions {
  /** Default `lenient` (decision D5). */
  bindingMode?: BindingMode
  /** Node / record budgets and deadline (wot-model.md §6.2). */
  budgets?: WalkBudgets
}

/**
 * Bounds for IndexResolver / QUERY_TRUST.
 * Fan-out caps are not applied on the heap resolve path.
 */
export interface ResolveBounds {
  /** Maximum hops from root to target (IndexResolver hard-caps at 7). */
  maxDepth: number
}

/**
 * Bounds for WoT relay sync expansion (START_WOT_SYNC).
 * Not used by IndexResolver.
 */
export interface GraphBounds {
  maxDepth: number
  /** Maximum newly reached pubkey authors at any depth after the root. */
  maxAuthorsPerLevel: number
  /** Maximum distinct authors, including the root. */
  maxTotalAuthors: number
  /** Maximum distinct source events retained by one sync. */
  maxEvents: number
}

export interface TrustQuery extends WalkQueryOptions {
  rootPubkey: string
  subject: TrustSubject
  context?: string
  now?: number
  bounds?: Partial<ResolveBounds>
  /** default = score only; path = reconstruct paths for graph UI. */
  format?: TrustQueryFormat
  /** Hop peer trust-score percent (0–100). Default 75 (green knob). */
  followTrustThreshold?: number
  /** Red/yellow boundary percent. Default 25. */
  followTrustRed?: number
}

export interface RatingClaimEvidence {
  eventId: string
  author: string
  subject: TrustSubject
  context: string
  /** Active numeric score in [0, 100]. Cancels are not stored as claims. */
  score: number
  labels: string[]
  /** Display-only sanitized descriptions keyed by label token. Not a WoT or rating-filter input. */
  labelHints?: Record<string, string>
  content: string
  createdAt: number
  activeFrom?: number
  activeUntil?: number
  /** Positive-p hops from the query root to the claim author (root = 0). */
  distance: number
}

export interface RatingQuery extends WalkQueryOptions {
  rootPubkey: string
  subject: TrustSubject
  context?: string
  /** When non-empty, keep claims that have at least one matching label. */
  labels?: string[]
  now?: number
  bounds?: Partial<ResolveBounds>
  /** default = score only; path = reconstruct issuer hop chains for graph UI. */
  format?: TrustQueryFormat
  /** Echoed green knob for rating tones. Hops stay at 1. */
  followTrustThreshold?: number
  /** Echoed red knob for rating tones. */
  followTrustRed?: number
}

export interface RatingQueryResult {
  subject: TrustSubject
  context: string
  claims: RatingClaimEvidence[]
  averageScore: number | null
  claimCount: number
  /** Hitting degree (none = 0, own rating = 1, people you trust = 2). */
  degree: number
  own?: RatingClaimEvidence
  sourceEventIds: string[]
  /** @deprecated Path UI uses `pathView` / `ratingEdges`. */
  paths: TrustPath[]
  /** Issuer hop vis (`format: 'path'`). */
  pathView?: GraphPathView
  /** Terminal kind 32014 strokes (not heap edges). */
  ratingEdges?: GraphPathViewEdge[]
  computedAt: number
  graphVersion: number
  /** Set when a walk budget stopped the walk (wot-model.md §6.2). */
  truncated?: true
  truncatedReasons?: WalkTruncation[]
  completeDepth?: number
  binding?: BindingProvenance
  /** Green knob used for rating tone (hops stay at 1). */
  followTrustThreshold: number
  /** Red knob used for rating tone. */
  followTrustRed: number
  /**
   * The post's events were pruned for storage and are being fetched again
   * from relays; this result is incomplete until a later `trustGraph` update.
   */
  rebuilding?: true
}

/** Share percent vs the follow-trust band (defaults 25 / 75). */
export function resolutionFromCounts(
  trust: number,
  distrust: number,
  connected: boolean,
  band: FollowTrustBand = DEFAULT_FOLLOW_TRUST_BAND,
): TrustResolution {
  return trustScoreResolution(trust, distrust, connected, band)
}
