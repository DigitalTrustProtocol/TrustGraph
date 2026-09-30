// Ported from AttentionX src/graph/path-resolve.test.ts (imports rewritten for @dtp/* packages).
/**
 * Fixture tests for IndexResolver + PathStrategyJson.
 *
 * Graphs use plain string node ids (not Nostr keys). Each scenario is a
 * known edge list; tests assert the subject Score (format default) and the
 * predecessor walk (format path → PathStrategyJson).
 */
import { describe, expect, it } from 'vitest'
import { HeapTrustHarness, trustRecord } from '../../src/testing'
import { scoresToPathView } from '../../src/path-view'
import { trustScoreCounts } from '../../src/score-read'
import { IndexScoreMap, indexResolver, pathStrategyJson } from '@dtp/trust-graph'
import { trustEdgeValue } from '@dtp/trust-graph'
import type { Graph } from '@dtp/trust-graph'
import { TrustScore, type Score } from '@dtp/trust-graph'
import type { TrustValue } from '../../src/types'
import { TRUST_STATEMENT_KIND } from '@dtp/trust-protocol'

const NOW = 10

type EdgeSpec = {
  id: string
  from: string
  to: string
  value: TrustValue
  toType?: 'p' | 'i'
}

function statement(spec: EdgeSpec) {
  return trustRecord(spec.id, spec.from, { type: spec.toType ?? 'p', value: spec.to }, spec.value)
}

function buildGraph(edges: readonly EdgeSpec[]): {
  graph: HeapTrustHarness
  heap: Graph
} {
  const graph = new HeapTrustHarness(edges.map(statement))
  return { graph, heap: graph.trustGraph }
}

function nodeId(heap: Graph, score: Score): string {
  if (score.subjectIndex === undefined) return score.subject ?? '?'
  return heap.nodesList[score.subjectIndex]?.id ?? '?'
}

function scoreEdges(
  heap: Graph,
  score: Score,
): Array<{ from: string; to: string; value: TrustValue }> {
  const to = nodeId(heap, score)
  return (score.edges ?? []).flatMap((index) => {
    const edge = heap.edgesList[index]
    if (!edge) return []
    return [{ from: edge.pubkey, to, value: trustEdgeValue(edge) ?? 0 }]
  })
}

function summarizeScore(heap: Graph, score: Score) {
  return {
    id: nodeId(heap, score),
    degree: score.degree,
    ...trustScoreCounts(score),
    connected: score.connected,
    count: score.count,
    edges: scoreEdges(heap, score),
  }
}

function resolveDefault(heap: Graph, root: string, subject: string): Score {
  const scores = indexResolver.resolve(root, subject, {
    graph: heap,
    format: 'default',
    followTrustThreshold: 1,
    now: NOW,
  })
  const hit = scores.find((row) => row.subject === subject) ?? scores[0]
  if (!hit) throw new Error(`IndexResolver returned no score for ${subject}`)
  return hit
}

function resolvePath(heap: Graph, root: string, subject: string): Score[] {
  return indexResolver.resolve(root, subject, {
    graph: heap,
    format: 'path',
    followTrustThreshold: 1,
    now: NOW,
  })
}

function sortedEdges(heap: Graph, scores: readonly Score[]) {
  return scores
    .flatMap((score) => scoreEdges(heap, score))
    .sort(
      (a, b) =>
        a.from.localeCompare(b.from) ||
        a.to.localeCompare(b.to) ||
        a.value - b.value,
    )
}

function trustScoreAt(
  scores: IndexScoreMap,
  subjectIndex: number,
  degree: number,
): TrustScore {
  const score = scores.ensure(subjectIndex, degree, TRUST_STATEMENT_KIND)
  if (!(score instanceof TrustScore)) {
    throw new Error('expected TrustScore')
  }
  return score
}

function sortedNodes(heap: Graph, scores: readonly Score[]) {
  return scores
    .map((score) => summarizeScore(heap, score))
    .sort((a, b) => a.id.localeCompare(b.id))
}

