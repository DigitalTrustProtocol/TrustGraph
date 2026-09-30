// Ported from AttentionX src/lib/nostr/nip32009.ts (imports rewritten for @dtp/* packages).
/**
 * Write-time 32009/14 columns on EventRecord. Heap apply reads these fields
 * and does not parse tags again.
 */

import {
  cloneLabelHints,
  getTrustSubjectValidationError,
  isCanonicalTrustLabel,
  parseHumanLabelTags,
  type TrustSubject,
} from './kind-32009'
import {
  RATING_STATEMENT_KIND,
  isCanonicalRatingLabel,
  parseRatingScoreValue,
} from './kind-32014'
import type { EventRecord, SignedNostrEvent } from './types'

export const KIND_TRUST = 32009

const UNIX_SECONDS = /^\d+$/
const SUBJECT_TAGS = new Set(['p', 'e', 'i'])

export type EventRecordGraphColumns = Pick<
  EventRecord,
  | 'subject'
  | 'subjectType'
  | 'c_tag'
  | 'nValue'
  | 'addressableId'
  | 'activate'
  | 'expire'
  | 'labels'
  | 'labelHints'
>

function tagsNamed(tags: readonly string[][], name: string): string[][] {
  return tags.filter((tag) => tag[0] === name)
}

function parseUnixSeconds(tag: string[] | undefined): number | undefined {
  if (!tag || tag.length !== 2 || !UNIX_SECONDS.test(tag[1] ?? '')) {
    return undefined
  }
  const parsed = Number(tag[1])
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

export function slotAddressableId(
  author: string,
  subject: { type: string; value: string },
  context: string,
): string {
  return [
    `${author.length}:${author}`,
    `${subject.type}:${subject.value.length}:${subject.value}`,
    `${context.length}:${context}`,
  ].join('|')
}

function parseSubject(
  tags: readonly string[][],
): { type: 'p' | 'e' | 'i'; value: string } | undefined {
  const subjectTags = tags.filter((tag) => SUBJECT_TAGS.has(tag[0] ?? ''))
  if (subjectTags.length !== 1 || (subjectTags[0]?.length ?? 0) < 2) {
    return undefined
  }
  const subjectTag = subjectTags[0]!
  const subject: TrustSubject = {
    type: subjectTag[0] as TrustSubject['type'],
    value: subjectTag[1]!,
  }
  if (getTrustSubjectValidationError(subject)) return undefined
  return {
    type: subject.type,
    value: subject.value.toLowerCase(),
  }
}

function labelColumns(
  tags: readonly string[][],
  isCanonicalLabel: (label: string) => boolean,
): Pick<EventRecordGraphColumns, 'labels' | 'labelHints'> {
  const { labels, labelHints } = parseHumanLabelTags(
    tagsNamed(tags, 'l'),
    [],
    isCanonicalLabel,
  )
  const hints = cloneLabelHints(labelHints)
  return {
    ...(labels.length > 0 ? { labels: [...labels] } : {}),
    ...(hints !== undefined ? { labelHints: hints } : {}),
  }
}

function fillKind32009Columns(
  event: SignedNostrEvent,
): EventRecordGraphColumns | undefined {
  const subject = parseSubject(event.tags)
  if (!subject) return undefined

  const valueTags = tagsNamed(event.tags, 'v')
  if (valueTags.length !== 1 || valueTags[0]?.length !== 2) return undefined
  const rawValue = valueTags[0]![1] ?? ''
  const live = rawValue === '1' || rawValue === '0' || rawValue === '-1'
  const tombstone = rawValue === ''
  if (!live && !tombstone) return undefined

  const contextTags = tagsNamed(event.tags, 'c')
  if (contextTags.length > 1) return undefined
  const context = contextTags[0]?.[1] ?? ''
  const activate = parseUnixSeconds(tagsNamed(event.tags, 'x')[0])
  const expire = parseUnixSeconds(tagsNamed(event.tags, 'y')[0])

  return {
    subject: subject.value,
    subjectType: subject.type,
    c_tag: context,
    ...(live ? { nValue: Number(rawValue) } : {}),
    ...(activate === undefined ? {} : { activate }),
    ...(expire === undefined ? {} : { expire }),
    ...labelColumns(event.tags, isCanonicalTrustLabel),
  }
}

function fillKind32014Columns(
  event: SignedNostrEvent,
): EventRecordGraphColumns | undefined {
  const subject = parseSubject(event.tags)
  if (!subject) return undefined

  const scoreTags = tagsNamed(event.tags, 'score')
  if (scoreTags.length !== 1 || scoreTags[0]?.length !== 2) return undefined
  const rawScore = scoreTags[0]![1] ?? ''
  const score = parseRatingScoreValue(rawScore)
  const tombstone = rawScore === ''
  if (score === undefined && !tombstone) return undefined

  const contextTags = tagsNamed(event.tags, 'c')
  if (contextTags.length > 1) return undefined
  const context = contextTags[0]?.[1] ?? ''
  const activate = parseUnixSeconds(tagsNamed(event.tags, 'x')[0])
  const expire = parseUnixSeconds(tagsNamed(event.tags, 'y')[0])
  
  return {
    subject: subject.value,
    subjectType: subject.type,
    c_tag: context,
    ...(score !== undefined ? { nValue: score } : {}),
    ...(activate === undefined ? {} : { activate }),
    ...(expire === undefined ? {} : { expire }),
    ...labelColumns(event.tags, isCanonicalRatingLabel),
  }
}

/**
 * Normalized 32009/14 columns for Dexie. Undefined for other kinds or
 * rows that cannot be reduced (callers persist the signed event anyway).
 */
export function fillEventRecordColumns(
  event: SignedNostrEvent,
): EventRecordGraphColumns | undefined {
  if (event.kind === KIND_TRUST) return fillKind32009Columns(event)
  if (event.kind === RATING_STATEMENT_KIND) return fillKind32014Columns(event)
  return undefined
}

export function eventRecordSubject(
  record: Pick<EventRecord, 'subject' | 'subjectType'>,
): TrustSubject | undefined {
  if (!record.subject || !record.subjectType) return undefined
  return { type: record.subjectType, value: record.subject }
}
