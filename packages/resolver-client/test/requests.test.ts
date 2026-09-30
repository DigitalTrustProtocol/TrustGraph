import { ResolverError, errorCodeFromMessage, machinePrefix, type TrustSubject } from '@dtp/resolver-client'
import { describe, expect, it } from 'vitest'
import { createHarness, flush } from './fake-server'

const subject = (id: string): TrustSubject => ({ type: 'i', value: `user:id:${id}` })

async function rejection(promise: Promise<unknown>): Promise<ResolverError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(ResolverError)
  return error as ResolverError
}

describe('machinePrefix', () => {
  it('extracts the NIP-01 machine prefix', () => {
    expect(machinePrefix('auth-required: sign in first')).toBe('auth-required')
    expect(machinePrefix('unsupported: filter')).toBe('unsupported')
    expect(machinePrefix('rate-limited:')).toBe('rate-limited')
    expect(machinePrefix('no prefix here')).toBeUndefined()
    expect(machinePrefix('Upper: case')).toBeUndefined()
    expect(machinePrefix(undefined)).toBeUndefined()
  })

  it('maps unknown prefixes to the fallback code', () => {
    expect(errorCodeFromMessage('blocked: deleted')).toBe('blocked')
    expect(errorCodeFromMessage('pow: difficulty 20')).toBe('error')
    expect(errorCodeFromMessage('', 'auth-required')).toBe('auth-required')
  })
})

