import {
  ResolverError,
  type CloseInfo,
  type InstanceChange,
  type PushMessage,
  type WebSocketConstructor,
} from '@dtp/resolver-client'
import { describe, expect, it } from 'vitest'
import { createHarness, flush } from './fake-server'

const ROOT = 'a'.repeat(64)

async function rejection(promise: Promise<unknown>): Promise<ResolverError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(ResolverError)
  return error as ResolverError
}

describe('socket compatibility', () => {
  it('accepts the platform WebSocket constructor type', () => {
    const ctor: WebSocketConstructor | undefined = globalThis.WebSocket
    expect(typeof ctor).toBe('function')
  })

  it('works with on* handler sockets', async () => {
    const { server, client } = createHarness({ server: { mode: 'props' } })
    server.instanceId = 'props'
    expect((await client.info()).instanceId).toBe('props')
  })
})

describe('session defaults', () => {
  it('sends one session.update when called before the socket opens', async () => {
    const { server, client } = createHarness()
    const defaults = { rootPubkey: ROOT, bounds: { maxDepth: 4 } }
    expect(await client.sessionUpdate(defaults)).toEqual({ defaults })
    expect(server.last.dtp('session.update')).toHaveLength(1)
    const next = { rootPubkey: ROOT, statementLimit: 20 }
    await client.sessionUpdate(next)
    expect(server.last.dtp('session.update').map((frame) => frame[3])).toEqual([
      { defaults },
      { defaults: next },
    ])
  })

  it('sends constructor defaults first on connect', async () => {
    const defaults = { rootPubkey: ROOT, bindingMode: 'strict' as const }
    const { server, client } = createHarness({ sessionDefaults: defaults })
    server.ops.set('trust.query', () => ({ result: {} }))
    await client.trustQuery({ subject: { type: 'p', value: ROOT } })
    const ops = server.last.framesOf('DTP').map((frame) => frame[2])
    expect(ops[0]).toBe('session.update')
    expect(server.last.dtp('session.update')[0]![3]).toEqual({ defaults })
  })
})

describe('subscriptions', () => {
  it('dispatches DTP-PUSH to topic handlers and unsubscribes per topic', async () => {
    const { server, client } = createHarness()
    const first: unknown[] = []
    const second: unknown[] = []
    const all: PushMessage[] = []
    client.on('push', (message) => all.push(message))
    const offFirst = await client.subscribe(['graph', 'coverage'], (data) => first.push(data))
    const offSecond = await client.subscribe(['graph'], (data) => second.push(data))
    expect(server.last.dtp('subscribe').map((frame) => frame[3])).toEqual([
      { topics: ['graph', 'coverage'] },
    ])

    server.last.receive(['DTP-PUSH', 'graph', { graphVersion: 7 }])
    server.last.receive(['DTP-PUSH', 'want', { demandId: 'd' }])
    server.last.receive(['DTP-PUSH', 'coverage', { coverage: 'complete' }])
    expect(first).toEqual([{ graphVersion: 7 }, { coverage: 'complete' }])
    expect(second).toEqual([{ graphVersion: 7 }])
    expect(all.map((message) => message.topic)).toEqual(['graph', 'want', 'coverage'])

    await offFirst()
    expect(server.last.dtp('unsubscribe').map((frame) => frame[3])).toEqual([{ topics: ['coverage'] }])
    server.last.receive(['DTP-PUSH', 'graph', { graphVersion: 8 }])
    expect(first).toHaveLength(2)
    expect(second).toEqual([{ graphVersion: 7 }, { graphVersion: 8 }])

    await offSecond()
    await offSecond()
    expect(server.last.dtp('unsubscribe').map((frame) => frame[3])).toEqual([
      { topics: ['coverage'] },
      { topics: ['graph'] },
    ])
  })

  it('rolls back the handler when subscribe fails', async () => {
    const { server, client } = createHarness()
    server.ops.set('subscribe', () => ({ error: ['invalid', 'invalid: unknown topic'] }))
    const seen: unknown[] = []
    expect((await rejection(client.subscribe(['nope'], (data) => seen.push(data)))).code).toBe('invalid')
    server.last.receive(['DTP-PUSH', 'nope', 1])
    expect(seen).toEqual([])
  })
})

