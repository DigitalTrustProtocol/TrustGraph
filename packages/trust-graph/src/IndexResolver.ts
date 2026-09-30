/**
 * Vendored from DigitalTrustProtocol/Trust (IndexResolver.ts).
 * Attention: returns Score[] (no ApiEnvelope); default followTrustThreshold = 75.
 */

import { IEdge, isValidAt, trustEdgeValue } from './Edge'
import type { Graph } from './Graph'
import type { IResolveStrategy, IResolveStrategyOptions, ScoreKind } from './IResolveStrategy'
import {
  IndexScoreMap,
  TrustScore,
  type IScore,
  type ITrustScore,
  type Score,
} from './Score'

import { TRUST_STATEMENT_KIND } from './constants'
import { meetsFollowTrustGreen } from './threshold'
import { FOLLOW_TRUST_GREEN_DEFAULT } from './constants'
import { WOT_MAX_DEGREE_HARD_CAP } from './constants'
import pathStrategyJson from './pathStrategyJson'
import { Node } from './Node'

const MAX_DEPTH = WOT_MAX_DEGREE_HARD_CAP

export class IndexResolver implements IResolveStrategy {
  readonly name = 'graph'

  resolve(
    observerId: string,
    subjectId: string,
    options: IResolveStrategyOptions = {},
  ): Score[] {
    const graph = options.graph as Graph | undefined
    if (!graph) return [] // If the graph is not found, return an empty array, should never happen

    const time = options.now ?? Math.floor(Date.now() / 1000)
    observerId = observerId.toLowerCase().trim()
    subjectId = subjectId.toLowerCase().trim()

    const observerNode = graph.getNode(observerId)
    if (!observerNode) return []

    const observerIndex = observerNode.index

    const subjectNode = graph.getNode(subjectId)
    if (!subjectNode) return []
    const subjectIndex = subjectNode.index

    const scoreMap = new IndexScoreMap()
    const scoreKind = options.kind ?? TRUST_STATEMENT_KIND as ScoreKind
    const format = options.format ?? 'default'
    const observerTrustScore = scoreMap.ensure(observerIndex, 0, TRUST_STATEMENT_KIND) // Initialize the observer trust score
    observerTrustScore.visited = true

    const maxDepth = Math.min(options.maxDepth ?? MAX_DEPTH, MAX_DEPTH)

    const subjectScore = scoreMap.ensure(subjectIndex, 0, scoreKind)
    subjectScore.subject = subjectId

    const trustContextIndexes = graph.getContextIndexes(options.trustContext ?? '', TRUST_STATEMENT_KIND);
    const scoreContextIndexes = graph.getContextIndexes(options.scoreContext ?? '', scoreKind); // in the future, it should graph.getContextIndexes(context, scoreKind)

    const subjectIncomingEdges = this.buildIncomingEdges(
      subjectNode,
      graph,
      scoreKind,
      time,
      scoreContextIndexes,
    )
    if (subjectIncomingEdges.size === 0) return [subjectScore] // If there are no incoming edges, return the subject score

    const queue: number[] = [observerIndex]
    let degree = 0
    let nodeCounter = 0

    while (
      queue.length > nodeCounter &&
      degree < maxDepth &&
      subjectScore.count === 0
    ) {
      const degreeLength = queue.length
      degree++

      subjectScore.reset()
      // Check all the incoming edges of the subject against nodes in the queue
      for (let i = nodeCounter; i < degreeLength; i++) {
        const queueNodeIndex = queue[i]!
        if (queueNodeIndex === subjectIndex) continue // Self-loops are not evidence

        const edge = subjectIncomingEdges.get(queueNodeIndex)
        if (!edge) continue // If the edge is not found connecting the current node to the subject, continue

        const queueNodeScore = scoreMap.getTrust(queueNodeIndex) // Get the trust score of the current node in the queue
        if (!queueNodeScore) continue // If the trust score is not found, continue, should never happen
        if (!this.meetsThreshold(observerIndex, queueNodeIndex, queueNodeScore, options)) continue

        subjectScore.add(edge) // Connection found, add the edge to the subject score
        subjectScore.degree = degree
      }

      if (subjectScore.count > 0) break // If the subject score has been connected, break out of the loop, no need to continue

      // Breadth-first search
      while (nodeCounter < degreeLength) {
        const nodeIndex = queue[nodeCounter++]
        const score = scoreMap.getTrust(nodeIndex)!
        //if (!score) continue // If the trust score is not found, continue, should never happen
        if(!this.meetsThreshold(observerIndex, nodeIndex, score, options)) continue // If the observer is not the node and the trust score does not meet the threshold, continue

        const node = graph.nodesList[nodeIndex]
        if (!node) continue // If the node is not found, continue, should never happen

        // Check all the outgoing edges of the node against the subject
        for (const [peerIndex, edgeIndex] of node.getOut(trustContextIndexes)) { // Only trust 32009 edges are considered

          //if (peerIndex === subjectIndex) continue // If the peer is the subject, continue, wrong type of edge found

          const edge = graph.edgesList[edgeIndex]!
          //if (!edge) continue // If the edge is not found, continue, this should never happen
          //if (edge.kind !== TRUST_STATEMENT_KIND && edge.kind !== scoreKind) continue // If the edge is not a trust statement or the score kind, continue
          if (!isValidAt(edge, time)) continue // If the edge is not valid at the given time, continue
      
          const peerNode = graph.nodesList[peerIndex]
          if (!peerNode || peerNode.type !== 'p') continue // If the peer node is not found or the type is not 'p', continue
      
          const peerScore = scoreMap.ensure(peerIndex, degree, edge.kind as ScoreKind)
          if(peerScore.degree && peerScore.degree < degree) continue // If the score's degree is less than the current degree, continue next edge

          peerScore.subject = subjectId
          if (peerScore.authorIndex === nodeIndex) continue // Prevent double counting, multiple edges of same kind to same target but different contexts!
      
          if(!peerScore.add(edge)) continue  // If the edge is not added for different reasons, continue next edge
          peerScore.authorIndex = nodeIndex 
      
          if (edge.kind !== TRUST_STATEMENT_KIND) continue // If the edge is not a trust statement, continue next edge
          if (trustEdgeValue(edge) !== 1) continue // If the edge value is not 1, continue
      
          if (!peerScore.visited && subjectScore.count === 0) { // subjectScore.count === 0 should not be checked here, as it was zero before entering the loop
            queue.push(peerIndex)
            peerScore.visited = true
          }

        }
      }
    }

    subjectScore.connected = subjectScore.count > 0
    subjectScore.degree = subjectScore.count > 0 ? degree : 0
    
    if (subjectScore.connected && format === 'path') {
      return pathStrategyJson.resolve(
        observerIndex,
        subjectIndex,
        scoreMap,
        graph,
        scoreKind,
      )
    }
    return [subjectScore]
  }

