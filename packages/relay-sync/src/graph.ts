// Ported from AttentionX src/relay/graph.ts (imports rewritten for @dtp/* packages).
import type { Event } from 'nostr-tools'

export const TRUST_STATEMENT_KIND = 32009

const HEX_64 = /^[0-9a-f]{64}$/
const INTEGER = /^(0|[1-9][0-9]*)$/

function singleTag(
  event: Event,
  name: string,
): string | undefined {
  const tags = event.tags.filter(([tagName]) => tagName === name)
  return tags.length === 1 ? tags[0]?.[1] : undefined
}

function tagValues(event: Event, name: string): string[] {
  return event.tags
    .filter(([tagName]) => tagName === name)
    .map((tag) => tag[1])
    .filter((value): value is string => typeof value === 'string')
}

function hasAtMostOneTag(event: Event, name: string): boolean {
  return event.tags.filter(([tagName]) => tagName === name).length <= 1
}

function isValidTrustD(d: string | undefined): boolean {
  return d !== undefined && HEX_64.test(d)
}

function parseTimeTag(
  event: Event,
  name: 'x' | 'y',
): number | undefined | null {
  const value = singleTag(event, name)
  if (value === undefined) {
    return undefined
  }
  if (!INTEGER.test(value)) {
    return null
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function isNewer(candidate: Event, current: Event): boolean {
  return (
    candidate.created_at > current.created_at ||
    (candidate.created_at === current.created_at &&
      candidate.id < current.id)
  )
}

/**
 * Resolves addressable kind 32009 slots and returns only currently active,
 * positive `p` edges. Full signature and deterministic `d` validation remains
 * the responsibility of the injected event repository.
 */
export function activePositivePubkeyEdges(
  events: readonly Event[],
  activeAt: number,
): string[] {
  const newestByAddress = new Map<string, Event>()

  for (const event of events) {
    if (
      event.kind !== TRUST_STATEMENT_KIND ||
      !HEX_64.test(event.pubkey) ||
      !HEX_64.test(event.id)
    ) {
      continue
    }

    const d = singleTag(event, 'd')
    const value = singleTag(event, 'v')
    const subjectTags = event.tags.filter(([name]) =>
      name === 'p' || name === 'e' || name === 'i',
    )
    if (
      !isValidTrustD(d) ||
      value === undefined ||
      !['1', '0', '-1', ''].includes(value) ||
      subjectTags.length !== 1 ||
      !hasAtMostOneTag(event, 'k') ||
      !hasAtMostOneTag(event, 'c') ||
      !hasAtMostOneTag(event, 'x') ||
      !hasAtMostOneTag(event, 'y') ||
      tagValues(event, 's').some((scope) => scope.length === 0)
    ) {
      continue
    }

    const address = `${event.pubkey}:${d}`
    const current = newestByAddress.get(address)
    if (!current || isNewer(event, current)) {
      newestByAddress.set(address, event)
    }
  }

  const edges = new Set<string>()
  for (const event of newestByAddress.values()) {
    const value = singleTag(event, 'v')
    const pubkey = singleTag(event, 'p')
    const startsAt = parseTimeTag(event, 'x')
    const expiresAt = parseTimeTag(event, 'y')
    if (
      value !== '1' ||
      pubkey === undefined ||
      !HEX_64.test(pubkey) ||
      startsAt === null ||
      expiresAt === null ||
      (startsAt !== undefined && activeAt < startsAt) ||
      (expiresAt !== undefined && activeAt > expiresAt)
    ) {
      continue
    }
    edges.add(pubkey)
  }

  return [...edges].sort()
}
