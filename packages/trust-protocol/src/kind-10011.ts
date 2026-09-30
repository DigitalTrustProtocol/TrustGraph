// Ported from AttentionX src/lib/nostr/kind-10011.ts (imports rewritten for @dtp/* packages).
// Not ported: buildNip39ProofText / containsNip39Proof (X proof-post text,
// AttentionX shared/proof-composer) — the servers never compose proof posts.
import {
  getEventHash,
  validateEvent,
  verifyEvent,
  type Event,
  type EventTemplate,
} from 'nostr-tools'
import {
  buildNip39TwitterLinkTags,
  isCanonicalNip39TwitterProofHint,
  isCanonicalTwitterHandle,
  isTwitterNumericId,
  normalizeTwitterHandle,
} from './x-identity'

export const NIP39_IDENTITY_KIND = 10011

const HEX_64 = /^[0-9a-f]{64}$/

export interface TwitterIdentityLink {
  handle: string
  twitterId: string
  /** Optional legacy proof-post reference. Proofless claims omit it. */
  proofPostId?: string
}

export interface ParsedKind10011TwitterIdentity extends TwitterIdentityLink {
  event: Event
}

export interface Kind10011ValidationOptions {
  verifyEvent?: boolean
}

export type Kind10011ValidationResult =
  | { valid: true; identity: ParsedKind10011TwitterIdentity }
  | { valid: false; errors: string[] }

export type SignedKind10011ValidationResult =
  | { valid: true; event: Event }
  | { valid: false; errors: string[] }

export interface BuildKind10011Input extends TwitterIdentityLink {
  createdAt: number
  existingEvent?: Pick<Event, 'tags' | 'content'>
}

export class Kind10011ValidationError extends Error {
  readonly errors: string[]

  constructor(errors: string[]) {
    super(errors.join('; '))
    this.name = 'Kind10011ValidationError'
    this.errors = errors
  }
}

function isTwitterProviderTag(tag: readonly string[]): boolean {
  return (
    tag[0] === 'i' &&
    (tag[1]?.startsWith('twitter:') === true ||
      tag[1]?.startsWith('twitter_id:') === true)
  )
}

function hasMatchingProofHints(
  handleTag: readonly string[],
  idTag: readonly string[],
  proofPostId: string | undefined,
): boolean {
  if (handleTag.length === 2 && idTag.length === 2) return true
  if (!proofPostId) return false
  if (handleTag.length === 3 && idTag.length === 3) return true
  return (
    handleTag.length === 4 &&
    idTag.length === 4 &&
    isCanonicalNip39TwitterProofHint(handleTag[3], proofPostId) &&
    isCanonicalNip39TwitterProofHint(idTag[3], proofPostId)
  )
}

function normalizeLink(link: TwitterIdentityLink): TwitterIdentityLink {
  const handle = normalizeTwitterHandle(link.handle)
  if (!isCanonicalTwitterHandle(handle)) {
    throw new Error('Twitter handle must be 1-15 letters, digits, or underscores')
  }
  if (!isTwitterNumericId(link.twitterId)) {
    throw new Error('twitterId must contain only decimal digits')
  }
  if (
    link.proofPostId !== undefined &&
    !isTwitterNumericId(link.proofPostId)
  ) {
    throw new Error('proofPostId must contain only decimal digits')
  }
  return {
    handle,
    twitterId: link.twitterId,
    ...(link.proofPostId ? { proofPostId: link.proofPostId } : {}),
  }
}

export function mergeKind10011TwitterTags(
  existingTags: readonly string[][],
  link: TwitterIdentityLink,
): string[][] {
  const normalized = normalizeLink(link)
  const unrelatedTags = existingTags
    .filter((tag) => !isTwitterProviderTag(tag))
    .map((tag) => [...tag])

  return [
    ...unrelatedTags,
    ...buildNip39TwitterLinkTags(
      normalized.handle,
      normalized.twitterId,
      normalized.proofPostId,
    ),
  ]
}

/** Count of non-Twitter tags preserved when merging a replacement. */
export function countPreservedKind10011Tags(
  existingTags: readonly string[][],
): number {
  return existingTags.filter((tag) => !isTwitterProviderTag(tag)).length
}

/**
 * Inspect existing Twitter provider tags for publish-preview classification.
 * Returns a valid claim when exactly one well-formed pair is present; otherwise
 * returns raw tag values for a replacement warning.
 */
