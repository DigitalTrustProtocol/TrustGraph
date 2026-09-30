/**
 * Stored event shapes. Mirrors AttentionX `storage/types.ts`
 * (`SignedNostrEvent`, `EventRecord`) plus the model columns `scopeRank` and
 * `hintPubkey` (wot-model.md §2.1). The extension's `EventRecord` is
 * assignable to this type.
 */

export interface SignedNostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

export interface EventRecord extends SignedNostrEvent {
  firstSeenAt: number
  /** Addressable slot key: `kind:pubkey:d` (empty d for kind 10011). */
  addressKey: string
  /** Optional local system state (e.g. demo WoT). */
  state?: string
  /** Graph / 32009/14 columns. Omitted on kind 10011 and other rows. */
  subject?: string
  subjectType?: 'p' | 'e' | 'i'
  c_tag?: string
  nValue?: number
  addressableId?: string
  activate?: number
  expire?: number
  labels?: string[]
  labelHints?: Record<string, string>
  /** Scope profile rank (wot-model.md §2.3). */
  scopeRank?: number
  /** First bare npub hint on a `user:id` subject under `s=x.com`, as hex. */
  hintPubkey?: string
}
