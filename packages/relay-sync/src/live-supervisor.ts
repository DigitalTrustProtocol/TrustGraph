// Ported from AttentionX src/relay/live-supervisor.ts (imports rewritten for @dtp/* packages).
import type { Event, Filter } from 'nostr-tools'
import { RATING_STATEMENT_KIND, X_TRUST_SCOPE } from '@dtp/trust-protocol'
import { TRUST_STATEMENT_KIND } from './graph'
import {
  AUTHOR_SYNC_FILTER_BATCH,
  batchAuthors,
  buildAuthorsRatingSyncFilter,
  buildAuthorsTrustSyncFilter,
  buildGlobalKindSyncFilter,
  frontierKindSyncScope,
  globalKindSyncScope,
} from './filters'
import {
  type Clock,
  type EventIngestResult,
  type RelayProvenance,
  type RelayQueryClient,
  type RelaySubscribeClient,
  type RelaySubscription,
  type SyncCursorRepository,
  systemClock,
} from './types'

export const GLOBAL_SYNC_KINDS = [
  TRUST_STATEMENT_KIND,
  RATING_STATEMENT_KIND,
] as const

export type LiveSyncMode = 'frontier' | 'global'
export type LiveSyncStatus =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'partial'
  | 'stopped'

const DEFAULT_QUEUE_CAP = 100
const FRONTIER_REPLACE_DEBOUNCE_MS = 1_500
const FLUSH_BATCH = 20

export interface LiveKindStat {
  kind: number
  received: number
  stored: number
  lastCheckpoint?: number
}

export interface LiveSyncSupervisorDependencies {
  client: RelayQueryClient & Partial<RelaySubscribeClient>
  cursors: SyncCursorRepository
  ingest: (event: Event) => Promise<EventIngestResult>
  onProvenance?: (observation: RelayProvenance) => void | Promise<void>
  onStatus?: (state: LiveSyncStatus) => void
  clock?: Clock
}

export interface LiveSyncStartOptions {
  relayUrls: readonly string[]
  mode: LiveSyncMode
  authors?: readonly string[]
  scope: string
  overlapSeconds: number
  signal?: AbortSignal
  queueCap?: number
}

interface QueuedLiveEvent {
  event: Event
  relayUrl: string
  scope: string
  kind: number
}

export class LiveSyncSupervisor {
  readonly #deps: LiveSyncSupervisorDependencies
  readonly #clock: Clock
  #subscriptions: RelaySubscription[] = []
  #queue: QueuedLiveEvent[] = []
  #flushChain: Promise<void> = Promise.resolve()
  #recovering = false
  #authors: string[] = []
  #options?: LiveSyncStartOptions
  #replaceTimer: ReturnType<typeof setTimeout> | undefined
  #relayReplace: Promise<void> = Promise.resolve()
  #started = false
  #opening = false
  #highWater = new Map<string, number>()
  #kindStats = new Map<number, LiveKindStat>()

  constructor(dependencies: LiveSyncSupervisorDependencies) {
    this.#deps = dependencies
    this.#clock = dependencies.clock ?? systemClock
  }

  get running(): boolean {
    return this.#started
  }

