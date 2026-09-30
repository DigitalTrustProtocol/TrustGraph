/**
 * Vendored from DigitalTrustProtocol/Trust — minimal types for heap Graph.
 * Attention: ITrustEvent / IEdge are the stored EventRecord after write-time
 * normalize. One protocol subject per event.
 */

import type { TrustEdgeRecord as EventRecord } from './record'

export type SubjectType = 'p' | 'e' | 'i'

export type GraphTrustValue = 1 | 0 | -1

export interface ExtractedSubject {
  tag: SubjectType
  value: string
}

/**
 * Runtime fields stamped after Dexie load. Never persist — events are written
 * from relay ingest / local publish, not from putting heap objects.
 */
export type HeapEventFields = {
  /** Position in Graph.edgesList while this record is on the heap. */
  index?: number
}

/** Heap trust event — EventRecord plus optional heap-only fields. */
export type ITrustEvent = EventRecord & HeapEventFields

export type Identity = Record<string, string>
