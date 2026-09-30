import type {
  LookupCountsParams,
  LookupCountsResult,
  LookupPage,
  LookupParams,
  NeighborhoodParams,
  WireRatingResult,
  WireTrustResult,
} from '@dtp/trust-query'
import { ResolverError, errorCodeFromMessage, isResolverErrorCode } from './errors'
import {
  WEBSOCKET_OPEN,
  type WebSocketCloseEventLike,
  type WebSocketConstructor,
  type WebSocketLike,
  type WebSocketMessageEventLike,
} from './socket'
import type {
  FrontierLookupResult,
  FrontierParams,
  GraphFieldParams,
  GraphFieldResult,
  IdentityClaimsParams,
  IdentityClaimsResult,
  LookupBatchParams,
  LookupBatchResult,
  NeighborhoodLookupResult,
  PublishResult,
  RatingBatchParams,
  RatingBatchResult,
  RatingQueryParams,
  ResolverInfo,
  ResolverSigner,
  SessionDefaults,
  SessionUpdateResult,
  SignedEvent,
  TopicsResult,
  TrustBatchParams,
  TrustBatchResult,
  TrustQueryParams,
} from './types'

export const NIP42_AUTH_KIND = 22242

export interface ReconnectOptions {
  /** First backoff delay. Default 500 ms. */
  minDelayMs?: number
  /** Backoff cap. Default 30 000 ms. */
  maxDelayMs?: number
  /** Relative jitter in [0, 1]: delay × (1 ± jitter). Default 0.2. */
  jitter?: number
  /** Uniform [0, 1) source. Default `Math.random`. */
  random?: () => number
}

