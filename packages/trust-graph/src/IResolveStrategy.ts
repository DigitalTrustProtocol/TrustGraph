/**
 * Vendored from DigitalTrustProtocol/Trust (IResolveStrategy.ts).
 * Attention: resolve returns Score[] (no server ApiEnvelope).
 */

import type { IGraph } from './Graph'
import type { Score } from './Score'

/** Output format: default (counts + degree). `path` is handled in query.ts. */
export type ResolveFormat = 'number' | 'default' | 'path'

export type ScoreKind = 32009 | 32014

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
}

export interface IResolveStrategy {
  readonly name: string
  resolve(
    authorId: string,
    subjectId: string,
    options?: IResolveStrategyOptions,
  ): Score[]
}