describe('IndexResolver + PathStrategyJson fixtures', () => {
  describe('direct edges', () => {
    it('records a direct trust on the subject and walks root ← subject', () => {
      // root --(+1)--> alice
      const { heap } = buildGraph([
        { id: 'root-alice', from: 'root', to: 'alice', value: 1 },
      ])

      const subject = resolveDefault(heap, 'root', 'alice')
      expect(summarizeScore(heap, subject)).toEqual({
        id: 'alice',
        degree: 1,
        trust: 1,
        distrust: 0,
        trustValue: 1,
        neutral: 0,
        connected: true,
        count: 1,
        edges: [{ from: 'root', to: 'alice', value: 1 }],
      })

      const path = resolvePath(heap, 'root', 'alice')
      expect(sortedNodes(heap, path).map((row) => row.id)).toEqual([
        'alice',
        'root',
      ])
      expect(sortedEdges(heap, path)).toEqual([
        { from: 'root', to: 'alice', value: 1 },
      ])
    })

    it('records a direct distrust on the subject (does not flip to trust)', () => {
      // root --(-1)--> neve
      const { heap } = buildGraph([
        { id: 'root-neve', from: 'root', to: 'neve', value: -1 },
      ])

      const subject = resolveDefault(heap, 'root', 'neve')
      expect(summarizeScore(heap, subject)).toEqual({
        id: 'neve',
        degree: 1,
        trust: 0,
        distrust: 1,
        trustValue: -1,
        neutral: 0,
        connected: true,
        count: 1,
        edges: [{ from: 'root', to: 'neve', value: -1 }],
      })

      const path = resolvePath(heap, 'root', 'neve')
      expect(sortedEdges(heap, path)).toEqual([
        { from: 'root', to: 'neve', value: -1 },
      ])
    })

    it('does not traverse a distrusted peer to a farther subject', () => {
      // root --(-1)--> neve --(+1)--> bob
      const { heap } = buildGraph([
        { id: 'root-neve', from: 'root', to: 'neve', value: -1 },
        { id: 'neve-bob', from: 'neve', to: 'bob', value: 1 },
      ])

      const bob = resolveDefault(heap, 'root', 'bob')
      expect(bob.connected).toBe(false)
      expect(bob.count).toBe(0)
      expect(sortedEdges(heap, resolvePath(heap, 'root', 'bob'))).toEqual([])
    })
  })

  describe('degree-2 last hop polarity', () => {
    it('keeps a two-hop trust path as +1 then +1', () => {
      // root --(+1)--> alice --(+1)--> bob
      const { heap } = buildGraph([
        { id: 'root-alice', from: 'root', to: 'alice', value: 1 },
        { id: 'alice-bob', from: 'alice', to: 'bob', value: 1 },
      ])

      const bob = resolveDefault(heap, 'root', 'bob')
      expect(summarizeScore(heap, bob)).toMatchObject({
        id: 'bob',
        degree: 2,
        trust: 1,
        distrust: 0,
        trustValue: 1,
        connected: true,
        edges: [{ from: 'alice', to: 'bob', value: 1 }],
      })

      const path = resolvePath(heap, 'root', 'bob')
      expect(sortedEdges(heap, path)).toEqual([
        { from: 'alice', to: 'bob', value: 1 },
        { from: 'root', to: 'alice', value: 1 },
      ])
    })

    it('keeps a two-hop distrust of the subject as -1 (does not become +1)', () => {
      // root --(+1)--> alice --(-1)--> bob
      const { heap } = buildGraph([
        { id: 'root-alice', from: 'root', to: 'alice', value: 1 },
        { id: 'alice-bob', from: 'alice', to: 'bob', value: -1 },
      ])

      const bob = resolveDefault(heap, 'root', 'bob')
      expect(summarizeScore(heap, bob)).toMatchObject({
        id: 'bob',
        degree: 2,
        trust: 0,
        distrust: 1,
        trustValue: -1,
        connected: true,
        edges: [{ from: 'alice', to: 'bob', value: -1 }],
      })

      const path = resolvePath(heap, 'root', 'bob')
      expect(sortedEdges(heap, path)).toEqual([
        { from: 'alice', to: 'bob', value: -1 },
        { from: 'root', to: 'alice', value: 1 },
      ])

      const view = scoresToPathView(heap, path)
      expect(
        view.edges.map((edge) => ({
          from: heap.nodesList.find((node) => node?.index === edge.from)?.id,
          to: heap.nodesList.find((node) => node?.index === edge.to)?.id,
          value: edge.value,
        })),
      ).toEqual(
        expect.arrayContaining([
          { from: 'alice', to: 'bob', value: -1 },
          { from: 'root', to: 'alice', value: 1 },
        ]),
      )
    })

    it('keeps a two-hop Neutral on the subject as 0', () => {
      // root --(+1)--> alice --(0)--> bob
      // Neutral does not increment count, so the walk keeps searching unless
      // a Trust/Distrust also hits. Pair Neutral with a parallel Trust.
      const { heap } = buildGraph([
        { id: 'root-alice', from: 'root', to: 'alice', value: 1 },
        { id: 'root-carol', from: 'root', to: 'carol', value: 1 },
        { id: 'alice-bob', from: 'alice', to: 'bob', value: 0 },
        { id: 'carol-bob', from: 'carol', to: 'bob', value: 1 },
      ])

      const bob = resolveDefault(heap, 'root', 'bob')
      expect(bob.degree).toBe(2)
      expect(trustScoreCounts(bob).trust).toBe(1)
      expect(trustScoreCounts(bob).distrust).toBe(0)
      expect(trustScoreCounts(bob).neutral).toBe(1)
      expect(scoreEdges(heap, bob)).toEqual(
        expect.arrayContaining([
          { from: 'alice', to: 'bob', value: 0 },
          { from: 'carol', to: 'bob', value: 1 },
        ]),
      )

      const path = resolvePath(heap, 'root', 'bob')
      expect(sortedEdges(heap, path)).toEqual(
        expect.arrayContaining([
          { from: 'alice', to: 'bob', value: 0 },
          { from: 'carol', to: 'bob', value: 1 },
          { from: 'root', to: 'alice', value: 1 },
          { from: 'root', to: 'carol', value: 1 },
        ]),
      )
    })
  })

  describe('distrusted middle user', () => {
    it('does not treat a directly distrusted peer as a hop to a degree-2 subject', () => {
      // root --(-1)--> neve
      // neve --(+1)--> bob
      // (no other path)
      const { heap } = buildGraph([
        { id: 'root-neve', from: 'root', to: 'neve', value: -1 },
        { id: 'neve-bob', from: 'neve', to: 'bob', value: 1 },
      ])

      const bob = resolveDefault(heap, 'root', 'bob')
      expect(bob.connected).toBe(false)
      const path = resolvePath(heap, 'root', 'bob')
      expect(sortedEdges(heap, path)).toEqual([])
      expect(path.some((score) => nodeId(heap, score) === 'neve')).toBe(false)
    })

    it('does not show root --(+1)--> neve when root --(-1)--> neve and alice is the hop', () => {
      // root --(-1)--> neve
      // root --(+1)--> alice --(+1)--> bob
      const { heap } = buildGraph([
        { id: 'root-neve', from: 'root', to: 'neve', value: -1 },
        { id: 'root-alice', from: 'root', to: 'alice', value: 1 },
        { id: 'alice-bob', from: 'alice', to: 'bob', value: 1 },
      ])

      const bob = resolveDefault(heap, 'root', 'bob')
      expect(bob.connected).toBe(true)
      expect(bob.degree).toBe(2)

      const path = resolvePath(heap, 'root', 'bob')
      expect(sortedNodes(heap, path).map((row) => row.id)).toEqual([
        'alice',
        'bob',
        'root',
      ])
      expect(sortedEdges(heap, path)).toEqual([
        { from: 'alice', to: 'bob', value: 1 },
        { from: 'root', to: 'alice', value: 1 },
      ])
      expect(
        sortedEdges(heap, path).some(
          (edge) => edge.to === 'neve' || edge.from === 'neve',
        ),
      ).toBe(false)
    })

    it('does not follow a friend through a peer the root directly distrusts', () => {
      // root --(-1)--> neve
      // root --(+1)--> alice --(+1)--> neve --(+1)--> bob
      const { heap } = buildGraph([
        { id: 'root-neve', from: 'root', to: 'neve', value: -1 },
        { id: 'root-alice', from: 'root', to: 'alice', value: 1 },
        { id: 'alice-neve', from: 'alice', to: 'neve', value: 1 },
        { id: 'neve-bob', from: 'neve', to: 'bob', value: 1 },
      ])

      const neveDirect = resolveDefault(heap, 'root', 'neve')
      expect(summarizeScore(heap, neveDirect)).toMatchObject({
        degree: 1,
        trust: 0,
        distrust: 1,
        trustValue: -1,
        edges: [{ from: 'root', to: 'neve', value: -1 }],
      })

      const bob = resolveDefault(heap, 'root', 'bob')
      expect(bob.connected).toBe(false)
      expect(trustScoreCounts(bob).trust).toBe(0)

      const path = resolvePath(heap, 'root', 'bob')
      expect(
        sortedEdges(heap, path).some(
          (edge) => edge.from === 'root' && edge.to === 'neve' && edge.value === 1,
        ),
      ).toBe(false)
    })

    it('can show a pubkey as a trusted hop while the matching user:id is a direct distrust', () => {
      // Heap nodes are not merged: user:id:neve ≠ neve.
      // Direct Path to the X id is distrust; Path to bob walks the pubkey.
      const { heap } = buildGraph([
        {
          id: 'root-neve-x',
          from: 'root',
          to: 'user:id:neve',
          value: -1,
          toType: 'i',
        },
        { id: 'root-neve-p', from: 'root', to: 'neve', value: 1 },
        { id: 'neve-bob', from: 'neve', to: 'bob', value: 1 },
      ])

      const xNeve = resolveDefault(heap, 'root', 'user:id:neve')
      expect(summarizeScore(heap, xNeve)).toMatchObject({
        id: 'user:id:neve',
        degree: 1,
        distrust: 1,
        trust: 0,
        edges: [{ from: 'root', to: 'user:id:neve', value: -1 }],
      })

      const bob = resolveDefault(heap, 'root', 'bob')
      expect(bob.connected).toBe(true)
      expect(bob.degree).toBe(2)

      const path = resolvePath(heap, 'root', 'bob')
      expect(sortedEdges(heap, path)).toEqual([
        { from: 'neve', to: 'bob', value: 1 },
        { from: 'root', to: 'neve', value: 1 },
      ])
    })

    it('keeps i-subject distrust on the X id while a separate p-hop can still walk', () => {
      // Two heap nodes: user:id:neve vs pubkey neve.
      // Direct path to the X id is distrust; the pubkey may still be a hop.
      const { heap } = buildGraph([
        {
          id: 'root-neve-x',
          from: 'root',
          to: 'user:id:neve',
          value: -1,
          toType: 'i',
        },
        { id: 'root-alice', from: 'root', to: 'alice', value: 1 },
        { id: 'alice-neve-p', from: 'alice', to: 'neve', value: 1 },
        { id: 'neve-bob', from: 'neve', to: 'bob', value: 1 },
      ])

      const xNeve = resolveDefault(heap, 'root', 'user:id:neve')
      expect(summarizeScore(heap, xNeve)).toMatchObject({
        id: 'user:id:neve',
        degree: 1,
        distrust: 1,
        trust: 0,
        edges: [{ from: 'root', to: 'user:id:neve', value: -1 }],
      })

      const bob = resolveDefault(heap, 'root', 'bob')
      expect(bob.connected).toBe(true)
      expect(bob.degree).toBe(3)
      expect(scoreEdges(heap, bob)).toEqual([
        { from: 'neve', to: 'bob', value: 1 },
      ])

      const path = resolvePath(heap, 'root', 'bob')
      expect(sortedEdges(heap, path)).toEqual([
        { from: 'alice', to: 'neve', value: 1 },
        { from: 'neve', to: 'bob', value: 1 },
        { from: 'root', to: 'alice', value: 1 },
      ])
      expect(
        sortedEdges(heap, path).some(
          (edge) => edge.from === 'root' && edge.to === 'neve',
        ),
      ).toBe(false)
    })
  })

  describe('early stop vs longer path', () => {
    it('stops at direct distrust and does not add a deeper trust to the subject', () => {
      // root --(-1)--> bob
      // root --(+1)--> alice --(+1)--> bob
      const { heap } = buildGraph([
        { id: 'root-bob', from: 'root', to: 'bob', value: -1 },
        { id: 'root-alice', from: 'root', to: 'alice', value: 1 },
        { id: 'alice-bob', from: 'alice', to: 'bob', value: 1 },
      ])

      const bob = resolveDefault(heap, 'root', 'bob')
      expect(summarizeScore(heap, bob)).toMatchObject({
        degree: 1,
        trust: 0,
        distrust: 1,
        trustValue: -1,
        edges: [{ from: 'root', to: 'bob', value: -1 }],
      })

      const path = resolvePath(heap, 'root', 'bob')
      expect(sortedEdges(heap, path)).toEqual([
        { from: 'root', to: 'bob', value: -1 },
      ])
    })

    it('aggregates mixed last-hop values at the hitting degree', () => {
      // root --(+1)--> a --(+1)--> bob
      // root --(+1)--> b --(-1)--> bob
      const { heap } = buildGraph([
        { id: 'root-a', from: 'root', to: 'a', value: 1 },
        { id: 'root-b', from: 'root', to: 'b', value: 1 },
        { id: 'a-bob', from: 'a', to: 'bob', value: 1 },
        { id: 'b-bob', from: 'b', to: 'bob', value: -1 },
      ])

      const bob = resolveDefault(heap, 'root', 'bob')
      expect(bob.degree).toBe(2)
      expect(trustScoreCounts(bob).trust).toBe(1)
      expect(trustScoreCounts(bob).distrust).toBe(1)
      expect(trustScoreCounts(bob).trustValue).toBe(0)
      expect(sortedEdges(heap, [bob])).toEqual([
        { from: 'a', to: 'bob', value: 1 },
        { from: 'b', to: 'bob', value: -1 },
      ])

      const path = resolvePath(heap, 'root', 'bob')
      expect(sortedEdges(heap, path)).toEqual([
        { from: 'a', to: 'bob', value: 1 },
        { from: 'b', to: 'bob', value: -1 },
        { from: 'root', to: 'a', value: 1 },
        { from: 'root', to: 'b', value: 1 },
      ])
    })
  })

  describe('PathStrategyJson walk', () => {
    it('reconstructs every hop on a degree-3 path without flipping values', () => {
      // root --(+1)--> a --(+1)--> b --(-1)--> c
      const { heap } = buildGraph([
        { id: 'r-a', from: 'root', to: 'a', value: 1 },
        { id: 'a-b', from: 'a', to: 'b', value: 1 },
        { id: 'b-c', from: 'b', to: 'c', value: -1 },
      ])

      const path = resolvePath(heap, 'root', 'c')
      expect(sortedNodes(heap, path).map((row) => row.id)).toEqual([
        'a',
        'b',
        'c',
        'root',
      ])
      expect(sortedEdges(heap, path)).toEqual([
        { from: 'a', to: 'b', value: 1 },
        { from: 'b', to: 'c', value: -1 },
        { from: 'root', to: 'a', value: 1 },
      ])
    })

    it('walks predecessors from a hand-built score map without changing edge polarity', () => {
      const { heap } = buildGraph([
        { id: 'root-alice', from: 'root', to: 'alice', value: 1 },
        { id: 'alice-bob', from: 'alice', to: 'bob', value: -1 },
      ])
      const rootIndex = heap.nodesIndex.get('root')
      const aliceIndex = heap.nodesIndex.get('alice')
      const bobIndex = heap.nodesIndex.get('bob')
      if (
        rootIndex === undefined ||
        aliceIndex === undefined ||
        bobIndex === undefined
      ) {
        throw new Error('missing nodes')
      }

      const rootAlice = heap.edgesList.find((edge) => edge?.id === 'root-alice')
      const aliceBob = heap.edgesList.find((edge) => edge?.id === 'alice-bob')
      const rootAliceIndex = rootAlice
        ? heap.edgesIndex.get(rootAlice.addressKey)
        : undefined
      const aliceBobIndex = aliceBob
        ? heap.edgesIndex.get(aliceBob.addressKey)
        : undefined
      if (rootAliceIndex === undefined || aliceBobIndex === undefined) {
        throw new Error('missing edges')
      }

      const scores = new IndexScoreMap()
      const rootScore = trustScoreAt(scores, rootIndex, 0)
      rootScore.visited = true
      rootScore.trustValue = 1
      rootScore.count = 1

      const aliceScore = trustScoreAt(scores, aliceIndex, 1)
      aliceScore.trust = 1
      aliceScore.trustValue = 1
      aliceScore.count = 1
      aliceScore.edges = [rootAliceIndex]

      const bobScore = trustScoreAt(scores, bobIndex, 2)
      bobScore.subject = 'bob'
      bobScore.distrust = 1
      bobScore.trustValue = -1
      bobScore.count = 1
      bobScore.connected = true
      bobScore.edges = [aliceBobIndex]

      const walked = pathStrategyJson.resolve(
        rootIndex,
        bobIndex,
        scores,
        heap,
      )
      expect(sortedEdges(heap, walked)).toEqual([
        { from: 'alice', to: 'bob', value: -1 },
        { from: 'root', to: 'alice', value: 1 },
      ])
    })
  })
})