export interface ResolverClientOptions {
  /** Server WebSocket URL; also the NIP-42 `relay` tag. */
  url: string
  /** Default `globalThis.WebSocket`. */
  WebSocket?: WebSocketConstructor
  signer?: ResolverSigner
  /** Per-request deadline. Default 1 500 ms. */
  requestTimeoutMs?: number
  /** Socket open deadline. Default `requestTimeoutMs`. */
  connectTimeoutMs?: number
  reconnect?: ReconnectOptions
  /** Sent as `session.update` on every (re)connect. */
  sessionDefaults?: SessionDefaults
  /** Close the socket after this long without in-flight work or subscriptions. Default null (never). */
  idleCloseMs?: number | null
  /** Milliseconds since the epoch, like `Date.now`. */
  now?: () => number
  setTimeout?: (callback: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

export interface RequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

export interface CloseInfo {
  code: number
  reason: string
  willReconnect: boolean
}

export interface InstanceChange {
  previous: string
  current: string
}

export interface PushMessage {
  topic: string
  data: unknown
}

export interface ResolverClientEvents {
  open: undefined
  close: CloseInfo
  push: PushMessage
  instanceChanged: InstanceChange
  notice: string
}

export type ResolverClientEventName = keyof ResolverClientEvents
export type PushHandler = (data: unknown, topic: string) => void
export type Unsubscribe = () => Promise<void>

interface Waiter<T> {
  resolve(value: T): void
  reject(error: ResolverError): void
  cleanup(): void
}

interface ReadState extends Waiter<SignedEvent[]> {
  events: SignedEvent[]
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

type ListenerSets = {
  [K in ResolverClientEventName]?: Set<(payload: ResolverClientEvents[K]) => void>
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function noop(): void {}

function closedError(): ResolverError {
  return new ResolverError('error', 'connection closed')
}

/** JSON with sorted object keys, so JSON-equal params share one key. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const fields = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function isSignedEvent(value: unknown): value is SignedEvent {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string'
  )
}

/**
 * One WebSocket to a resolver server (resolver-api.md): pipelined `DTP`
 * operations, NIP-01 `EVENT` / `REQ`, NIP-42 with a caller signer, push
 * subscriptions, reconnect with backoff, and optional idle close.
 */
export class ResolverClient {
  readonly url: string
  private readonly WebSocketCtor: WebSocketConstructor | undefined
  private readonly signer: ResolverSigner | undefined
  private readonly requestTimeoutMs: number
  private readonly connectTimeoutMs: number
  private readonly minDelayMs: number
  private readonly maxDelayMs: number
  private readonly jitter: number
  private readonly random: () => number
  private readonly idleCloseMs: number | null
  private readonly now: () => number
  private readonly setTimer: (callback: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  private ws: WebSocketLike | undefined
  private connecting: Deferred<void> | undefined
  private connectTimer: unknown
  private idleTimer: unknown
  private reconnectTimer: unknown
  private reconnectAttempt = 0
  private seq = 0
  private challenge: string | undefined
  private readonly challengeWaiters = new Set<Waiter<string>>()
  private authInFlight: Promise<void> | undefined
  private defaults: SessionDefaults | undefined
  private sessionSync:
    | { defaults: SessionDefaults; socket: WebSocketLike; promise: Promise<SessionUpdateResult> }
    | undefined
  private knownInstanceId: string | undefined
  private readonly pending = new Map<string, Waiter<unknown>>()
  private readonly coalesced = new Map<string, Promise<unknown>>()
  private readonly okWaiters = new Map<string, Array<Waiter<PublishResult>>>()
  private readonly reads = new Map<string, ReadState>()
  private readonly topics = new Map<string, Set<PushHandler>>()
  private readonly listeners: ListenerSets = {}

  constructor(options: ResolverClientOptions) {
    this.url = options.url
    this.WebSocketCtor = options.WebSocket
    this.signer = options.signer
    this.requestTimeoutMs = options.requestTimeoutMs ?? 1_500
    this.connectTimeoutMs = options.connectTimeoutMs ?? this.requestTimeoutMs
    this.minDelayMs = options.reconnect?.minDelayMs ?? 500
    this.maxDelayMs = options.reconnect?.maxDelayMs ?? 30_000
    this.jitter = Math.min(1, Math.max(0, options.reconnect?.jitter ?? 0.2))
    this.random = options.reconnect?.random ?? Math.random
    this.idleCloseMs = options.idleCloseMs ?? null
    this.defaults = options.sessionDefaults
    this.now = options.now ?? Date.now
    this.setTimer = options.setTimeout ?? ((callback, ms) => globalThis.setTimeout(callback, ms))
    this.clearTimer =
      options.clearTimeout ??
      ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  get connected(): boolean {
    return this.ws?.readyState === WEBSOCKET_OPEN && this.connecting === undefined
  }

  /** `instanceId` from the latest `info` answer. */
  get instanceId(): string | undefined {
    return this.knownInstanceId
  }

  on<K extends ResolverClientEventName>(
    event: K,
    listener: (payload: ResolverClientEvents[K]) => void,
  ): () => void {
    const sets = this.listeners as Record<K, Set<(payload: ResolverClientEvents[K]) => void>>
    const set = (sets[event] ??= new Set())
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  }

  connect(): Promise<void> {
    return this.ensureOpen()
  }

  /** Close the socket and stop reconnecting; the next request opens a new one. */
  close(): void {
    this.clearReconnect()
    this.reconnectAttempt = 0
    this.closeSocket(1000, 'client close')
  }

  request<T>(op: string, params: object = {}, options: RequestOptions = {}): Promise<T> {
    if (options.signal) return this.withAuthRetry(() => this.requestOnce<T>(op, params, options))
    const key = `${op}\n${canonicalJson(params)}`
    const existing = this.coalesced.get(key)
    if (existing) return existing as Promise<T>
    const promise: Promise<T> = this.withAuthRetry(() =>
      this.requestOnce<T>(op, params, options),
    ).finally(() => {
      if (this.coalesced.get(key) === promise) this.coalesced.delete(key)
    })
    this.coalesced.set(key, promise)
    return promise
  }

  trustQuery(params: TrustQueryParams, options?: RequestOptions): Promise<WireTrustResult> {
    return this.request('trust.query', params, options)
  }

  trustBatch(params: TrustBatchParams, options?: RequestOptions): Promise<TrustBatchResult> {
    return this.request('trust.batch', params, options)
  }

  ratingQuery(params: RatingQueryParams, options?: RequestOptions): Promise<WireRatingResult> {
    return this.request('rating.query', params, options)
  }

  ratingBatch(params: RatingBatchParams, options?: RequestOptions): Promise<RatingBatchResult> {
    return this.request('rating.batch', params, options)
  }

  graphField(params: GraphFieldParams = {}, options?: RequestOptions): Promise<GraphFieldResult> {
    return this.request('graph.field', params, options)
  }

  lookupIncoming(params: LookupParams, options?: RequestOptions): Promise<LookupPage> {
    return this.request('lookup.incoming', params, options)
  }

  lookupOutgoing(params: LookupParams, options?: RequestOptions): Promise<LookupPage> {
    return this.request('lookup.outgoing', params, options)
  }

  lookupCounts(params: LookupCountsParams, options?: RequestOptions): Promise<LookupCountsResult> {
    return this.request('lookup.counts', params, options)
  }

  lookupBatch(params: LookupBatchParams, options?: RequestOptions): Promise<LookupBatchResult> {
    return this.request('lookup.batch', params, options)
  }

  neighborhood(
    params: NeighborhoodParams,
    options?: RequestOptions,
  ): Promise<NeighborhoodLookupResult> {
    return this.request('graph.neighborhood', params, options)
  }

  frontier(params: FrontierParams, options?: RequestOptions): Promise<FrontierLookupResult> {
    return this.request('graph.frontier', params, options)
  }

  identityClaims(
    params: IdentityClaimsParams,
    options?: RequestOptions,
  ): Promise<IdentityClaimsResult> {
    return this.request('identity.claims', params, options)
  }

  async info(options?: RequestOptions): Promise<ResolverInfo> {
    const info = await this.request<ResolverInfo>('info', {}, options)
    this.noteInstance(info)
    return info
  }

  /** Stores `defaults` (replacing earlier ones) and re-sends them after every reconnect. */
  async sessionUpdate(
    defaults: SessionDefaults,
    options?: RequestOptions,
  ): Promise<SessionUpdateResult> {
    this.defaults = defaults
    await this.ensureOpen()
    const current = this.defaults
    const socket = this.ws
    if (!socket) throw closedError()
    if (this.sessionSync?.defaults !== current || this.sessionSync.socket !== socket) {
      this.sessionSync = {
        defaults: current,
        socket,
        promise: this.request<SessionUpdateResult>('session.update', { defaults: current }, options),
      }
    }
    return this.sessionSync.promise
  }

  /** Adds `handler` for `topics`; only topics new to this client are sent as `subscribe`. */
  async subscribe(topics: string[], handler: PushHandler): Promise<Unsubscribe> {
    const wanted = [...new Set(topics)]
    await this.ensureOpen()
    const added: string[] = []
    for (const topic of wanted) {
      let handlers = this.topics.get(topic)
      if (!handlers) {
        handlers = new Set()
        this.topics.set(topic, handlers)
        added.push(topic)
      }
      handlers.add(handler)
    }
    this.clearIdle()
    if (added.length > 0) {
      try {
        await this.request<TopicsResult>('subscribe', { topics: added })
      } catch (error) {
        this.removeHandler(wanted, handler)
        this.scheduleIdle()
        throw error
      }
    }
    let active = true
    return async () => {
      if (!active) return
      active = false
      const removed = this.removeHandler(wanted, handler)
      if (removed.length > 0 && this.connected) {
        await this.request<TopicsResult>('unsubscribe', { topics: removed }).catch(noop)
      }
      this.scheduleIdle()
    }
  }

  /** `["EVENT", event]`; resolves with the server's `OK`. Never rejects on `OK false`. */
  async publish(event: SignedEvent, options: { timeoutMs?: number } = {}): Promise<PublishResult> {
    const first = await this.publishOnce(event, options)
    if (first.accepted || !this.signer || errorCodeFromMessage(first.message) !== 'auth-required') {
      return first
    }
    await this.authenticate()
    return this.publishOnce(event, options)
  }

  /** `["REQ", sub, ...filters]`; collects events until `EOSE`, then sends `CLOSE`. */
  req(filters: object[], options: { timeoutMs?: number } = {}): Promise<SignedEvent[]> {
    return this.withAuthRetry(() => this.readOnce(filters, options))
  }

  /** NIP-42: sign kind 22242 for the current challenge; concurrent calls share one `AUTH`. */
  authenticate(): Promise<void> {
    const signer = this.signer
    if (!signer) {
      return Promise.reject(new ResolverError('auth-required', 'auth-required: no signer configured'))
    }
    this.authInFlight ??= this.runAuth(signer).finally(() => {
      this.authInFlight = undefined
      this.scheduleIdle()
    })
    return this.authInFlight
  }

  private async runAuth(signer: ResolverSigner): Promise<void> {
    await this.ensureOpen()
    const challenge = await this.waitForChallenge()
    const event = await signer.signEvent({
      kind: NIP42_AUTH_KIND,
      created_at: Math.floor(this.now() / 1000),
      tags: [
        ['relay', this.url],
        ['challenge', challenge],
      ],
      content: '',
    })
    const result = await this.awaitOk(['AUTH', event], event.id, this.requestTimeoutMs)
    if (!result.accepted) {
      throw new ResolverError(
        errorCodeFromMessage(result.message, 'auth-required'),
        result.message || 'auth-required: rejected',
      )
    }
  }

  private async withAuthRetry<T>(attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt()
    } catch (error) {
      if (!(error instanceof ResolverError) || error.code !== 'auth-required' || !this.signer) {
        throw error
      }
      await this.authenticate()
      return attempt()
    }
  }

  private async requestOnce<T>(op: string, params: object, options: RequestOptions): Promise<T> {
    if (options.signal?.aborted) throw new ResolverError('cancelled', `cancelled: ${op}`)
    await this.ensureOpen()
    return this.sendDtp<T>(op, params, options)
  }

  /** Sends synchronously on the open socket, so frames keep call order on the wire. */
  private sendDtp<T>(op: string, params: object, options: RequestOptions = {}): Promise<T> {
    const ws = this.ws
    if (!ws || !this.connected) return Promise.reject(closedError())
    const { signal } = options
    if (signal?.aborted) return Promise.reject(new ResolverError('cancelled', `cancelled: ${op}`))
    const reqId = String(++this.seq)
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs
    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter<unknown> = {
        resolve: (value) => resolve(value as T),
        reject,
        cleanup: noop,
      }
      const abandon = (error: ResolverError): void => {
        if (this.pending.get(reqId) !== waiter) return
        this.pending.delete(reqId)
        waiter.cleanup()
        this.trySend(ws, ['DTP-CANCEL', reqId])
        reject(error)
        this.scheduleIdle()
      }
      const timer = this.setTimer(
        () => abandon(new ResolverError('timeout', `timeout: ${op} after ${timeoutMs} ms`)),
        timeoutMs,
      )
      const onAbort = (): void => abandon(new ResolverError('cancelled', `cancelled: ${op}`))
      signal?.addEventListener('abort', onAbort, { once: true })
      waiter.cleanup = () => {
        this.clearTimer(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      this.pending.set(reqId, waiter)
      this.clearIdle()
      if (!this.trySend(ws, ['DTP', reqId, op, params])) {
        this.pending.delete(reqId)
        waiter.cleanup()
        reject(closedError())
      }
    })
  }

  private async publishOnce(
    event: SignedEvent,
    options: { timeoutMs?: number },
  ): Promise<PublishResult> {
    await this.ensureOpen()
    return this.awaitOk(['EVENT', event], event.id, options.timeoutMs ?? this.requestTimeoutMs)
  }

  /** Same-id `EVENT`s in flight share one frame and one `OK`. */
  private awaitOk(
    frame: ['EVENT' | 'AUTH', SignedEvent],
    eventId: string,
    timeoutMs: number,
  ): Promise<PublishResult> {
    const ws = this.ws
    if (!ws || !this.connected) return Promise.reject(closedError())
    return new Promise<PublishResult>((resolve, reject) => {
      const waiter: Waiter<PublishResult> = { resolve, reject, cleanup: noop }
      const timer = this.setTimer(() => {
        const list = this.okWaiters.get(eventId)
        const index = list?.indexOf(waiter) ?? -1
        if (!list || index < 0) return
        list.splice(index, 1)
        if (list.length === 0) this.okWaiters.delete(eventId)
        reject(new ResolverError('timeout', `timeout: no OK for ${eventId} after ${timeoutMs} ms`))
        this.scheduleIdle()
      }, timeoutMs)
      waiter.cleanup = () => this.clearTimer(timer)
      const list = this.okWaiters.get(eventId)
      if (list) {
        list.push(waiter)
        if (frame[0] === 'EVENT') return
      } else {
        this.okWaiters.set(eventId, [waiter])
      }
      this.clearIdle()
      if (!this.trySend(ws, frame)) this.settleOk(eventId, closedError())
    })
  }

  private async readOnce(filters: object[], options: { timeoutMs?: number }): Promise<SignedEvent[]> {
    await this.ensureOpen()
    const ws = this.ws
    if (!ws || !this.connected) throw closedError()
    const subId = `r${++this.seq}`
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs
    return new Promise<SignedEvent[]>((resolve, reject) => {
      const state: ReadState = { events: [], resolve, reject, cleanup: noop }
      const timer = this.setTimer(() => {
        if (this.reads.get(subId) !== state) return
        this.reads.delete(subId)
        this.trySend(ws, ['CLOSE', subId])
        reject(new ResolverError('timeout', `timeout: REQ ${subId} after ${timeoutMs} ms`))
        this.scheduleIdle()
      }, timeoutMs)
      state.cleanup = () => this.clearTimer(timer)
      this.reads.set(subId, state)
      this.clearIdle()
      if (!this.trySend(ws, ['REQ', subId, ...filters])) {
        this.reads.delete(subId)
        state.cleanup()
        reject(closedError())
      }
    })
  }

  private waitForChallenge(): Promise<string> {
    if (this.challenge !== undefined) return Promise.resolve(this.challenge)
    return new Promise<string>((resolve, reject) => {
      const waiter: Waiter<string> = { resolve, reject, cleanup: noop }
      const timer = this.setTimer(() => {
        if (!this.challengeWaiters.delete(waiter)) return
        reject(new ResolverError('auth-required', 'auth-required: no AUTH challenge from server'))
      }, this.requestTimeoutMs)
      waiter.cleanup = () => this.clearTimer(timer)
      this.challengeWaiters.add(waiter)
    })
  }

  private ensureOpen(): Promise<void> {
    if (this.connecting) return this.connecting.promise
    if (this.ws?.readyState === WEBSOCKET_OPEN) return Promise.resolve()
    return this.open()
  }

  private open(): Promise<void> {
    this.clearReconnect()
    if (this.ws) this.handleClose(this.ws, 1006, 'socket not open', false)
    const Ctor =
      this.WebSocketCtor ??
      (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket
    let ws: WebSocketLike
    try {
      if (!Ctor) throw new Error('no WebSocket implementation')
      ws = new Ctor(this.url)
    } catch (error) {
      if (this.topics.size > 0) this.scheduleReconnect()
      const reason = error instanceof Error ? error.message : String(error)
      return Promise.reject(new ResolverError('error', `connect failed: ${reason}`))
    }
    const connecting = deferred<void>()
    connecting.promise.catch(noop)
    this.ws = ws
    this.connecting = connecting
    this.challenge = undefined
    this.connectTimer = this.setTimer(() => {
      this.connectTimer = undefined
      if (this.ws !== ws || this.connecting !== connecting) return
      this.handleClose(ws, 1006, 'connect timeout', true)
      try {
        ws.close()
      } catch {
        // The socket may already be failing.
      }
    }, this.connectTimeoutMs)
    this.attach(ws)
    return connecting.promise
  }

  private attach(ws: WebSocketLike): void {
    const onOpen = (): void => this.handleOpen(ws)
    const onMessage = (event: WebSocketMessageEventLike | undefined): void =>
      this.handleMessage(ws, event?.data)
    const onClose = (event: WebSocketCloseEventLike | undefined): void =>
      this.handleClose(ws, event?.code ?? 1006, event?.reason ?? '', true)
    if (typeof ws.addEventListener === 'function') {
      ws.addEventListener('open', onOpen)
      ws.addEventListener('message', onMessage)
      ws.addEventListener('close', onClose)
    } else {
      ws.onopen = onOpen
      ws.onmessage = onMessage
      ws.onclose = onClose
    }
  }

  private handleOpen(ws: WebSocketLike): void {
    if (ws !== this.ws) return
    this.clearConnectTimer()
    this.reconnectAttempt = 0
    const connecting = this.connecting
    this.connecting = undefined
    this.restoreSession(ws)
    connecting?.resolve()
    this.emit('open', undefined)
    this.scheduleIdle()
  }

  /** resolver-api.md § Keepalive, idle, reconnect: defaults, topics, then `info`. */
  private restoreSession(ws: WebSocketLike): void {
    if (this.defaults) {
      const defaults = this.defaults
      const promise = this.restoreCall<SessionUpdateResult>('session.update', { defaults })
      promise.catch(noop)
      this.sessionSync = { defaults, socket: ws, promise }
    }
    if (this.topics.size > 0) {
      this.restoreCall<TopicsResult>('subscribe', { topics: [...this.topics.keys()] }).catch(noop)
    }
    this.restoreCall<ResolverInfo>('info', {}).then((info) => this.noteInstance(info), noop)
  }

  private restoreCall<T>(op: string, params: object): Promise<T> {
    return this.sendDtp<T>(op, params).catch((error: unknown) => {
      if (!(error instanceof ResolverError) || error.code !== 'auth-required' || !this.signer) {
        throw error
      }
      return this.authenticate().then(() => this.requestOnce<T>(op, params, {}))
    })
  }

  private noteInstance(info: ResolverInfo | undefined): void {
    const current = info?.instanceId
    if (typeof current !== 'string') return
    const previous = this.knownInstanceId
    this.knownInstanceId = current
    if (previous !== undefined && previous !== current) {
      this.emit('instanceChanged', { previous, current })
    }
  }

  private handleMessage(ws: WebSocketLike, data: unknown): void {
    if (ws !== this.ws || typeof data !== 'string') return
    let message: unknown
    try {
      message = JSON.parse(data)
    } catch {
      return
    }
    if (!Array.isArray(message) || typeof message[0] !== 'string') return
    const [type, first, second, third] = message as [string, unknown, unknown, unknown]
    switch (type) {
      case 'DTP-OK':
        this.settleDtp(first, (waiter) => waiter.resolve(second))
        break
      case 'DTP-ERR': {
        const code = isResolverErrorCode(second) ? second : 'error'
        const text = typeof third === 'string' ? third : String(second)
        this.settleDtp(first, (waiter) => waiter.reject(new ResolverError(code, text)))
        break
      }
      case 'DTP-PUSH':
        if (typeof first === 'string') this.dispatchPush(first, second)
        break
      case 'AUTH':
        if (typeof first === 'string') this.receiveChallenge(first)
        break
      case 'OK':
        if (typeof first === 'string') {
          this.settleOk(first, {
            accepted: second === true,
            message: typeof third === 'string' ? third : '',
          })
        }
        break
      case 'EVENT':
        if (typeof first === 'string' && isSignedEvent(second)) {
          this.reads.get(first)?.events.push(second)
        }
        break
      case 'EOSE':
        if (typeof first === 'string') this.finishRead(ws, first)
        break
      case 'CLOSED':
        if (typeof first === 'string') this.failRead(first, second)
        break
      case 'NOTICE':
        if (typeof first === 'string') this.emit('notice', first)
        break
      default:
        break
    }
  }

  private settleDtp(reqId: unknown, settle: (waiter: Waiter<unknown>) => void): void {
    if (typeof reqId !== 'string') return
    const waiter = this.pending.get(reqId)
    if (!waiter) return
    this.pending.delete(reqId)
    waiter.cleanup()
    settle(waiter)
    this.scheduleIdle()
  }

  private settleOk(eventId: string, outcome: PublishResult | ResolverError): void {
    const waiters = this.okWaiters.get(eventId)
    if (!waiters) return
    this.okWaiters.delete(eventId)
    for (const waiter of waiters) {
      waiter.cleanup()
      if (outcome instanceof ResolverError) waiter.reject(outcome)
      else waiter.resolve(outcome)
    }
    this.scheduleIdle()
  }

  private finishRead(ws: WebSocketLike, subId: string): void {
    const state = this.reads.get(subId)
    if (!state) return
    this.reads.delete(subId)
    state.cleanup()
    this.trySend(ws, ['CLOSE', subId])
    state.resolve(state.events)
    this.scheduleIdle()
  }

  private failRead(subId: string, message: unknown): void {
    const state = this.reads.get(subId)
    if (!state) return
    this.reads.delete(subId)
    state.cleanup()
    const text = typeof message === 'string' ? message : 'error: closed'
    state.reject(new ResolverError(errorCodeFromMessage(text), text))
    this.scheduleIdle()
  }

  private receiveChallenge(challenge: string): void {
    this.challenge = challenge
    for (const waiter of this.challengeWaiters) {
      waiter.cleanup()
      waiter.resolve(challenge)
    }
    this.challengeWaiters.clear()
  }

  private dispatchPush(topic: string, data: unknown): void {
    for (const handler of this.topics.get(topic) ?? []) {
      try {
        handler(data, topic)
      } catch {
        // A failing subscriber must not break dispatch to the others.
      }
    }
    this.emit('push', { topic, data })
  }

  private removeHandler(topics: string[], handler: PushHandler): string[] {
    const removed: string[] = []
    for (const topic of topics) {
      const handlers = this.topics.get(topic)
      if (!handlers) continue
      handlers.delete(handler)
      if (handlers.size === 0) {
        this.topics.delete(topic)
        removed.push(topic)
      }
    }
    return removed
  }

  private handleClose(ws: WebSocketLike, code: number, reason: string, mayReconnect: boolean): void {
    if (ws !== this.ws) return
    this.ws = undefined
    this.challenge = undefined
    this.clearConnectTimer()
    this.clearIdle()
    const error = closedError()
    const connecting = this.connecting
    this.connecting = undefined
    connecting?.reject(error)
    this.rejectAll(error)
    const willReconnect = mayReconnect && this.topics.size > 0
    this.emit('close', { code, reason, willReconnect })
    if (willReconnect) this.scheduleReconnect()
  }

  private rejectAll(error: ResolverError): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const waiter of pending) {
      waiter.cleanup()
      waiter.reject(error)
    }
    const okWaiters = [...this.okWaiters.values()].flat()
    this.okWaiters.clear()
    for (const waiter of okWaiters) {
      waiter.cleanup()
      waiter.reject(error)
    }
    const reads = [...this.reads.values()]
    this.reads.clear()
    for (const state of reads) {
      state.cleanup()
      state.reject(error)
    }
    const challengeWaiters = [...this.challengeWaiters]
    this.challengeWaiters.clear()
    for (const waiter of challengeWaiters) {
      waiter.cleanup()
      waiter.reject(error)
    }
  }

  private closeSocket(code: number, reason: string): void {
    const ws = this.ws
    if (!ws) return
    this.handleClose(ws, code, reason, false)
    try {
      ws.close(code, reason)
    } catch {
      // Already closing.
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined) return
    const base = Math.min(this.maxDelayMs, this.minDelayMs * 2 ** this.reconnectAttempt)
    const spread = 1 + this.jitter * (2 * this.random() - 1)
    const delay = Math.max(0, Math.min(this.maxDelayMs, base * spread))
    this.reconnectAttempt += 1
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = undefined
      if (this.topics.size === 0 || this.ws) return
      this.open().catch(noop)
    }, delay)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer === undefined) return
    this.clearTimer(this.reconnectTimer)
    this.reconnectTimer = undefined
  }

  private clearConnectTimer(): void {
    if (this.connectTimer === undefined) return
    this.clearTimer(this.connectTimer)
    this.connectTimer = undefined
  }

  private isBusy(): boolean {
    return (
      this.pending.size > 0 ||
      this.okWaiters.size > 0 ||
      this.reads.size > 0 ||
      this.topics.size > 0 ||
      this.authInFlight !== undefined ||
      this.connecting !== undefined
    )
  }

  private scheduleIdle(): void {
    if (this.idleCloseMs === null || !this.connected || this.isBusy()) return
    this.clearIdle()
    const ws = this.ws
    this.idleTimer = this.setTimer(() => {
      this.idleTimer = undefined
      if (ws === this.ws && !this.isBusy()) this.closeSocket(1000, 'idle')
    }, this.idleCloseMs)
  }

  private clearIdle(): void {
    if (this.idleTimer === undefined) return
    this.clearTimer(this.idleTimer)
    this.idleTimer = undefined
  }

  private trySend(ws: WebSocketLike, frame: unknown[]): boolean {
    if (ws !== this.ws || ws.readyState !== WEBSOCKET_OPEN) return false
    try {
      ws.send(JSON.stringify(frame))
      return true
    } catch {
      return false
    }
  }

  private emit<K extends ResolverClientEventName>(event: K, payload: ResolverClientEvents[K]): void {
    const set = this.listeners[event] as Set<(payload: ResolverClientEvents[K]) => void> | undefined
    if (!set) return
    for (const listener of [...set]) {
      try {
        listener(payload)
      } catch {
        // Listener errors stay with the listener.
      }
    }
  }
}
