/**
 * Vendored from DigitalTrustProtocol/Trust (pathStrategyJson.ts).
 * Attention: walk predecessor via edge.author node index (fixed traverse).
 */

import { TRUST_STATEMENT_KIND } from './constants'
import type { Graph } from './Graph'
import { IndexScoreMap, type Score } from './Score'

class PathStrategyJson {
  resolve(
    authorIndex: number,
    subjectIndex: number,
    scores: IndexScoreMap,
    graph: Graph,
    scoreKind: number = TRUST_STATEMENT_KIND,
  ): Score[] {
    const result: Score[] = []
    const visited = new Set<number>()

    const traverse = (nodeIndex: number, kind: number): void => {
      if (visited.has(nodeIndex)) return
      visited.add(nodeIndex)

      const score = scores.peek(nodeIndex, kind)
      if (!score) return

      result.push(score)
      if (nodeIndex === authorIndex) return
      if (!score.edges || score.edges.length === 0) return

      for (const edgeIndex of score.edges) {
        const edge = graph.edgesList[edgeIndex]
        if (!edge) continue

        const authorNodeIndex = graph.nodesIndex.get(edge.pubkey.toLowerCase())
        if (authorNodeIndex === undefined) continue
        traverse(authorNodeIndex, TRUST_STATEMENT_KIND)
      }
    }

    traverse(subjectIndex, scoreKind)
    return result
  }
}

const pathStrategyJson = new PathStrategyJson()
export default pathStrategyJson