  get kindStats(): LiveKindStat[] {
    return [...this.#kindStats.values()].sort((left, right) => left.kind - right.kind)
  }

  async start(options: LiveSyncStartOptions): Promise<void> {
    this.stop()
    this.#options = options
    this.#authors = [...new Set(options.authors ?? [])]
    this.#started = true
    this.#deps.onStatus?.('connecting')
    await this.#openSubscriptions()
    if (this.#started && this.#deps.client.subscribe) {
      this.#deps.onStatus?.('live')
    }
  }

  stop(): void {
    this.#started = false
    if (this.#replaceTimer !== undefined) {
      clearTimeout(this.#replaceTimer)
      this.#replaceTimer = undefined
    }
    this.#closeSubscriptions('attentionx live sync stopped')
    this.#queue = []
    this.#recovering = false
    this.#deps.onStatus?.('stopped')
  }

  /**
   * Rebuild live subscriptions for a new active relay list. Removed relays
   * have their sockets closed. A no-op when the set is unchanged.
   */
  replaceRelays(relayUrls: readonly string[]): Promise<void> {
    if (!this.#started || !this.#options) return Promise.resolve()
    const next = [...new Set(relayUrls.filter(Boolean))]
    const previous = this.#options.relayUrls
    const previousSorted = [...previous].sort()
    const nextSorted = [...next].sort()
    if (
      previousSorted.length === nextSorted.length &&
      previousSorted.every((url, index) => url === nextSorted[index])
    ) {
      return Promise.resolve()
    }
    const nextSet = new Set(next)
    const removed = previous.filter((url) => !nextSet.has(url))
    this.#options = { ...this.#options, relayUrls: next }
    const run = this.#relayReplace.then(() => this.#rebuildRelaySubscriptions(removed))
    this.#relayReplace = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  replaceAuthors(authors: readonly string[]): void {
    if (!this.#started || this.#options?.mode !== 'frontier') return
    const next = [...new Set(authors)].sort()
    const prev = [...this.#authors].sort()
    if (
      next.length === prev.length &&
      next.every((value, index) => value === prev[index])
    ) {
      return
    }
    this.#authors = next
    if (this.#replaceTimer !== undefined) clearTimeout(this.#replaceTimer)
    this.#replaceTimer = setTimeout(() => {
      this.#replaceTimer = undefined
      if (!this.#started) return
      this.#deps.onStatus?.('reconnecting')
      void this.#openSubscriptions().then(() => {
        if (this.#started && this.#deps.client.subscribe) {
          this.#deps.onStatus?.('live')
        }
      })
    }, FRONTIER_REPLACE_DEBOUNCE_MS)
  }

  async #rebuildRelaySubscriptions(removed: readonly string[]): Promise<void> {
    if (!this.#started) return
    this.#deps.onStatus?.('reconnecting')
    while (this.#opening) await Promise.resolve()
    if (!this.#started) return
    await this.#openSubscriptions()
    if (!this.#started) return
    for (const url of removed) this.#deps.client.releaseRelay?.(url)
    if (this.#deps.client.subscribe) this.#deps.onStatus?.('live')
  }

  #closeSubscriptions(reason: string): void {
    for (const sub of this.#subscriptions) {
      try {
        sub.close(reason)
      } catch {
        /* ignore */
      }
    }
    this.#subscriptions = []
  }

  async #openSubscriptions(): Promise<void> {
    const options = this.#options
    if (!options || this.#opening) return
    this.#opening = true
    try {
      this.#closeSubscriptions('attentionx replace subscriptions')
      const client = this.#deps.client
      if (!client.subscribe) {
        this.#deps.onStatus?.('partial')
        return
      }
      const nowSeconds = Math.floor(this.#clock.now() / 1_000)
      const overlap = Math.max(0, Math.floor(options.overlapSeconds))

      const open = (
        relayUrl: string,
        filter: Filter,
        scope: string,
        kind: number,
      ) => {
        const sub = client.subscribe!({
          relayUrl,
          filter,
          signal: options.signal,
          onEvent: (event) => {
            this.#trackHighWater(relayUrl, scope, event.created_at)
            this.#enqueue({ event, relayUrl, scope, kind })
          },
          onEose: () => {
            void this.#checkpoint(relayUrl, scope, kind)
          },
          onClose: () => {
            if (!this.#started || options.signal?.aborted || this.#opening) {
              return
            }
            this.#deps.onStatus?.('reconnecting')
            void this.#openSubscriptions().then(() => {
              if (this.#started && this.#deps.client.subscribe) {
                this.#deps.onStatus?.('live')
              }
            })
          },
        })
        this.#subscriptions.push(sub)
      }

      for (const relayUrl of options.relayUrls) {
        if (options.mode === 'global') {
          for (const kind of GLOBAL_SYNC_KINDS) {
            this.#ensureKindStat(kind)
            const scope = globalKindSyncScope(options.scope, kind)
            const since = await this.#sinceForScope(
              relayUrl,
              scope,
              overlap,
              nowSeconds,
              true,
            )
            const extra =
              kind === RATING_STATEMENT_KIND
                ? { '#s': [X_TRUST_SCOPE] }
                : undefined
            open(
              relayUrl,
              buildGlobalKindSyncFilter(kind, since, extra),
              scope,
              kind,
            )
          }
          continue
        }

        const trustScope = frontierKindSyncScope(
          options.scope,
          TRUST_STATEMENT_KIND,
        )
        const ratingScope = frontierKindSyncScope(
          options.scope,
          RATING_STATEMENT_KIND,
        )
        this.#ensureKindStat(TRUST_STATEMENT_KIND)
        this.#ensureKindStat(RATING_STATEMENT_KIND)
        const trustSince = await this.#frontierSince(
          relayUrl,
          trustScope,
          TRUST_STATEMENT_KIND,
          overlap,
          nowSeconds,
        )
        const ratingSince = await this.#frontierSince(
          relayUrl,
          ratingScope,
          RATING_STATEMENT_KIND,
          overlap,
          nowSeconds,
        )
        for (const batch of batchAuthors(
          this.#authors,
          AUTHOR_SYNC_FILTER_BATCH,
        )) {
          open(
            relayUrl,
            buildAuthorsTrustSyncFilter(batch, trustSince),
            trustScope,
            TRUST_STATEMENT_KIND,
          )
          open(
            relayUrl,
            buildAuthorsRatingSyncFilter(batch, ratingSince),
            ratingScope,
            RATING_STATEMENT_KIND,
          )
        }
      }
    } finally {
      this.#opening = false
    }
  }

  async #frontierSince(
    relayUrl: string,
    liveScope: string,
    kind: number,
    overlap: number,
    nowSeconds: number,
  ): Promise<number> {
    const live = await this.#deps.cursors.getCursor(relayUrl, liveScope)
    if (live) {
      return Math.max(0, live.lastSeenCreatedAt - overlap)
    }
    const authorScopes = this.#authors.map(
      (author) => `${this.#options?.scope}:kind:${kind}:author:${author}`,
    )
    return this.#minSince(relayUrl, authorScopes, overlap, nowSeconds)
  }

