import {
  NIP42_AUTH_KIND,
  ResolverError,
  type ResolverSigner,
  type SignedEvent,
} from '@dtp/resolver-client'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { SERVER_URL, createHarness, flush, type FakeServer } from './fake-server'

function realSigner(): { signer: ResolverSigner; pubkey: string; signed: SignedEvent[] } {
  const secret = generateSecretKey()
  const pubkey = getPublicKey(secret)
  const signed: SignedEvent[] = []
  return {
    pubkey,
    signed,
    signer: {
      getPublicKey: async () => pubkey,
      signEvent: async (template) => {
        const event = finalizeEvent(template, secret)
        signed.push(event)
        return event
      },
    },
  }
}

/** Plain JSON shape, as it crosses the wire (no nostr-tools `verified` symbol). */
function signedNote(): SignedEvent {
  const event = finalizeEvent(
    { kind: 32009, created_at: 1_790_000_000, tags: [['d', 'x']], content: '' },
    generateSecretKey(),
  )
  return JSON.parse(JSON.stringify(event)) as SignedEvent
}

/** trust.query is refused until the socket has authenticated. */
function requireAuthForTrust(server: FakeServer): void {
  server.ops.set('trust.query', (_params, socket) =>
    socket.authedPubkeys.size > 0
      ? { result: { authed: true } }
      : { error: ['auth-required', 'auth-required: members only'] },
  )
}

async function rejection(promise: Promise<unknown>): Promise<ResolverError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(ResolverError)
  return error as ResolverError
}

describe('NIP-42', () => {
  it('signs kind 22242 for the challenge on auth-required and retries once', async () => {
    const { signer, pubkey, signed } = realSigner()
    const { server, client, clock } = createHarness({ signer, server: { challenge: 'chal-xyz' } })
    requireAuthForTrust(server)
    const authEvents: SignedEvent[] = []
    server.onAuth = (event) => {
      authEvents.push(event as SignedEvent)
      return [true, '']
    }

    const result = await client.trustQuery({ subject: { type: 'i', value: 'user:id:1' } })
    expect(result).toEqual({ authed: true })

    expect(authEvents).toHaveLength(1)
    const auth = authEvents[0]!
    expect(auth.kind).toBe(NIP42_AUTH_KIND)
    expect(auth.kind).toBe(22242)
    expect(auth.pubkey).toBe(pubkey)
    expect(auth.created_at).toBe(Math.floor(clock.now / 1000))
    expect(auth.tags).toEqual([
      ['relay', SERVER_URL],
      ['challenge', 'chal-xyz'],
    ])
    expect(verifyEvent(auth)).toBe(true)
    expect(signed).toHaveLength(1)
    expect(server.last.dtp('trust.query')).toHaveLength(2)
    expect(server.last.framesOf('AUTH')).toHaveLength(1)
  })

  it('retries only once when the server still refuses', async () => {
    const { signer } = realSigner()
    const { server, client } = createHarness({ signer })
    server.ops.set('trust.query', () => ({ error: ['auth-required', 'auth-required: still no'] }))
    const error = await rejection(client.trustQuery({ subject: { type: 'i', value: 'user:id:1' } }))
    expect(error.code).toBe('auth-required')
    expect(server.last.dtp('trust.query')).toHaveLength(2)
    expect(server.last.framesOf('AUTH')).toHaveLength(1)
  })

  it('parallel auth-required failures share one AUTH', async () => {
    const { signer } = realSigner()
    const { server, client } = createHarness({ signer })
    requireAuthForTrust(server)
    await Promise.all(
      ['1', '2', '3'].map((id) => client.trustQuery({ subject: { type: 'i', value: `user:id:${id}` } })),
    )
    expect(server.last.framesOf('AUTH')).toHaveLength(1)
    expect(server.last.dtp('trust.query')).toHaveLength(6)
  })

  it('without a signer rejects with auth-required and sends no AUTH', async () => {
    const { server, client } = createHarness()
    requireAuthForTrust(server)
    const error = await rejection(client.trustQuery({ subject: { type: 'i', value: 'user:id:1' } }))
    expect(error.code).toBe('auth-required')
    expect(server.last.framesOf('AUTH')).toHaveLength(0)
    expect((await rejection(client.authenticate())).code).toBe('auth-required')
  })

  it('authenticate() maps a refused AUTH to its machine prefix', async () => {
    const { signer } = realSigner()
    const { server, client } = createHarness({ signer })
    server.onAuth = () => [false, 'restricted: not a member']
    const error = await rejection(client.authenticate())
    expect(error.code).toBe('restricted')
  })

  it('authenticate() waits for a challenge that arrives late', async () => {
    const { signer } = realSigner()
    const { server, client } = createHarness({ signer, server: { challenge: '' } })
    const done = client.authenticate()
    await flush()
    expect(server.last.framesOf('AUTH')).toHaveLength(0)
    server.last.receive(['AUTH', 'late-challenge'])
    await done
    const auth = server.last.framesOf('AUTH')[0]![1] as SignedEvent
    expect(auth.tags).toContainEqual(['challenge', 'late-challenge'])
  })
})

