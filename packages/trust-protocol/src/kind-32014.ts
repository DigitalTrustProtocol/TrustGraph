// Ported from AttentionX src/lib/nostr/kind-32014.ts (imports rewritten for @dtp/* packages).
import {
  getEventHash,
  validateEvent,
  verifyEvent,
  type Event,
  type EventTemplate,
} from 'nostr-tools'
import {
  TRUST_CONTEXT_BYTE_LIMIT,
  TRUST_STATEMENT_CONTENT_LIMIT,
  buildKind32009D,
  canonicalizeNpubHint,
  getStructuredTrustHintValidationError,
  getTrustSubjectValidationError,
  isCanonicalTrustContext,
  isCanonicalTrustScope,
  parseSubjectHint,
  serializeSubjectHint,
  parseHumanLabelTags,
  type SubjectHint,
  type TrustSubject,
} from './kind-32009'
import { sanitizeTrustContent } from './trust-content'

export const RATING_STATEMENT_KIND = 32014
export const RATING_STATEMENT_CONTENT_LIMIT = TRUST_STATEMENT_CONTENT_LIMIT
export const RATING_LABEL_BYTE_LIMIT = TRUST_CONTEXT_BYTE_LIMIT
export const RATING_SCORE_MAX_FRACTION_DIGITS = 6

const HEX_64 = /^[0-9a-f]{64}$/
const IDENTIFIER_CLASS_GRAMMAR =
  /^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._-]*)*$/
const UNIX_SECONDS = /^\d+$/
const LABEL_GRAMMAR =
  /^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._-]*)*$/
const RESERVED_TAGS = new Set([
  'd',
  'p',
  'e',
  'i',
  'score',
  'k',
  's',
  'c',
  'l',
  'x',
  'y',
])

export type RatingSubject = TrustSubject
export type RatingStatementActiveStatus =
  | 'active'
  | 'cancelled'
  | 'not_yet_active'
  | 'expired'

export interface BuildKind32014Input {
  subject: RatingSubject
  /** Empty string = cancel. Canonical number in [0, 100] otherwise. */
  score: string
  context?: string
  scopes?: string[]
  k?: string
  labels?: string[]
  activationTime?: number
  expirationTime?: number
  content?: string
  createdAt: number
  subjectHints?: SubjectHint[]
  extraTags?: string[][]
}

export interface ParsedKind32014 {
  event: Event
  d: string
  subject: RatingSubject
  /** Empty string when cancelled; otherwise a canonical score in [0, 100]. */
  score: string
  /** Numeric score when active; undefined when cancelled. */
  scoreValue?: number
  context: string
  scopes: string[]
  labels: string[]
  /** Sanitized descriptions keyed by label token. Display only; not in `d`. */
  labelHints?: Record<string, string>
  k?: string
  activationTime?: number
  expirationTime?: number
  subjectHints: SubjectHint[]
  /** Sanitized reason text. Signed `event.content` is left unchanged. */
  content: string
}

export interface Kind32014ValidationOptions {
  verifyEvent?: boolean
}

export type Kind32014ValidationResult =
  | { valid: true; statement: ParsedKind32014 }
  | { valid: false; errors: string[] }

export interface ReducedKind32014 {
  statements: ParsedKind32014[]
  rejected: Array<{ event: Event; errors: string[] }>
}

export class Kind32014ValidationError extends Error {
  readonly errors: string[]

  constructor(errors: string[]) {
    super(errors.join('; '))
    this.name = 'Kind32014ValidationError'
    this.errors = errors
  }
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function unicodeCharacterLength(value: string): number {
  return [...value].length
}

export function isCanonicalRatingLabel(label: string): boolean {
  return (
    label.length > 0 &&
    utf8Length(label) <= RATING_LABEL_BYTE_LIMIT &&
    LABEL_GRAMMAR.test(label)
  )
}

export function canonicalRatingLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const label of labels) {
    if (seen.has(label)) continue
    seen.add(label)
    result.push(label)
  }
  return result
}

/**
 * Canonical score wire form, or undefined if invalid.
 * Empty string is cancel (not a number). `"0"` is an active rating.
 */
