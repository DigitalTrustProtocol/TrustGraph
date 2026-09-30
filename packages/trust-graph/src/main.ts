// Package entry. `index.ts` is the barrel from the AttentionX origin and
// stays byte-identical; this file adds the package-local modules that
// replaced its external imports, and the exports of the gap fixes (D3).
export * from './index'
export * from './constants'
export * from './threshold'
export type { TrustEdgeRecord } from './record'
export {
  USER_ID_PREFIX,
  type IdentityClaim,
  type OwnEvidenceEntry,
  type OwnEvidenceSource,
} from './Graph'
export { DEFAULT_MAX_REACHED_NODES, DEFAULT_MAX_WALK_RECORDS } from './IndexResolver'
export type {
  BindCut,
  BindingMode,
  BindOutcome,
  BindSource,
  FieldBind,
  FieldResult,
  IdentityBind,
  WalkBudgets,
  WalkResult,
  WalkTruncation,
} from './IResolveStrategy'
