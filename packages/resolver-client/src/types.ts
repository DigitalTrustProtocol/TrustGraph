import type {
  FrontierResult,
  LookupCountsParams,
  LookupCountsResult,
  LookupPage,
  LookupParams,
  NeighborhoodResult,
  ResolveBounds,
  TruncationReason,
  TrustQueryFormat,
  TrustSubject,
  WireRatingResult,
  WireTrustResult,
} from '@dtp/trust-query'

export interface SignedEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

export interface EventTemplate {
  kind: number
  created_at: number
  tags: string[][]
  content: string
}

/** Keys stay in the caller; the client only asks for signatures. */
export interface ResolverSigner {
  getPublicKey(): Promise<string>
  signEvent(template: EventTemplate): Promise<SignedEvent>
}

export type BindingMode = 'lenient' | 'strict'

/** resolver-api.md § Session defaults. Unknown fields pass through. */
export interface SessionDefaults {
  rootPubkey?: string
  bindingMode?: BindingMode
  followTrustThreshold?: number
  followTrustRed?: number
  hopContext?: string
  bounds?: Partial<ResolveBounds>
  statementLimit?: number
  [field: string]: unknown
}

export interface SessionUpdateResult {
  defaults: SessionDefaults
}

/** resolver-api.md § Query fields; missing fields come from the session defaults. */
export interface ResolverQueryFields {
  rootPubkey?: string
  now?: number
  bounds?: Partial<ResolveBounds>
  format?: TrustQueryFormat
  followTrustThreshold?: number
  followTrustRed?: number
  hopContext?: string
  statementLimit?: number
  bindingMode?: BindingMode
  deadlineMs?: number
}

export interface TrustQueryParams extends ResolverQueryFields {
  subject: TrustSubject
  context?: string
}

export interface TrustBatchItem {
  key: string
  subject: TrustSubject
  context?: string
}

export interface TrustBatchParams extends ResolverQueryFields {
  items: TrustBatchItem[]
}

export interface TrustBatchResult {
  graphVersion: number
  results: Record<string, WireTrustResult>
  errors?: Record<string, string>
}

export interface RatingQueryParams extends ResolverQueryFields {
  subject: TrustSubject
  context?: string
  labels?: string[]
}

export interface RatingBatchItem {
  key: string
  subject: TrustSubject
  context?: string
  labels?: string[]
}

export interface RatingBatchParams extends ResolverQueryFields {
  items: RatingBatchItem[]
}

export interface RatingBatchResult {
  graphVersion: number
  results: Record<string, WireRatingResult>
  errors?: Record<string, string>
}

export interface GraphFieldParams {
  rootPubkey?: string
  hopContext?: string
  threshold?: number
  maxDepth?: number
  bindingMode?: BindingMode
}

export interface GraphFieldResult {
  graphVersion: number
  completeDepth: number
  levels: string[][]
  binds: unknown
}

export type LookupBatchQuery =
  | { id: string; op: 'incoming' | 'outgoing'; params: LookupParams }
  | { id: string; op: 'counts'; params: LookupCountsParams }

export interface LookupBatchParams {
  queries: LookupBatchQuery[]
}

export interface LookupBatchResult {
  graphVersion: number
  results: Record<string, LookupPage | LookupCountsResult>
  errors?: Record<string, string>
}

export type NeighborhoodLookupResult = NeighborhoodResult & {
  truncatedReasons?: TruncationReason[]
}

export interface FrontierParams {
  roots: string[]
  maxDepth?: number
  maxAuthorsPerLevel?: number
  maxTotalAuthors?: number
}

export type FrontierLookupResult = FrontierResult & { graphVersion: number }

export interface IdentityClaimsParams {
  twitterId: string
}

export interface IdentityClaimsResult {
  claims: Array<{ pubkey: string; eventId: string }>
}

/** The NIP-11 `dtp` object plus `graphVersion` and memory status. */
export interface ResolverInfo {
  instanceId: string
  graphVersion: number
  api?: string
  model?: string
  corpus?: string
  scopeProfile?: string
  capabilities?: string[]
  limits?: Record<string, number>
  [field: string]: unknown
}

export interface TopicsResult {
  topics: string[]
}

export interface PublishResult {
  accepted: boolean
  message: string
}
