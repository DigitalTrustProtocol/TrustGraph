import {
  ResolverClient,
  type ResolverClientOptions,
  type WebSocketCloseEventLike,
  type WebSocketConstructor,
  type WebSocketLike,
  type WebSocketMessageEventLike,
} from '@dtp/resolver-client'

export const SERVER_URL = 'ws://127.0.0.1:3870/'

export function createHarness(
  options: Partial<Omit<ResolverClientOptions, 'url'>> & { server?: FakeServerOptions } = {},
): { server: FakeServer; clock: ManualClock; client: ResolverClient } {
  const { server: serverOptions, ...clientOptions } = options
  const server = new FakeServer(serverOptions)
  const clock = new ManualClock()
  const client = new ResolverClient({
    url: SERVER_URL,
    WebSocket: server.WebSocket,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: () => clock.now,
    ...clientOptions,
  })
  return { server, clock, client }
}

export type Frame = unknown[]
type Listener = (event: never) => void
export type OpHandler = (params: Record<string, unknown>, socket: FakeSocket, reqId: string) => OpReply
export type OpReply = { result: unknown } | { error: [string, string] } | 'hold'

export interface FakeServerOptions {
  /** Deliver events with `addEventListener` (default) or `on*` handlers. */
  mode?: 'listeners' | 'props'
  autoOpen?: boolean
  challenge?: string
}

export class FakeSocket implements WebSocketLike {
  readyState = 0
  readonly sent: Frame[] = []
  readonly closedWith: Array<{ code?: number; reason?: string }> = []
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: WebSocketMessageEventLike) => void) | null = null
  onclose: ((event: WebSocketCloseEventLike) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  addEventListener?: (type: string, listener: Listener) => void
  authedPubkeys = new Set<string>()
  private readonly listeners = new Map<string, Listener[]>()

  constructor(
    readonly url: string,
    readonly server: FakeServer,
  ) {
    if (server.mode === 'listeners') {
      this.addEventListener = (type, listener) => {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
      }
    }
    server.sockets.push(this)
    if (server.autoOpen) queueMicrotask(() => this.accept())
  }

  /** Server side: complete the upgrade and send the NIP-42 challenge. */
  accept(): void {
    if (this.readyState !== 0) return
    this.readyState = 1
    this.fire('open', {})
    if (this.server.challenge) this.receive(['AUTH', this.server.challenge])
  }

  /** Server side: deliver a frame to the client. */
  receive(frame: Frame): void {
    if (this.readyState !== 1) return
    this.fire('message', { data: JSON.stringify(frame) })
  }

  /** Server side: deliver an arbitrary text frame. */
  fireRaw(data: string): void {
    this.fire('message', { data })
  }

  /** Server side: drop the connection. */
  drop(code = 1006, reason = ''): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.fire('close', { code, reason })
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('socket not open')
    const frame = JSON.parse(data) as Frame
    this.sent.push(frame)
    this.server.handle(frame, this)
  }

  close(code?: number, reason?: string): void {
    this.closedWith.push({ code, reason })
    if (this.readyState === 3) return
    this.readyState = 3
    queueMicrotask(() => this.fire('close', { code: code ?? 1005, reason: reason ?? '' }))
  }

  framesOf(type: string): Frame[] {
    return this.sent.filter((frame) => frame[0] === type)
  }

  dtp(op: string): Frame[] {
    return this.sent.filter((frame) => frame[0] === 'DTP' && frame[2] === op)
  }

  private fire(type: 'open' | 'message' | 'close', event: object): void {
    if (this.server.mode === 'listeners') {
      for (const listener of this.listeners.get(type) ?? []) (listener as (event: object) => void)(event)
      return
    }
    const handler = { open: this.onopen, message: this.onmessage, close: this.onclose }[type]
    ;(handler as ((event: object) => void) | null)?.(event)
  }
}

