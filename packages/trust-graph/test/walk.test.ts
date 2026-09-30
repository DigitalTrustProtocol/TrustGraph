import { describe, expect, it } from 'vitest'
import { Graph, indexResolver, type ITrustEvent } from '../src/main'

const ROOT = 'root'
const OTHER = 'other'

function trust(id: string, author: string, subjectType: 'p' | 'i', subject: string, value: number, extra: Partial<ITrustEvent> = {}): ITrustEvent {
  return {
    id,
    pubkey: author,
    created_at: 1,
    kind: 32009,
    content: '',
    addressKey: `32009:${author}:${subjectType}:${subject}:identity`,
    subject,
    subjectType,
    c_tag: 'identity',
    nValue: value,
    ...extra,
  }
}

function connected(graph: Graph, root: string, subject: string, bindingMode?: 'lenient' | 'strict'): boolean {
  return indexResolver.walk(root, subject, {
    graph,
    trustContext: 'identity',
    scoreContext: 'identity',
    followTrustThreshold: 1,
    now: 10,
    ...(bindingMode ? { bindingMode } : {}),
  }).connected
}

/** Root trusts user:id:1; P (bound to it) trusts the target. */
function boundChain(): Graph {
  const graph = new Graph()
  for (const root of [ROOT, OTHER]) graph.applyTrustEvent(trust(`${root}-x`, root, 'i', 'user:id:1', 1))
  graph.applyTrustEvent(trust('p-target', 'p', 'p', 'target', 1))
  return graph
}

describe('per-walk identity binds (G6, G8)', () => {
  it('applies own evidence only to the root that holds it', () => {
    const graph = boundChain()
    graph.bindIdentity('user:id:1', 'p', { root: ROOT, source: 'bio' })
    expect(connected(graph, ROOT, 'target')).toBe(true)
    expect(connected(graph, OTHER, 'target')).toBe(false)
  })

  it('unbindIdentity removes the bind for that root', () => {
    const graph = boundChain()
    graph.bindIdentity('user:id:1', 'p', { root: ROOT })
    expect(graph.unbindIdentity('user:id:1', { root: ROOT })).toBe(true)
    expect(graph.unbindIdentity('user:id:1', { root: ROOT })).toBe(false)
    expect(connected(graph, ROOT, 'target')).toBe(false)
  })

  it('strict mode needs the pubkey to claim the X id', () => {
    const graph = boundChain()
    graph.bindIdentity('user:id:1', 'p', { root: ROOT })
    expect(connected(graph, ROOT, 'target', 'lenient')).toBe(true)
    expect(connected(graph, ROOT, 'target', 'strict')).toBe(false)
    graph.addIdentityClaim('p', '1', 'claim-event')
    expect(connected(graph, ROOT, 'target', 'strict')).toBe(true)
    graph.removeIdentityClaims('p')
    expect(connected(graph, ROOT, 'target', 'strict')).toBe(false)
  })

  it('reports the bind as subject provenance on a user:id walk', () => {
    const graph = boundChain()
    graph.bindIdentity('user:id:1', 'p', { root: ROOT, source: 'post' })
    const walk = indexResolver.walk(ROOT, 'user:id:1', { graph, trustContext: 'identity', scoreContext: 'identity', now: 10 })
    expect(walk.subjectBind?.bind).toMatchObject({ pubkey: 'p', source: 'own-post', confirmed: false })
  })
})

describe('walk budgets (G10)', () => {
  function chain(): Graph {
    const graph = new Graph()
    graph.applyTrustEvent(trust('r-a', ROOT, 'p', 'a', 1))
    graph.applyTrustEvent(trust('r-b', ROOT, 'p', 'b', 1))
    graph.applyTrustEvent(trust('a-c', 'a', 'p', 'c', 1))
    graph.applyTrustEvent(trust('c-t', 'c', 'p', 't', 1))
    return graph
  }

  it('an untruncated walk reports no truncation', () => {
    const walk = indexResolver.walk(ROOT, 't', { graph: chain(), trustContext: 'identity', scoreContext: 'identity', now: 10 })
    expect(walk.connected).toBe(true)
    expect(walk.degree).toBe(3)
    expect(walk.truncated).toBeUndefined()
  })

  it('stops at a level boundary on the node budget', () => {
    const walk = indexResolver.walk(ROOT, 't', {
      graph: chain(),
      trustContext: 'identity',
      scoreContext: 'identity',
      now: 10,
      budgets: { maxReachedNodes: 2 },
    })
    expect(walk.connected).toBe(false)
    expect(walk.truncated).toBe('nodeBudget')
    expect(walk.completeDepth).toBe(0)
  })

  it('stops on a passed deadline', () => {
    const walk = indexResolver.walk(ROOT, 't', {
      graph: chain(),
      trustContext: 'identity',
      scoreContext: 'identity',
      now: 10,
      budgets: { deadline: 0 },
    })
    expect(walk.truncated).toBe('timeBudget')
  })
})

describe('field (G12)', () => {
  it('reports levels, completeDepth, and binds from the root', () => {
    const graph = new Graph()
    graph.applyTrustEvent(trust('r-a', ROOT, 'p', 'a', 1))
    graph.applyTrustEvent(trust('r-x', ROOT, 'i', 'user:id:1', 1))
    graph.applyTrustEvent(trust('a-b', 'a', 'p', 'b', 1))
    graph.bindIdentity('user:id:1', 'p', { root: ROOT })
    const field = indexResolver.field(ROOT, { graph, trustContext: 'identity', now: 10, maxDepth: 4 })
    expect(field.levels[0]).toEqual([ROOT])
    expect(field.levels[1]).toEqual(['a', 'p'])
    expect(field.levels[2]).toEqual(['b'])
    expect(field.completeDepth).toBe(3)
    expect(field.truncated).toBeUndefined()
    expect(field.binds).toEqual([{ subject: 'i:user:id:1', pubkey: 'p', source: 'own-bio' }])
  })

  it('answers a root with no statements with the root alone', () => {
    const field = indexResolver.field('nobody', { graph: new Graph(), maxDepth: 4 })
    expect(field).toEqual({ completeDepth: 3, levels: [['nobody']], binds: [] })
  })
})