  private meetsThreshold( observerIndex: number, currentIndex: number, score: ITrustScore, options: IResolveStrategyOptions): boolean {
    if (observerIndex === currentIndex) return true // Self is always trusted
    const threshold = options.followTrustThreshold ?? FOLLOW_TRUST_GREEN_DEFAULT
    return meetsFollowTrustGreen(score.trust, score.distrust, threshold)
  }


  private buildIncomingEdges(
    subjectNode: Node,
    graph: Graph,
    scoreKind: number,
    time: number,
    contextIndexes: number[],
  ): Map<number, IEdge> {
    const subjectIncomingEdges = new Map<number, IEdge>()
    for (const ctxIdx of contextIndexes) {
      const inMap = subjectNode.inbound.get(ctxIdx)
      if (!inMap) continue
      for (const [aIndex, edgeIndexes] of inMap.entries()) {
        if (subjectIncomingEdges.has(aIndex)) continue
        for (const edgeIndex of edgeIndexes) {
          const edge = graph.edgesList[edgeIndex]
          if (!edge || edge.kind !== scoreKind || !isValidAt(edge, time)) 
            continue
            subjectIncomingEdges.set(aIndex, edge)
            break
        }
      }
    }
    return subjectIncomingEdges
  }
}

const indexResolver = new IndexResolver()
export default indexResolver