export function inspectExistingTwitterTags(
  existingTags: readonly string[][],
): {
  claim?: TwitterIdentityLink
  rawTwitterTags: string[]
  hasTwitterTags: boolean
} {
  const twitterTags = existingTags.filter(isTwitterProviderTag)
  const rawTwitterTags = twitterTags.map((tag) => tag[1] ?? '')
  if (twitterTags.length === 0) {
    return { rawTwitterTags: [], hasTwitterTags: false }
  }

  const handleTags = twitterTags.filter((tag) =>
    tag[1]?.startsWith('twitter:'),
  )
  const idTags = twitterTags.filter((tag) =>
    tag[1]?.startsWith('twitter_id:'),
  )
  if (handleTags.length === 1 && idTags.length === 1) {
    const handle = normalizeTwitterHandle(
      handleTags[0]?.[1]?.slice('twitter:'.length) ?? '',
    )
    const twitterId = idTags[0]?.[1]?.slice('twitter_id:'.length) ?? ''
    const handleProof = handleTags[0]?.[2] ?? ''
    const idProof = idTags[0]?.[2] ?? ''
    if (
      isCanonicalTwitterHandle(handle) &&
      isTwitterNumericId(twitterId) &&
      handleProof === idProof &&
      hasMatchingProofHints(handleTags[0], idTags[0], handleProof)
    ) {
      return {
        claim: {
          handle,
          twitterId,
          ...(handleProof ? { proofPostId: handleProof } : {}),
        },
        rawTwitterTags,
        hasTwitterTags: true,
      }
    }
  }

  return { rawTwitterTags, hasTwitterTags: true }
}

export type Kind10011PublishChange = 'add' | 'refresh' | 'replace' | 'clear'

export function classifyKind10011PublishChange(
  existing: { claim?: TwitterIdentityLink; hasTwitterTags: boolean } | undefined,
  target: TwitterIdentityLink,
): Kind10011PublishChange {
  if (!existing?.hasTwitterTags) return 'add'
  if (!existing.claim) return 'replace'
  if (
    existing.claim.handle === target.handle &&
    existing.claim.twitterId === target.twitterId
  ) {
    return 'refresh'
  }
  return 'replace'
}

/** Classify a clear (revocation) publish against the current slot event. */
export function classifyKind10011ClearChange(
  existing: { claim?: TwitterIdentityLink; hasTwitterTags: boolean } | undefined,
): 'clear' | 'add' {
  return existing?.hasTwitterTags ? 'clear' : 'add'
}

export function buildKind10011Event(
  input: BuildKind10011Input,
): EventTemplate {
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
    throw new Error('createdAt must be a non-negative safe integer')
  }

  return {
    kind: NIP39_IDENTITY_KIND,
    created_at: input.createdAt,
    content: input.existingEvent?.content ?? '',
    tags: mergeKind10011TwitterTags(input.existingEvent?.tags ?? [], input),
  }
}

/**
 * Build a replaceable kind 10011 that removes all Twitter provider tags
 * (revocation). Preserves unrelated provider tags and content. Claims still
 * require twitter/twitter_id tags — this event is "valid signed 10011, no claim".
 */
export function buildKind10011ClearEvent(input: {
  createdAt: number
  existingEvent?: Pick<Event, 'tags' | 'content'>
}): EventTemplate {
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
    throw new Error('createdAt must be a non-negative safe integer')
  }
  return {
    kind: NIP39_IDENTITY_KIND,
    created_at: input.createdAt,
    content: input.existingEvent?.content ?? '',
    tags: (input.existingEvent?.tags ?? [])
      .filter((tag) => !isTwitterProviderTag(tag))
      .map((tag) => [...tag]),
  }
}

function cloneEventWithoutVerificationCache(event: Event): Event {
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags.map((tag) => [...tag]),
    content: event.content,
    sig: event.sig,
  }
}

