// Ported from AttentionX src/graph/index-resolver.test.ts (imports rewritten for @dtp/* packages).
/**
 * Direct IndexResolver tests: scoreKind 32009 / 32014, degrees 0–5.
 * Product resolve max is 4 (`WOT_MAX_DEGREE_DEFAULT`); degree 5 must miss.
 * Only +1 identity hops may trust or rate the terminal subject.
 */
import { describe, expect, it } from 'vitest'
import { WOT_MAX_DEGREE_DEFAULT } from '../../src/shared/wot-max-degree'
import { HeapTrustHarness, ratingRecord, trustRecord } from '../../src/testing'
import { indexResolver } from '@dtp/trust-graph'
import { RatingScore, TrustScore, type Score } from '@dtp/trust-graph'
import type { Graph } from '@dtp/trust-graph'
import type { TrustSubject, TrustValue } from '../../src/types'
import type { EventRecord } from '@dtp/trust-protocol'
import { RATING_STATEMENT_KIND } from '@dtp/trust-protocol'
import { TRUST_STATEMENT_KIND } from '@dtp/trust-protocol'

const NOW = 10
const root = 'root'
const post: TrustSubject = { type: 'i', value: 'post:id:42' }
const foe = 'foe'
const stranger = 'stranger'
const skip = 'skip'

function hopId(n: number): string {
  return `d${n}`
}

function pubkey(id: string): TrustSubject {
  return { type: 'p', value: id }
}

function issuerAt(hops: number): string {
  return hops === 0 ? root : hopId(hops)
}

/** Root --(+1)--> d1 --(+1)--> … --(+1)--> d{hops}. */
function trustedChain(hops: number): EventRecord[] {
  const out: EventRecord[] = []
  let prev = root
  for (let i = 1; i <= hops; i++) {
    const id = hopId(i)
    out.push(trustRecord(`hop-${prev}-${id}`, prev, pubkey(id), 1))
    prev = id
  }
  return out
}

function terminalTrust(author: string, value: TrustValue): EventRecord {
  return trustRecord(`32009-${author}-post`, author, post, value)
}

function terminalRating(author: string, score: number): EventRecord {
  return ratingRecord(`32014-${author}-post`, author, post, score)
}

/** Untrusted issuers who also speak about the post — must never count. */
function untrustedSpeakers(kind: 32009 | 32014): EventRecord[] {
  return [
    trustRecord('root-foe', root, pubkey(foe), -1),
    trustRecord('root-skip', root, pubkey(skip), 0),
    kind === TRUST_STATEMENT_KIND
      ? terminalTrust(foe, 1)
      : terminalRating(foe, 100),
    kind === TRUST_STATEMENT_KIND
      ? terminalTrust(skip, 1)
      : terminalRating(skip, 100),
    kind === TRUST_STATEMENT_KIND
      ? terminalTrust(stranger, -1)
      : terminalRating(stranger, 0),
  ]
}

function resolve(
  heap: Graph,
  subjectId: string,
  scoreKind: 32009 | 32014,
): Score {
  const scores = indexResolver.resolve(root, subjectId, {
    graph: heap,
    format: 'default',
    followTrustThreshold: 1,
    now: NOW,
    kind: scoreKind,
    maxDepth: WOT_MAX_DEGREE_DEFAULT,
    trustContext: 'identity',
    scoreContext: 'identity',
  })
  const hit = scores.find((row) => row.subject === subjectId) ?? scores[0]
  if (!hit) throw new Error(`IndexResolver returned no score for ${subjectId}`)
  return hit
}

const ladder: ReadonlyArray<{
  degree: number
  hops: number
  yields: boolean
}> = [
  { degree: 1, hops: 0, yields: true },
  { degree: 2, hops: 1, yields: true },
  { degree: 3, hops: 2, yields: true },
  { degree: 4, hops: 3, yields: true },
  { degree: 5, hops: 4, yields: false },
]