describe('DTP requests', () => {
  it('opens on demand and pipelines requests answered out of order', async () => {
    const { server, client } = createHarness()
    const held: Array<[string, Record<string, unknown>]> = []
    server.ops.set('trust.query', (params, _socket, reqId) => {
      held.push([reqId, params])
      return 'hold'
    })
    const subjects = ['1', '2', '3'].map(subject)
    const results = subjects.map((s) => client.trustQuery({ subject: s }))
    await flush()

    expect(server.sockets).toHaveLength(1)
    const frames = server.last.dtp('trust.query')
    expect(frames).toHaveLength(3)
    expect(new Set(frames.map((frame) => frame[1])).size).toBe(3)
    expect(frames.map((frame) => frame[3])).toEqual(subjects.map((s) => ({ subject: s })))

    for (const [reqId, params] of [...held].reverse()) {
      server.last.receive(['DTP-OK', reqId, { subject: params.subject, graphVersion: Number(reqId) }])
    }
    const answers = await Promise.all(results)
    expect(answers.map((answer) => answer.subject)).toEqual(subjects)
  })

  it('sends typed helpers with their op names', async () => {
    const { server, client } = createHarness()
    for (const op of [
      'trust.batch',
      'rating.query',
      'rating.batch',
      'graph.field',
      'lookup.incoming',
      'lookup.outgoing',
      'lookup.counts',
      'lookup.batch',
      'graph.neighborhood',
      'graph.frontier',
      'identity.claims',
    ]) {
      server.ops.set(op, () => ({ result: { op } }))
    }
    const answers = await Promise.all([
      client.trustBatch({ items: [{ key: 'a', subject: subject('1') }] }),
      client.ratingQuery({ subject: { type: 'i', value: 'post:id:9' } }),
      client.ratingBatch({ items: [{ key: 'b', subject: { type: 'i', value: 'post:id:9' } }] }),
      client.graphField({ maxDepth: 2 }),
      client.lookupIncoming({ keys: ['i:user:id:1'] }),
      client.lookupOutgoing({ keys: ['p:' + 'a'.repeat(64)] }),
      client.lookupCounts({ keys: ['i:user:id:1'], direction: 'incoming' }),
      client.lookupBatch({ queries: [{ id: 'q', op: 'incoming', params: { keys: ['i:user:id:1'] } }] }),
      client.neighborhood({ centerId: 'i:user:id:1' }),
      client.frontier({ roots: ['a'.repeat(64)] }),
      client.identityClaims({ twitterId: '11348282' }),
    ])
    expect(answers.map((answer) => (answer as unknown as { op: string }).op)).toEqual([
      'trust.batch',
      'rating.query',
      'rating.batch',
      'graph.field',
      'lookup.incoming',
      'lookup.outgoing',
      'lookup.counts',
      'lookup.batch',
      'graph.neighborhood',
      'graph.frontier',
      'identity.claims',
    ])
  })

  it('maps DTP-ERR codes and messages; unknown codes become error', async () => {
    const { server, client } = createHarness()
    server.ops.set('trust.query', () => ({ error: ['busy', 'busy: 32 in flight'] }))
    server.ops.set('graph.field', () => ({ error: ['unsupported', 'unsupported: graph.field'] }))
    server.ops.set('lookup.incoming', () => ({ error: ['weird', 'weird: thing'] }))

    const busy = await rejection(client.trustQuery({ subject: subject('1') }))
    expect(busy.code).toBe('busy')
    expect(busy.message).toBe('busy: 32 in flight')
    expect((await rejection(client.graphField())).code).toBe('unsupported')
    expect((await rejection(client.lookupIncoming({ keys: ['i:user:id:1'] }))).code).toBe('error')
    expect((await rejection(client.request('nope.op'))).code).toBe('invalid')
  })

  it('times out: sends DTP-CANCEL and rejects with timeout', async () => {
    const { server, client, clock } = createHarness({ requestTimeoutMs: 1_500 })
    server.ops.set('trust.query', () => 'hold')
    const result = client.trustQuery({ subject: subject('1') }, { timeoutMs: 200 })
    await flush()
    const [frame] = server.last.dtp('trust.query')
    clock.advance(199)
    expect(server.last.framesOf('DTP-CANCEL')).toHaveLength(0)
    clock.advance(1)
    const error = await rejection(result)
    expect(error.code).toBe('timeout')
    expect(server.last.framesOf('DTP-CANCEL')).toEqual([['DTP-CANCEL', frame![1]]])

    server.last.receive(['DTP-OK', frame![1], { late: true }])
    await flush()
  })

  it('uses requestTimeoutMs by default', async () => {
    const { server, client, clock } = createHarness({ requestTimeoutMs: 1_500 })
    server.ops.set('trust.query', () => 'hold')
    const result = client.trustQuery({ subject: subject('1') })
    await flush()
    clock.advance(1_499)
    expect(server.last.framesOf('DTP-CANCEL')).toHaveLength(0)
    clock.advance(1)
    expect((await rejection(result)).code).toBe('timeout')
  })

  it('abort sends DTP-CANCEL and rejects with cancelled', async () => {
    const { server, client } = createHarness()
    server.ops.set('trust.query', () => 'hold')
    const controller = new AbortController()
    const result = client.trustQuery({ subject: subject('1') }, { signal: controller.signal })
    await flush()
    const [frame] = server.last.dtp('trust.query')
    controller.abort()
    expect((await rejection(result)).code).toBe('cancelled')
    expect(server.last.framesOf('DTP-CANCEL')).toEqual([['DTP-CANCEL', frame![1]]])
  })

  it('an already aborted signal sends nothing', async () => {
    const { server, client } = createHarness()
    await client.connect()
    await flush()
    const controller = new AbortController()
    controller.abort()
    const error = await rejection(
      client.trustQuery({ subject: subject('1') }, { signal: controller.signal }),
    )
    expect(error.code).toBe('cancelled')
    expect(server.last.dtp('trust.query')).toHaveLength(0)
  })

  it('coalesces identical in-flight requests into one wire request', async () => {
    const { server, client } = createHarness()
    server.ops.set('trust.query', () => 'hold')
    const first = client.request('trust.query', { subject: subject('1'), context: 'identity' })
    const second = client.request('trust.query', { context: 'identity', subject: { value: 'user:id:1', type: 'i' } })
    const other = client.request('trust.query', { subject: subject('2') })
    await flush()
    const frames = server.last.dtp('trust.query')
    expect(frames).toHaveLength(2)
    server.last.receive(['DTP-OK', frames[0]![1], { value: 'one' }])
    server.last.receive(['DTP-OK', frames[1]![1], { value: 'two' }])
    expect(await first).toEqual({ value: 'one' })
    expect(await second).toEqual({ value: 'one' })
    expect(await other).toEqual({ value: 'two' })

    const again = client.request('trust.query', { subject: subject('1'), context: 'identity' })
    await flush()
    expect(server.last.dtp('trust.query')).toHaveLength(3)
    server.last.receive(['DTP-OK', server.last.dtp('trust.query')[2]![1], { value: 'three' }])
    expect(await again).toEqual({ value: 'three' })
  })

  it('does not coalesce requests that carry a signal', async () => {
    const { server, client } = createHarness()
    server.ops.set('trust.query', () => ({ result: { ok: true } }))
    const signal = new AbortController().signal
    await Promise.all([
      client.trustQuery({ subject: subject('1') }, { signal }),
      client.trustQuery({ subject: subject('1') }, { signal }),
    ])
    expect(server.last.dtp('trust.query')).toHaveLength(2)
  })

  it('reqIds stay unique across many requests', async () => {
    const { server, client } = createHarness()
    server.ops.set('trust.query', (params) => ({ result: params }))
    await Promise.all(Array.from({ length: 50 }, (_, i) => client.trustQuery({ subject: subject(String(i)) })))
    const ids = server.last.framesOf('DTP').map((frame) => frame[1])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('forwards NOTICE and ignores unknown or malformed frames', async () => {
    const { server, client } = createHarness()
    const notices: string[] = []
    client.on('notice', (message) => notices.push(message))
    await client.connect()
    server.last.receive(['NOTICE', 'restarting soon'])
    server.last.receive(['FUTURE-THING', 1, 2])
    server.last.receive([42])
    server.last.fireRaw('not json')
    server.last.receive(['DTP-OK', 'unknown-req', {}])
    expect(notices).toEqual(['restarting soon'])
    server.ops.set('trust.query', () => ({ result: { fine: true } }))
    expect(await client.trustQuery({ subject: subject('1') })).toEqual({ fine: true })
  })

  it('info records instanceId', async () => {
    const { server, client } = createHarness()
    server.instanceId = 'abc'
    const info = await client.info()
    expect(info.instanceId).toBe('abc')
    expect(client.instanceId).toBe('abc')
  })

  it('rejects when the socket cannot be constructed', async () => {
    const client = createHarness({
      WebSocket: class {
        constructor() {
          throw new Error('bad url')
        }
      } as never,
    }).client
    const error = await rejection(client.info())
    expect(error.code).toBe('error')
    expect(error.message).toContain('bad url')
  })
})
