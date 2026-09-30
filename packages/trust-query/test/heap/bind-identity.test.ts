// Ported from AttentionX src/graph/bind-identity.test.ts (imports rewritten for @dtp/* packages).
import { describe, expect, it } from 'vitest'
import { HeapTrustHarness, trustRecord } from '../../src/testing'
import { indexResolver } from '@dtp/trust-graph'
import { Graph } from '@dtp/trust-graph'
import type { ITrustEvent } from '@dtp/trust-graph'
import { TRUST_STATEMENT_KIND } from '@dtp/trust-protocol'
import { RATING_STATEMENT_KIND } from '@dtp/trust-protocol'
import type { TrustSubject, TrustValue } from '../../src/types'

const ROOT = 'root'
const NEVE_PK = 'neve'
const ARCHIVE_PK = 'archive'

function iUser(twitterId: string): TrustSubject {
  return { type: 'i', value: `user:id:${twitterId}` }
}

function stmt(
  eventId: string,
  author: string,
  subject: TrustSubject,
  value: TrustValue,
) {
  return trustRecord(eventId, author, subject, value, { context: 'identity' })
}

function boundGraph(records: ReturnType<typeof stmt>[]) {
  const graph = new Graph()
  graph.bindIdentity('user:id:16224', NEVE_PK)
  graph.bindIdentity('user:id:999', ARCHIVE_PK)
  for (const record of records) graph.applyTrustEvent(record)
  return graph
}