  async #sinceForScope(
    relayUrl: string,
    scope: string,
    overlap: number,
    nowSeconds: number,
    firstEnableNow: boolean,
  ): Promise<number> {
    const cursor = await this.#deps.cursors.getCursor(relayUrl, scope)
    if (cursor === undefined) {
      return firstEnableNow ? Math.max(0, nowSeconds - overlap) : nowSeconds
    }
    return Math.max(0, cursor.lastSeenCreatedAt - overlap)
  }

  async #minSince(
    relayUrl: string,
    scopes: readonly string[],
    overlap: number,
    nowSeconds: number,
  ): Promise<number> {
    if (scopes.length === 0) return Math.max(0, nowSeconds - overlap)
    let min = nowSeconds
    let found = false
    for (const scope of scopes) {
      const cursor = await this.#deps.cursors.getCursor(relayUrl, scope)
      if (!cursor) continue
      found = true
      min = Math.min(min, Math.max(0, cursor.lastSeenCreatedAt - overlap))
    }
    return found ? min : Math.max(0, nowSeconds - overlap)
  }

  #trackHighWater(relayUrl: string, scope: string, createdAt: number): void {
    const key = `${relayUrl}|${scope}`
    const previous = this.#highWater.get(key) ?? 0
    if (createdAt > previous) this.#highWater.set(key, createdAt)
  }

  #ensureKindStat(kind: number): LiveKindStat {
    const current = this.#kindStats.get(kind)
    if (current) return current
    const created: LiveKindStat = { kind, received: 0, stored: 0 }
    this.#kindStats.set(kind, created)
    return created
  }

  #enqueue(item: QueuedLiveEvent): void {
    if (this.#recovering) return
    this.#trackHighWater(item.relayUrl, item.scope, item.event.created_at)
    this.#queue.push(item)
    const cap = this.#options?.queueCap ?? DEFAULT_QUEUE_CAP
    if (this.#queue.length > cap) {
      this.#recovering = true
      this.#deps.onStatus?.('partial')
      this.#closeSubscriptions('attentionx live backpressure')
      this.#flushChain = this.#flushChain
        .then(() => this.#runFlush(), () => this.#runFlush())
        .then(async () => {
          if (!this.#started) return
          this.#deps.onStatus?.('reconnecting')
          await this.#openSubscriptions()
          if (this.#started && this.#deps.client.subscribe) {
            this.#deps.onStatus?.('live')
          }
        })
        .finally(() => {
          this.#recovering = false
        })
      return
    }
    this.#flushChain = this.#flushChain.then(
      () => this.#runFlush(),
      () => this.#runFlush(),
    )
  }

  async #runFlush(): Promise<void> {
    while (this.#queue.length > 0) {
      const batch = this.#queue.splice(0, FLUSH_BATCH)
      for (const item of batch) {
        const stat = this.#ensureKindStat(item.kind)
        stat.received += 1
        const ingestResult = await this.#deps.ingest(item.event)
        if (ingestResult === 'stored') stat.stored += 1
        await this.#deps.onProvenance?.({
          relayUrl: item.relayUrl,
          eventId: item.event.id,
          observedAt: this.#clock.now(),
          ingestResult,
        })
      }
    }
  }

  async #checkpoint(
    relayUrl: string,
    scope: string,
    kind: number,
  ): Promise<void> {
    try {
      const key = `${relayUrl}|${scope}`
      const previous = await this.#deps.cursors.getCursor(relayUrl, scope)
      const lastSeenCreatedAt = Math.max(
        previous?.lastSeenCreatedAt ?? 0,
        this.#highWater.get(key) ?? 0,
      )
      const lastEoseAt = this.#clock.now()
      await this.#deps.cursors.setCursor({
        relayUrl,
        scope,
        lastSeenCreatedAt,
        lastEoseAt,
        retry: { attempts: 0 },
      })
      const stat = this.#ensureKindStat(kind)
      stat.lastCheckpoint = lastEoseAt
    } catch {
      /* worker shutdown / closed database */
    }
  }
}
