// Ported from AttentionX src/relay/types.ts (imports rewritten for @dtp/* packages).
import type { Event, Filter } from 'nostr-tools'

export interface RelayQueryRequest {
  relayUrl: string
  filter: Filter
  /**
   * Implementations must await event handling and resolve only after EOSE (or
   * the equivalent completed-query signal). Reject on disconnect or timeout.
   */
  onEvent: (event: Event) => void | Promise<void>
  signal?: AbortSignal
}

export interface RelayQueryClient {
  query(request: RelayQueryRequest): Promise<void>
}

export interface RelaySubscribeRequest {
  relayUrl: string
  filter: Filter
  onEvent: (event: Event) => void | Promise<void>
  onEose?: () => void
  onClose?: (reason: string) => void
  signal?: AbortSignal
}

export interface RelaySubscription {
  close(reason?: string): void
}

export interface RelaySubscribeClient {
  subscribe(request: RelaySubscribeRequest): RelaySubscription
  /** Close the websocket after this relay leaves the active list. */
  releaseRelay?(relayUrl: string): void
}

export interface GraphFrontierReader {
  positiveChildren(
    authors: readonly string[],
    nowSeconds: number,
  ): string[]
  authorsFromRoots(
    roots: readonly string[],
    nowSeconds: number,
    limits: {
      maxDepth: number
      maxAuthorsPerLevel: number
      maxTotalAuthors: number
    },
  ): { authors: string[]; reasons: string[] }
}

export interface SyncCursorRetry {
  attempts: number
  nextRetryAt?: number
  lastError?: string
}

export interface SyncCursor {
  relayUrl: string
  scope: string
  lastSeenCreatedAt: number
  lastEoseAt: number
  retry?: SyncCursorRetry
}

export interface SyncCursorRepository {
  getCursor(relayUrl: string, scope: string): Promise<SyncCursor | undefined>
  setCursor(cursor: SyncCursor): Promise<void>
}

export type EventIngestResult = 'stored' | 'duplicate' | 'rejected'

export interface RelayEventRepository {
  /**
   * Validate and atomically store an event by ID. Invalid events return
   * `rejected`; an ID already in durable storage returns `duplicate`.
   */
  ingestEvent(event: Event): Promise<EventIngestResult>
  listEventsByAuthor(author: string, kind: number): Promise<readonly Event[]>
}

export interface RelayProvenance {
  relayUrl: string
  eventId: string
  observedAt: number
  ingestResult: EventIngestResult
}

export interface RetryPolicy {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  multiplier: number
  jitterRatio: number
}

export interface RetryNotice {
  relayUrl: string
  scope: string
  attempt: number
  delayMs: number
  error: unknown
}

export interface Clock {
  now(): number
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (milliseconds, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        return
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, milliseconds)
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    }),
}
