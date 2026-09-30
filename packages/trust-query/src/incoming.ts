// Ported from AttentionX src/graph/incoming.ts (imports rewritten for @dtp/* packages).
import { parseCanonicalTwitterSubject } from '@dtp/trust-protocol'
import { cloneLabelHints } from '@dtp/trust-protocol'
import { eventRecordSubject } from '@dtp/trust-protocol'
import { trustEdgeValue } from '@dtp/trust-graph'
import type { TrustEdgeRecord as EventRecord } from '@dtp/trust-graph'
import type { ResolvedStatement, TrustSubject } from './types'

/** Cap for incoming 1-hop statements returned to Notes Trusted By. */
export const MAX_INCOMING_TRUST_STATEMENTS = 200

function pubkeyKey(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * True when this winner targets the Notes user: `i:user:id` and/or a bound
 * npub (`p`). Graph neighborhood draws these 1-hop edges even when the
 * authors are outside the operator's last-degree WoT resolve.
 */
export function isIncomingUserStatement(
  statement: EventRecord,
  options: {
    twitterId?: string
    pubkeyHexes: ReadonlySet<string>
  },
): boolean {
  const value = trustEdgeValue(statement)
  if (value === undefined) return false
  const subject = eventRecordSubject(statement)
  if (!subject) return false
  switch (subject.type) {
    case 'i': {
      if (!options.twitterId) return false
      const parsed = parseCanonicalTwitterSubject(subject.value)
      return parsed?.type === 'account' && parsed.twitterId === options.twitterId
    }
    case 'p':
      return options.pubkeyHexes.has(pubkeyKey(subject.value))
    case 'e':
      return false
    default: {
      const _exhaustive: never = subject
      return _exhaustive
    }
  }
}

export function toIncomingResolvedStatement(
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
    distance: 1,
  }
}

export function incomingSubjectKeys(subject: TrustSubject): {
  twitterId?: string
  pubkeyHexes: Set<string>
} {
  const pubkeyHexes = new Set<string>()
  switch (subject.type) {
    case 'p': {
      const hex = pubkeyKey(subject.value)
      if (/^[0-9a-f]{64}$/.test(hex)) pubkeyHexes.add(hex)
      return { pubkeyHexes }
    }
    case 'i': {
      const parsed = parseCanonicalTwitterSubject(subject.value)
      if (parsed?.type === 'account') {
        return { twitterId: parsed.twitterId, pubkeyHexes }
      }
      return { pubkeyHexes }
    }
    case 'e':
      return { pubkeyHexes }
    default: {
      const _exhaustive: never = subject
      return _exhaustive
    }
  }
}

/**
 * Map Graph.in winners to Notes rows.
 * A derived nostr key is the only issuer. An X id is a subject, not an author.
 * When that key already trusts the same person via `p` at the same value, the
 * matching `user:id` row is the same trust and is not listed again.
 * A different value stays (hop-mesh Trust plus user:id distrust).
 */
export function selectIncomingUserStatements(
  statements: readonly EventRecord[],
): {
  statements: ResolvedStatement[]
  truncated: boolean
} {
  const matched: ResolvedStatement[] = []
  for (const statement of statements) {
    if (trustEdgeValue(statement) === undefined) continue
    if (!eventRecordSubject(statement)) continue
    matched.push(toIncomingResolvedStatement(statement))
  }
  const listed = omitSameValueUserIdDuplicate(matched)
  const truncated = listed.length > MAX_INCOMING_TRUST_STATEMENTS
  return {
    statements: truncated
      ? listed.slice(0, MAX_INCOMING_TRUST_STATEMENTS)
      : listed,
    truncated,
  }
}

/** Drop `user:id` when this author already has a `p` row with the same value. */
function omitSameValueUserIdDuplicate(
  statements: readonly ResolvedStatement[],
): ResolvedStatement[] {
  const keyTrust = new Set(
    statements.flatMap((row) =>
      row.subject.type === 'p' ? [`${row.author}:${row.value}`] : [],
    ),
  )
  return statements.filter((row) => {
    if (row.subject.type !== 'i') return true
    if (!row.subject.value.startsWith('user:id:')) return true
    return !keyTrust.has(`${row.author}:${row.value}`)
  })
}
