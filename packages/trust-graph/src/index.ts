/**
 * Vendored Trust heap graph + resolvers (DigitalTrustProtocol/Trust).
 *
 * Do not modify this package without explicit permission. It is fragile
 * under AI interference. Change Attention wrappers in `src/graph`
 * (`graph.ts`, `adapter.ts`, `query.ts`, `ratings/`) instead.
 */

export { isValidAt, trustEdgeValue, type IEdge } from './Edge'
export {
  Graph,
  type GraphTrustConnectionOptions,
  type GraphTrustConnectionPayload,
  type GraphTrustEdgePayload,
  type GraphTrustValue,
  type IGraph,
} from './Graph'
export type {
  IResolveStrategy,
  IResolveStrategyOptions,
  ResolveFormat,
  ScoreKind,
} from './IResolveStrategy'
export { IndexResolver } from './IndexResolver'
export { default as indexResolver } from './IndexResolver'
export { Node } from './Node'
export { default as pathStrategyJson } from './pathStrategyJson'
export { IndexScoreMap, RatingScore, Score, TrustScore, type IScore, type IRatingScore, type ITrustScore } from './Score'
export type {
  ExtractedSubject,
  HeapEventFields,
  ITrustEvent,
  Identity,
  SubjectType,
} from './types'
