// Ported from AttentionX src/relay/synchronizer.ts (imports rewritten for @dtp/* packages).
import type { Event, Filter } from 'nostr-tools'
import {
  isEligibleXRatingScope,
  isEligibleXTrustScope,
  RATING_STATEMENT_KIND,
  scopesFromEventTags,
} from '@dtp/trust-protocol'
import {
  activePositivePubkeyEdges,
  TRUST_STATEMENT_KIND,
} from './graph'
import {
  AUTHOR_SYNC_FILTER_BATCH,
  batchAuthors,
  batchXTrustSubjectIds,
  buildAuthorsRatingSyncFilter,
  buildAuthorsTrustSyncFilter,
  buildXAccountTrustDiscoveryFilter,
  buildXPostSubjectFilter,
  SYNC_PAGE_SIZE,
  xSubjectBatchSyncScope,
} from './filters'
import {
  assertRetryPolicy,
  DEFAULT_RETRY_POLICY,
  retryDelayMs,
} from './retry'
import {
  systemClock,
  type Clock,
  type EventIngestResult,
  type GraphFrontierReader,
  type RelayEventRepository,
  type RelayProvenance,
  type RelayQueryClient,
  type RetryNotice,
  type RetryPolicy,
  type SyncCursor,
  type SyncCursorRepository,
} from './types'

const HEX_64 = /^[0-9a-f]{64}$/
const FULL_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000
const MAX_PAGES = 20

export interface GraphSyncLimits {
  maxDepth: number
  maxAuthorsPerLevel: number
  maxTotalAuthors: number
  maxEvents: number
  /** Separate budget for kind 32014 so ratings cannot starve trust BFS. */
  maxRatingEvents?: number
  /** Independent budget for `#i=user:id` discovery. */
  maxDiscoveryEvents?: number
}

export const DEFAULT_GRAPH_SYNC_LIMITS: GraphSyncLimits = {
  maxDepth: 2,
  maxAuthorsPerLevel: 50,
  maxTotalAuthors: 150,
  maxEvents: 2_000,
  maxRatingEvents: 2_000,
  maxDiscoveryEvents: 400,
}

export interface RelaySynchronizerDependencies {
  client: RelayQueryClient
  cursors: SyncCursorRepository
  events: RelayEventRepository
  frontier?: GraphFrontierReader
  onProvenance?: (observation: RelayProvenance) => void | Promise<void>
  onRetry?: (notice: RetryNotice) => void | Promise<void>
  clock?: Clock
  random?: () => number
}

export interface SynchronizeOptions {
  relayUrls: readonly string[]
  rootPubkeys: readonly string[]
  scope: string
  overlapSeconds: number
  xUserIds?: readonly string[]
  limits?: GraphSyncLimits
  retryPolicy?: RetryPolicy
  signal?: AbortSignal
}

export interface RelayQueryOutcome {
  relayUrl: string
  author: string
  scope: string
  attempts: number
  completed: boolean
  error?: string
}

export type SyncTruncationReason =
  | 'maxDepth'
  | 'maxAuthorsPerLevel'
  | 'maxTotalAuthors'
  | 'maxEvents'
  | 'maxRatingEvents'
  | 'maxDiscoveryEvents'

export interface SynchronizeResult {
  authors: string[]
  eventsProcessed: number
  eventsStored: number
  duplicates: number
  rejected: number
  queries: RelayQueryOutcome[]
  truncated: boolean
  truncationReasons: SyncTruncationReason[]
  complete: boolean
}

class EventLimitReachedError extends Error {
  constructor(message = 'Relay synchronization reached maxEvents') {
    super(message)
    this.name = 'EventLimitReachedError'
  }
}

class RatingEventLimitReachedError extends Error {
  constructor() {
    super('Relay synchronization reached maxRatingEvents')
    this.name = 'RatingEventLimitReachedError'
  }
}

class DiscoveryEventLimitReachedError extends Error {
  constructor() {
    super('Relay synchronization reached maxDiscoveryEvents')
    this.name = 'DiscoveryEventLimitReachedError'
  }
}

