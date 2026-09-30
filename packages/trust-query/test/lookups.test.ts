import { describe, expect, it } from 'vitest'
import { Graph } from '@dtp/trust-graph'
import { ratingRecord, trustRecord } from '../src/testing'
import {
  LookupError,
  lookupCounts,
  lookupPage,
  positiveAuthorFrontier,
  type LookupItem,
  type LookupParams,
} from '../src/index'

const hex = (c: string) => c.repeat(64)
const A = hex('a')
const B = hex('b')
const C = hex('c')
const D = hex('d')
const X = 'user:id:100'
const POST = 'post:id:9'

function graphOf(records: Parameters<Graph['applyTrustEvent']>[0][]): Graph {
  const graph = new Graph()
  for (const record of records) graph.applyTrustEvent(record)
  return graph
}

function ids(items: readonly LookupItem[]): string[] {
  return items.map((item) => item.eventId)
}

function allPages(graph: Graph, direction: 'incoming' | 'outgoing', params: LookupParams): LookupItem[] {
  const out: LookupItem[] = []
  let cursor: string | undefined
  for (let guard = 0; guard < 100; guard += 1) {
    const page = lookupPage(graph, 1, direction, { ...params, ...(cursor ? { cursor } : {}) })
    out.push(...page.items)
    if (!page.nextCursor) return out
    cursor = page.nextCursor
  }
  throw new Error('paging did not end')
}