describe('reconnect', () => {
  it('rejects in-flight work, reconnects with backoff, restores the session, and reports a new instance', async () => {
    const { server, client, clock } = createHarness({ reconnect: { random: () => 1 } })
    const pushes: unknown[] = []
    await client.subscribe(['graph'], (data) => pushes.push(data))
    const defaults = { rootPubkey: ROOT, followTrustThreshold: 75 }
    await client.sessionUpdate(defaults)
    await flush()
    expect(client.instanceId).toBe('instance-a')

    const changes: InstanceChange[] = []
    const closes: CloseInfo[] = []
    let opens = 0
    client.on('instanceChanged', (change) => changes.push(change))
    client.on('close', (info) => closes.push(info))
    client.on('open', () => opens++)

    server.ops.set('trust.query', () => 'hold')
    const inflight = client.trustQuery({ subject: { type: 'p', value: ROOT } })
    await flush()
    server.instanceId = 'instance-b'
    server.last.drop(1006, 'gone')

    const error = await rejection(inflight)
    expect(error.code).toBe('error')
    expect(error.message).toBe('connection closed')
    expect(closes).toEqual([{ code: 1006, reason: 'gone', willReconnect: true }])

    const delays = clock.delays()
    expect(delays).toHaveLength(1)
    expect(delays[0]).toBeGreaterThanOrEqual(400)
    expect(delays[0]).toBeLessThanOrEqual(600)
    clock.advance(delays[0]! - 1)
    expect(server.sockets).toHaveLength(1)
    clock.advance(1)
    await flush()

    expect(server.sockets).toHaveLength(2)
    expect(opens).toBe(1)
    const ops = server.last.framesOf('DTP').map((frame) => frame[2])
    expect(ops.slice(0, 3)).toEqual(['session.update', 'subscribe', 'info'])
    expect(server.last.dtp('session.update')[0]![3]).toEqual({ defaults })
    expect(server.last.dtp('subscribe')[0]![3]).toEqual({ topics: ['graph'] })
    expect(changes).toEqual([{ previous: 'instance-a', current: 'instance-b' }])
    expect(client.instanceId).toBe('instance-b')

    server.last.receive(['DTP-PUSH', 'graph', { graphVersion: 2 }])
    expect(pushes).toEqual([{ graphVersion: 2 }])
  })

  it('does not emit instanceChanged when the instance stays the same', async () => {
    const { server, client, clock } = createHarness()
    await client.subscribe(['graph'], () => {})
    await flush()
    const changes: InstanceChange[] = []
    client.on('instanceChanged', (change) => changes.push(change))
    server.last.drop()
    clock.advance(clock.delays()[0]!)
    await flush()
    expect(server.sockets).toHaveLength(2)
    expect(changes).toEqual([])
  })

  it('backs off exponentially from 0.5 s to a 30 s cap', async () => {
    const { server, client, clock } = createHarness({ reconnect: { random: () => 0.5 } })
    await client.subscribe(['graph'], () => {})
    server.autoOpen = false
    server.last.drop()
    for (const expected of [500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      expect(clock.delays()).toEqual([expected])
      clock.advance(expected)
      await flush()
      server.last.drop()
    }
    server.autoOpen = true
    clock.advance(clock.delays()[0]!)
    await flush()
    expect(client.connected).toBe(true)
    server.last.drop()
    expect(clock.delays()).toEqual([500])
  })

  it('keeps jittered delays within ±jitter of the base', async () => {
    for (const random of [0, 0.25, 0.999]) {
      const { server, client, clock } = createHarness({ reconnect: { random: () => random, jitter: 0.2 } })
      await client.subscribe(['graph'], () => {})
      server.last.drop()
      const [delay] = clock.delays()
      expect(delay).toBeGreaterThanOrEqual(400)
      expect(delay).toBeLessThanOrEqual(600)
    }
  })

  it('without subscriptions reconnects lazily on the next request', async () => {
    const { server, client, clock } = createHarness()
    await client.info()
    const closes: CloseInfo[] = []
    client.on('close', (info) => closes.push(info))
    server.last.drop()
    expect(closes).toEqual([{ code: 1006, reason: '', willReconnect: false }])
    expect(clock.delays()).toEqual([])
    expect(server.sockets).toHaveLength(1)
    await client.info()
    expect(server.sockets).toHaveLength(2)
  })

  it('a connect timeout rejects waiting requests', async () => {
    const { server, client, clock } = createHarness({ requestTimeoutMs: 1_000, server: { autoOpen: false } })
    const result = client.info()
    await flush()
    clock.advance(1_000)
    expect((await rejection(result)).code).toBe('error')
    expect(server.last.closedWith).toHaveLength(1)
  })
})

describe('idle close', () => {
  it('closes cleanly after idleCloseMs without work, then reopens on demand', async () => {
    const { server, client, clock } = createHarness({ idleCloseMs: 60_000 })
    const closes: CloseInfo[] = []
    client.on('close', (info) => closes.push(info))
    await client.info()
    await flush()
    expect(clock.delays()).toEqual([60_000])
    clock.advance(59_999)
    expect(server.last.closedWith).toEqual([])
    clock.advance(1)
    expect(server.last.closedWith).toEqual([{ code: 1000, reason: 'idle' }])
    expect(closes).toEqual([{ code: 1000, reason: 'idle', willReconnect: false }])
    expect(clock.delays()).toEqual([])

    await client.info()
    expect(server.sockets).toHaveLength(2)
  })

  it('stays open while requests are in flight or topics are subscribed', async () => {
    const { server, client, clock } = createHarness({ idleCloseMs: 60_000 })
    const off = await client.subscribe(['graph'], () => {})
    await flush()
    expect(clock.delays()).not.toContain(60_000)
    clock.advance(120_000)
    expect(server.last.closedWith).toEqual([])
    await off()
    expect(clock.delays()).toEqual([60_000])

    server.ops.set('trust.query', () => 'hold')
    const pending = client.trustQuery({ subject: { type: 'p', value: ROOT } }, { timeoutMs: 100_000 })
    await flush()
    expect(clock.delays()).toEqual([100_000])
    clock.advance(100_000)
    await pending.catch(() => {})
    expect(clock.delays()).toEqual([60_000])
  })

  it('never closes when idleCloseMs is null', async () => {
    const { client, clock } = createHarness()
    await client.info()
    await flush()
    expect(clock.delays()).toEqual([])
  })
})

describe('close()', () => {
  it('closes without reconnecting even with subscriptions', async () => {
    const { server, client, clock } = createHarness()
    await client.subscribe(['graph'], () => {})
    client.close()
    expect(server.last.closedWith).toEqual([{ code: 1000, reason: 'client close' }])
    expect(clock.delays()).toEqual([])
    await client.info()
    expect(server.sockets).toHaveLength(2)
    expect(server.last.dtp('subscribe')[0]![3]).toEqual({ topics: ['graph'] })
  })
})