function assertLimits(limits: GraphSyncLimits): void {
  if (
    !Number.isInteger(limits.maxDepth) ||
    limits.maxDepth < 0 ||
    !Number.isInteger(limits.maxAuthorsPerLevel) ||
    limits.maxAuthorsPerLevel < 1 ||
    !Number.isInteger(limits.maxTotalAuthors) ||
    limits.maxTotalAuthors < 1 ||
    !Number.isInteger(limits.maxEvents) ||
    limits.maxEvents < 1 ||
    (limits.maxRatingEvents !== undefined &&
      (!Number.isInteger(limits.maxRatingEvents) ||
        limits.maxRatingEvents < 1)) ||
    (limits.maxDiscoveryEvents !== undefined &&
      (!Number.isInteger(limits.maxDiscoveryEvents) ||
        limits.maxDiscoveryEvents < 1))
  ) {
    throw new Error('Invalid graph synchronization limits')
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

/** Post trust: empty or x.com scope. Post ratings: x.com only. */
function isEligibleXPostStatement(event: Event): boolean {
  const scopes = scopesFromEventTags(event.tags)
  if (event.kind === TRUST_STATEMENT_KIND) return isEligibleXTrustScope(scopes)
  if (event.kind === RATING_STATEMENT_KIND) return isEligibleXRatingScope(scopes)
  return false
}

export function authorSyncScope(scope: string, author: string): string {
  return `${scope}:kind:${TRUST_STATEMENT_KIND}:author:${author}`
}

export function authorRatingSyncScope(scope: string, author: string): string {
  return `${scope}:kind:${RATING_STATEMENT_KIND}:author:${author}`
}

export function authorsTrustBatchScope(
  scope: string,
  authors: readonly string[],
): string {
  if (authors.length === 1) return authorSyncScope(scope, authors[0]!)
  return `${scope}:kind:${TRUST_STATEMENT_KIND}:authors:${[...authors].sort().join(',')}`
}

export function authorsRatingBatchScope(
  scope: string,
  authors: readonly string[],
): string {
  if (authors.length === 1) return authorRatingSyncScope(scope, authors[0]!)
  return `${scope}:kind:${RATING_STATEMENT_KIND}:authors:${[...authors].sort().join(',')}`
}

type KindGate = 'trust' | 'rating' | 'discovery'

export class RelaySynchronizer {
  private readonly dependencies: RelaySynchronizerDependencies
  private readonly clock: Clock
  private readonly random: () => number

  constructor(dependencies: RelaySynchronizerDependencies) {
    this.dependencies = dependencies
    this.clock = dependencies.clock ?? systemClock
    this.random = dependencies.random ?? Math.random
  }

  async synchronize(options: SynchronizeOptions): Promise<SynchronizeResult> {
    const limits: GraphSyncLimits = {
      ...DEFAULT_GRAPH_SYNC_LIMITS,
      ...options.limits,
    }
    const retryPolicy = options.retryPolicy ?? DEFAULT_RETRY_POLICY
    assertLimits(limits)
    assertRetryPolicy(retryPolicy)
    if (!options.scope) {
      throw new Error('Synchronization scope is required')
    }
    if (
      !Number.isFinite(options.overlapSeconds) ||
      options.overlapSeconds < 0
    ) {
      throw new Error('overlapSeconds must be non-negative')
    }

    const relayUrls = unique(options.relayUrls.filter(Boolean))
    const requestedRoots = unique(options.rootPubkeys)
    for (const pubkey of requestedRoots) {
      if (!HEX_64.test(pubkey)) {
        throw new Error(`Invalid root pubkey: ${pubkey}`)
      }
    }

    const reasons = new Set<SyncTruncationReason>()
    const nowSeconds = Math.floor(this.clock.now() / 1_000)
    const seeded = this.dependencies.frontier?.authorsFromRoots(
      requestedRoots,
      nowSeconds,
      {
        maxDepth: limits.maxDepth,
        maxAuthorsPerLevel: limits.maxAuthorsPerLevel,
        maxTotalAuthors: limits.maxTotalAuthors,
      },
    )
    let currentLevel =
      seeded?.authors && seeded.authors.length > 0
        ? [...seeded.authors]
        : [...requestedRoots]
    for (const reason of seeded?.reasons ?? []) {
      if (
        reason === 'maxDepth' ||
        reason === 'maxAuthorsPerLevel' ||
        reason === 'maxTotalAuthors'
      ) {
        reasons.add(reason)
      }
    }
    if (currentLevel.length > limits.maxAuthorsPerLevel) {
      currentLevel = currentLevel.slice(0, limits.maxAuthorsPerLevel)
      reasons.add('maxAuthorsPerLevel')
    }
    if (currentLevel.length > limits.maxTotalAuthors) {
      currentLevel = currentLevel.slice(0, limits.maxTotalAuthors)
      reasons.add('maxTotalAuthors')
    }

    const discovered = new Set(currentLevel)
    const seenOutcomes = new Map<string, EventIngestResult>()
    const ratingSeenOutcomes = new Map<string, EventIngestResult>()
    const discoverySeenOutcomes = new Map<string, EventIngestResult>()
    const queries: RelayQueryOutcome[] = []
    let eventsStored = 0
    let duplicates = 0
    let rejected = 0
    let stoppedByEventLimit = false
    let stoppedByRatingEventLimit = false
    const counters = {
      onStored: () => {
        eventsStored += 1
      },
      onDuplicate: () => {
        duplicates += 1
      },
      onRejected: () => {
        rejected += 1
      },
    }
    const maxRatingEvents =
      limits.maxRatingEvents ??
      DEFAULT_GRAPH_SYNC_LIMITS.maxRatingEvents ??
      2_000
    const maxDiscoveryEvents =
      limits.maxDiscoveryEvents ??
      DEFAULT_GRAPH_SYNC_LIMITS.maxDiscoveryEvents ??
      400
    const perAuthorCap = Math.max(
      20,
      Math.floor(limits.maxEvents / Math.max(1, limits.maxTotalAuthors)),
    )
    const authorCounts = new Map<string, number>()

    const fetchTrustLevel = async (authors: readonly string[]) => {
      for (const relayUrl of relayUrls) {
        for (const batch of batchAuthors(authors, AUTHOR_SYNC_FILTER_BATCH)) {
          const outcome = await this.syncAuthorBatchFromRelay({
            relayUrl,
            authors: batch,
            kind: 'trust',
            baseScope: options.scope,
            overlapSeconds: options.overlapSeconds,
            retryPolicy,
            signal: options.signal,
            seenOutcomes,
            maxEvents: limits.maxEvents,
            perAuthorCap,
            authorCounts,
            ...counters,
          })
          queries.push(outcome)
          if (outcome.error === 'Relay synchronization reached maxEvents') {
            reasons.add('maxEvents')
            stoppedByEventLimit = true
            return
          }
        }
        if (stoppedByEventLimit) return
      }
    }

    await fetchTrustLevel(currentLevel)

    for (
      let depth = 0;
      depth <= limits.maxDepth && currentLevel.length > 0 && !stoppedByEventLimit;
      depth += 1
    ) {
      const nextCandidates = await this.nextHopAuthors(
        currentLevel,
        discovered,
        nowSeconds,
      )
      if (depth === limits.maxDepth) {
        if (nextCandidates.length > 0) reasons.add('maxDepth')
        break
      }
      let nextLevel = nextCandidates
      if (nextLevel.length > limits.maxAuthorsPerLevel) {
        nextLevel = nextLevel.slice(0, limits.maxAuthorsPerLevel)
        reasons.add('maxAuthorsPerLevel')
      }
      const remainingAuthors = limits.maxTotalAuthors - discovered.size
      if (nextLevel.length > remainingAuthors) {
        nextLevel = nextLevel.slice(0, Math.max(0, remainingAuthors))
        reasons.add('maxTotalAuthors')
      }
      for (const pubkey of nextLevel) discovered.add(pubkey)
      currentLevel = nextLevel
      if (currentLevel.length === 0) break
      await fetchTrustLevel(currentLevel)
    }

    const frozenAuthors = [...discovered]
    if (!stoppedByEventLimit) {
      for (const relayUrl of relayUrls) {
        for (const batch of batchAuthors(
          frozenAuthors,
          AUTHOR_SYNC_FILTER_BATCH,
        )) {
          if (stoppedByRatingEventLimit) break
          const outcome = await this.syncAuthorBatchFromRelay({
            relayUrl,
            authors: batch,
            kind: 'rating',
            baseScope: options.scope,
            overlapSeconds: options.overlapSeconds,
            retryPolicy,
            signal: options.signal,
            seenOutcomes: ratingSeenOutcomes,
            maxEvents: maxRatingEvents,
            perAuthorCap,
            authorCounts: new Map(),
            ...counters,
          })
          queries.push(outcome)
          if (
            outcome.error ===
            'Relay synchronization reached maxRatingEvents'
          ) {
            reasons.add('maxRatingEvents')
            stoppedByRatingEventLimit = true
          }
        }
      }
    }

    let stoppedByDiscoveryLimit = false
    if (!stoppedByEventLimit) {
      for (const relayUrl of relayUrls) {
        for (const batch of batchXTrustSubjectIds(options.xUserIds ?? [])) {
          const outcome = await this.syncXSubjectsFromRelay({
            relayUrl,
            twitterIds: batch,
            baseScope: options.scope,
            overlapSeconds: options.overlapSeconds,
            retryPolicy,
            signal: options.signal,
            seenOutcomes: discoverySeenOutcomes,
            maxEvents: maxDiscoveryEvents,
            ...counters,
          })
          queries.push(outcome)
          if (
            outcome.error ===
            'Relay synchronization reached maxDiscoveryEvents'
          ) {
            reasons.add('maxDiscoveryEvents')
            stoppedByDiscoveryLimit = true
            break
          }
        }
        if (stoppedByDiscoveryLimit) break
      }
    }

    const complete =
      queries.every((query) => query.completed) &&
      !stoppedByEventLimit &&
      !stoppedByRatingEventLimit &&
      !stoppedByDiscoveryLimit

    return {
      authors: frozenAuthors,
      eventsProcessed:
        seenOutcomes.size +
        ratingSeenOutcomes.size +
        discoverySeenOutcomes.size,
      eventsStored,
      duplicates,
      rejected,
      queries,
      truncated: reasons.size > 0,
      truncationReasons: [...reasons],
      complete,
    }
  }

  /**
   * One-shot pull of trust and ratings about specific posts from any author
   * (reload after storage pruning). No `since` and no stored cursor: a
   * cursor would make the next reload skip the old events it must recover.
   * `complete` is true only when every post batch finished on at least one
   * relay without hitting the event cap, an error, or an abort.
   */
  async refreshXPostSubjects(options: {
    relayUrls: readonly string[]
    postIds: readonly string[]
    signal?: AbortSignal
    retryPolicy?: RetryPolicy
    maxEvents?: number
  }): Promise<{
    eventsStored: number
    queries: RelayQueryOutcome[]
    complete: boolean
  }> {
    const retryPolicy = options.retryPolicy ?? DEFAULT_RETRY_POLICY
    assertRetryPolicy(retryPolicy)
    const maxEvents =
      options.maxEvents ?? DEFAULT_GRAPH_SYNC_LIMITS.maxDiscoveryEvents ?? 400
    let eventsStored = 0
    const counters = {
      onStored: () => {
        eventsStored += 1
      },
      onDuplicate: () => {},
      onRejected: () => {},
    }
    const queries: RelayQueryOutcome[] = []
    const batches = batchXTrustSubjectIds(options.postIds)
    const completedScopes = new Set<string>()
    for (const relayUrl of unique(options.relayUrls.filter(Boolean))) {
      const seenOutcomes = new Map<string, EventIngestResult>()
      for (const batch of batches) {
        if (options.signal?.aborted) break
        const scope = `x-posts:${batch.join(',')}`
        const outcome = await this.queryPaged({
          relayUrl,
          scope,
          authorLabel: scope,
          retryPolicy,
          signal: options.signal,
          seenOutcomes,
          maxEvents,
          buildFilter: (pageSince, until, limit) => ({
            ...buildXPostSubjectFilter(batch, pageSince),
            ...(until === undefined ? {} : { until }),
            limit,
          }),
          since: undefined,
          perAuthorCursors: [],
          accept: isEligibleXPostStatement,
          limitError: () => new DiscoveryEventLimitReachedError(),
          ...counters,
        })
        queries.push(outcome)
        if (outcome.completed && !options.signal?.aborted) {
          completedScopes.add(scope)
        }
        if (
          outcome.error === 'Relay synchronization reached maxDiscoveryEvents'
        ) {
          break
        }
      }
    }
    const complete =
      batches.length > 0 &&
      batches.every((batch) => completedScopes.has(`x-posts:${batch.join(',')}`))
    return { eventsStored, queries, complete }
  }

  private async nextHopAuthors(
    currentLevel: readonly string[],
    discovered: ReadonlySet<string>,
    nowSeconds: number,
  ): Promise<string[]> {
    if (this.dependencies.frontier) {
      return this.dependencies.frontier
        .positiveChildren(currentLevel, nowSeconds)
        .filter((pubkey) => !discovered.has(pubkey))
    }
    const next = new Set<string>()
    for (const author of currentLevel) {
      const authorEvents = await this.dependencies.events.listEventsByAuthor(
        author,
        TRUST_STATEMENT_KIND,
      )
      for (const pubkey of activePositivePubkeyEdges(
        authorEvents,
        nowSeconds,
      )) {
        if (!discovered.has(pubkey)) next.add(pubkey)
      }
    }
    return [...next].sort()
  }

  private async syncAuthorBatchFromRelay(input: {
    relayUrl: string
    authors: readonly string[]
    kind: 'trust' | 'rating'
    baseScope: string
    overlapSeconds: number
    retryPolicy: RetryPolicy
    signal?: AbortSignal
    seenOutcomes: Map<string, EventIngestResult>
    maxEvents: number
    perAuthorCap: number
    authorCounts: Map<string, number>
    onStored: () => void
    onDuplicate: () => void
    onRejected: () => void
  }): Promise<RelayQueryOutcome> {
    const authors = [...input.authors].sort()
    const scope =
      input.kind === 'trust'
        ? authorsTrustBatchScope(input.baseScope, authors)
        : authorsRatingBatchScope(input.baseScope, authors)
    const perAuthorScopes = authors.map((author) =>
      input.kind === 'trust'
        ? authorSyncScope(input.baseScope, author)
        : authorRatingSyncScope(input.baseScope, author),
    )
    const cursors = await Promise.all(
      perAuthorScopes.map((authorScope) =>
        this.dependencies.cursors.getCursor(input.relayUrl, authorScope),
      ),
    )
    const sinces = cursors.map((cursor) =>
      this.sinceFromCursor(cursor, input.overlapSeconds),
    )
    const since =
      sinces.every((value) => value === undefined)
        ? undefined
        : Math.min(
            ...sinces.map((value) => value ?? 0),
          )
    const authorSet = new Set(authors)
    const expectedKind =
      input.kind === 'trust' ? TRUST_STATEMENT_KIND : RATING_STATEMENT_KIND
    const gate: KindGate = input.kind
    const limitError =
      input.kind === 'trust'
        ? () => new EventLimitReachedError()
        : () => new RatingEventLimitReachedError()
    const authorLabel = authors.length === 1 ? authors[0]! : authors.join(',')

    return this.queryPaged({
      relayUrl: input.relayUrl,
      scope,
      authorLabel,
      retryPolicy: input.retryPolicy,
      signal: input.signal,
      seenOutcomes: input.seenOutcomes,
      maxEvents: input.maxEvents,
      buildFilter: (pageSince, until, limit) =>
        input.kind === 'trust'
          ? {
              ...buildAuthorsTrustSyncFilter(authors, pageSince, until),
              limit,
            }
          : {
              ...buildAuthorsRatingSyncFilter(authors, pageSince, until),
              limit,
            },
      since,
      perAuthorCursors: authors.map((author, index) => ({
        author,
        scope: perAuthorScopes[index]!,
        previous: cursors[index],
      })),
      accept: (event) => {
        if (event.kind !== expectedKind) return false
        if (!authorSet.has(event.pubkey)) return false
        if (gate === 'trust') {
          return isEligibleXTrustScope(scopesFromEventTags(event.tags))
        }
        return isEligibleXRatingScope(scopesFromEventTags(event.tags))
      },
      perAuthorCap: input.perAuthorCap,
      authorCounts: input.authorCounts,
      limitError,
      onStored: input.onStored,
      onDuplicate: input.onDuplicate,
      onRejected: input.onRejected,
    })
  }

  private async syncXSubjectsFromRelay(input: {
    relayUrl: string
    twitterIds: readonly string[]
    baseScope: string
    overlapSeconds: number
    retryPolicy: RetryPolicy
    signal?: AbortSignal
    seenOutcomes: Map<string, EventIngestResult>
    maxEvents: number
    onStored: () => void
    onDuplicate: () => void
    onRejected: () => void
  }): Promise<RelayQueryOutcome> {
    const scope = xSubjectBatchSyncScope(input.baseScope, input.twitterIds)
    const cursor = await this.dependencies.cursors.getCursor(
      input.relayUrl,
      scope,
    )
    const since = this.sinceFromCursor(cursor, input.overlapSeconds)
    const author = `x:${[...input.twitterIds].sort().join(',')}`
    return this.queryPaged({
      relayUrl: input.relayUrl,
      scope,
      authorLabel: author,
      retryPolicy: input.retryPolicy,
      signal: input.signal,
      seenOutcomes: input.seenOutcomes,
      maxEvents: input.maxEvents,
      buildFilter: (pageSince, until, limit) => ({
        ...buildXAccountTrustDiscoveryFilter(input.twitterIds, pageSince),
        ...(until === undefined ? {} : { until }),
        limit,
      }),
      since,
      perAuthorCursors: [
        { author, scope, previous: cursor },
      ],
      accept: (event) =>
        event.kind === TRUST_STATEMENT_KIND &&
        isEligibleXTrustScope(scopesFromEventTags(event.tags)),
      limitError: () =>
        new DiscoveryEventLimitReachedError(),
      onStored: input.onStored,
      onDuplicate: input.onDuplicate,
      onRejected: input.onRejected,
    })
  }

  private sinceFromCursor(
    cursor: SyncCursor | undefined,
    overlapSeconds: number,
  ): number | undefined {
    if (cursor === undefined) return undefined
    return Math.floor(cursor.lastEoseAt / FULL_REFRESH_INTERVAL_MS) ===
      Math.floor(this.clock.now() / FULL_REFRESH_INTERVAL_MS)
      ? Math.max(0, cursor.lastSeenCreatedAt - overlapSeconds)
      : undefined
  }

  private async queryPaged(input: {
    relayUrl: string
    scope: string
    authorLabel: string
    retryPolicy: RetryPolicy
    signal?: AbortSignal
    seenOutcomes: Map<string, EventIngestResult>
    maxEvents: number
    buildFilter: (since: number | undefined, until: number | undefined, limit: number) => Filter
    since: number | undefined
    perAuthorCursors: Array<{
      author: string
      scope: string
      previous: SyncCursor | undefined
    }>
    accept: (event: Event) => boolean
    perAuthorCap?: number
    authorCounts?: Map<string, number>
    limitError: () => Error
    onStored: () => void
    onDuplicate: () => void
    onRejected: () => void
  }): Promise<RelayQueryOutcome> {
    const maxSeenByAuthor = new Map<string, number>()
    for (const row of input.perAuthorCursors) {
      maxSeenByAuthor.set(row.author, row.previous?.lastSeenCreatedAt ?? 0)
    }

    for (let attempt = 1; attempt <= input.retryPolicy.maxAttempts; attempt += 1) {
      try {
        let until: number | undefined
        let unsaturated = false
        let stalled = false
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const remaining = input.maxEvents - input.seenOutcomes.size
          if (remaining < 1) throw input.limitError()
          const pageLimit = Math.min(SYNC_PAGE_SIZE, remaining)
          let pageCount = 0
          let minCreated: number | undefined
          await this.dependencies.client.query({
            relayUrl: input.relayUrl,
            filter: input.buildFilter(input.since, until, pageLimit),
            signal: input.signal,
            onEvent: async (event: Event) => {
              pageCount += 1
              minCreated =
                minCreated === undefined
                  ? event.created_at
                  : Math.min(minCreated, event.created_at)
              await this.ingestPagedEvent(event, input, maxSeenByAuthor)
            },
          })
          if (pageCount < pageLimit) {
            unsaturated = true
            break
          }
          if (minCreated === undefined) {
            unsaturated = true
            break
          }
          if (until !== undefined && minCreated >= until) {
            stalled = true
            break
          }
          until = minCreated
        }

        if (unsaturated) {
          const now = this.clock.now()
          for (const row of input.perAuthorCursors) {
            await this.dependencies.cursors.setCursor({
              relayUrl: input.relayUrl,
              scope: row.scope,
              lastSeenCreatedAt: maxSeenByAuthor.get(row.author) ?? 0,
              lastEoseAt: now,
              retry: { attempts: 0 },
            })
          }
          return {
            relayUrl: input.relayUrl,
            author: input.authorLabel,
            scope: input.scope,
            attempts: attempt,
            completed: true,
          }
        }

        await this.persistRetry(
          input.relayUrl,
          input.perAuthorCursors,
          attempt,
          stalled ? 'page stall' : 'saturated',
        )
        return {
          relayUrl: input.relayUrl,
          author: input.authorLabel,
          scope: input.scope,
          attempts: attempt,
          completed: false,
          error: stalled
            ? 'Relay page stalled on identical created_at'
            : 'Relay query saturated before EOSE',
        }
      } catch (error) {
        if (
          error instanceof EventLimitReachedError ||
          error instanceof RatingEventLimitReachedError ||
          error instanceof DiscoveryEventLimitReachedError ||
          attempt >= input.retryPolicy.maxAttempts
        ) {
          await this.persistRetry(
            input.relayUrl,
            input.perAuthorCursors,
            attempt,
            errorMessage(error),
          )
          return {
            relayUrl: input.relayUrl,
            author: input.authorLabel,
            scope: input.scope,
            attempts: attempt,
            completed: false,
            error: errorMessage(error),
          }
        }
        const delayMs = retryDelayMs(
          input.retryPolicy,
          attempt,
          this.random,
        )
        await this.dependencies.onRetry?.({
          relayUrl: input.relayUrl,
          scope: input.scope,
          attempt,
          delayMs,
          error,
        })
        try {
          await this.clock.sleep(delayMs, input.signal)
        } catch (sleepError) {
          await this.persistRetry(
            input.relayUrl,
            input.perAuthorCursors,
            attempt,
            errorMessage(sleepError),
          )
          return {
            relayUrl: input.relayUrl,
            author: input.authorLabel,
            scope: input.scope,
            attempts: attempt,
            completed: false,
            error: errorMessage(sleepError),
          }
        }
        if (input.signal?.aborted) {
          await this.persistRetry(
            input.relayUrl,
            input.perAuthorCursors,
            attempt,
            'aborted',
          )
          return {
            relayUrl: input.relayUrl,
            author: input.authorLabel,
            scope: input.scope,
            attempts: attempt,
            completed: false,
            error: 'aborted',
          }
        }
      }
    }

    throw new Error('Unreachable relay retry state')
  }

  private async ingestPagedEvent(
    event: Event,
    input: {
      relayUrl: string
      seenOutcomes: Map<string, EventIngestResult>
      maxEvents: number
      accept: (event: Event) => boolean
      perAuthorCap?: number
      authorCounts?: Map<string, number>
      limitError: () => Error
      onStored: () => void
      onDuplicate: () => void
      onRejected: () => void
    },
    maxSeenByAuthor: Map<string, number>,
  ): Promise<void> {
    let ingestResult = input.seenOutcomes.get(event.id)
    if (ingestResult !== undefined) {
      input.onDuplicate()
    } else {
      if (input.seenOutcomes.size >= input.maxEvents) {
        throw input.limitError()
      }
      const authorCount = input.authorCounts?.get(event.pubkey) ?? 0
      if (
        input.perAuthorCap !== undefined &&
        authorCount >= input.perAuthorCap
      ) {
        ingestResult = 'rejected'
      } else if (!input.accept(event)) {
        ingestResult = 'rejected'
      } else {
        ingestResult = await this.dependencies.events.ingestEvent(event)
      }
      input.seenOutcomes.set(event.id, ingestResult)
      if (ingestResult === 'stored') {
        input.onStored()
        if (input.authorCounts) {
          input.authorCounts.set(event.pubkey, authorCount + 1)
        }
      } else if (ingestResult === 'duplicate') {
        input.onDuplicate()
      } else {
        input.onRejected()
      }
    }
    if (ingestResult !== 'rejected') {
      maxSeenByAuthor.set(
        event.pubkey,
        Math.max(maxSeenByAuthor.get(event.pubkey) ?? 0, event.created_at),
      )
    }
    await this.dependencies.onProvenance?.({
      relayUrl: input.relayUrl,
      eventId: event.id,
      observedAt: this.clock.now(),
      ingestResult,
    })
  }

  private async persistRetry(
    relayUrl: string,
    rows: Array<{ author: string; scope: string; previous: SyncCursor | undefined }>,
    attempt: number,
    lastError: string,
  ): Promise<void> {
    const now = this.clock.now()
    for (const row of rows) {
      await this.dependencies.cursors.setCursor({
        relayUrl,
        scope: row.scope,
        lastSeenCreatedAt: row.previous?.lastSeenCreatedAt ?? 0,
        lastEoseAt: row.previous?.lastEoseAt ?? 0,
        retry: {
          attempts: attempt,
          nextRetryAt: now,
          lastError,
        },
      })
    }
  }
}
