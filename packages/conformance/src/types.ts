/** Case shapes of `dtp-wot-corpus/1` (see corpus/README.md). */

export interface CorpusRecord {
  /** Default: `<kind>:<pubkey>:<subjectType>:<subject>:<context>`. */
  addressKey?: string
  id: string
  pubkey: string
  kind: 32009 | 32014
  created_at: number
  subjectType: 'p' | 'e' | 'i'
  subject: string
  context?: string
  /** 32009: -1 | 0 | 1; 32014: score. Absent = Delete. */
  value?: number
  activate?: number
  expire?: number
  scopeRank?: number
  hintPubkey?: string
  content?: string
  labels?: string[]
  labelHints?: Record<string, string>
  dTag?: string
}

export interface CorpusClaim {
  pubkey: string
  twitterId: string
  eventId?: string
}

export interface CorpusOwnEvidence {
  root: string
  iKey: string
  pubkey: string
  source: 'bio' | 'post'
}

export type CorpusOp =
  | { op: 'apply'; record: CorpusRecord }
  | { op: 'remove'; addressKey: string }
  | { op: 'claim'; claim: CorpusClaim }
  | { op: 'unclaim'; pubkey: string }
  | { op: 'own'; evidence: CorpusOwnEvidence }
  | { op: 'unown'; root: string; iKey: string }
  /** NIP-09 by the slot author: `a` = whole slot up to `created_at`; `e` = the named winner. */
  | { op: 'delete'; author: string; created_at: number; addressKey?: string; eventId?: string }

export type QueryType =
  | 'trust'
  | 'rating'
  | 'lookup-incoming'
  | 'lookup-outgoing'
  | 'lookup-counts'
  | 'neighborhood'
  | 'frontier'

export interface LookupPageExpectation {
  limit: number
  expectItems: unknown[]
  expectNextCursor: boolean
}

export interface CorpusQuery {
  type: QueryType
  /** Free text for humans; not compared. */
  note?: string
  /**
   * Run the query once per binding mode (sets `input.bindingMode`). An
   * expectation may then be `{ lenient, strict }` or one value for both.
   */
  modes?: Array<'lenient' | 'strict'>
  input: Record<string, unknown>
  /** Both runners, when the case has no gap tag for this query. */
  expect?: unknown
  /** Gap cases: the proposed model rule (Rust runner). */
  expectModel?: unknown
  /** Gap cases: today's TypeScript behaviour (TS runner). */
  expectCurrent?: unknown
  /** Lookup paging expectations. */
  pages?: LookupPageExpectation[]
}

export interface ModelCase {
  id: string
  model: string
  tags: string[]
  profile?: string
  description?: string
  source?: string
  records?: CorpusRecord[]
  claims?: CorpusClaim[]
  ownEvidence?: CorpusOwnEvidence[]
  ops?: CorpusOp[] | null
  queries: CorpusQuery[]
}

export interface ProtocolCase {
  id: string
  model: string
  tags: string[]
  profile: string
  description?: string
  event: Record<string, unknown>
  expect: {
    valid: boolean
    /** NIP-01 OK prefix when rejected: `invalid` or `blocked`. */
    prefix?: 'invalid' | 'blocked'
    eligible?: boolean
    /** Normalized record in model field names (wot-model.md §2.1), partial. */
    record?: Record<string, unknown>
    claim?: CorpusClaim | null
    deletion?: { eventIds: string[]; addressKeys: string[] }
  }
}

export type AnyCase = ModelCase | ProtocolCase

export function isProtocolCase(value: AnyCase): value is ProtocolCase {
  return 'event' in value
}
