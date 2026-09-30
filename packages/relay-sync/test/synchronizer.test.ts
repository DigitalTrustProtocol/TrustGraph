// Ported from AttentionX src/relay/synchronizer.test.ts (imports rewritten for @dtp/* packages).
import type { Event } from 'nostr-tools'
import { describe, expect, it, vi } from 'vitest'
import { activePositivePubkeyEdges } from '../src/graph'
import {
  authorSyncScope,
  RelaySynchronizer,
  type GraphSyncLimits,
} from '../src/synchronizer'
import {
  buildAuthorRatingSyncFilter,
  buildAuthorTrustSyncFilter,
  buildXAccountTrustDiscoveryFilter,
} from '../src/filters'
import type {
  Clock,
  EventIngestResult,
  RelayEventRepository,
  RelayQueryClient,
  SyncCursor,
  SyncCursorRepository,
} from '../src/types'

const relay = 'wss://relay.example'
const root = 'a'.repeat(64)
const childOne = 'b'.repeat(64)
const childTwo = 'c'.repeat(64)
const grandchild = 'd'.repeat(64)

const clock: Clock = {
  now: () => 200_000,
  sleep: async () => undefined,
}

const VALID_D = 'f'.repeat(64)

function event(input: {
  id: string
  author?: string
  createdAt: number
  target?: string
  value?: '1' | '0' | '-1' | ''
  d?: string
}): Event {
  return {
    id: input.id.repeat(64),
    pubkey: input.author ?? root,
    created_at: input.createdAt,
    kind: 32009,
    tags: [
      ['d', input.d ?? VALID_D],
      input.target
        ? ['p', input.target]
        : ['i', `user:id:${input.id.padStart(8, '0')}`],
      ['v', input.value ?? '1'],
    ],
    content: '',
    sig: input.id.repeat(128),
  }
}

class MemoryEvents implements RelayEventRepository {
  readonly stored = new Map<string, Event>()

  async ingestEvent(value: Event): Promise<EventIngestResult> {
    if (this.stored.has(value.id)) {
      return 'duplicate'
    }
    this.stored.set(value.id, value)
    return 'stored'
  }

  async listEventsByAuthor(
    author: string,
    kind: number,
  ): Promise<readonly Event[]> {
    return [...this.stored.values()].filter(
      (value) => value.pubkey === author && value.kind === kind,
    )
  }
}

class MemoryCursors implements SyncCursorRepository {
  readonly values = new Map<string, SyncCursor>()
  readonly setCursor = vi.fn(async (cursor: SyncCursor) => {
    this.values.set(`${cursor.relayUrl}|${cursor.scope}`, cursor)
  })

  async getCursor(
    relayUrl: string,
    scope: string,
  ): Promise<SyncCursor | undefined> {
    return this.values.get(`${relayUrl}|${scope}`)
  }
}

const oneAuthorLimits: GraphSyncLimits = {
  maxDepth: 0,
  maxAuthorsPerLevel: 10,
  maxTotalAuthors: 10,
  maxEvents: 20,
}

