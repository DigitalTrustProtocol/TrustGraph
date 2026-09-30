// Ported from AttentionX src/relay/filters.ts (imports rewritten for @dtp/* packages).
import type { Filter } from 'nostr-tools'
import { RATING_STATEMENT_KIND, X_TRUST_SCOPE } from '@dtp/trust-protocol'
import { TRUST_STATEMENT_KIND } from './graph'

/** Default batch size for `#i` subject filters (relay limits vary). */
export const X_TRUST_SUBJECT_FILTER_BATCH = 20

/** Authors per REQ — stay under typical relay filter limits. */
export const AUTHOR_SYNC_FILTER_BATCH = 20

/** Page size for `until` pagination of saturated REQs. */
export const SYNC_PAGE_SIZE = 200

/**
 * Pull kind `32009` events authored by one pubkey for Attention on x.com.
 *
 * Omits `#s` so both legacy empty-scope and explicit `s=x.com` statements
 * match. Relays cannot filter “missing `s`”; unrelated scopes are
 * dropped client-side via `isEligibleXTrustScope`.
 *
 * @see docs/architecture.md § Scope policy
 */
export function buildAuthorTrustSyncFilter(
  author: string,
  since?: number,
  until?: number,
): Filter {
  return buildAuthorsTrustSyncFilter([author], since, until)
}

/** Multi-author kind `32009` pull. Omits `#s` (same as single-author). */
export function buildAuthorsTrustSyncFilter(
  authors: readonly string[],
  since?: number,
  until?: number,
): Filter {
  const unique = uniqueHexAuthors(authors)
  if (unique.length === 0) {
    throw new Error('At least one author is required')
  }
  return {
    kinds: [TRUST_STATEMENT_KIND],
    authors: unique,
    ...(since === undefined ? {} : { since }),
    ...(until === undefined ? {} : { until }),
  }
}

/**
 * Pull kind `32014` ratings authored by one pubkey already on the 32009
 * frontier. Separate REQ from trust so ratings never expand WoT traversal.
 */
export function buildAuthorRatingSyncFilter(
  author: string,
  since?: number,
  until?: number,
): Filter {
  return buildAuthorsRatingSyncFilter([author], since, until)
}

/**
 * Multi-author kind `32014` pull. Requests `#s=x.com` so empty-scope ratings
 * never cross the wire; ingest still validates with `isEligibleXRatingScope`.
 */
export function buildAuthorsRatingSyncFilter(
  authors: readonly string[],
  since?: number,
  until?: number,
): Filter {
  const unique = uniqueHexAuthors(authors)
  if (unique.length === 0) {
    throw new Error('At least one author is required')
  }
  return {
    kinds: [RATING_STATEMENT_KIND],
    authors: unique,
    '#s': [X_TRUST_SCOPE],
    ...(since === undefined ? {} : { since }),
    ...(until === undefined ? {} : { until }),
  }
}

/** Author-unfiltered live/global kind pull. */
export function buildGlobalKindSyncFilter(
  kind: number,
  since?: number,
  extra?: Omit<Filter, 'kinds' | 'since'>,
): Filter {
  return {
    kinds: [kind],
    ...extra,
    ...(since === undefined ? {} : { since }),
  }
}

/**
 * Discover trust statements about specific X accounts from any author.
 *
 * `#k=user:id` AND `#i=user:id:<digits>` — no `#s`, so legacy empty-scope and
 * new explicit `s=x.com` user statements are included; unrelated scopes are
 * filtered client-side.
 */
export function buildXAccountTrustDiscoveryFilter(
  twitterIds: readonly string[],
  since?: number,
): Filter {
  const subjects = [
    ...new Set(
      twitterIds
        .map((id) => id.trim())
        .filter((id) => /^\d+$/.test(id))
        .map((id) => `user:id:${id}`),
    ),
  ]
  if (subjects.length === 0) {
    throw new Error('At least one numeric X user id is required')
  }
  return {
    kinds: [TRUST_STATEMENT_KIND],
    '#k': ['user:id'],
    '#i': subjects,
    ...(since === undefined ? {} : { since }),
  }
}

/**
 * Trust (`32009`) and ratings (`32014`) about specific X posts from any
 * author, used to reload a post whose events were pruned for storage.
 *
 * Only `#i=post:id:<digits>` — no `#s` / `#k`, so legacy statements without
 * those tags still match; scope eligibility is checked client-side.
 */
export function buildXPostSubjectFilter(
  postIds: readonly string[],
  since?: number,
): Filter {
  const subjects = [
    ...new Set(
      postIds
        .map((id) => id.trim())
        .filter((id) => /^\d+$/.test(id))
        .map((id) => `post:id:${id}`),
    ),
  ]
  if (subjects.length === 0) {
    throw new Error('At least one numeric X post id is required')
  }
  return {
    kinds: [TRUST_STATEMENT_KIND, RATING_STATEMENT_KIND],
    '#i': subjects,
    ...(since === undefined ? {} : { since }),
  }
}

/**
 * Optional companion filter for site-scoped statements only (`#s=x.com`).
 * Useful when a caller wants an explicit x.com pull alongside the open filter.
 */
export function buildXScopedTrustFilter(
  base: Omit<Filter, '#s' | 'kinds'> & { kinds?: number[] },
): Filter {
  return {
    ...base,
    kinds: base.kinds ?? [TRUST_STATEMENT_KIND],
    '#s': [X_TRUST_SCOPE],
  }
}

/** Refresh one known replaceable slot when the `d` digest is already known. */
export function buildTrustSlotFilter(author: string, d: string): Filter {
  return {
    kinds: [TRUST_STATEMENT_KIND],
    authors: [author],
    '#d': [d],
  }
}

export function batchXTrustSubjectIds(
  twitterIds: readonly string[],
  batchSize = X_TRUST_SUBJECT_FILTER_BATCH,
): string[][] {
  const unique = [
    ...new Set(
      twitterIds
        .map((id) => id.trim())
        .filter((id) => /^\d+$/.test(id)),
    ),
  ].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  return batchValues(unique, batchSize)
}

export function batchAuthors(
  authors: readonly string[],
  batchSize = AUTHOR_SYNC_FILTER_BATCH,
): string[][] {
  return batchValues(uniqueHexAuthors(authors), batchSize)
}

export function xSubjectSyncScope(baseScope: string): string {
  return `${baseScope}:x-subjects`
}

/** Stable per-batch cursor so later `#i` batches cannot steal an earlier cursor. */
export function xSubjectBatchSyncScope(
  baseScope: string,
  twitterIds: readonly string[],
): string {
  const key = batchXTrustSubjectIds(twitterIds, twitterIds.length)[0]?.join(',')
  if (!key) return xSubjectSyncScope(baseScope)
  return `${baseScope}:x-subjects:${key}`
}

export function globalKindSyncScope(baseScope: string, kind: number): string {
  return `${baseScope}:kind:${kind}:global`
}

/** Durable live cursor for heap-frontier subscriptions (one per relay+kind). */
export function frontierKindSyncScope(baseScope: string, kind: number): string {
  return `${baseScope}:kind:${kind}:frontier-live`
}

function uniqueHexAuthors(authors: readonly string[]): string[] {
  return [
    ...new Set(
      authors
        .map((author) => author.trim().toLowerCase())
        .filter((author) => /^[0-9a-f]{64}$/.test(author)),
    ),
  ].sort()
}

function batchValues<T>(values: readonly T[], batchSize: number): T[][] {
  const size = Math.max(1, Math.floor(batchSize))
  const batches: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size) as T[])
  }
  return batches
}