export function validateKind10011TwitterIdentity(
  event: unknown,
  options: Kind10011ValidationOptions = {},
): Kind10011ValidationResult {
  const signedValidation = validateSignedKind10011Event(event, options)
  if (!signedValidation.valid) return signedValidation

  const signedEvent = signedValidation.event
  const errors: string[] = []
  const handleTags = signedEvent.tags.filter(
    (tag) => tag[0] === 'i' && tag[1]?.startsWith('twitter:'),
  )
  const idTags = signedEvent.tags.filter(
    (tag) => tag[0] === 'i' && tag[1]?.startsWith('twitter_id:'),
  )
  if (
    handleTags.length !== 1 ||
    ![2, 3, 4].includes(handleTags[0]?.length ?? 0)
  ) {
    errors.push(
      'Event must contain exactly one two-, three-, or four-element twitter i tag',
    )
  }
  if (
    idTags.length !== 1 ||
    ![2, 3, 4].includes(idTags[0]?.length ?? 0)
  ) {
    errors.push(
      'Event must contain exactly one two-, three-, or four-element twitter_id i tag',
    )
  }

  const handle = handleTags[0]?.[1]?.slice('twitter:'.length) ?? ''
  const twitterId = idTags[0]?.[1]?.slice('twitter_id:'.length) ?? ''
  const handleProof = handleTags[0]?.[2] ?? ''
  const idProof = idTags[0]?.[2] ?? ''

  if (!isCanonicalTwitterHandle(handle)) {
    errors.push('twitter handle must be canonical lowercase')
  }
  if (!isTwitterNumericId(twitterId)) {
    errors.push('twitter_id must contain only decimal digits')
  }
  if (handleProof === '' && idProof === '') {
    if (handleTags[0]?.length !== 2 || idTags[0]?.length !== 2) {
      errors.push('Proofless twitter tags must contain exactly two elements')
    }
  } else if (!isTwitterNumericId(handleProof) || !isTwitterNumericId(idProof)) {
    errors.push('Twitter proof post IDs must contain only decimal digits')
  } else if (handleProof !== idProof) {
    errors.push('twitter and twitter_id tags must use the same proof post ID')
  } else {
    if (handleTags[0]!.length !== idTags[0]!.length) {
      errors.push(
        'twitter and twitter_id tags must use matching legacy or structured proof hints',
      )
    }
    if (
      handleTags[0]!.length === 4 &&
      !isCanonicalNip39TwitterProofHint(handleTags[0]![3], handleProof)
    ) {
      errors.push('twitter i tag fourth value must match its proof post ID')
    }
    if (
      idTags[0]!.length === 4 &&
      !isCanonicalNip39TwitterProofHint(idTags[0]![3], idProof)
    ) {
      errors.push('twitter_id i tag fourth value must match its proof post ID')
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }
  return {
    valid: true,
    identity: {
      event: signedEvent,
      handle,
      twitterId,
      ...(handleProof ? { proofPostId: handleProof } : {}),
    },
  }
}

export function validateSignedKind10011Event(
  event: unknown,
  options: Kind10011ValidationOptions = {},
): SignedKind10011ValidationResult {
  if (
    typeof event !== 'object' ||
    event === null ||
    !('id' in event) ||
    !('sig' in event) ||
    !validateEvent(event)
  ) {
    return { valid: false, errors: ['A complete signed Nostr event is required'] }
  }

  const signedEvent = event as Event
  const errors: string[] = []
  if (signedEvent.kind !== NIP39_IDENTITY_KIND) {
    errors.push(`Event kind must be ${NIP39_IDENTITY_KIND}`)
  }
  if (
    !Number.isSafeInteger(signedEvent.created_at) ||
    signedEvent.created_at < 0
  ) {
    errors.push('created_at must be a non-negative safe integer')
  }

  if (options.verifyEvent !== false) {
    if (!HEX_64.test(signedEvent.id)) {
      errors.push('Event id must be 64 lowercase hexadecimal characters')
    } else {
      const uncachedEvent = cloneEventWithoutVerificationCache(signedEvent)
      if (getEventHash(uncachedEvent) !== signedEvent.id) {
        errors.push('Event id does not match its serialized event hash')
      } else if (!verifyEvent(uncachedEvent)) {
        errors.push('Event signature is invalid')
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }
  return { valid: true, event: signedEvent }
}

export function parseKind10011TwitterIdentity(
  event: Event,
  options: Kind10011ValidationOptions = {},
): ParsedKind10011TwitterIdentity {
  const result = validateKind10011TwitterIdentity(event, options)
  if (!result.valid) {
    throw new Kind10011ValidationError(result.errors)
  }
  return result.identity
}

// Role-oriented aliases for callers that do not use event kind names.
export const mergeTwitterIdentityTags = mergeKind10011TwitterTags
export const buildTwitterIdentityEvent = buildKind10011Event
export const parseTwitterIdentityEvent = parseKind10011TwitterIdentity
export const validateTwitterIdentityEvent = validateKind10011TwitterIdentity
