/**
 * Vendored from DigitalTrustProtocol/Trust (src/lib/trust/graph/Graph.ts).
 * Attention: edges are EventRecord; i↔p identity map converts i-nodes in place.
 */

import { isValidAt, trustEdgeValue, type IEdge } from './Edge'
import { eachPeerEdge, removePeerEdge, Node, type PeerEdgeMap } from './Node'
import type { ITrustEvent, SubjectType } from './types'
import { TRUST_STATEMENT_KIND } from './constants'
import { RATING_STATEMENT_KIND } from './constants'
import { ScoreKind } from './IResolveStrategy'

export type { GraphTrustValue } from './types'

export interface GraphTrustEdgePayload {
  /** `events.addressKey` (`kind:pubkey:d`). Heap `edgesIndex` key. */
  addressKey: string
  dTag: string
  author: string
  kind: number
  value: -1 | 0 | 1
  /** Kind 32014 numeric score. Trust polarity stays in `value`. */
  nValue?: number
  context: string
  createdAt: number
  eventId?: string
  activate?: number
  expire?: number
  content?: string
}

export interface GraphTrustConnectionPayload {
  author: string
  subject: string
  subjectType: SubjectType
  edge: GraphTrustEdgePayload
}

export interface GraphTrustConnectionOptions {
  context?: string
  value?: -1 | 0 | 1
  /** Edge kind filter. Default 32009. Context buckets are keyed by kind. */
  kind?: number
  /** Peer-node type filter. Not a context-bucket key. */
  subjectType?: SubjectType
  includeInactive?: boolean
  now?: number
}

export interface IGraph {
  applyTrustEvent(trust: ITrustEvent): boolean
  removeTrustEvent(trust: ITrustEvent): boolean
  getContextIndexes(context: string, kind: number): number[]
  getAllContextIndexes(context: string, kinds: number[]): number[]
  out(
    authorId: string,
    options?: GraphTrustConnectionOptions,
  ): GraphTrustConnectionPayload[]
  in(
    subjectId: string,
    options?: GraphTrustConnectionOptions,
  ): GraphTrustConnectionPayload[]
  addNode(id: string, type: SubjectType): Node
  getNode(id: string): Node | null
  createNode(id: string, type: SubjectType): Node
  readonly nodesIndex: Map<string, number>
  readonly nodesList: Array<Node | null>
  readonly edgesList: Array<IEdge | null>
}

/** Context bucket keys: kind, then optional `c` segments (`32009:identity`). */
function contextIndexKeys(kind: number, context: string): string[] {
  const bucket = String(kind)
  if (context.length === 0) return [bucket]
  const keys: string[] = []
  let key = ''
  for (const segment of [bucket, ...context.split(':')]) {
    key = key.length > 0 ? `${key}:${segment}` : segment
    keys.push(key)
  }
  return keys.reverse()
}

function contextKey(kind: ScoreKind, context: string): string {
  return contextIndexKeys(kind, context)[0]!
}

function unlinkPeerEdge(
  adjacency: Map<number, PeerEdgeMap>,
  contextIndex: number,
  peerIndex: number,
  edgeIndex: number,
): void {
  const peers = adjacency.get(contextIndex)
  if (!peers) return
  removePeerEdge(peers, peerIndex, edgeIndex)
  if (peers.size === 0) adjacency.delete(contextIndex)
}

function shouldReplaceEdge(
  existing: IEdge,
  incoming: ITrustEvent,
): 'keep' | 'replace' | 'ignore' {
  if (existing.created_at > incoming.created_at) return 'ignore'
  if (existing.created_at < incoming.created_at) return 'replace'
  if (incoming.id.localeCompare(existing.id) < 0) return 'replace'
  if (incoming.id === existing.id) return 'replace'
  return 'ignore'
}

export class Graph implements IGraph {
  nodesIndex: Map<string, number> = new Map()
  nodesList: Array<Node | null> = []

  contextIndex: Map<string, number> = new Map()
  contextList: Array<string | null> = []

  edgesIndex: Map<string, number> = new Map()
  edgesList: Array<IEdge | null> = []

  /** Canonical i-subject (`user:id:<digits>`) → pubkey. */
  iToP: Map<string, string> = new Map()
  /** Pubkey → i-subjects. 1 Nostr → N X. */
  pToI: Map<string, Set<string>> = new Map()