export function canonicalizeRatingScore(value: string): string | undefined {
  if (value === '') return ''
  if (value !== value.trim() || value.length === 0) return undefined
  if (/[eE+]/.test(value) || value.startsWith('.')) return undefined

  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value)
  if (!match) return undefined

  const integerPart = match[1]
  const fractionPart = match[2]
  if (fractionPart !== undefined && fractionPart.length > RATING_SCORE_MAX_FRACTION_DIGITS) {
    return undefined
  }
  if (integerPart.length > 1 && integerPart.startsWith('0')) return undefined

  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return undefined

  if (fractionPart === undefined) {
    return integerPart
  }
  const strippedFraction = fractionPart.replace(/0+$/, '')
  if (strippedFraction.length === 0) return integerPart
  return `${integerPart}.${strippedFraction}`
}

export function parseRatingScoreValue(score: string): number | undefined {
  if (score === '') return undefined
  const canonical = canonicalizeRatingScore(score)
  if (canonical === undefined || canonical === '') return undefined
  return Number(canonical)
}

function deriveIdentifierClass(iValue: string): string | undefined {
  if (/^user:id:\d+$/.test(iValue)) return 'user:id'
  if (/^post:id:\d+$/.test(iValue)) return 'post:id'
  if (/^hash:[0-9a-f]{64}$/.test(iValue)) return 'hash'
  if (iValue.startsWith('web:')) return 'web'
  if (/^nostr:profile:[0-9a-f]{64}$/.test(iValue)) return 'nostr:profile'
  if (/^nostr:pubkey:[0-9a-f]{64}$/.test(iValue)) return 'nostr:pubkey'
  if (iValue.startsWith('nostr:addr:')) return 'nostr:addr'
  return undefined
}

function formatUnixSeconds(value: number, name: string): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return String(value)
}

function validateSubjectHints(hints: readonly SubjectHint[]): void {
  for (const hint of hints) {
    if (hint.kind === 'npub') {
      if (!canonicalizeNpubHint(hint.npub)) {
        throw new Error('Subject npub hint is not a valid npub')
      }
      continue
    }
    const error = getStructuredTrustHintValidationError({
      class: hint.class,
      property: hint.property,
      value: hint.value,
    })
    if (error) throw new Error(`Subject hint: ${error}`)
  }
}

function validateBuildInput(input: BuildKind32014Input): void {
  const subjectError = getTrustSubjectValidationError(input.subject)
  if (subjectError) {
    throw new Error(subjectError)
  }
  const canonicalScore = canonicalizeRatingScore(input.score)
  if (canonicalScore === undefined || canonicalScore !== input.score) {
    throw new Error(
      'Score must be empty (cancel) or a canonical number in [0, 100]',
    )
  }
  if (!isCanonicalTrustContext(input.context ?? '')) {
    throw new Error('Context is not canonical')
  }
  for (const scope of input.scopes ?? []) {
    if (!isCanonicalTrustScope(scope)) {
      throw new Error('Scope is not canonical')
    }
  }
  for (const label of input.labels ?? []) {
    if (!isCanonicalRatingLabel(label)) {
      throw new Error('Label is not canonical')
    }
  }
  validateSubjectHints(input.subjectHints ?? [])
  if (input.k !== undefined && !IDENTIFIER_CLASS_GRAMMAR.test(input.k)) {
    throw new Error('Identifier class is not canonical')
  }
  if (
    input.k !== undefined &&
    input.subject.type === 'i' &&
    (!input.subject.value.startsWith(`${input.k}:`) ||
      input.subject.value.length <= input.k.length + 1)
  ) {
    throw new Error('Identifier class does not match the i subject')
  }
  if (
    unicodeCharacterLength(input.content ?? '') >
    RATING_STATEMENT_CONTENT_LIMIT
  ) {
    throw new Error(
      `Content must not exceed ${RATING_STATEMENT_CONTENT_LIMIT} Unicode characters`,
    )
  }
  formatUnixSeconds(input.createdAt, 'createdAt')
  if (input.activationTime !== undefined) {
    formatUnixSeconds(input.activationTime, 'activationTime')
  }
  if (input.expirationTime !== undefined) {
    formatUnixSeconds(input.expirationTime, 'expirationTime')
  }
  if (
    input.activationTime !== undefined &&
    input.expirationTime !== undefined &&
    input.activationTime > input.expirationTime
  ) {
    throw new Error('activationTime must be less than or equal to expirationTime')
  }
  for (const tag of input.extraTags ?? []) {
    if (
      !Array.isArray(tag) ||
      tag.length === 0 ||
      tag.some((part) => typeof part !== 'string')
    ) {
      throw new Error('Extra tags must be non-empty arrays of strings')
    }
    if (RESERVED_TAGS.has(tag[0])) {
      throw new Error(`Extra tags must not contain reserved ${tag[0]} tags`)
    }
  }
}