describe('IndexResolver degree 0', () => {
  it('32009: author is the subject with no incoming is disconnected', () => {
    const h = new HeapTrustHarness([
      trustRecord('root-alice', root, pubkey('alice'), 1),
    ])
    const score = resolve(h.graph, root, TRUST_STATEMENT_KIND)
    expect(score).toBeInstanceOf(TrustScore)
    expect(score.connected).toBe(false)
    expect(score.count).toBe(0)
    expect(score.degree).toBe(0)
    expect((score as TrustScore).trustValue).toBe(0)
  })

  it('32009: hop-1 incoming onto the observer is last-degree evidence', () => {
    const h = new HeapTrustHarness([
      trustRecord('root-alice', root, pubkey('alice'), 1),
      trustRecord('alice-root', 'alice', pubkey(root), 1),
    ])
    const score = resolve(h.graph, root, TRUST_STATEMENT_KIND)
    expect(score).toBeInstanceOf(TrustScore)
    expect(score.connected).toBe(true)
    expect(score.degree).toBe(2)
    expect(score.count).toBe(1)
    expect((score as TrustScore).trust).toBe(1)
    expect((score as TrustScore).trustValue).toBe(1)
  })

  it('32014: untrusted and stranger ratings do not connect (degree 0)', () => {
    const h = new HeapTrustHarness(untrustedSpeakers(RATING_STATEMENT_KIND))
    const score = resolve(h.graph, post.value, RATING_STATEMENT_KIND)
    expect(score).toBeInstanceOf(RatingScore)
    expect(score.connected).toBe(false)
    expect(score.count).toBe(0)
    expect(score.degree).toBe(0)
  })

  it('32009: untrusted and stranger post trusts do not connect (degree 0)', () => {
    const h = new HeapTrustHarness(untrustedSpeakers(TRUST_STATEMENT_KIND))
    const score = resolve(h.graph, post.value, TRUST_STATEMENT_KIND)
    expect(score).toBeInstanceOf(TrustScore)
    expect(score.connected).toBe(false)
    expect(score.count).toBe(0)
    expect(score.degree).toBe(0)
  })
})

describe('IndexResolver 32009 degrees 1–5 (maxDepth 4)', () => {
  it.each(ladder)(
    'degree $degree (hops=$hops) yields=$yields; foe/skip/stranger ignored',
    ({ degree, hops, yields }) => {
      const issuer = issuerAt(hops)
      const h = new HeapTrustHarness([
        ...trustedChain(hops),
        ...untrustedSpeakers(TRUST_STATEMENT_KIND),
        terminalTrust(issuer, 1),
      ])
      const score = resolve(h.graph, post.value, TRUST_STATEMENT_KIND)
      expect(score).toBeInstanceOf(TrustScore)
      if (!yields) {
        expect(score.connected).toBe(false)
        expect(score.count).toBe(0)
        return
      }
      expect(score.connected).toBe(true)
      expect(score.degree).toBe(degree)
      expect(score.count).toBe(1)
      expect((score as TrustScore).trust).toBe(1)
      expect((score as TrustScore).distrust).toBe(0)
    },
  )
})

describe('IndexResolver 32014 degrees 1–5 (maxDepth 4)', () => {
  it.each(ladder)(
    'degree $degree (hops=$hops) yields=$yields; foe/skip/stranger ignored',
    ({ degree, hops, yields }) => {
      const issuer = issuerAt(hops)
      const h = new HeapTrustHarness([
        ...trustedChain(hops),
        ...untrustedSpeakers(RATING_STATEMENT_KIND),
        terminalRating(issuer, 40),
      ])
      const score = resolve(h.graph, post.value, RATING_STATEMENT_KIND)
      expect(score).toBeInstanceOf(RatingScore)
      if (!yields) {
        expect(score.connected).toBe(false)
        expect(score.count).toBe(0)
        return
      }
      expect(score.connected).toBe(true)
      expect(score.degree).toBe(degree)
      expect(score.count).toBe(1)
      expect((score as RatingScore).ratingValue).toBe(40)
    },
  )
})