  eventAddedSinceLastSave = 0
  eventRemovedSinceLastSave = 0

  clear(): void {
    this.nodesIndex.clear()
    this.nodesList = []
    this.contextIndex.clear()
    this.contextList = []
    this.edgesIndex.clear()
    this.edgesList = []
    this.iToP.clear()
    this.pToI.clear()
    this.eventAddedSinceLastSave = 0
    this.eventRemovedSinceLastSave = 0
  }

  bindIdentity(iSubject: string, pubkey: string): void {
    const iKey = iSubject.toLowerCase()
    const pKey = pubkey.toLowerCase()
    const previous = this.iToP.get(iKey)
    this.iToP.set(iKey, pKey)
    let aliases = this.pToI.get(pKey)
    if (!aliases) {
      aliases = new Set()
      this.pToI.set(pKey, aliases)
    }
    aliases.add(iKey)

    if (previous && previous !== pKey) {
      const oldAliases = this.pToI.get(previous)
      if (oldAliases) {
        oldAliases.delete(iKey)
        if (oldAliases.size === 0) this.pToI.delete(previous)
      }
      this.rebindSubjectEdges(iKey, previous)
    }

    const iIndex = this.nodesIndex.get(iKey)
    const iNode = iIndex !== undefined ? this.nodesList[iIndex] : null
    const pIndex = this.nodesIndex.get(pKey)
    const pNode = pIndex !== undefined ? this.nodesList[pIndex] : null

    if (iNode && iNode.type === 'i' && iNode.id === iKey && !pNode) {
      this.convertIToP(iNode, pKey)
      return
    }
    if (
      iNode &&
      iNode.type === 'i' &&
      iNode.id === iKey &&
      pNode &&
      iNode !== pNode
    ) {
      this.absorbINodeIntoP(iNode, pNode)
      return
    }
    if (pNode) {
      this.nodesIndex.set(iKey, pNode.index)
    }
  }

  applyTrustEvent(trust: ITrustEvent): boolean {
    if (
      trust.kind !== TRUST_STATEMENT_KIND &&
      trust.kind !== RATING_STATEMENT_KIND
    ) {
      return false
    }
    if (!trust.subject || !trust.subjectType || !trust.addressKey) {
      return false
    }

    const contextIndex = this.applyContext(trust.c_tag ?? '', trust.kind as ScoreKind)

    const authorNode = this.addNode(trust.pubkey, 'p')
    const subjectNode = this.addNode(trust.subject, trust.subjectType)

    const edgeIndex = this.addEdge(trust)
    if (edgeIndex === null) return false

    if (trust.nValue !== undefined) {
      authorNode.addOut(contextIndex, subjectNode.index, edgeIndex)
      subjectNode.addIn(contextIndex, authorNode.index, edgeIndex)
    } else {
      // A Delete unlinks only its own slot (gap G3); sibling slots from the
      // same author to the same node keep their edges.
      unlinkPeerEdge(authorNode.outbound, contextIndex, subjectNode.index, edgeIndex)
      unlinkPeerEdge(subjectNode.inbound, contextIndex, authorNode.index, edgeIndex)
    }

    this.eventAddedSinceLastSave++
    return true
  }

  removeTrustEvent(trust: ITrustEvent): boolean {
    if (!trust.addressKey) return false
    const key = trust.addressKey
    const edgeIndex = this.edgesIndex.get(key)
    if (edgeIndex === undefined) return false
    this.unlinkEdge(edgeIndex)
    this.edgesList[edgeIndex] = null
    this.edgesIndex.delete(key)
    this.eventRemovedSinceLastSave++
    return true
  }

  getAllContextIndexes(context: string, kinds: number[]): number[] {
    const result: number[] = []
    for (const kind of kinds) {
      result.push(...this.getContextIndexes(context, kind))
    }
    return result
  }

  getContextIndexes(context: string, kind: number): number[] {
    const result: number[] = []
    for (const key of contextIndexKeys(kind, context)) {
      const index = this.contextIndex.get(key)
      if (index !== undefined) result.push(index)
    }
    return result
  }

