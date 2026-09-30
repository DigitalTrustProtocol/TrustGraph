// Ported from AttentionX src/graph/ratings.test.ts (imports rewritten for @dtp/* packages).
import { describe, expect, it } from 'vitest'
import { isArtifactSubject, isIdentitySubject } from '../../src/index'
import { HeapTrustHarness, ratingRecord, trustRecord } from '../../src/testing'
import type { TrustSubject } from '../../src/types'

const root = 'root'
const alice = 'alice'
const bob = 'bob'
const carol = 'carol'
const post: TrustSubject = { type: 'i', value: 'post:id:42' }

function trust(
  eventId: string,
  author: string,
  subject: TrustSubject,
  value: 1 | -1 | 0,
) {
  return trustRecord(eventId, author, subject, value)
}

function claim(
  eventId: string,
  author: string,
  score: number,
  options: Parameters<typeof ratingRecord>[4] = {},
) {
  return ratingRecord(eventId, author, post, score, options)
}

describe('artifact rating resolver', () => {
  it('classifies identity vs artifact subjects', () => {
    expect(isIdentitySubject({ type: 'p', value: 'ab'.repeat(32) })).toBe(true)
    expect(isIdentitySubject({ type: 'i', value: 'user:id:1' })).toBe(true)
    expect(isArtifactSubject(post)).toBe(true)
    expect(isArtifactSubject({ type: 'e', value: 'ab'.repeat(32) })).toBe(true)
  })

  it('uses only the operator rating when the operator has rated', () => {
    const graph = new HeapTrustHarness([
      trust('t1', root, { type: 'p', value: alice }, 1),
      trust('t2', root, { type: 'p', value: bob }, -1),
    ])
    graph.rebuildClaims([
      claim('r-root', root, 80),
      claim('r-alice', alice, 0),
      claim('r-bob', bob, 100),
    ])

    const result = graph.queryRating({
      rootPubkey: root,
      subject: post,
      now: 10,
    })

    expect(result.claimCount).toBe(1)
    expect(result.averageScore).toBe(80)
    expect(result.degree).toBe(1)
    expect(result.own?.score).toBe(80)
    expect(result.claims.map((row) => row.author)).toEqual([root])
    expect(result.claims.find((row) => row.author === alice)).toBeUndefined()
    expect(result.claims.find((row) => row.author === bob)).toBeUndefined()
  })

  it('follows c=identity person trust to an empty-context rating', () => {
    const graph = new HeapTrustHarness([
      trustRecord('t1', root, { type: 'p', value: alice }, 1, {
        context: 'identity',
      }),
    ])
    graph.rebuildClaims([claim('r-alice', alice, 40)])

    const result = graph.queryRating({
      rootPubkey: root,
      subject: post,
      now: 10,
    })

    expect(result.claimCount).toBe(1)
    expect(result.averageScore).toBe(40)
    expect(result.degree).toBe(2)
    expect(result.claims.map((row) => row.author)).toEqual([alice])
  })

  it('averages hop-1 ratings and ignores hop-2 when the operator has not rated', () => {
    const graph = new HeapTrustHarness([
      trust('t1', root, { type: 'p', value: alice }, 1),
      trust('t2', alice, { type: 'p', value: carol }, 1),
    ])
    graph.rebuildClaims([
      claim('r-alice', alice, 40),
      claim('r-carol', carol, 100),
    ])

    const result = graph.queryRating({
      rootPubkey: root,
      subject: post,
      now: 10,
    })

    expect(result.claimCount).toBe(1)
    expect(result.averageScore).toBe(40)
    expect(result.degree).toBe(2)
    expect(result.own).toBeUndefined()
    expect(result.claims.map((row) => row.author)).toEqual([alice])
  })

  it('averages all hop-1 scores including 0 and excludes distrusted issuers', () => {
    const dave = 'dave'
    const graph = new HeapTrustHarness([
      trust('t1', root, { type: 'p', value: alice }, 1),
      trust('t2', root, { type: 'p', value: bob }, 1),
      trust('t3', root, { type: 'p', value: carol }, 1),
      trust('t4', root, { type: 'p', value: dave }, -1),
    ])
    graph.rebuildClaims([
      claim('r-alice', alice, 80),
      claim('r-bob', bob, 40),
      claim('r-carol', carol, 0),
      claim('r-dave', dave, 100),
    ])

    const result = graph.queryRating({
      rootPubkey: root,
      subject: post,
      now: 10,
    })

    expect(result.degree).toBe(2)
    expect(result.claimCount).toBe(3)
    expect(result.averageScore).toBe(40)
    expect(result.claims.map((row) => row.author).sort()).toEqual([
      alice,
      bob,
      carol,
    ])
    expect(result.claims.find((row) => row.author === dave)).toBeUndefined()
  })

  it('does not use ratings as hops', () => {
    const graph = new HeapTrustHarness([
      trust('t1', root, { type: 'p', value: alice }, 1),
      trust('t2', alice, { type: 'p', value: carol }, 1),
    ])
    graph.rebuildClaims([
      claim('genuine', alice, 100, { labels: ['genuine'] }),
      claim('spam', carol, 0, { labels: ['spam'] }),
    ])

    const all = graph.queryRating({ rootPubkey: root, subject: post, now: 10 })
    expect(all.claimCount).toBe(1)
    expect(all.claims[0]?.author).toBe(alice)
    expect(all.degree).toBe(2)

    const spam = graph.queryRating({
      rootPubkey: root,
      subject: post,
      labels: ['spam'],
      now: 10,
    })
    expect(spam.claimCount).toBe(0)
  })

  it('returns label descriptions for display without using them as filters', () => {
    const graph = new HeapTrustHarness([
      trust('t1', root, { type: 'p', value: alice }, 1),
    ])
    graph.rebuildClaims([
      claim('genuine', alice, 80, {
        labels: ['genuine'],
        labelHints: { genuine: 'Looks like a real person' },
      }),
    ])

    const all = graph.queryRating({ rootPubkey: root, subject: post, now: 10 })
    expect(all.claims[0]?.labels).toEqual(['genuine'])
    expect(all.claims[0]?.labelHints).toEqual({
      genuine: 'Looks like a real person',
    })

    const filtered = graph.queryRating({
      rootPubkey: root,
      subject: post,
      labels: ['genuine'],
      now: 10,
    })
    expect(filtered.claimCount).toBe(1)
    const miss = graph.queryRating({
      rootPubkey: root,
      subject: post,
      labels: ['Looks like a real person'],
      now: 10,
    })
    expect(miss.claimCount).toBe(0)
  })

  it('resolves exact context only and skips inactive windows', () => {
    const graph = new HeapTrustHarness([
      trust('t1', root, { type: 'p', value: alice }, 1),
    ])
    graph.rebuildClaims([
      claim('generic', alice, 80),
      claim('product', alice, 20, { context: 'product' }),
      claim('future', carol, 100, { activeFrom: 100 }),
    ])

    const generic = graph.queryRating({
      rootPubkey: root,
      subject: post,
      now: 10,
    })
    expect(generic.claims.map((row) => row.eventId).sort()).toEqual(['generic'])

    const product = graph.queryRating({
      rootPubkey: root,
      subject: post,
      context: 'product',
      now: 10,
    })
    expect(product.claims.map((row) => row.eventId)).toEqual(['product'])
  })

  it('reconstructs issuer hop chains when format is path', () => {
    const graph = new HeapTrustHarness([
      trust('t1', root, { type: 'p', value: alice }, 1),
      trust('t-post', alice, post, 1),
    ])
    graph.rebuildClaims([claim('r-alice', alice, 80)])

    const scored = graph.queryRating({
      rootPubkey: root,
      subject: post,
      now: 10,
    })
    expect(scored.paths).toEqual([])
    expect(scored.pathView?.nodes ?? []).toEqual([])
    expect(scored.ratingEdges ?? []).toEqual([])

    const withPath = graph.queryRating({
      rootPubkey: root,
      subject: post,
      now: 10,
      format: 'path',
    })
    expect(withPath.paths).toEqual([])
    expect(withPath.pathView?.nodes.length).toBeGreaterThan(0)
    expect(
      withPath.pathView?.nodes.some(
        (node) => node.subject?.value === alice,
      ),
    ).toBe(true)
    expect(withPath.ratingEdges?.length).toBeGreaterThan(0)
    expect(withPath.ratingEdges?.[0]?.eventId).toBe('r-alice')
  })

  it('bumps graphVersion when claims change without new trust edges', () => {
    const graph = new HeapTrustHarness([
      trust('t1', root, { type: 'p', value: alice }, 1),
    ])
    const before = graph.graphVersion
    graph.rebuildClaims([claim('r1', alice, 60)])
    expect(graph.graphVersion).toBeGreaterThan(before)
  })
})