/** Scripted resolver server: DTP ops by name, plus hooks for EVENT / AUTH / REQ. */
export class FakeServer {
  readonly sockets: FakeSocket[] = []
  readonly mode: 'listeners' | 'props'
  autoOpen: boolean
  challenge: string | undefined
  instanceId = 'instance-a'
  readonly ops = new Map<string, OpHandler>()
  onEvent?: (event: { id: string }, socket: FakeSocket) => [boolean, string] | 'hold'
  onAuth?: (event: { id: string; pubkey: string }, socket: FakeSocket) => [boolean, string]
  onReq?: (subId: string, filters: unknown[], socket: FakeSocket) => void

  constructor(options: FakeServerOptions = {}) {
    this.mode = options.mode ?? 'listeners'
    this.autoOpen = options.autoOpen ?? true
    this.challenge = options.challenge ?? 'challenge-1'
    this.ops.set('info', () => ({ result: { instanceId: this.instanceId, graphVersion: 1 } }))
    this.ops.set('session.update', (params) => ({ result: { defaults: params.defaults } }))
    this.ops.set('subscribe', (params) => ({ result: { topics: params.topics } }))
    this.ops.set('unsubscribe', (params) => ({ result: { topics: params.topics } }))
  }

  get WebSocket(): WebSocketConstructor {
    return socketClassFor(this)
  }

  get last(): FakeSocket {
    const socket = this.sockets.at(-1)
    if (!socket) throw new Error('no socket yet')
    return socket
  }

  handle(frame: Frame, socket: FakeSocket): void {
    const reply = (out: Frame): void => queueMicrotask(() => socket.receive(out))
    switch (frame[0]) {
      case 'DTP': {
        const [, reqId, op, params] = frame as [string, string, string, Record<string, unknown>]
        const handler = this.ops.get(op)
        const outcome = handler ? handler(params, socket, reqId) : { error: ['invalid', 'invalid: unknown op'] as [string, string] }
        if (outcome === 'hold') return
        if ('result' in outcome) reply(['DTP-OK', reqId, outcome.result])
        else reply(['DTP-ERR', reqId, outcome.error[0], outcome.error[1]])
        return
      }
      case 'EVENT': {
        const event = frame[1] as { id: string }
        const outcome = this.onEvent?.(event, socket) ?? [true, '']
        if (outcome !== 'hold') reply(['OK', event.id, outcome[0], outcome[1]])
        return
      }
      case 'AUTH': {
        const event = frame[1] as { id: string; pubkey: string }
        const [ok, message] = this.onAuth?.(event, socket) ?? [true, '']
        if (ok) socket.authedPubkeys.add(event.pubkey)
        reply(['OK', event.id, ok, message])
        return
      }
      case 'REQ': {
        const [, subId, ...filters] = frame as [string, string, ...unknown[]]
        this.onReq?.(subId, filters, socket)
        return
      }
      default:
        return
    }
  }
}

function socketClassFor(server: FakeServer): WebSocketConstructor {
  return class extends FakeSocket {
    constructor(url: string) {
      super(url, server)
    }
  }
}

/** Injected timers: `advance` runs due callbacks in time order. */
export class ManualClock {
  now = 1_790_000_000_000
  private nextId = 1
  readonly timers = new Map<number, { at: number; ms: number; callback: () => void }>()

  readonly setTimeout = (callback: () => void, ms: number): unknown => {
    const id = this.nextId++
    this.timers.set(id, { at: this.now + ms, ms, callback })
    return id
  }

  readonly clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number)
  }

  delays(): number[] {
    return [...this.timers.values()].map((timer) => timer.ms)
  }

  advance(ms: number): void {
    const target = this.now + ms
    for (;;) {
      let nextId: number | undefined
      let nextAt = Infinity
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && timer.at < nextAt) {
          nextAt = timer.at
          nextId = id
        }
      }
      if (nextId === undefined) break
      const timer = this.timers.get(nextId)!
      this.timers.delete(nextId)
      this.now = timer.at
      timer.callback()
    }
    this.now = target
  }
}

/** Drain every queued microtask (socket open, server replies, client continuations). */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