describe('RelaySynchronizer', () => {
  it('queries a per-relay author cursor with overlap', async () => {
    const cursors = new MemoryCursors()
    const scope = authorSyncScope('trust', root)
    cursors.values.set(`${relay}|${scope}`, {
      relayUrl: relay,
      scope,
      lastSeenCreatedAt: 100,
      lastEoseAt: 1,
    })
    const incoming = event({ id: '1', createdAt: 105 })
    const client: RelayQueryClient = {
      query: vi.fn(async (request) => {
        if (request.filter.kinds?.[0] === 32014) return
        expect(request.filter).toEqual({
          ...buildAuthorTrustSyncFilter(root, 90),
          limit: 20,
        })
        await request.onEvent(incoming)
      }),
    }

    await new RelaySynchronizer({
      client,
      cursors,
      events: new MemoryEvents(),
      clock,
    }).synchronize({
      relayUrls: [relay],
      rootPubkeys: [root],
      scope: 'trust',
      overlapSeconds: 10,
      limits: oneAuthorLimits,
    })

    expect(cursors.values.get(`${relay}|${scope}`)).toMatchObject({
      lastSeenCreatedAt: 105,
      lastEoseAt: 200_000,
    })
  })

  it('forces one full refresh after crossing a durable refresh slot', async () => {
    const cursors = new MemoryCursors()
    const scope = authorSyncScope('trust', root)
    cursors.values.set(`${relay}|${scope}`, {
      relayUrl: relay,
      scope,
      lastSeenCreatedAt: 100,
      lastEoseAt: 1,
    })
    const nextDayClock: Clock = {
      now: () => 24 * 60 * 60 * 1_000 + 1,
      sleep: async () => undefined,
    }
    const client: RelayQueryClient = {
      query: vi.fn(async (request) => {
        expect(request.filter.since).toBeUndefined()
      }),
    }

    await new RelaySynchronizer({
      client,
      cursors,
      events: new MemoryEvents(),
      clock: nextDayClock,
    }).synchronize({
      relayUrls: [relay],
      rootPubkeys: [root],
      scope: 'trust',
      overlapSeconds: 10,
      limits: oneAuthorLimits,
    })

    expect(cursors.values.get(`${relay}|${scope}`)?.lastEoseAt).toBe(
      nextDayClock.now(),
    )
  })

  it('does not advance a cursor when the query fails before EOSE', async () => {
    const cursors = new MemoryCursors()
    const scope = authorSyncScope('trust', root)
    const original: SyncCursor = {
      relayUrl: relay,
      scope,
      lastSeenCreatedAt: 100,
      lastEoseAt: 1,
    }
    cursors.values.set(`${relay}|${scope}`, original)
    const client: RelayQueryClient = {
      query: async (request) => {
        await request.onEvent(event({ id: '2', createdAt: 110 }))
        throw new Error('disconnected before EOSE')
      },
    }

    const result = await new RelaySynchronizer({
      client,
      cursors,
      events: new MemoryEvents(),
      clock,
    }).synchronize({
      relayUrls: [relay],
      rootPubkeys: [root],
      scope: 'trust',
      overlapSeconds: 10,
      limits: oneAuthorLimits,
      retryPolicy: {
        maxAttempts: 1,
        initialDelayMs: 0,
        maxDelayMs: 0,
        multiplier: 1,
        jitterRatio: 0,
      },
    })

    expect(result.queries[0]).toMatchObject({
      completed: false,
      attempts: 1,
    })
    expect(cursors.setCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSeenCreatedAt: 100,
        retry: expect.objectContaining({ attempts: 1 }),
      }),
    )
    expect(cursors.values.get(`${relay}|${scope}`)?.lastSeenCreatedAt).toBe(100)
  })

  it('deduplicates event IDs while reporting every relay provenance', async () => {
    const duplicate = event({ id: '3', createdAt: 120 })
    const provenance = vi.fn()
    const events = new MemoryEvents()
    const client: RelayQueryClient = {
      query: async (request) => {
        if (request.filter.kinds?.[0] === 32014) return
        await request.onEvent(duplicate)
      },
    }

    const result = await new RelaySynchronizer({
      client,
      cursors: new MemoryCursors(),
      events,
      onProvenance: provenance,
      clock,
    }).synchronize({
      relayUrls: [relay, 'wss://second.example'],
      rootPubkeys: [root],
      scope: 'trust',
      overlapSeconds: 10,
      limits: oneAuthorLimits,
    })

    expect(result).toMatchObject({
      eventsProcessed: 1,
      eventsStored: 1,
      duplicates: 1,
    })
    expect(events.stored).toHaveLength(1)
    expect(provenance).toHaveBeenCalledTimes(2)
  })

  it('follows only bounded active positive edges and reports truncation', async () => {
    const byAuthor = new Map<string, Event[]>([
      [
        root,
        [
          event({
            id: '4',
            createdAt: 100,
            target: childOne,
            d: 'a'.repeat(64),
          }),
          event({
            id: '5',
            createdAt: 100,
            target: childTwo,
            d: 'b'.repeat(64),
          }),
        ],
      ],
      [
        childOne,
        [
          event({
            id: '6',
            author: childOne,
            createdAt: 100,
            target: grandchild,
          }),
        ],
      ],
    ])
    const queriedAuthors: string[] = []
    const client: RelayQueryClient = {
      query: async (request) => {
        if (request.filter.kinds?.[0] === 32014) return
        const author = request.filter.authors?.[0]
        if (!author) {
          throw new Error('missing author filter')
        }
        queriedAuthors.push(author)
        for (const value of byAuthor.get(author) ?? []) {
          await request.onEvent(value)
        }
      },
    }

    const result = await new RelaySynchronizer({
      client,
      cursors: new MemoryCursors(),
      events: new MemoryEvents(),
      clock,
    }).synchronize({
      relayUrls: [relay],
      rootPubkeys: [root],
      scope: 'trust',
      overlapSeconds: 10,
      limits: {
        maxDepth: 1,
        maxAuthorsPerLevel: 1,
        maxTotalAuthors: 3,
        maxEvents: 20,
      },
    })

    expect(queriedAuthors).toEqual([root, childOne])
    expect(result.authors).toEqual([root, childOne])
    expect(result.truncated).toBe(true)
    expect(result.truncationReasons).toEqual(
      expect.arrayContaining(['maxAuthorsPerLevel', 'maxDepth']),
    )
  })

  it('stops at maxEvents without checkpointing an incomplete query', async () => {
    const cursors = new MemoryCursors()
    const client: RelayQueryClient = {
      query: async (request) => {
        if (request.filter.kinds?.[0] === 32014) return
        await request.onEvent(event({ id: '7', createdAt: 100 }))
        await request.onEvent(event({ id: '8', createdAt: 101 }))
      },
    }

    const result = await new RelaySynchronizer({
      client,
      cursors,
      events: new MemoryEvents(),
      clock,
    }).synchronize({
      relayUrls: [relay],
      rootPubkeys: [root],
      scope: 'trust',
      overlapSeconds: 10,
      limits: { ...oneAuthorLimits, maxEvents: 1 },
    })

    expect(result.truncationReasons).toContain('maxEvents')
    expect(result.eventsProcessed).toBe(1)
    expect(cursors.setCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        retry: expect.objectContaining({ attempts: 1 }),
      }),
    )
    expect(cursors.values.get(`${relay}|${authorSyncScope('trust', root)}`)
      ?.lastSeenCreatedAt).toBe(0)
  })

  it('refreshes post subjects without since, cursors, or ineligible scopes', async () => {
    const postStatement = (id: string, kind: number, scope?: string): Event => ({
      id: id.repeat(64),
      pubkey: childOne,
      created_at: 10,
      kind,
      tags: [
        ['d', VALID_D],
        ['i', 'post:id:9'],
        ...(kind === 32014 ? [['score', '80']] : [['v', '1']]),
        ...(scope ? [['s', scope]] : []),
      ],
      content: '',
      sig: id.repeat(128),
    })
    const trust = postStatement('1', 32009, 'x.com')
    const rating = postStatement('2', 32014, 'x.com')
    const otherSite = postStatement('3', 32009, 'example.com')
    const unscopedRating = postStatement('4', 32014)
    const cursors = new MemoryCursors()
    const events = new MemoryEvents()
    const client: RelayQueryClient = {
      query: vi.fn(async (request) => {
        expect(request.filter).toEqual({
          kinds: [32009, 32014],
          '#i': ['post:id:9'],
          limit: 200,
        })
        for (const value of [trust, rating, otherSite, unscopedRating]) {
          await request.onEvent(value)
        }
      }),
    }

    const result = await new RelaySynchronizer({
      client,
      cursors,
      events,
      clock,
    }).refreshXPostSubjects({ relayUrls: [relay], postIds: ['9'] })

    expect(result.eventsStored).toBe(2)
    expect(result.complete).toBe(true)
    expect([...events.stored.keys()].sort()).toEqual([rating.id, trust.id].sort())
    expect(cursors.setCursor).not.toHaveBeenCalled()

    const capped = await new RelaySynchronizer({
      client,
      cursors,
      events: new MemoryEvents(),
      clock,
    }).refreshXPostSubjects({ relayUrls: [relay], postIds: ['9'], maxEvents: 1 })
    expect(capped.complete).toBe(false)
  })

  it('queries X account subject filters before author traversal', async () => {
    const client: RelayQueryClient = {
      query: vi.fn(async () => undefined),
    }

    await new RelaySynchronizer({
      client,
      cursors: new MemoryCursors(),
      events: new MemoryEvents(),
      clock,
    }).synchronize({
      relayUrls: [relay],
      rootPubkeys: [root],
      scope: 'trust',
      overlapSeconds: 10,
      xUserIds: ['42', '99'],
      limits: oneAuthorLimits,
    })

    expect(client.query).toHaveBeenCalledWith(
      expect.objectContaining({
        relayUrl: relay,
        filter: expect.objectContaining(
          buildXAccountTrustDiscoveryFilter(['42', '99']),
        ),
      }),
    )
    expect(client.query).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining(
          buildAuthorTrustSyncFilter(root),
        ),
      }),
    )
    expect(client.query).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining(
          buildAuthorRatingSyncFilter(root),
        ),
      }),
    )
  })
})

describe('activePositivePubkeyEdges', () => {
  it('does not revive replaced, cancelled, or inactive edges', () => {
    const old = event({
      id: '9',
      createdAt: 10,
      target: childOne,
      d: 'slot',
    })
    const cancelled = event({
      id: 'a',
      createdAt: 11,
      target: childOne,
      value: '',
      d: 'slot',
    })
    const inactive = {
      ...event({
        id: 'b',
        createdAt: 12,
        target: childTwo,
        d: 'inactive',
      }),
      tags: [
        ['d', 'inactive'],
        ['p', childTwo],
        ['v', '1'],
        ['x', '201'],
      ],
    }

    expect(
      activePositivePubkeyEdges([old, cancelled, inactive], 200),
    ).toEqual([])
  })

  it('ignores edges with non-canonical d tags', () => {
    expect(
      activePositivePubkeyEdges(
        [
          {
            ...event({
              id: 'c',
              createdAt: 10,
              target: childOne,
            }),
            tags: [
              ['d', 'not-a-canonical-d-tag'],
              ['p', childOne],
              ['v', '1'],
            ],
          },
        ],
        200,
      ),
    ).toEqual([])
  })
})
