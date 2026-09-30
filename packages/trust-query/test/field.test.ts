import { describe, expect, it } from 'vitest'
import { indexResolver } from '@dtp/trust-graph'
import { executeFieldQuery } from '../src/field'
import { executeTrustQuery } from '../src/query'
import { HeapTrustHarness, trustRecord } from '../src/testing'

const ROOT = 'a'.repeat(64)
const ALICE = 'b'.repeat(64)
const BOB = 'c'.repeat(64)

function heap(): HeapTrustHarness {
  return new HeapTrustHarness([
    trustRecord('root-alice', ROOT, { type: 'p', value: ALICE }, 1, { context: 'identity' }),
    trustRecord('alice-bob', ALICE, { type: 'p', value: BOB }, 1, { context: 'identity' }),
    trustRecord('bob-x', BOB, { type: 'i', value: 'user:id:7' }, 1, { context: 'identity' }),
  ])
}

describe('executeFieldQuery (graph.field)', () => {
  it('returns graphVersion, completeDepth, levels, and binds', () => {
    const h = heap()
    const field = executeFieldQuery(h.graph, indexResolver, { rootPubkey: ROOT, now: 10, maxDepth: 4 }, 7)
    // Level 3 holds only the unbound user:id:7, which does not qualify.
    expect(field).toEqual({ graphVersion: 7, completeDepth: 3, levels: [[ROOT], [ALICE], [BOB], []], binds: [] })
  })

  it('reports truncation from a walk budget', () => {
    const field = executeFieldQuery(
      heap().graph,
      indexResolver,
      { rootPubkey: ROOT, now: 10, maxDepth: 4, budgets: { maxReachedNodes: 2 } },
      1,
    )
    expect(field.truncated).toBe(true)
    expect(field.truncatedReasons).toEqual(['nodeBudget'])
    expect(field.completeDepth).toBe(1)
  })
})

describe('executeTrustQuery walk extras', () => {
  it('adds binding provenance for user:id subjects only', () => {
    const h = heap()
    const user = executeTrustQuery(h.graph, indexResolver, { rootPubkey: ROOT, subject: { type: 'i', value: 'user:id:7' }, context: 'identity', now: 10, followTrustThreshold: 1 }, 1)
    expect(user.binding).toEqual({ mode: 'lenient', source: 'none', confirmed: false })
    expect(user.truncated).toBe(false)
    expect(user.completeDepth).toBeUndefined()
    const peer = executeTrustQuery(h.graph, indexResolver, { rootPubkey: ROOT, subject: { type: 'p', value: BOB }, context: 'identity', now: 10 }, 1)
    expect(peer.binding).toBeUndefined()
  })

  it('reports completeDepth only when a walk budget truncates', () => {
    const result = executeTrustQuery(
      heap().graph,
      indexResolver,
      { rootPubkey: ROOT, subject: { type: 'i', value: 'user:id:7' }, context: 'identity', now: 10, budgets: { maxReachedNodes: 2 } },
      1,
    )
    expect(result.truncated).toBe(true)
    expect(result.truncatedReasons).toEqual(['nodeBudget'])
    expect(result.completeDepth).toBe(1)
    expect(result.connected).toBe(false)
  })
})
