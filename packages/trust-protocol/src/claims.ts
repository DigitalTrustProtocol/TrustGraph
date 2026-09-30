/**
 * Identity claims (wot-model.md §2.6, identity-binding.md §3): the pair
 * `(pubkey, twitterId)` from a pubkey's winning, valid kind 10011 that
 * carries `twitter_id:X` with its matching `twitter` tag (NIP-39).
 */

import type { Event } from 'nostr-tools'
import {
  validateKind10011TwitterIdentity,
  type Kind10011ValidationOptions,
} from './kind-10011'

export interface IdentityClaim {
  pubkey: string
  twitterId: string
  eventId: string
  createdAt: number
}

/** The claim a signed kind 10011 makes, or undefined (no or malformed X tags). */
export function identityClaimFromEvent(
  event: Event,
  options: Kind10011ValidationOptions = {},
): IdentityClaim | undefined {
  const result = validateKind10011TwitterIdentity(event, options)
  if (!result.valid) return undefined
  return {
    pubkey: event.pubkey.toLowerCase(),
    twitterId: result.identity.twitterId,
    eventId: event.id,
    createdAt: event.created_at,
  }
}