export async function buildKind32014Event(
  input: BuildKind32014Input,
): Promise<EventTemplate> {
  validateBuildInput(input)
  const context = input.context ?? ''
  const scopes = input.scopes ?? []
  const labels = canonicalRatingLabels(input.labels ?? [])
  const k =
    input.k ??
    (input.subject.type === 'i'
      ? deriveIdentifierClass(input.subject.value)
      : undefined)
  const subjectHints = input.subjectHints ?? []
  const tags: string[][] = [
    ['d', await buildKind32009D(input.subject, scopes, context)],
    [
      input.subject.type,
      input.subject.value,
      ...subjectHints.map(serializeSubjectHint),
    ],
    ['score', input.score],
  ]

  if (k !== undefined) {
    tags.push(['k', k])
  }
  for (const scope of [...scopes].sort()) {
    tags.push(['s', scope])
  }
  if (context !== '') {
    tags.push(['c', context])
  }
  for (const label of labels) {
    tags.push(['l', label])
  }
  if (input.activationTime !== undefined) {
    tags.push(['x', formatUnixSeconds(input.activationTime, 'activationTime')])
  }
  if (input.expirationTime !== undefined) {
    tags.push(['y', formatUnixSeconds(input.expirationTime, 'expirationTime')])
  }
  tags.push(...(input.extraTags ?? []).map((tag) => [...tag]))

  return {
    kind: RATING_STATEMENT_KIND,
    created_at: input.createdAt,
    content: input.content ?? '',
    tags,
  }
}

function tagsNamed(event: Event, name: string): string[][] {
  return event.tags.filter((tag) => tag[0] === name)
}

