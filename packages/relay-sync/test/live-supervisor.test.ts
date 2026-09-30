// Ported from AttentionX src/relay/live-supervisor.test.ts (imports rewritten for @dtp/* packages).
import { describe, expect, it, vi } from 'vitest'
import type { Event } from 'nostr-tools'
import { LiveSyncSupervisor } from '../src/live-supervisor'
import { globalKindSyncScope } from '../src/filters'
import type {
  EventIngestResult,
  RelaySubscribeClient,
  RelaySubscribeRequest,
  SyncCursor,
  SyncCursorRepository,
} from '../src/types'

const relay = 'wss://relay.example'
const author = 'a'.repeat(64)

class MemoryCursors implements SyncCursorRepository {
  readonly values = new Map<string, SyncCursor>()

  async getCursor(relayUrl: string, scope: string) {
    return this.values.get(`${relayUrl}|${scope}`)
  }

  async setCursor(cursor: SyncCursor) {
    this.values.set(`${cursor.relayUrl}|${cursor.scope}`, cursor)
  }
}

function makeClient(onSubscribe?: (request: RelaySubscribeRequest) => void) {
  const subs: RelaySubscribeRequest[] = []
  const client: RelaySubscribeClient = {
    subscribe(request) {
      subs.push(request)
      onSubscribe?.(request)
      queueMicrotask(() => request.onEose?.())
      return {
        close: () => undefined,
      }
    },
  }
  return { client, subs }
}

