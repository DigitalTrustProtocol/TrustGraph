// Ported from AttentionX src/graph/follow-trust-threshold.test.ts (imports rewritten for @dtp/* packages).
import { describe, expect, it } from 'vitest'
import { FOLLOW_TRUST_THRESHOLD_DEFAULT } from '../../src/shared/wot-follow-trust-threshold'
import { HeapTrustHarness, trustRecord } from '../../src/testing'
import type { TrustSubject } from '../../src/types'

const root = 'root'
const post: TrustSubject = { type: 'i', value: 'post:id:42' }

function pubkey(id: string): TrustSubject {
  return { type: 'p', value: id }
}

const mixedPeer = [
  trustRecord('root-a', root, pubkey('a'), 1),
  trustRecord('root-b', root, pubkey('b'), 1),
  trustRecord('a-peer', 'a', pubkey('peer'), 1),
  trustRecord('b-peer', 'b', pubkey('peer'), -1),
  trustRecord('peer-post', 'peer', post, 1),
]

describe('executeTrustQuery followTrustThreshold', () => {
  it('echoes the default 75% when the query omits the field', () => {
    const h = new HeapTrustHarness([
      trustRecord('root-alice', root, pubkey('alice'), 1),
    ])
    const result = h.query({
      rootPubkey: root,
      subject: { type: 'p', value: 'alice' },
    })
    expect(result.followTrustThreshold).toBe(FOLLOW_TRUST_THRESHOLD_DEFAULT)
    expect(result.followTrustRed).toBe(25)
    expect(result.connected).toBe(true)
  })

  it('clamps an invalid percent to 75 and echoes it', () => {
    const h = new HeapTrustHarness([
      trustRecord('root-alice', root, pubkey('alice'), 1),
    ])
    const result = h.query({
      rootPubkey: root,
      subject: { type: 'p', value: 'alice' },
      followTrustThreshold: Number.NaN,
    })
    expect(result.followTrustThreshold).toBe(FOLLOW_TRUST_THRESHOLD_DEFAULT)
    expect(result.followTrustRed).toBe(25)
  })

  it('connects a 50% mixed hop at 1% and misses at 75%', () => {
    const h = new HeapTrustHarness(mixedPeer)
    const permissive = h.query({
      rootPubkey: root,
      subject: post,
      followTrustThreshold: 1,
    })
    expect(permissive.followTrustThreshold).toBe(1)
    expect(permissive.followTrustRed).toBe(1)
    expect(permissive.connected).toBe(true)
    expect(permissive.degree).toBe(3)

    const strict = h.query({
      rootPubkey: root,
      subject: post,
      followTrustThreshold: 75,
    })
    expect(strict.followTrustThreshold).toBe(75)
    expect(strict.followTrustRed).toBe(25)
    expect(strict.connected).toBe(false)
    expect(strict.resolution).toBe('none')
  })

  it('treats 71% share as trusted when green is 60', () => {
    const tesla: TrustSubject = { type: 'i', value: 'user:id:13298072' }
    const authors = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7']
    const records = [
      ...authors.map((author) =>
        trustRecord(`root-${author}`, root, pubkey(author), 1),
      ),
      ...authors.slice(0, 5).map((author) =>
        trustRecord(`${author}-tesla`, author, tesla, 1),
      ),
      trustRecord('a6-tesla', 'a6', tesla, -1),
      trustRecord('a7-tesla', 'a7', tesla, -1),
    ]
    const h = new HeapTrustHarness(records)
    const atSixty = h.query({
      rootPubkey: root,
      subject: tesla,
      followTrustThreshold: 60,
      followTrustRed: 25,
    })
    expect(atSixty.trust).toBe(5)
    expect(atSixty.distrust).toBe(2)
    expect(atSixty.resolution).toBe('trusted')

    const atDefault = h.query({
      rootPubkey: root,
      subject: tesla,
      followTrustThreshold: 75,
      followTrustRed: 25,
    })
    expect(atDefault.resolution).toBe('mixed')
  })
})