function parseUnixSeconds(
  tag: string[] | undefined,
  name: string,
  errors: string[],
): number | undefined {
  if (!tag) {
    return undefined
  }
  if (tag.length !== 2 || !UNIX_SECONDS.test(tag[1])) {
    errors.push(`${name} tag must contain one base-10 Unix-second integer`)
    return undefined
  }

  const parsed = Number(tag[1])
  if (!Number.isSafeInteger(parsed)) {
    errors.push(`${name} tag exceeds the safe integer range`)
    return undefined
  }
  return parsed
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

function parseScopes(
  scopeTags: string[][],
  errors: string[],
): string[] {
  const scopes: string[] = []
  for (const tag of scopeTags) {
    if (tag.length !== 2) {
      errors.push('Each s tag must contain exactly one scope value')
      continue
    }
    if (!isCanonicalTrustScope(tag[1])) {
      errors.push('Scope is not canonical')
      continue
    }
    scopes.push(tag[1])
  }
  return [...new Set(scopes)].sort()
}

function parseLabels(
  labelTags: string[][],
  errors: string[],
): { labels: string[]; labelHints?: Record<string, string> } {
  return parseHumanLabelTags(labelTags, errors, isCanonicalRatingLabel)
}

function parseSubjectHints(
  subjectTag: string[] | undefined,
  errors: string[],
): SubjectHint[] {
  if (!subjectTag || subjectTag.length <= 2) return []
  const hints: SubjectHint[] = []
  for (const rawHint of subjectTag.slice(2)) {
    const hint = parseSubjectHint(rawHint)
    if (!hint) {
      errors.push(
        'Additional subject values must be a bare npub1… or class:property:value',
      )
      continue
    }
    hints.push(hint)
  }
  return hints
}

async function inspectKind32014(
  event: Event,
  options: Kind32014ValidationOptions,
): Promise<{ errors: string[]; statement?: ParsedKind32014 }> {
  const errors: string[] = []
  if (!validateEvent(event)) {
    return { errors: ['Event does not have a valid Nostr event shape'] }
  }
  if (event.kind !== RATING_STATEMENT_KIND) {
    errors.push(`Event kind must be ${RATING_STATEMENT_KIND}`)
  }
  if (!Number.isSafeInteger(event.created_at) || event.created_at < 0) {
    errors.push('created_at must be a non-negative safe integer')
  }
  if (unicodeCharacterLength(event.content) > RATING_STATEMENT_CONTENT_LIMIT) {
    errors.push(
      `Content must not exceed ${RATING_STATEMENT_CONTENT_LIMIT} Unicode characters`,
    )
  }

  if (options.verifyEvent !== false) {
    if (!HEX_64.test(event.id)) {
      errors.push('Event id must be 64 lowercase hexadecimal characters')
    } else {
      const uncachedEvent = cloneEventWithoutVerificationCache(event)
      if (getEventHash(uncachedEvent) !== event.id) {
        errors.push('Event id does not match its serialized event hash')
      } else if (!verifyEvent(uncachedEvent)) {
        errors.push('Event signature is invalid')
      }
    }
  }

  const dTags = tagsNamed(event, 'd')
  const subjectTags = event.tags.filter((tag) =>
    ['p', 'e', 'i'].includes(tag[0]),
  )
  const scoreTags = tagsNamed(event, 'score')
  const kTags = tagsNamed(event, 'k')
  const scopeTags = tagsNamed(event, 's')
  const contextTags = tagsNamed(event, 'c')
  const labelTags = tagsNamed(event, 'l')
  const activationTags = tagsNamed(event, 'x')
  const expirationTags = tagsNamed(event, 'y')

  if (dTags.length !== 1 || dTags[0]?.length !== 2) {
    errors.push('Event must contain exactly one two-element d tag')
  } else if (!HEX_64.test(dTags[0][1])) {
    errors.push('d tag must be 64 lowercase hexadecimal characters')
  }
  if (subjectTags.length !== 1 || (subjectTags[0]?.length ?? 0) < 2) {
    errors.push('Event must contain exactly one subject tag with a primary value')
  }
  if (scoreTags.length !== 1 || scoreTags[0]?.length !== 2) {
    errors.push('Event must contain exactly one two-element score tag')
  }
  if (
    kTags.length > 1 ||
    (kTags.length === 1 && kTags[0].length !== 2)
  ) {
    errors.push('Event may contain at most one two-element k tag')
  }
  if (
    contextTags.length > 1 ||
    (contextTags.length === 1 && contextTags[0].length !== 2)
  ) {
    errors.push('Event may contain at most one two-element c tag')
  }
  if (
    activationTags.length > 1 ||
    (activationTags.length === 1 && activationTags[0].length !== 2)
  ) {
    errors.push('Event may contain at most one two-element x tag')
  }
  if (
    expirationTags.length > 1 ||
    (expirationTags.length === 1 && expirationTags[0].length !== 2)
  ) {
    errors.push('Event may contain at most one two-element y tag')
  }

  const context = contextTags[0]?.[1] ?? ''
  if (!isCanonicalTrustContext(context)) {
    errors.push('Context is not canonical')
  }

  const scopes = parseScopes(scopeTags, errors)
  const { labels, labelHints } = parseLabels(labelTags, errors)
  const k = kTags[0]?.[1]

  const subjectTag = subjectTags[0]
  const subject =
    subjectTag && subjectTag.length >= 2
      ? ({
          type: subjectTag[0] as RatingSubject['type'],
          value: subjectTag[1],
        } as RatingSubject)
      : undefined
  const subjectHints = parseSubjectHints(subjectTag, errors)
  if (subject) {
    const subjectError = getTrustSubjectValidationError(subject)
    if (subjectError) {
      errors.push(subjectError)
    }
  }

  if (k !== undefined) {
    if (!IDENTIFIER_CLASS_GRAMMAR.test(k)) {
      errors.push('Identifier class is not canonical')
    } else if (subject?.type !== 'i') {
      errors.push('k tag is only valid with an i subject')
    } else if (
      !subject.value.startsWith(`${k}:`) ||
      subject.value.length <= k.length + 1
    ) {
      errors.push('i subject must equal k plus a non-empty value')
    }
  } else if (subject?.type === 'i' && kTags.length > 0) {
    errors.push('k tag must contain exactly one identifier class value')
  }

  const rawScore = scoreTags[0]?.[1]
  let score: string | undefined
  if (rawScore === undefined) {
    errors.push('Event must contain exactly one two-element score tag')
  } else {
    const canonical = canonicalizeRatingScore(rawScore)
    if (canonical === undefined || canonical !== rawScore) {
      errors.push(
        'score must be empty (cancel) or a canonical number in [0, 100]',
      )
    } else {
      score = canonical
    }
  }

  const activationTime = parseUnixSeconds(activationTags[0], 'x', errors)
  const expirationTime = parseUnixSeconds(expirationTags[0], 'y', errors)
  if (
    activationTime !== undefined &&
    expirationTime !== undefined &&
    activationTime > expirationTime
  ) {
    errors.push('x must be less than or equal to y')
  }

  if (
    dTags.length === 1 &&
    dTags[0].length === 2 &&
    subject &&
    !getTrustSubjectValidationError(subject) &&
    isCanonicalTrustContext(context)
  ) {
    const expectedD = await buildKind32009D(subject, scopes, context)
    if (dTags[0][1] !== expectedD) {
      errors.push('d tag does not match the subject, scope, and context')
    }
  }

  if (errors.length === 0 && subject && score !== undefined) {
    const scoreValue = parseRatingScoreValue(score)
    return {
      errors,
      statement: {
        event,
        d: dTags[0][1],
        subject,
        score,
        context,
        scopes,
        labels,
        ...(labelHints !== undefined ? { labelHints } : {}),
        subjectHints,
        content: sanitizeTrustContent(
          event.content,
          RATING_STATEMENT_CONTENT_LIMIT,
        ),
        ...(scoreValue !== undefined ? { scoreValue } : {}),
        ...(k !== undefined ? { k } : {}),
        activationTime,
        expirationTime,
      },
    }
  }
  return { errors }
}

export async function validateKind32014Event(
  event: unknown,
  options: Kind32014ValidationOptions = {},
): Promise<Kind32014ValidationResult> {
  if (
    typeof event !== 'object' ||
    event === null ||
    !('id' in event) ||
    !('sig' in event)
  ) {
    return { valid: false, errors: ['A complete signed Nostr event is required'] }
  }

  const inspection = await inspectKind32014(event as Event, options)
  return inspection.statement
    ? { valid: true, statement: inspection.statement }
    : { valid: false, errors: inspection.errors }
}

export async function parseKind32014Event(
  event: Event,
  options: Kind32014ValidationOptions = {},
): Promise<ParsedKind32014> {
  const result = await validateKind32014Event(event, options)
  if (!result.valid) {
    throw new Kind32014ValidationError(result.errors)
  }
  return result.statement
}

export function isNewerKind32014Replacement(
  candidate: ParsedKind32014,
  current: ParsedKind32014,
): boolean {
  if (
    candidate.event.pubkey !== current.event.pubkey ||
    candidate.d !== current.d
  ) {
    throw new Error('Replacement candidates must have the same author and d tag')
  }
  return (
    candidate.event.created_at > current.event.created_at ||
    (candidate.event.created_at === current.event.created_at &&
      candidate.event.id < current.event.id)
  )
}

export async function reduceKind32014Events(
  events: readonly Event[],
  options: Kind32014ValidationOptions = {},
): Promise<ReducedKind32014> {
  const byAddress = new Map<string, ParsedKind32014>()
  const rejected: ReducedKind32014['rejected'] = []

  for (const event of events) {
    const result = await validateKind32014Event(event, options)
    if (!result.valid) {
      rejected.push({ event, errors: result.errors })
      continue
    }

    const key = `${event.pubkey}:${result.statement.d}`
    const current = byAddress.get(key)
    if (
      !current ||
      isNewerKind32014Replacement(result.statement, current)
    ) {
      byAddress.set(key, result.statement)
    }
  }

  return {
    statements: [...byAddress.values()].sort(
      (left, right) =>
        right.event.created_at - left.event.created_at ||
        left.event.id.localeCompare(right.event.id),
    ),
    rejected,
  }
}

export function getRatingStatementActiveStatus(
  statement: ParsedKind32014,
  now: number,
): RatingStatementActiveStatus {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('now must be a non-negative safe integer')
  }
  if (statement.score === '') {
    return 'cancelled'
  }
  if (
    statement.activationTime !== undefined &&
    now < statement.activationTime
  ) {
    return 'not_yet_active'
  }
  if (
    statement.expirationTime !== undefined &&
    now > statement.expirationTime
  ) {
    return 'expired'
  }
  return 'active'
}

export function isRatingStatementActive(
  statement: ParsedKind32014,
  now: number,
): boolean {
  return getRatingStatementActiveStatus(statement, now) === 'active'
}

export const buildRatingStatementEvent = buildKind32014Event
export const parseRatingStatementEvent = parseKind32014Event
export const validateRatingStatementEvent = validateKind32014Event
export const reduceRatingStatementEvents = reduceKind32014Events
