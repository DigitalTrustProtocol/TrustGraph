/**
 * NIP-09 deletion requests (kind 5) that target the held kinds
 * (resolver-api.md § Ingest, wot-model.md §2.4). Validation only; the store
 * applies them (author match, slot floor).
 */

import {
  getEventHash,
  validateEvent,
  verifyEvent,
  type Event,
} from 'nostr-tools'
import { TRUST_STATEMENT_KIND } from './kind-32009'
import { RATING_STATEMENT_KIND } from './kind-32014'
import { NIP39_IDENTITY_KIND } from './kind-10011'

export const DELETION_KIND = 5

/** Kinds whose events a deletion may target on a DTP server. */
export const DELETABLE_KINDS: ReadonlySet<number> = new Set([
  TRUST_STATEMENT_KIND,
  RATING_STATEMENT_KIND,
  NIP39_IDENTITY_KIND,
])

const HEX_64 = /^[0-9a-f]{64}$/
const ADDRESS = /^(0|[1-9]\d*):([0-9a-f]{64}):(.*)$/s

export interface DeletionAddress {
  kind: number
  pubkey: string
  d: string
  /** `kind:pubkey:d`, the store's slot key. */
  addressKey: string
}

export interface ParsedDeletion {
  event: Event
  /** `e` targets (event ids). The store checks that the target's author matches. */
  eventIds: string[]
  /**
   * `a` targets by the deletion's own author for a held kind. Coordinates by
   * other authors or for other kinds are dropped; both lists may be empty.
   */
  addresses: DeletionAddress[]
}

export type DeletionValidationResult =
  | { valid: true; deletion: ParsedDeletion }
  | { valid: false; errors: string[] }

export function validateDeletionEvent(
  event: unknown,
  options: { verifyEvent?: boolean } = {},
): DeletionValidationResult {
  if (
    typeof event !== 'object' ||
    event === null ||
    !('id' in event) ||
    !('sig' in event) ||
    !validateEvent(event)
  ) {
    return { valid: false, errors: ['A complete signed Nostr event is required'] }
  }
  const signed = event as Event
  const errors: string[] = []
  if (signed.kind !== DELETION_KIND) errors.push(`Event kind must be ${DELETION_KIND}`)
  if (!Number.isSafeInteger(signed.created_at) || signed.created_at < 0) {
    errors.push('created_at must be a non-negative safe integer')
  }
  if (options.verifyEvent !== false) {
    if (!HEX_64.test(signed.id)) {
      errors.push('Event id must be 64 lowercase hexadecimal characters')
    } else {
      const uncached: Event = {
        id: signed.id,
        pubkey: signed.pubkey,
        created_at: signed.created_at,
        kind: signed.kind,
        tags: signed.tags.map((tag) => [...tag]),
        content: signed.content,
        sig: signed.sig,
      }
      if (getEventHash(uncached) !== signed.id) {
        errors.push('Event id does not match its serialized event hash')
      } else if (!verifyEvent(uncached)) {
        errors.push('Event signature is invalid')
      }
    }
  }

  const eventIds: string[] = []
  const addresses: DeletionAddress[] = []
  const author = signed.pubkey.toLowerCase()
  for (const tag of signed.tags) {
    if (tag[0] === 'e') {
      const id = tag[1] ?? ''
      if (!HEX_64.test(id)) {
        errors.push('e tag must contain a 64 lowercase hexadecimal event id')
        continue
      }
      if (!eventIds.includes(id)) eventIds.push(id)
    } else if (tag[0] === 'a') {
      const match = ADDRESS.exec(tag[1] ?? '')
      if (!match) {
        errors.push('a tag must contain a kind:pubkey:d coordinate')
        continue
      }
      const kind = Number(match[1])
      const pubkey = match[2]!
      // NIP-09: only the author may delete; other kinds are not held here.
      if (pubkey !== author || !DELETABLE_KINDS.has(kind)) continue
      const d = match[3] ?? ''
      const addressKey = `${kind}:${pubkey}:${d}`
      if (!addresses.some((a) => a.addressKey === addressKey)) {
        addresses.push({ kind, pubkey, d, addressKey })
      }
    }
  }
  if (errors.length > 0) return { valid: false, errors }
  return { valid: true, deletion: { event: signed, eventIds, addresses } }
}