  private edgePayload(edge: IEdge): GraphTrustEdgePayload {
    const trustValue = trustEdgeValue(edge)
    return {
      addressKey: edge.addressKey,
      dTag: edge.addressableId ?? '',
      author: edge.pubkey,
      kind: edge.kind,
      value: trustValue ?? 0,
      ...(edge.kind === RATING_STATEMENT_KIND && edge.nValue !== undefined
        ? { nValue: edge.nValue }
        : {}),
      context: edge.c_tag ?? '',
      createdAt: edge.created_at,
      eventId: edge.id,
      ...(edge.activate !== undefined ? { activate: edge.activate } : {}),
      ...(edge.expire !== undefined ? { expire: edge.expire } : {}),
      ...(edge.content !== undefined ? { content: edge.content } : {}),
    }
  }

  private connections(
    nodeId: string,
    direction: 'out' | 'in',
    options: GraphTrustConnectionOptions = {},
  ): GraphTrustConnectionPayload[] {
    const node = this.getNode(nodeId.toLowerCase())
    if (!node) return []

    const now = options.now ?? Math.floor(Date.now() / 1000)
    const kind = options.kind ?? TRUST_STATEMENT_KIND
    const seen = new Set<string>()
    const result: GraphTrustConnectionPayload[] = []
    const contextIndexes = this.getContextIndexes(options.context ?? '', kind)

    for (const contextIndex of contextIndexes) {
      const peerMap = node[direction === 'out' ? 'outbound' : 'inbound'].get(
        contextIndex,
      )
      if (!peerMap) continue

      for (const [peerIndex, edgeIndex] of eachPeerEdge(peerMap)) {
        const edge = this.edgesList[edgeIndex]
        if (!edge || edge.kind !== kind) continue
        if (!options.includeInactive && !isValidAt(edge, now)) continue
        if (kind === TRUST_STATEMENT_KIND) {
          const value = trustEdgeValue(edge)
          if (value === undefined) continue
          if (options.value !== undefined && value !== options.value) {
            continue
          }
        } else if (edge.nValue === undefined) {
          continue
        }

        const peerNode = this.nodesList[peerIndex]
        if (!peerNode) continue

        const authorNode = direction === 'out' ? node : peerNode
        const subjectNode = direction === 'out' ? peerNode : node
        if (options.subjectType && subjectNode.type !== options.subjectType) {
          continue
        }

        const key = `${authorNode.index}:${subjectNode.index}:${edgeIndex}`
        if (seen.has(key)) continue
        seen.add(key)

        result.push({
          author: authorNode.id,
          subject: subjectNode.id,
          subjectType: subjectNode.type,
          edge: this.edgePayload(edge),
        })
      }
    }

    return result
  }

  out(
    authorId: string,
    options: GraphTrustConnectionOptions = {},
  ): GraphTrustConnectionPayload[] {
    return this.connections(authorId, 'out', options)
  }

  in(
    subjectId: string,
    options: GraphTrustConnectionOptions = {},
  ): GraphTrustConnectionPayload[] {
    return this.connections(subjectId, 'in', options)
  }

  addNode(id: string, type: SubjectType): Node {
    const normalized = id.toLowerCase()
    const mapped = this.iToP.get(normalized)
    if (mapped) {
      const pNode = this.addNode(mapped, 'p')
      this.nodesIndex.set(normalized, pNode.index)
      return pNode
    }
    const index = this.nodesIndex.get(normalized)
    if (index !== undefined) {
      const node = this.nodesList[index]
      if (node) return node
    }
    if (type === 'p') {
      const iKeys = this.pToI.get(normalized)
      if (iKeys) {
        for (const iKey of iKeys) {
          const iIndex = this.nodesIndex.get(iKey)
          if (iIndex === undefined) continue
          const iNode = this.nodesList[iIndex]
          if (iNode && iNode.type === 'i' && iNode.id === iKey) {
            return this.convertIToP(iNode, normalized)
          }
        }
      }
    }
    return this.createNode(normalized, type)
  }

  getNode(id: string): Node | null {
    const normalized = id.toLowerCase()
    let index = this.nodesIndex.get(normalized)
    if (index === undefined) {
      const mapped = this.iToP.get(normalized) // If the node is an domain specific id, map it to a npub
      if (mapped) index = this.nodesIndex.get(mapped)
    }
    if (index === undefined) return null 
    return this.nodesList[index] ?? null
  }