describe('publish', () => {
  it('maps OK true and OK false', async () => {
    const { server, client } = createHarness()
    const accepted = signedNote()
    const refused = signedNote()
    server.onEvent = (event) => (event.id === accepted.id ? [true, ''] : [false, 'blocked: deleted'])
    expect(await client.publish(accepted)).toEqual({ accepted: true, message: '' })
    expect(await client.publish(refused)).toEqual({ accepted: false, message: 'blocked: deleted' })
    expect(server.last.framesOf('EVENT')).toEqual([
      ['EVENT', accepted],
      ['EVENT', refused],
    ])
  })

  it('authenticates and republishes once on auth-required', async () => {
    const { signer } = realSigner()
    const { server, client } = createHarness({ signer })
    server.onEvent = (_event, socket) =>
      socket.authedPubkeys.size > 0 ? [true, ''] : [false, 'auth-required: writers only']
    const event = signedNote()
    expect(await client.publish(event)).toEqual({ accepted: true, message: '' })
    expect(server.last.framesOf('EVENT')).toHaveLength(2)
    expect(server.last.framesOf('AUTH')).toHaveLength(1)
  })

  it('without a signer resolves the auth-required OK false', async () => {
    const { server, client } = createHarness()
    server.onEvent = () => [false, 'auth-required: writers only']
    expect(await client.publish(signedNote())).toEqual({
      accepted: false,
      message: 'auth-required: writers only',
    })
  })

  it('times out without an OK', async () => {
    const { server, client, clock } = createHarness()
    server.onEvent = () => 'hold'
    const result = client.publish(signedNote(), { timeoutMs: 300 })
    await flush()
    clock.advance(300)
    expect((await rejection(result)).code).toBe('timeout')
  })
})

describe('REQ', () => {
  it('collects events until EOSE, then sends CLOSE', async () => {
    const { server, client } = createHarness()
    const events = [signedNote(), signedNote()]
    server.onReq = (subId, _filters, socket) => {
      queueMicrotask(() => {
        for (const event of events) socket.receive(['EVENT', subId, event])
        socket.receive(['EOSE', subId])
      })
    }
    const filters = [{ ids: events.map((event) => event.id) }]
    expect(await client.req(filters)).toEqual(events)
    const [req] = server.last.framesOf('REQ')
    expect(req!.slice(2)).toEqual(filters)
    expect(server.last.framesOf('CLOSE')).toEqual([['CLOSE', req![1]]])
  })

  it('CLOSED rejects with the machine prefix as code', async () => {
    const { server, client } = createHarness()
    server.onReq = (subId, _filters, socket) =>
      queueMicrotask(() => socket.receive(['CLOSED', subId, 'unsupported: kinds 1']))
    const error = await rejection(client.req([{ kinds: [1] }]))
    expect(error.code).toBe('unsupported')
    expect(error.message).toBe('unsupported: kinds 1')
  })

  it('CLOSED auth-required authenticates and retries once', async () => {
    const { signer } = realSigner()
    const { server, client } = createHarness({ signer })
    server.onReq = (subId, _filters, socket) =>
      queueMicrotask(() =>
        socket.receive(
          socket.authedPubkeys.size > 0 ? ['EOSE', subId] : ['CLOSED', subId, 'auth-required: members'],
        ),
      )
    expect(await client.req([{ kinds: [13534] }])).toEqual([])
    expect(server.last.framesOf('REQ')).toHaveLength(2)
    expect(server.last.framesOf('AUTH')).toHaveLength(1)
  })

  it('CLOSED auth-required without a signer rejects auth-required', async () => {
    const { server, client } = createHarness()
    server.onReq = (subId, _filters, socket) =>
      queueMicrotask(() => socket.receive(['CLOSED', subId, 'auth-required: members']))
    expect((await rejection(client.req([{ kinds: [13534] }]))).code).toBe('auth-required')
  })

  it('times out, sends CLOSE, and rejects timeout', async () => {
    const { server, client, clock } = createHarness()
    const result = client.req([{ ids: ['a'.repeat(64)] }], { timeoutMs: 400 })
    await flush()
    clock.advance(400)
    expect((await rejection(result)).code).toBe('timeout')
    expect(server.last.framesOf('CLOSE')).toHaveLength(1)
  })
})