describe('LiveSyncSupervisor', () => {
  it('keeps frontier subscriptions open after EOSE and checkpoints', async () => {
    const cursors = new MemoryCursors()
    const { client, subs } = makeClient()
    const ingest = vi.fn(async (): Promise<EventIngestResult> => 'stored')
    const statuses: string[] = []
    const supervisor = new LiveSyncSupervisor({
      client: { query: async () => undefined, ...client },
      cursors,
      ingest,
      onStatus: (state) => statuses.push(state),
      clock: { now: () => 200_000, sleep: async () => undefined },
    })

    await supervisor.start({
      relayUrls: [relay],
      mode: 'frontier',
      authors: [author],
      scope: 'attentionx-wot-v1',
      overlapSeconds: 60,
    })

    expect(statuses).toEqual(['stopped', 'connecting', 'live'])
    expect(subs.length).toBe(2)
    expect(subs.every((sub) => sub.filter.authors?.includes(author))).toBe(true)
    await Promise.resolve()
    expect(
      [...cursors.values.values()].some((cursor) => cursor.lastEoseAt === 200_000),
    ).toBe(true)
    supervisor.stop()
  })

  it('opens subscriptions for a new relay and releases a removed one', async () => {
    const closed: string[] = []
    const released: string[] = []
    const subs: RelaySubscribeRequest[] = []
    const client: RelaySubscribeClient = {
      subscribe(request) {
        subs.push(request)
        return { close: () => closed.push(request.relayUrl) }
      },
      releaseRelay(relayUrl) {
        released.push(relayUrl)
      },
    }
    const statuses: string[] = []
    const supervisor = new LiveSyncSupervisor({
      client: { query: async () => undefined, ...client },
      cursors: new MemoryCursors(),
      ingest: async () => 'stored',
      onStatus: (state) => statuses.push(state),
      clock: { now: () => 1_700_000_000_000, sleep: async () => undefined },
    })
    const oldRelay = 'wss://old.example'
    const newRelay = 'wss://new.example'

    await supervisor.start({
      relayUrls: [oldRelay],
      mode: 'global',
      scope: 'attentionx-wot-v1',
      overlapSeconds: 60,
    })
    const opened = subs.length
    await supervisor.replaceRelays([newRelay])

    expect(closed).toEqual(Array.from({ length: opened }, () => oldRelay))
    expect(released).toEqual([oldRelay])
    expect(subs.filter((sub) => sub.relayUrl === newRelay)).toHaveLength(2)
    expect(statuses.at(-1)).toBe('live')

    await supervisor.replaceRelays([newRelay])
    expect(released).toEqual([oldRelay])
    supervisor.stop()
  })

  it('starts global kinds at now minus overlap without authors', async () => {
    const { client, subs } = makeClient()
    const supervisor = new LiveSyncSupervisor({
      client: { query: async () => undefined, ...client },
      cursors: new MemoryCursors(),
      ingest: async () => 'stored',
      clock: { now: () => 1_700_000_000_000, sleep: async () => undefined },
    })

    await supervisor.start({
      relayUrls: [relay],
      mode: 'global',
      scope: 'attentionx-wot-v1',
      overlapSeconds: 60,
    })

    expect(subs.map((sub) => sub.filter.kinds?.[0]).sort()).toEqual([
      32009, 32014,
    ])
    expect(subs.every((sub) => !sub.filter.authors)).toBe(true)
    expect(subs.find((sub) => sub.filter.kinds?.[0] === 32014)?.filter['#s']).toEqual([
      'x.com',
    ])
    const since = subs[0]?.filter.since
    expect(since).toBe(1_700_000_000 - 60)
    expect(globalKindSyncScope('attentionx-wot-v1', 32009)).toBe(
      'attentionx-wot-v1:kind:32009:global',
    )
    supervisor.stop()
  })

  it('reconnects from the durable high-water cursor', async () => {
    const cursors = new MemoryCursors()
    const scope = globalKindSyncScope('attentionx-wot-v1', 32009)
    cursors.values.set(`${relay}|${scope}`, {
      relayUrl: relay,
      scope,
      lastSeenCreatedAt: 1_234,
      lastEoseAt: 1,
    })
    const { client, subs } = makeClient()
    const supervisor = new LiveSyncSupervisor({
      client: { query: async () => undefined, ...client },
      cursors,
      ingest: async () => 'stored',
      clock: { now: () => 2_000_000, sleep: async () => undefined },
    })

    await supervisor.start({
      relayUrls: [relay],
      mode: 'global',
      scope: 'attentionx-wot-v1',
      overlapSeconds: 10,
    })

    const trust = subs.find((sub) => sub.filter.kinds?.[0] === 32009)
    expect(trust?.filter.since).toBe(1_224)
    supervisor.stop()
  })

  it('stays partial when the client cannot subscribe', async () => {
    const statuses: string[] = []
    const supervisor = new LiveSyncSupervisor({
      client: { query: async () => undefined },
      cursors: new MemoryCursors(),
      ingest: async () => 'stored',
      onStatus: (state) => statuses.push(state),
    })

    await supervisor.start({
      relayUrls: [relay],
      mode: 'global',
      scope: 'attentionx-wot-v1',
      overlapSeconds: 60,
    })

    expect(statuses).toEqual(['stopped', 'connecting', 'partial'])
    supervisor.stop()
  })

  it('defers overflow and reconnects after flushing', async () => {
    const statuses: string[] = []
    let latest: RelaySubscribeRequest | undefined
    const { client } = makeClient((request) => {
      latest = request
    })
    const ingest = vi.fn(async (): Promise<EventIngestResult> => 'stored')
    const supervisor = new LiveSyncSupervisor({
      client: { query: async () => undefined, ...client },
      cursors: new MemoryCursors(),
      ingest,
      onStatus: (state) => statuses.push(state),
      clock: { now: () => 200_000, sleep: async () => undefined },
    })

    await supervisor.start({
      relayUrls: [relay],
      mode: 'frontier',
      authors: [author],
      scope: 'attentionx-wot-v1',
      overlapSeconds: 60,
      queueCap: 1,
    })

    const event = (id: string): Event => ({
      id: id.padEnd(64, '0'),
      pubkey: author,
      created_at: 100,
      kind: 32009,
      tags: [],
      content: '',
      sig: 's'.repeat(128),
    })

    void latest!.onEvent(event('1'))
    void latest!.onEvent(event('2'))
    await vi.waitFor(() => {
      expect(statuses).toContain('partial')
      expect(statuses).toContain('reconnecting')
      expect(statuses.at(-1)).toBe('live')
    })
    expect(ingest).toHaveBeenCalled()
    supervisor.stop()
  })
})
