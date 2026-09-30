// Ported from AttentionX src/graph/heap-test-harness.ts (imports rewritten for @dtp/* packages).
/**
 * Test-only heap driver. Production uses GraphManager.
 */
import { slotAddressableId } from '@dtp/trust-protocol'
import { TRUST_STATEMENT_KIND } from '@dtp/trust-protocol'
import { RATING_STATEMENT_KIND } from '@dtp/trust-protocol'
import type { EventRecord } from '@dtp/trust-protocol'
import { normalizeResolveBounds } from './bounds'
import { executeTrustQuery } from './query'
import { indexResolver } from '@dtp/trust-graph'
import { artifactRatingResolver } from './ratings/ArtifactRatingResolver'
import { Graph } from '@dtp/trust-graph'
import type { IResolveStrategy } from '@dtp/trust-graph'
import type {
  RatingQuery,
  RatingQueryResult,
  ResolveBounds,
  TrustQuery,
  TrustQueryResult,
  TrustSubject,
  TrustValue,
} from './types'
import { WOT_MAX_DEGREE_DEFAULT } from './shared/wot-max-degree'
import { neighborhoodFromHeap } from './graph'
import type { NeighborhoodOptions, NeighborhoodResult } from './graph'

export function trustRecord(
  eventId: string,
  author: string,
  subject: TrustSubject,
  value: TrustValue,
  options: {
    context?: string
    createdAt?: number
    activeFrom?: number
    activeUntil?: number
    content?: string
    labels?: string[]
    labelHints?: Record<string, string>
  } = {},
): EventRecord {
  const context = options.context ?? ''
  const pubkey = author.toLowerCase()
  const normalized = {
    type: subject.type,
    value: subject.value.toLowerCase(),
  }
  return {
    id: eventId,
    pubkey,
    created_at: options.createdAt ?? 1,
    kind: TRUST_STATEMENT_KIND,
    tags: [],
    content: options.content ?? '',
    sig: '',
    firstSeenAt: 0,
    addressKey: `${TRUST_STATEMENT_KIND}:${pubkey}:${slotAddressableId(pubkey, normalized, context)}`,
    subject: normalized.value,
    subjectType: subject.type,
    c_tag: context,
    nValue: value,
    addressableId: slotAddressableId(author, subject, context),
    ...(options.activeFrom !== undefined ? { activate: options.activeFrom } : {}),
    ...(options.activeUntil !== undefined ? { expire: options.activeUntil } : {}),
    ...(options.labels !== undefined ? { labels: options.labels } : {}),
    ...(options.labelHints !== undefined ? { labelHints: options.labelHints } : {}),
  }
}

export function ratingRecord(
  eventId: string,
  author: string,
  subject: TrustSubject,
  score: number,
  options: {
    context?: string
    labels?: string[]
    labelHints?: Record<string, string>
    content?: string
    createdAt?: number
    activeFrom?: number
    activeUntil?: number
  } = {},
): EventRecord {
  const context = options.context ?? ''
  const pubkey = author.toLowerCase()
  const normalized = {
    type: subject.type,
    value: subject.value.toLowerCase(),
  }
  return {
    id: eventId,
    pubkey,
    created_at: options.createdAt ?? 1,
    kind: RATING_STATEMENT_KIND,
    tags: [],
    content: options.content ?? '',
    sig: '',
    firstSeenAt: 0,
    addressKey: `${RATING_STATEMENT_KIND}:${pubkey}:${slotAddressableId(pubkey, normalized, context)}`,
    subject: normalized.value,
    subjectType: subject.type,
    c_tag: context,
    nValue: score,
    addressableId: slotAddressableId(author, subject, context),
    ...(options.activeFrom !== undefined ? { activate: options.activeFrom } : {}),
    ...(options.activeUntil !== undefined ? { expire: options.activeUntil } : {}),
    ...(options.labels !== undefined ? { labels: [...options.labels] } : { labels: [] }),
    ...(options.labelHints !== undefined ? { labelHints: options.labelHints } : {}),
  }
}

export class HeapTrustHarness {
  readonly graph = new Graph()
  graphVersion = 0
  readonly defaultBounds: Readonly<ResolveBounds>
  #resolver: IResolveStrategy = indexResolver

  constructor(
    statements: Iterable<EventRecord> = [],
    defaultBounds: Partial<ResolveBounds> = {},
    resolver: IResolveStrategy = indexResolver,
  ) {
    this.defaultBounds = normalizeResolveBounds({
      maxDepth: WOT_MAX_DEGREE_DEFAULT,
      ...defaultBounds,
    })
    this.#resolver = resolver
    for (const statement of statements) {
      this.graph.applyTrustEvent(statement)
    }
    this.graphVersion += 1
  }

  upsert(statement: EventRecord): boolean {
    const ok = this.graph.applyTrustEvent(statement)
    if (ok) this.graphVersion += 1
    return ok
  }

  rebuild(statements: Iterable<EventRecord>): {
    accepted: number
    graphVersion: number
  } {
    this.graph.clear()
    let accepted = 0
    for (const statement of statements) {
      if (this.graph.applyTrustEvent(statement)) accepted += 1
    }
    this.graphVersion += 1
    return { accepted, graphVersion: this.graphVersion }
  }

  get trustGraph(): Graph {
    return this.graph
  }

  bindIdentity(iSubject: string, pubkey: string): void {
    this.graph.bindIdentity(iSubject, pubkey)
  }

  query(query: TrustQuery): TrustQueryResult {
    return executeTrustQuery(
      this.graph,
      this.#resolver,
      {
        ...query,
        bounds: { ...this.defaultBounds, ...query.bounds },
      },
      this.graphVersion,
    )
  }

  rebuildClaims(claims: Iterable<EventRecord>): void {
    for (const claim of claims) {
      this.graph.applyTrustEvent(claim)
    }
    this.graphVersion += 1
  }

  queryRating(query: RatingQuery): RatingQueryResult {
    return artifactRatingResolver.resolve(
      this.graph,
      this.#resolver,
      query,
      this.graphVersion,
      this.defaultBounds,
    )
  }

  neighborhood(
    centerId: NeighborhoodResult['centerId'],
    options: NeighborhoodOptions = {},
  ): NeighborhoodResult {
    return neighborhoodFromHeap(
      this.graph,
      this.graphVersion,
      centerId,
      options,
    )
  }
}