describe('Graph i↔p identity map', () => {
  it('converts an i-node to a p-node in place (same index)', () => {
    const graph = new Graph()
    const record = stmt('e1', ROOT, iUser('16224'), 1)
    expect(graph.applyTrustEvent(record)).toBe(true)
    const before = graph.getNode('user:id:16224')
    expect(before?.type).toBe('i')
    const index = before!.index
    graph.bindIdentity('user:id:16224', NEVE_PK)
    const after = graph.getNode(NEVE_PK)
    expect(after?.index).toBe(index)
    expect(after?.type).toBe('p')
    expect(after?.id).toBe(NEVE_PK)
    expect(graph.getNode('user:id:16224')?.index).toBe(index)
    expect(graph.iToP.get('user:id:16224')).toBe(NEVE_PK)
    expect(graph.pToI.get(NEVE_PK)?.has('user:id:16224')).toBe(true)
  })

  it('walks bound user:id trust as pubkey hops', () => {
    const heap = boundGraph([
      stmt('root-neve', ROOT, iUser('16224'), 1),
      stmt('neve-archive', NEVE_PK, iUser('999'), 1),
    ])
    const scores = indexResolver.resolve(ROOT, ARCHIVE_PK, {
      graph: heap,
      format: 'path',
      followTrustThreshold: 1,
      now: 10,
      trustContext: 'identity',
      scoreContext: 'identity',
    })
    const hit = scores.find((row) => row.subject === ARCHIVE_PK)
    expect(hit?.connected || (hit?.count ?? 0) > 0).toBe(true)
  })

  it('does not walk a distrusted user:id as a trusted hop', () => {
    const harness = new HeapTrustHarness()
    harness.bindIdentity('user:id:16224', NEVE_PK)
    harness.bindIdentity('user:id:999', ARCHIVE_PK)
    harness.upsert(stmt('root-neve', ROOT, iUser('16224'), -1))
    harness.upsert(stmt('neve-archive', NEVE_PK, iUser('999'), 1))
    const archive = harness.query({
      rootPubkey: ROOT,
      subject: iUser('999'),
      context: 'identity',
      now: 10,
      format: 'path',
    })
    expect(archive.connected).toBe(false)
    const neveDirect = harness.query({
      rootPubkey: ROOT,
      subject: iUser('16224'),
      context: 'identity',
      now: 10,
      format: 'path',
    })
    expect(neveDirect.direct).toMatchObject({ value: -1 })
    expect(neveDirect.resolution).toBe('distrusted')
  })

  it('moves user:id edges onto the new pubkey when rebound', () => {
    const harness = new HeapTrustHarness()
    harness.bindIdentity('user:id:1', 'alpha')
    harness.upsert(stmt('root-x', ROOT, iUser('1'), 1))
    harness.upsert(stmt('root-alpha', ROOT, { type: 'p', value: 'alpha' }, 1))
    harness.bindIdentity('user:id:1', 'beta')

    const alpha = harness.query({
      rootPubkey: ROOT,
      subject: { type: 'p', value: 'alpha' },
      context: 'identity',
      now: 10,
    })
    const rebound = harness.query({
      rootPubkey: ROOT,
      subject: iUser('1'),
      context: 'identity',
      now: 10,
    })
    expect(alpha.statements.map((row) => row.eventId)).toEqual(['root-alpha'])
    expect(alpha.direct).toMatchObject({ value: 1, eventId: 'root-alpha' })
    expect(rebound.direct).toMatchObject({ value: 1, eventId: 'root-x' })
    expect(harness.trustGraph.pToI.get('alpha')?.has('user:id:1')).toBeFalsy()

    harness.upsert(
      trustRecord('root-x-down', ROOT, iUser('1'), -1, {
        context: 'identity',
        createdAt: 2,
      }),
    )
    const alphaAfter = harness.query({
      rootPubkey: ROOT,
      subject: { type: 'p', value: 'alpha' },
      context: 'identity',
      now: 10,
    })
    const betaAfter = harness.query({
      rootPubkey: ROOT,
      subject: iUser('1'),
      context: 'identity',
      now: 10,
    })
    expect(alphaAfter.direct).toMatchObject({ value: 1, eventId: 'root-alpha' })
    expect(betaAfter.direct).toMatchObject({ value: -1, eventId: 'root-x-down' })
  })

  it('IndexResolver hops leftover native p +1 even when identity is −1', () => {
    const harness = new HeapTrustHarness()
    harness.bindIdentity('user:id:16224', NEVE_PK)
    harness.bindIdentity('user:id:999', ARCHIVE_PK)
    harness.upsert(stmt('root-neve-p', ROOT, { type: 'p', value: NEVE_PK }, 1))
    harness.upsert(stmt('root-neve', ROOT, iUser('16224'), -1))
    harness.upsert(stmt('neve-archive', NEVE_PK, iUser('999'), 1))
    expect(
      harness.trustGraph.edgesList.some(
        (edge) =>
          edge?.id === 'root-neve-p' &&
          edge.subjectType === 'p' &&
          edge.nValue === 1,
      ),
    ).toBe(true)
    const archive = harness.query({
      rootPubkey: ROOT,
      subject: iUser('999'),
      context: 'identity',
      now: 10,
      format: 'path',
    })
    expect(archive.connected).toBe(true)
  })

  it('queries bound own user:id as disconnected when nobody issued onto You', () => {
    const harness = new HeapTrustHarness()
    harness.bindIdentity('user:id:1', ROOT)
    harness.upsert(stmt('root-neve', ROOT, iUser('16224'), 1))
    const self = harness.query({
      rootPubkey: ROOT,
      subject: iUser('1'),
      context: 'identity',
      now: 10,
    })
    expect(self.connected).toBe(false)
    expect(self.resolution).toBe('none')
    expect(self.statements).toEqual([])
    expect(self.direct).toBeUndefined()
  })

  it('stores kind 32014 on the heap without creating hops', () => {
    const graph = new Graph()
    const rating = stmt('r', ROOT, iUser('16224'), 1)
    rating.kind = RATING_STATEMENT_KIND
    rating.nValue = 80
    rating.addressKey = rating.addressKey.replace(
      `${TRUST_STATEMENT_KIND}:`,
      `${RATING_STATEMENT_KIND}:`,
    )
    expect(graph.applyTrustEvent(rating)).toBe(true)
    expect(graph.edgesList.some((edge) => edge?.kind === RATING_STATEMENT_KIND)).toBe(
      true,
    )
    expect(graph.out(ROOT, { now: 10, context: 'identity' })).toEqual([])
    expect(TRUST_STATEMENT_KIND).toBe(32009)
  })

  it('keeps 32009 and 32014 in separate heap slots', () => {
    const graph = new Graph()
    const trust = stmt('t', ROOT, iUser('16224'), 1)
    const rating = stmt('r', ROOT, iUser('16224'), 1)
    rating.kind = RATING_STATEMENT_KIND
    rating.nValue = 80
    rating.addressKey = rating.addressKey.replace(
      `${TRUST_STATEMENT_KIND}:`,
      `${RATING_STATEMENT_KIND}:`,
    )
    expect(graph.applyTrustEvent(trust)).toBe(true)
    expect(graph.applyTrustEvent(rating)).toBe(true)
    expect(
      graph.edgesList.filter((edge) => edge?.kind === TRUST_STATEMENT_KIND),
    ).toHaveLength(1)
    expect(
      graph.edgesList.filter((edge) => edge?.kind === RATING_STATEMENT_KIND),
    ).toHaveLength(1)
    expect(graph.out(ROOT, { now: 10, context: 'identity' })).toHaveLength(1)
    expect(graph.out(ROOT, { now: 10, context: 'identity' })[0]?.edge.kind).toBe(
      TRUST_STATEMENT_KIND,
    )
  })

  it('registers a kind-prefixed context bucket for the event kind only', () => {
    const graph = new Graph()
    const record = stmt('e1', ROOT, iUser('16224'), 1)
    expect(graph.applyTrustEvent(record)).toBe(true)
    expect(graph.getContextIndex('identity', TRUST_STATEMENT_KIND)).toBeDefined()
    expect(
      graph.getContextIndex('identity', RATING_STATEMENT_KIND),
    ).toBeUndefined()

    const rating = stmt('r1', ROOT, iUser('16224'), 1)
    rating.kind = RATING_STATEMENT_KIND
    rating.nValue = 80
    rating.addressKey = rating.addressKey.replace(
      `${TRUST_STATEMENT_KIND}:`,
      `${RATING_STATEMENT_KIND}:`,
    )
    expect(graph.applyTrustEvent(rating)).toBe(true)
    expect(
      graph.getContextIndex('identity', RATING_STATEMENT_KIND),
    ).toBeDefined()
  })

  it('keeps an empty-nValue tombstone in memory and unlinks adjacency', () => {
    const graph = new Graph()
    const live = stmt('e1', ROOT, iUser('16224'), 1)
    expect(graph.applyTrustEvent(live)).toBe(true)
    expect(graph.out(ROOT, { now: 10, context: 'identity' })).toHaveLength(1)

    const tomb: ITrustEvent = { ...live, id: 'e2', created_at: 2 }
    delete tomb.nValue
    expect(graph.applyTrustEvent(tomb)).toBe(true)
    expect(graph.out(ROOT, { now: 10, context: 'identity' })).toEqual([])
    expect(graph.edgesList[0]).toBe(tomb)
    expect(tomb.nValue).toBeUndefined()
  })

  it('ignores an older live event after a tombstone wins the slot', () => {
    const graph = new Graph()
    const tomb: ITrustEvent = stmt('e2', ROOT, iUser('16224'), 1)
    tomb.created_at = 2
    delete tomb.nValue
    expect(graph.applyTrustEvent(tomb)).toBe(true)

    const stale = stmt('e1', ROOT, iUser('16224'), 1)
    stale.created_at = 1
    stale.addressableId = tomb.addressableId
    stale.addressKey = tomb.addressKey
    expect(graph.applyTrustEvent(stale)).toBe(false)
    expect(graph.out(ROOT, { now: 10, context: 'identity' })).toEqual([])
    expect(graph.edgesList[0]).toBe(tomb)
  })

  it('lets a newer live event replace a tombstone', () => {
    const graph = new Graph()
    const tomb: ITrustEvent = stmt('e2', ROOT, iUser('16224'), 1)
    tomb.created_at = 2
    delete tomb.nValue
    expect(graph.applyTrustEvent(tomb)).toBe(true)

    const live = stmt('e3', ROOT, iUser('16224'), 1)
    live.created_at = 3
    live.addressableId = tomb.addressableId
    live.addressKey = tomb.addressKey
    expect(graph.applyTrustEvent(live)).toBe(true)
    expect(graph.out(ROOT, { now: 10, context: 'identity' })).toHaveLength(1)
    expect(graph.edgesList[0]).toBe(live)
  })

  it('does not unlink when an empty nValue is older than the live edge', () => {
    const graph = new Graph()
    const live = stmt('e1', ROOT, iUser('16224'), 1)
    live.created_at = 5
    expect(graph.applyTrustEvent(live)).toBe(true)
    const tomb: ITrustEvent = { ...live, id: 'e0', created_at: 1 }
    delete tomb.nValue
    expect(graph.applyTrustEvent(tomb)).toBe(false)
    expect(graph.out(ROOT, { now: 10, context: 'identity' })).toHaveLength(1)
    expect(graph.edgesList[0]).toBe(live)
  })

  it('stamps heap index on the EventRecord for Score.addTrust', () => {
    const graph = new Graph()
    const record: ITrustEvent = stmt('e1', ROOT, iUser('16224'), 1)
    expect(graph.applyTrustEvent(record)).toBe(true)
    expect(record.index).toBe(0)
    expect(graph.edgesList[record.index!]).toBe(record)
    const replacement: ITrustEvent = stmt('e2', ROOT, iUser('16224'), -1)
    replacement.created_at = 2
    replacement.addressableId = record.addressableId
    replacement.addressKey = record.addressKey
    expect(graph.applyTrustEvent(replacement)).toBe(true)
    expect(replacement.index).toBe(0)
    expect(graph.edgesList[0]).toBe(replacement)
  })
})