  createNode(id: string, type: SubjectType): Node {
    const node = new Node(id.toLowerCase(), type)
    node.index = this.nodesList.push(node) - 1
    this.nodesIndex.set(node.id, node.index)
    this.eventAddedSinceLastSave++
    return node
  }


  addEdge(trust: ITrustEvent): number | null {
    if (!trust.addressKey) return null
    const key = trust.addressKey
    
    let index = this.edgesIndex.get(key)
    if (index !== undefined) {
      const existing = this.edgesList[index]
      if (!existing) return null // Return should never happen
      if (shouldReplaceEdge(existing, trust) === 'ignore') return null
      this.edgesList[index] = trust // Overwrite the existing edge with the new one
    } else {
      index = this.edgesList.push(trust) - 1
      this.edgesIndex.set(key, index)
      
    }
    trust.index = index
    this.addNode(trust.pubkey, 'p').edges.add(index)
    return index
  }

  removeEdge(addressKey: string): IEdge | null {
    const index = this.edgesIndex.get(addressKey)
    if (index === undefined) return null
    const edge = this.edgesList[index]
    if (!edge) return null
    this.unlinkEdge(index)
    this.edgesList[index] = null
    this.edgesIndex.delete(addressKey)
    return edge
  }

  applyContext(context: string, kind: ScoreKind): number {
    return this.addContext(contextKey(kind, context))
  }

  getContextIndex(context: string, kind: ScoreKind): number | undefined {
    return this.contextIndex.get(contextKey(kind, context))
  }

  addContext(context: string): number {
    const existing = this.contextIndex.get(context)
    if (existing !== undefined) return existing
    const index = this.contextList.push(context) - 1
    this.contextIndex.set(context, index)
    return index
  }

  /** Move edges whose subject is this X id from the previous pubkey onto the new one. */
  private rebindSubjectEdges(iKey: string, oldPubkey: string): void {
    const oldIndex = this.nodesIndex.get(oldPubkey)
    const oldNode = oldIndex !== undefined ? this.nodesList[oldIndex] : null
    if (!oldNode) {
      if (this.nodesIndex.get(iKey) !== undefined) this.nodesIndex.delete(iKey)
      return
    }

    const edgeIndexes: number[] = []
    const seen = new Set<number>()
    for (const peerMaps of [oldNode.inbound, oldNode.outbound]) {
      for (const peers of peerMaps.values()) {
        for (const indexes of peers.values()) {
          for (const edgeIndex of indexes) {
            if (seen.has(edgeIndex)) continue
            const edge = this.edgesList[edgeIndex]
            if (edge?.subject?.toLowerCase() !== iKey) continue
            seen.add(edgeIndex)
            edgeIndexes.push(edgeIndex)
          }
        }
      }
    }

    if (edgeIndexes.length === 0) {
      if (this.nodesIndex.get(iKey) === oldNode.index) this.nodesIndex.delete(iKey)
      return
    }

    const newNode = this.addNode(iKey, 'i')
    for (const edgeIndex of edgeIndexes) {
      this.moveReboundEdge(edgeIndex, oldNode, newNode)
    }
  }

  private moveReboundEdge(edgeIndex: number, oldNode: Node, newNode: Node): void {
    const edge = this.edgesList[edgeIndex]
    if (!edge) return
    const authorNode = this.getNode(edge.pubkey)
    if (!authorNode) return
    const contextIndex = this.getContextIndex(edge.c_tag ?? '', edge.kind as ScoreKind)
    if (contextIndex === undefined) return

    const outMap = authorNode.outbound.get(contextIndex)
    if (outMap) {
      removePeerEdge(outMap, oldNode.index, edgeIndex)
      if (outMap.size === 0) authorNode.outbound.delete(contextIndex)
    }
    const inMap = oldNode.inbound.get(contextIndex)
    if (inMap) {
      removePeerEdge(inMap, authorNode.index, edgeIndex)
      if (inMap.size === 0) oldNode.inbound.delete(contextIndex)
    }
    authorNode.addOut(contextIndex, newNode.index, edgeIndex)
    newNode.addIn(contextIndex, authorNode.index, edgeIndex)
  }

