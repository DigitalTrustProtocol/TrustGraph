/**
 * The heap edge record. Replaces the vendored heap's import of AttentionX
 * `storage/types` `EventRecord`; that type satisfies this interface
 * structurally (every field here is either identical or optional there).
 *
 * Field mapping to the model (wot-model.md §2.1): `c_tag` = context,
 * `nValue` = value (absent = Delete), `addressableId` = dTag.
 */
export interface TrustEdgeRecord {
  /** 64 lowercase hex event id. Tie-break and provenance. */
  id: string
  /** 64 lowercase hex author pubkey. */
  pubkey: string
  created_at: number
  kind: number
  content: string
  /** Addressable slot key `kind:pubkey:d`. Heap `edgesIndex` key. */
  addressKey: string
  /** Signed-event fields a store may keep on the record; the heap never reads them. */
  tags?: string[][]
  sig?: string
  firstSeenAt?: number
  state?: string
  /** Primary subject value, lowercased. */
  subject?: string
  subjectType?: 'p' | 'e' | 'i'
  c_tag?: string
  /** 32009: -1 | 0 | 1; 32014: score in [0, 100]; absent = Delete. */
  nValue?: number
  addressableId?: string
  activate?: number
  expire?: number
  labels?: string[]
  labelHints?: Record<string, string>
  /** Scope profile rank (x.com: 2 for `s=x.com`, 1 for empty scope). P2 tie-break in the walk (G2); absent = 0. */
  scopeRank?: number
  /** First bare npub hint on a `user:id` subject with `s=x.com`, as hex. Identity witness (G8). */
  hintPubkey?: string
}
