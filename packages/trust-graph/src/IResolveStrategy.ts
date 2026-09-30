/**
 * Vendored from DigitalTrustProtocol/Trust (IResolveStrategy.ts).
 * Attention: resolve returns Score[] (no server ApiEnvelope).
 * @dtp/trust-graph (decision D3): binding mode (G8), walk budgets (G10), and
 * the walk / field results (G12). See DIVERGENCE.json.
 */

import type { IGraph } from './Graph'
import type { Score } from './Score'

/** Output format: default (counts + degree). `path` is handled in query.ts. */
export type ResolveFormat = 'number' | 'default' | 'path'

export type ScoreKind = 32009 | 32014

/** identity-binding.md: how `bind(R, X, ℓ)` treats unclaimed candidates. */
export type BindingMode = 'lenient' | 'strict'

/** Why a walk budget stopped the walk (wot-model.md §6.2). */
export type WalkTruncation = 'timeBudget' | 'nodeBudget' | 'edgeBudget'

/** Walk budgets (wot-model.md §6.2). Node and record budgets are deterministic. */
export interface WalkBudgets {
  /** Reached nodes: the root plus every `p` node that got a level. */
  maxReachedNodes?: number
  /** Scanned records: one per (expanding author, subject) in the hop buckets. */
  maxWalkRecords?: number
  /** Wall-clock deadline, `Date.now()` milliseconds. */
  deadline?: number
}

export interface IResolveStrategyOptions {
  graph?: IGraph
  maxDepth?: number // Default: 4
  stopWhenFound?: boolean 
  trustContext?: string // Default: identity
  scoreContext?: string // Default: undefined
  followTrustThreshold?: number // Default: 75
  respectDirectDistrust?: boolean // Default: true
  format?: ResolveFormat // Default: 'default'
  /** Unix seconds for edge activate/expire checks (default: now). */
  now?: number // Default: now
  /** Evidence kind to score. Default: 32009. Hops always walk 32009 Trust(+1). */
  kind?: ScoreKind
  /** Default `lenient` (decision D5). */
  bindingMode?: BindingMode
  budgets?: WalkBudgets
}

/** Where a bind came from (identity-binding.md §8). */
export type BindSource = 'own-bio' | 'own-post' | 'own-statement' | 'witness'

export interface IdentityBind {
  pubkey: string
  source: BindSource
  /** The witness statement (sources `own-statement` / `witness`). */
  witnessEventId?: string
  /** Level of the witness author (the root's own statement = 0). */
  witnessLevel?: number
  /** P's kind 10011 naming X, when known. */
  claimEventId?: string
  confirmed: boolean
}

/** Strict mode: the top candidate that was cut, and why. */
export interface BindCut {
  pubkey: string
  reason: 'no-claim' | 'false-hint'
}

/** `bind(R, X, ℓ)` with provenance. */
export interface BindOutcome {
  bind?: IdentityBind
  cut?: BindCut
}

/** One walk (wot-model.md §6) and what it saw. */
export interface WalkResult {
  /** The subject's hit score first; for `format: 'path'` also the backward union of hop scores. */
  scores: Score[]
  connected: boolean
  degree: number
  /** Level of the last hit check (`degree − 1` when connected). */
  lastLevel: number
  /** Deepest complete level; meaningful when `truncated` is set. */
  completeDepth: number
  truncated?: WalkTruncation
  mode: BindingMode
  /** `bind(R, X, lastLevel)` for a `user:id` subject. */
  subjectBind?: BindOutcome
  scannedRecords: number
  reachedNodes: number
}

export interface FieldBind {
  /** `i:user:id:<digits>` */
  subject: string
  pubkey: string
  source: BindSource
  /** Witness author level, when the bind came from a witness. */
  level?: number
  witnessEventId?: string
}

/** The walk's level structure from the root (`graph.field`, gap G12). */
export interface FieldResult {
  completeDepth: number
  /** Qualifying node keys per level, sorted; `levels[0]` is the root. */
  levels: string[][]
  binds: FieldBind[]
  truncated?: WalkTruncation
}

export interface IResolveStrategy {
  readonly name: string
  resolve(
    authorId: string,
    subjectId: string,
    options?: IResolveStrategyOptions,
  ): Score[]
  walk(
    authorId: string,
    subjectId: string,
    options?: IResolveStrategyOptions,
  ): WalkResult
  field(authorId: string, options?: IResolveStrategyOptions): FieldResult
}