  private convertIToP(node: Node, pubkey: string): Node {
    const oldId = node.id
    this.nodesIndex.delete(oldId)
    node.id = pubkey.toLowerCase()
    node.type = 'p'
    this.nodesIndex.set(node.id, node.index)
    this.nodesIndex.set(oldId, node.index)
    return node
  }

  private absorbINodeIntoP(iNode: Node, pNode: Node): void {
    this.retargetPeerIndexes(iNode.index, pNode.index)
    this.nodesIndex.delete(iNode.id)
    this.nodesIndex.set(iNode.id, pNode.index)
    this.nodesList[iNode.index] = null
  }

  private retargetPeerIndexes(fromIndex: number, toIndex: number): void {
    const fromNode = this.nodesList[fromIndex]
    if (!fromNode) return
    for (const [ctxIdx, peers] of fromNode.inbound) {
      for (const [authorIdx, edgeIndexes] of peers) {
        const author = this.nodesList[authorIdx]
        if (!author) continue
        const outMap = author.outbound.get(ctxIdx)
        const fromEdges = outMap?.get(fromIndex)
        if (outMap && fromEdges) {
          outMap.delete(fromIndex)
          const toEdges = outMap.get(toIndex) ?? []
          for (const edgeIdx of fromEdges) {
            if (!toEdges.includes(edgeIdx)) toEdges.push(edgeIdx)
          }
          outMap.set(toIndex, toEdges)
        }
        const target = this.nodesList[toIndex]
        if (!target) continue
        let targetIn = target.inbound.get(ctxIdx)
        if (!targetIn) {
          targetIn = new Map()
          target.inbound.set(ctxIdx, targetIn)
        }
        const existing = targetIn.get(authorIdx) ?? []
        for (const edgeIdx of edgeIndexes) {
          if (!existing.includes(edgeIdx)) existing.push(edgeIdx)
        }
        targetIn.set(authorIdx, existing)
      }
    }
    for (const [ctxIdx, peers] of fromNode.outbound) {
      for (const [peerIdx, edgeIndexes] of peers) {
        const peer = this.nodesList[peerIdx]
        if (!peer) continue
        const inMap = peer.inbound.get(ctxIdx)
        const fromEdges = inMap?.get(fromIndex)
        if (inMap && fromEdges) {
          inMap.delete(fromIndex)
          const toEdges = inMap.get(toIndex) ?? []
          for (const edgeIdx of fromEdges) {
            if (!toEdges.includes(edgeIdx)) toEdges.push(edgeIdx)
          }
          inMap.set(toIndex, toEdges)
        }
        const target = this.nodesList[toIndex]
        if (!target) continue
        let targetOut = target.outbound.get(ctxIdx)
        if (!targetOut) {
          targetOut = new Map()
          target.outbound.set(ctxIdx, targetOut)
        }
        const existing = targetOut.get(peerIdx) ?? []
        for (const edgeIdx of edgeIndexes) {
          if (!existing.includes(edgeIdx)) existing.push(edgeIdx)
        }
        targetOut.set(peerIdx, existing)
      }
    }
    fromNode.inbound.clear()
    fromNode.outbound.clear()
  }

  private resolvedSubjectId(edge: IEdge): string | undefined {
    if (!edge.subject) return undefined
    const mapped = this.iToP.get(edge.subject)
    return (mapped ?? edge.subject).toLowerCase()
  }

  private unlinkEdge(index: number): void {
    const edge = this.edgesList[index]
    if (!edge) return
    const authorNode = this.getNode(edge.pubkey)
    const subjectId = this.resolvedSubjectId(edge)
    const subjectNode = subjectId ? this.getNode(subjectId) : null
    const contextIndex = this.getContextIndex(edge.c_tag ?? '', edge.kind as ScoreKind)
    if (authorNode && index !== undefined) authorNode.edges.delete(index)
    if (!authorNode || !subjectNode || contextIndex === undefined) return
    unlinkPeerEdge(authorNode.outbound, contextIndex, subjectNode.index, index)
    unlinkPeerEdge(subjectNode.inbound, contextIndex, authorNode.index, index)
  }
}