describe('IndexResolver only trusted identities speak', () => {
  it('32009: two trusted hop-1 issuers both count; distrusted does not', () => {
    const h = new HeapTrustHarness([
      trustRecord('root-d1', root, pubkey(hopId(1)), 1),
      trustRecord('root-d1b', root, pubkey('d1b'), 1),
      ...untrustedSpeakers(TRUST_STATEMENT_KIND),
      terminalTrust(hopId(1), 1),
      terminalTrust('d1b', -1),
    ])
    const score = resolve(h.graph, post.value, TRUST_STATEMENT_KIND)
    expect(score.degree).toBe(2)
    expect(score.count).toBe(2)
    expect((score as TrustScore).trust).toBe(1)
    expect((score as TrustScore).distrust).toBe(1)
  })

  it('32014: two trusted hop-1 ratings count including 0; distrusted 100 does not', () => {
    const h = new HeapTrustHarness([
      trustRecord('root-d1', root, pubkey(hopId(1)), 1),
      trustRecord('root-d1b', root, pubkey('d1b'), 1),
      ...untrustedSpeakers(RATING_STATEMENT_KIND),
      terminalRating(hopId(1), 40),
      terminalRating('d1b', 0),
    ])
    const score = resolve(h.graph, post.value, RATING_STATEMENT_KIND)
    expect(score.degree).toBe(2)
    expect(score.count).toBe(2)
    expect((score as RatingScore).ratingValue).toBe(40)
  })

  it('32009: hop-2 evidence is ignored when a trusted hop-1 already hit', () => {
    const h = new HeapTrustHarness([
      ...trustedChain(2),
      terminalTrust(hopId(1), 1),
      terminalTrust(hopId(2), -1),
      ...untrustedSpeakers(TRUST_STATEMENT_KIND),
    ])
    const score = resolve(h.graph, post.value, TRUST_STATEMENT_KIND)
    expect(score.degree).toBe(2)
    expect((score as TrustScore).trust).toBe(1)
    expect((score as TrustScore).distrust).toBe(0)
  })

  it('32014: hop-2 rating is ignored when a trusted hop-1 already hit', () => {
    const h = new HeapTrustHarness([
      ...trustedChain(2),
      terminalRating(hopId(1), 25),
      terminalRating(hopId(2), 99),
      ...untrustedSpeakers(RATING_STATEMENT_KIND),
    ])
    const score = resolve(h.graph, post.value, RATING_STATEMENT_KIND)
    expect(score.degree).toBe(2)
    expect(score.count).toBe(1)
    expect((score as RatingScore).ratingValue).toBe(25)
  })

  it('32014 is never a hop to a rater', () => {
    const h = new HeapTrustHarness([
      terminalRating(root, 80),
      terminalRating(hopId(1), 10),
    ])
    const score = resolve(h.graph, post.value, RATING_STATEMENT_KIND)
    expect(score.degree).toBe(1)
    expect(score.count).toBe(1)
    expect((score as RatingScore).ratingValue).toBe(80)
  })

  it('32009 query ignores a 32014 on the post', () => {
    const h = new HeapTrustHarness([
      ...trustedChain(1),
      terminalRating(hopId(1), 80),
    ])
    const score = resolve(h.graph, post.value, TRUST_STATEMENT_KIND)
    expect(score.connected).toBe(false)
    expect(score.count).toBe(0)
  })

  it('32014 query ignores a 32009 on the post', () => {
    const h = new HeapTrustHarness([
      ...trustedChain(1),
      terminalTrust(hopId(1), 1),
    ])
    const score = resolve(h.graph, post.value, RATING_STATEMENT_KIND)
    expect(score.connected).toBe(false)
    expect(score.count).toBe(0)
  })

  it('same author can trust and rate a post without clobbering either slot', () => {
    const h = new HeapTrustHarness([
      ...trustedChain(1),
      terminalTrust(hopId(1), 1),
      terminalRating(hopId(1), 80),
    ])
    const trust = resolve(h.graph, post.value, TRUST_STATEMENT_KIND)
    expect(trust).toBeInstanceOf(TrustScore)
    expect(trust.connected).toBe(true)
    expect((trust as TrustScore).trust).toBe(1)

    const rating = resolve(h.graph, post.value, RATING_STATEMENT_KIND)
    expect(rating).toBeInstanceOf(RatingScore)
    expect(rating.connected).toBe(true)
    expect((rating as RatingScore).ratingValue).toBe(80)
  })

  it('32009 and 32014 can hit at different degrees', () => {
    const h = new HeapTrustHarness([
      ...trustedChain(2),
      terminalTrust(hopId(1), 1),
      terminalRating(hopId(2), 40),
    ])
    const trust = resolve(h.graph, post.value, TRUST_STATEMENT_KIND)
    const rating = resolve(h.graph, post.value, RATING_STATEMENT_KIND)
    expect(trust.connected).toBe(true)
    expect(trust.degree).toBe(2)
    expect((trust as TrustScore).trust).toBe(1)
    expect(rating.connected).toBe(true)
    expect(rating.degree).toBe(3)
    expect((rating as RatingScore).ratingValue).toBe(40)
  })

  it('32014 path walks hop TrustScores then the subject RatingScore', () => {
    const h = new HeapTrustHarness([
      ...trustedChain(1),
      terminalRating(hopId(1), 40),
    ])
    const scores = indexResolver.resolve(root, post.value, {
      graph: h.graph,
      format: 'path',
      followTrustThreshold: 1,
      now: NOW,
      kind: RATING_STATEMENT_KIND,
      maxDepth: WOT_MAX_DEGREE_DEFAULT,
    })
    const subject = scores.find((row) => row.subject === post.value) ?? scores[0]
    expect(subject).toBeInstanceOf(RatingScore)
    expect((subject as RatingScore).ratingValue).toBe(40)
    expect(scores.some((row) => row instanceof TrustScore)).toBe(true)
  })
})

