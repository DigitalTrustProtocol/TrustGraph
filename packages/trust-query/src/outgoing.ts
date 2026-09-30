// Ported from AttentionX src/graph/outgoing.ts (imports rewritten for @dtp/* packages).
import { parseCanonicalTwitterSubject } from '@dtp/trust-protocol'
import { cloneLabelHints } from '@dtp/trust-protocol'
import { eventRecordSubject } from '@dtp/trust-protocol'
import { trustEdgeValue } from '@dtp/trust-graph'
import type { TrustEdgeRecord as EventRecord } from '@dtp/trust-graph'
import type { ResolvedStatement } from './types'

/** Cap for outgoing user:id statements returned to Notes. */
export const MAX_OUTGOING_TRUST_STATEMENTS = 200

function authorKey(author: string): string {
  return author.trim().toLowerCase()
}

/** True when this winner is an active user:id statement by one of `authorPubkeys`. */
export function isOutgoingUserStatement(
  statement: EventRecord,
  authorPubkeys: ReadonlySet<string>,
): boolean {
  if (!authorPubkeys.has(authorKey(statement.pubkey))) return false
  if (statement.subjectType !== 'i') return false
  const parsed = parseCanonicalTwitterSubject(statement.subject ?? '')
  if (parsed?.type !== 'account') return false
  return trustEdgeValue(statement) !== undefined
}

export function toOutgoingResolvedStatement(
  statement: EventRecord,
): ResolvedStatement {
  const subject = eventRecordSubject(statement)!
  const labelHints = cloneLabelHints(statement.labelHints)
  const value = trustEdgeValue(statement) ?? 0
  return {
    eventId: statement.id,
    connectionKey: statement.addressKey,
    author: statement.pubkey,
    subject: { ...subject },
    context: statement.c_tag ?? '',
    requestedContext: statement.c_tag ?? '',
    contextMatch: 'exact',
    value,
    createdAt: statement.created_at,
    ...(statement.activate !== undefined
      ? { activeFrom: statement.activate }
      : {}),
    ...(statement.expire !== undefined
      ? { activeUntil: statement.expire }
      : {}),
    ...(statement.content !== undefined && statement.content !== ''
      ? { content: statement.content }
      : {}),
    ...(statement.labels !== undefined && statement.labels.length > 0
      ? { labels: [...statement.labels] }
      : {}),
    ...(labelHints !== undefined ? { labelHints } : {}),
    distance: 0,
  }
}

export function selectOutgoingUserStatements(
  statements: readonly EventRecord[],
  authorPubkeys: ReadonlySet<string>,
): {
  statements: ResolvedStatement[]
  truncated: boolean
} {
  const authors = new Set(
    [...authorPubkeys].map((pubkey) => authorKey(pubkey)).filter(Boolean),
  )
  if (authors.size === 0) {
    return { statements: [], truncated: false }
  }
  const matched: ResolvedStatement[] = []
  for (const statement of statements) {
    if (!isOutgoingUserStatement(statement, authors)) continue
    matched.push(toOutgoingResolvedStatement(statement))
  }
  const truncated = matched.length > MAX_OUTGOING_TRUST_STATEMENTS
  return {
    statements: truncated
      ? matched.slice(0, MAX_OUTGOING_TRUST_STATEMENTS)
      : matched,
    truncated,
  }
}

export function outgoingTargetTwitterId(
  statement: Pick<ResolvedStatement, 'subject'>,
): string | undefined {
  if (statement.subject.type !== 'i') return undefined
  const parsed = parseCanonicalTwitterSubject(statement.subject.value)
  return parsed?.type === 'account' ? parsed.twitterId : undefined
}
