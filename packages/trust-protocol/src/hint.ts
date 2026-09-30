/**
 * Identity witness hint (wot-model.md §2.1 `hintPubkey`,
 * identity-binding.md §2): the first bare `npub1…` hint on the primary `i`
 * tag, only for `user:id:<digits>` subjects whose scope set contains `x.com`.
 */

import { nip19 } from 'nostr-tools'
import { parseSubjectHint, subjectNpubFromHints, type SubjectHint } from './kind-32009'
import { scopesCarryXHints } from './scope-profile'

const USER_ID_SUBJECT = /^user:id:\d+$/
const SUBJECT_TAGS = new Set(['p', 'e', 'i'])

/** Hex pubkey of a canonical npub, or undefined. */
export function npubToHex(npub: string): string | undefined {
  try {
    const decoded = nip19.decode(npub)
    if (decoded.type !== 'npub') return undefined
    return typeof decoded.data === 'string' ? decoded.data.toLowerCase() : undefined
  } catch {
    return undefined
  }
}

/** Hint pubkey from a validated statement's subject, hints, and scopes. */
export function hintPubkeyFor(
  subject: { type: string; value: string },
  hints: readonly SubjectHint[],
  scopes: readonly string[],
): string | undefined {
  if (subject.type !== 'i' || !USER_ID_SUBJECT.test(subject.value)) return undefined
  if (!scopesCarryXHints(scopes)) return undefined
  const npub = subjectNpubFromHints(hints)
  return npub ? npubToHex(npub) : undefined
}

/**
 * Hint pubkey read straight from tags (for rows validated earlier).
 * Malformed hints make the event invalid at validation, so they never get here.
 */
export function hintPubkeyFromTags(tags: readonly string[][]): string | undefined {
  const subjectTags = tags.filter((tag) => SUBJECT_TAGS.has(tag[0] ?? ''))
  if (subjectTags.length !== 1) return undefined
  const tag = subjectTags[0]!
  const scopes = tags
    .filter((t) => t[0] === 's' && typeof t[1] === 'string')
    .map((t) => t[1]!)
  const hints: SubjectHint[] = []
  for (const raw of tag.slice(2)) {
    const hint = parseSubjectHint(raw)
    if (hint) hints.push(hint)
  }
  return hintPubkeyFor({ type: tag[0]!, value: tag[1] ?? '' }, hints, scopes)
}