describe('IndexResolver kind-prefixed context vs applyTrustEvent', () => {
  const user: TrustSubject = { type: 'i', value: 'user:id:44196397' }

  it('walks identity p-hops onto identity user:id evidence (X timeline)', () => {
    const h = new HeapTrustHarness([
      trustRecord('root-alice', root, pubkey('alice'), 1, {
        context: 'identity',
      }),
      trustRecord('alice-user', 'alice', user, 1, { context: 'identity' }),
    ])
    expect([...h.graph.contextIndex.keys()]).toEqual(['32009:identity'])
    const hopIndexes = h.graph.getContextIndexes(
      'identity',
      TRUST_STATEMENT_KIND,
    )
    expect(hopIndexes).toHaveLength(1)
    const alice = h.graph.getNode('alice')
    expect(alice).not.toBeNull()
    expect([...alice!.getOut(hopIndexes)]).toHaveLength(1)

    const scores = indexResolver.resolve(root, user.value, {
      graph: h.graph,
      format: 'default',
      followTrustThreshold: 75,
      now: NOW,
      kind: TRUST_STATEMENT_KIND,
      maxDepth: WOT_MAX_DEGREE_DEFAULT,
      trustContext: 'identity',
      scoreContext: 'identity',
    })
    const hit = scores.find((row) => row.subject === user.value) ?? scores[0]
    expect(hit?.connected).toBe(true)
    expect(hit?.degree).toBe(2)
    expect((hit as TrustScore).trust).toBe(1)
  })

  it('identity query still sees empty-c hops (demo seed)', () => {
    const h = new HeapTrustHarness([
      trustRecord('root-alice', root, pubkey('alice'), 1),
      trustRecord('alice-user', 'alice', user, 1),
    ])
    const scores = indexResolver.resolve(root, user.value, {
      graph: h.graph,
      format: 'default',
      followTrustThreshold: 75,
      now: NOW,
      kind: TRUST_STATEMENT_KIND,
      maxDepth: WOT_MAX_DEGREE_DEFAULT,
      trustContext: 'identity',
      scoreContext: 'identity',
    })
    const hit = scores.find((row) => row.subject === user.value) ?? scores[0]
    expect(hit?.connected).toBe(true)
    expect(hit?.degree).toBe(2)
  })

  it('stores empty-c post trust and ratings under the bare kind bucket', () => {
    const h = new HeapTrustHarness([
      terminalTrust(root, 1),
      terminalRating(root, 80),
    ])
    expect([...h.graph.contextIndex.keys()].sort()).toEqual(['32009', '32014'])
    expect(h.graph.getContextIndexes('', TRUST_STATEMENT_KIND)).toHaveLength(1)
    expect(
      h.graph.getContextIndexes('identity', TRUST_STATEMENT_KIND),
    ).toHaveLength(1)
    expect(h.graph.getContextIndexes('', RATING_STATEMENT_KIND)).toHaveLength(1)

    const trust = resolve(h.graph, post.value, TRUST_STATEMENT_KIND)
    expect(trust.connected).toBe(true)
    expect((trust as TrustScore).trust).toBe(1)

    const rating = resolve(h.graph, post.value, RATING_STATEMENT_KIND)
    expect(rating.connected).toBe(true)
    expect((rating as RatingScore).ratingValue).toBe(80)
  })
})

describe('IndexResolver followTrustThreshold', () => {
  const mixedPeer = [
    trustRecord('root-a', root, pubkey('a'), 1),
    trustRecord('root-b', root, pubkey('b'), 1),
    trustRecord('a-peer', 'a', pubkey('peer'), 1),
    trustRecord('b-peer', 'b', pubkey('peer'), -1),
    terminalTrust('peer', 1),
  ]

  function resolveAt(threshold: number): Score {
    const h = new HeapTrustHarness(mixedPeer)
    const scores = indexResolver.resolve(root, post.value, {
      graph: h.graph,
      format: 'default',
      followTrustThreshold: threshold,
      now: NOW,
      kind: TRUST_STATEMENT_KIND,
      maxDepth: WOT_MAX_DEGREE_DEFAULT,
    })
    const hit = scores.find((row) => row.subject === post.value) ?? scores[0]
    if (!hit) throw new Error('IndexResolver returned no score for the post')
    return hit
  }

  it('uses a 50% mixed hop at threshold 1', () => {
    const score = resolveAt(1)
    expect(score.connected).toBe(true)
    expect(score.degree).toBe(3)
  })

  it('skips a 50% mixed hop at the default 75%', () => {
    const score = resolveAt(75)
    expect(score.connected).toBe(false)
    expect(score.count).toBe(0)
  })
})