describe('lookup.incoming', () => {
  const graph = graphOf([
    trustRecord('e1', A, { type: 'i', value: X }, 1, { context: 'identity', createdAt: 10 }),
    trustRecord('e2', B, { type: 'i', value: X }, -1, { context: 'identity', createdAt: 20 }),
    trustRecord('e3', C, { type: 'i', value: X }, 0, { createdAt: 30 }),
    trustRecord('e4', A, { type: 'p', value: D }, 1, { context: 'identity', createdAt: 40 }),
    trustRecord('e5', B, { type: 'p', value: D }, 1, { context: 'identity', createdAt: 5 }),
    trustRecord('e6', C, { type: 'i', value: X }, 1, { context: 'other', createdAt: 50 }),
    trustRecord('e7', D, { type: 'i', value: X }, 1, { context: 'identity', createdAt: 60, activeUntil: 70 }),
    ratingRecord('r1', A, { type: 'i', value: POST }, 80, { createdAt: 11, labels: ['genuine'] }),
    ratingRecord('r2', B, { type: 'i', value: POST }, 0, { createdAt: 12, labels: ['spam'] }),
  ])

  it('returns selected winners over the identity chain, most recent first', () => {
    const page = lookupPage(graph, 7, 'incoming', {
      keys: [`i:${X}`],
      context: 'identity',
      now: 100,
    })
    expect(page.graphVersion).toBe(7)
    // e6 is in context `other` (not in the identity chain); e7 expired at 70.
    expect(ids(page.items)).toEqual(['e3', 'e2', 'e1'])
    expect(page.items[0]).toMatchObject({ kind: 32009, author: C, value: 0, context: '' })
    expect(page.nextCursor).toBeUndefined()
  })

  it('filters by value, activity, and time range', () => {
    const base = { keys: [`i:${X}`], context: 'identity', now: 65 }
    expect(ids(lookupPage(graph, 1, 'incoming', { ...base, values: [1] }).items)).toEqual(['e7', 'e1'])
    expect(ids(lookupPage(graph, 1, 'incoming', { ...base, now: 100, includeInactive: true }).items)).toEqual([
      'e7',
      'e3',
      'e2',
      'e1',
    ])
    expect(ids(lookupPage(graph, 1, 'incoming', { ...base, since: 15, until: 30 }).items)).toEqual(['e3', 'e2'])
  })

  it('selects one record per author and key; contextMatch any sees every bucket', () => {
    const any = lookupPage(graph, 1, 'incoming', { keys: [`i:${X}`], contextMatch: 'any', now: 100 })
    // C has e3 (global) and e6 (other): selected keeps the newest (e6).
    expect(ids(any.items)).toEqual(['e6', 'e2', 'e1'])
    const raw = lookupPage(graph, 1, 'incoming', {
      keys: [`i:${X}`],
      contextMatch: 'any',
      mode: 'raw',
      now: 100,
    })
    expect(ids(raw.items)).toEqual(['e6', 'e3', 'e2', 'e1'])
    const exact = lookupPage(graph, 1, 'incoming', {
      keys: [`i:${X}`],
      context: 'identity',
      contextMatch: 'exact',
      now: 100,
    })
    expect(ids(exact.items)).toEqual(['e2', 'e1'])
  })

  it('merges aliases with the omitSameValueUserIdDuplicate rule', () => {
    const merged = graphOf([
      trustRecord('u1', A, { type: 'i', value: X }, 1, { context: 'identity', createdAt: 1 }),
      trustRecord('p1', A, { type: 'p', value: D }, 1, { context: 'identity', createdAt: 2 }),
      trustRecord('u2', B, { type: 'i', value: X }, -1, { context: 'identity', createdAt: 3 }),
      trustRecord('p2', B, { type: 'p', value: D }, 1, { context: 'identity', createdAt: 4 }),
    ])
    const params = { keys: [`i:${X}`, `p:${D}`], context: 'identity', now: 10 }
    expect(ids(lookupPage(merged, 1, 'incoming', params).items)).toEqual(['p2', 'u2', 'p1', 'u1'])
    expect(ids(lookupPage(merged, 1, 'incoming', { ...params, mergeKeys: true }).items)).toEqual([
      'p2',
      'u2',
      'p1',
    ])
    expect(lookupCounts(merged, 1, { ...params, direction: 'incoming', mergeKeys: true }).counts).toEqual({
      merged: { trust: 2, neutral: 0, distrust: 1, ratings: 0 },
    })
  })

  it('does not resolve keys through binds', () => {
    const bound = graphOf([
      trustRecord('u1', A, { type: 'i', value: X }, 1, { context: 'identity', createdAt: 1 }),
      trustRecord('p1', B, { type: 'p', value: D }, 1, { context: 'identity', createdAt: 2 }),
    ])
    bound.bindIdentity(X, D)
    expect(ids(lookupPage(bound, 1, 'incoming', { keys: [`i:${X}`], context: 'identity', now: 5 }).items)).toEqual([
      'u1',
    ])
    expect(ids(lookupPage(bound, 1, 'incoming', { keys: [`p:${D}`], context: 'identity', now: 5 }).items)).toEqual([
      'p1',
    ])
  })

  it('reads ratings with the exact bucket and the label filter', () => {
    const ratings = lookupPage(graph, 1, 'incoming', { keys: [`i:${POST}`], kinds: [32014], now: 100 })
    expect(ids(ratings.items)).toEqual(['r2', 'r1'])
    expect(ratings.items[1]).toMatchObject({ score: 80, labels: ['genuine'] })
    expect(ratings.items[1]).not.toHaveProperty('value')
    const genuine = lookupPage(graph, 1, 'incoming', {
      keys: [`i:${POST}`],
      kinds: [32014],
      labels: ['genuine'],
      now: 100,
    })
    expect(ids(genuine.items)).toEqual(['r1'])
    const withTotals = lookupPage(graph, 1, 'incoming', {
      keys: [`i:${POST}`],
      kinds: [32009, 32014],
      withTotals: true,
      now: 100,
    })
    expect(withTotals.totals).toEqual({ trust: 0, neutral: 0, distrust: 0, ratings: 2 })
  })

  it('pages with keyset cursors that add up to the unpaged result', () => {
    for (const order of ['recent', 'author'] as const) {
      const params: LookupParams = { keys: [`i:${X}`, `p:${D}`], contextMatch: 'any', mode: 'raw', order, now: 100 }
      const unpaged = lookupPage(graph, 1, 'incoming', { ...params, limit: 500 }).items
      const paged = allPages(graph, 'incoming', { ...params, limit: 2 })
      expect(ids(paged)).toEqual(ids(unpaged))
      expect(new Set(ids(paged)).size).toBe(paged.length)
    }
    const byAuthor = lookupPage(graph, 1, 'incoming', {
      keys: [`i:${X}`],
      contextMatch: 'any',
      mode: 'raw',
      order: 'author',
      now: 100,
    })
    expect(byAuthor.items.map((i) => i.author)).toEqual([A, B, C, C])
  })

  it('rejects malformed requests and foreign cursors', () => {
    expect(() => lookupPage(graph, 1, 'incoming', { keys: [] })).toThrow(LookupError)
    expect(() => lookupPage(graph, 1, 'incoming', { keys: ['nope'] })).toThrow(LookupError)
    expect(() => lookupPage(graph, 1, 'outgoing', { keys: [`i:${X}`] })).toThrow(/pubkeys/)
    expect(() =>
      lookupPage(graph, 1, 'incoming', { keys: Array.from({ length: 51 }, (_, i) => `i:user:id:${i}`) }),
    ).toThrow(/at most 50/)
    const first = lookupPage(graph, 1, 'incoming', { keys: [`i:${X}`], contextMatch: 'any', limit: 1, now: 100 })
    expect(first.nextCursor).toBeDefined()
    expect(() =>
      lookupPage(graph, 1, 'incoming', { keys: [`i:${X}`], limit: 1, now: 100, cursor: first.nextCursor }),
    ).toThrow(/does not match/)
    expect(() => lookupPage(graph, 1, 'incoming', { keys: [`i:${X}`], cursor: 'garbage' })).toThrow(/malformed/)
  })

  it('stops at the scanned-record budget and omits totals', () => {
    const page = lookupPage(
      graph,
      1,
      'incoming',
      { keys: [`i:${X}`], contextMatch: 'any', mode: 'raw', withTotals: true, now: 100 },
      { maxKeys: 50, maxPage: 500, maxRecords: 2 },
    )
    expect(page.truncated).toBe(true)
    expect(page.truncatedReasons).toEqual(['edgeBudget'])
    expect(page.totals).toBeUndefined()
  })
})

describe('lookup.outgoing and counts', () => {
  const graph = graphOf([
    trustRecord('o1', A, { type: 'p', value: B }, 1, { context: 'identity', createdAt: 1 }),
    trustRecord('o2', A, { type: 'i', value: X }, -1, { context: 'identity', createdAt: 2 }),
    trustRecord('o3', A, { type: 'i', value: POST }, 1, { createdAt: 3 }),
    trustRecord('o4', B, { type: 'p', value: C }, 0, { context: 'identity', createdAt: 4 }),
    ratingRecord('o5', A, { type: 'i', value: POST }, 55, { createdAt: 5 }),
  ])

  it('filters subject types', () => {
    const people = lookupPage(graph, 1, 'outgoing', {
      keys: [`p:${A}`],
      context: 'identity',
      subjectTypes: ['p', 'user:id'],
      now: 10,
    })
    expect(ids(people.items)).toEqual(['o2', 'o1'])
    const posts = lookupPage(graph, 1, 'outgoing', {
      keys: [`p:${A}`],
      kinds: [32009, 32014],
      context: 'identity',
      subjectTypes: ['post:id'],
      now: 10,
    })
    // The 32014 bucket is exact `identity`, so the empty-context rating is not in it.
    expect(ids(posts.items)).toEqual(['o3'])
  })

  it('counts per key and equals the unpaged tally', () => {
    const counts = lookupCounts(graph, 1, {
      keys: [`p:${A}`, `p:${B}`],
      direction: 'outgoing',
      kinds: [32009, 32014],
      contextMatch: 'any',
      now: 10,
    })
    expect(counts.counts).toEqual({
      [`p:${A}`]: { trust: 2, neutral: 0, distrust: 1, ratings: 1 },
      [`p:${B}`]: { trust: 0, neutral: 1, distrust: 0, ratings: 0 },
    })
  })

  it('gives the same answer for every observer (no root input)', () => {
    const a = lookupPage(graph, 1, 'outgoing', { keys: [`p:${A}`], now: 10, contextMatch: 'any' })
    const b = lookupPage(graph, 1, 'outgoing', { keys: [`p:${A}`], now: 10, contextMatch: 'any' })
    expect(a).toEqual(b)
  })
})

describe('sync frontier', () => {
  it('walks active positive identity-chain statements level by level with caps', () => {
    const E = hex('e')
    const F = hex('f')
    const graph = graphOf([
      trustRecord('1', A, { type: 'p', value: B }, 1, { context: 'identity' }),
      trustRecord('2', A, { type: 'p', value: C }, 1),
      trustRecord('3', A, { type: 'p', value: D }, -1, { context: 'identity' }),
      trustRecord('4', B, { type: 'p', value: E }, 1, { context: 'identity' }),
      trustRecord('5', C, { type: 'p', value: F }, 1, { context: 'identity', activeUntil: 1 }),
      trustRecord('6', E, { type: 'p', value: F }, 1, { context: 'identity' }),
      trustRecord('7', C, { type: 'p', value: E }, 1, { context: 'other' }),
    ])
    const full = positiveAuthorFrontier(graph, [A], { maxDepth: 3, maxAuthorsPerLevel: 10, maxTotalAuthors: 10 }, 5)
    expect(full.authors).toEqual([
      { pubkey: A, depth: 0 },
      { pubkey: B, depth: 1, via: A },
      { pubkey: C, depth: 1, via: A },
      { pubkey: E, depth: 2, via: B },
      { pubkey: F, depth: 3, via: E },
    ])
    expect(full.reasons).toEqual([])
    const capped = positiveAuthorFrontier(graph, [A], { maxDepth: 1, maxAuthorsPerLevel: 1, maxTotalAuthors: 10 }, 5)
    expect(capped.authors.map((a) => a.pubkey)).toEqual([A, B])
    expect(capped.reasons.sort()).toEqual(['maxAuthorsPerLevel', 'maxDepth'])
    const total = positiveAuthorFrontier(graph, [A], { maxDepth: 3, maxAuthorsPerLevel: 10, maxTotalAuthors: 2 }, 5)
    expect(total.authors.map((a) => a.pubkey)).toEqual([A, B])
    expect(total.reasons).toEqual(['maxTotalAuthors'])
  })

  it('follows a bound user:id to its pubkey', () => {
    const graph = graphOf([trustRecord('1', A, { type: 'i', value: X }, 1, { context: 'identity' })])
    expect(positiveAuthorFrontier(graph, [A], { maxDepth: 2, maxAuthorsPerLevel: 9, maxTotalAuthors: 9 }, 5).authors).toHaveLength(1)
    graph.bindIdentity(X, B)
    expect(
      positiveAuthorFrontier(graph, [A], { maxDepth: 2, maxAuthorsPerLevel: 9, maxTotalAuthors: 9 }, 5).authors,
    ).toEqual([
      { pubkey: A, depth: 0 },
      { pubkey: B, depth: 1, via: A },
    ])
  })
})
