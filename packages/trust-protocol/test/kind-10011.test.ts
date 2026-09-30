// Ported from AttentionX src/lib/nostr/kind-10011.test.ts (imports rewritten for @dtp/* packages).
// The NIP-39 proof-text case is not ported (proof-composer stays in AttentionX).
import {
  finalizeEvent,
  generateSecretKey,
  type Event,
} from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import {
  buildKind10011ClearEvent,
  buildKind10011Event,
  classifyKind10011ClearChange,
  classifyKind10011PublishChange,
  countPreservedKind10011Tags,
  inspectExistingTwitterTags,
  mergeKind10011TwitterTags,
  parseKind10011TwitterIdentity,
  validateSignedKind10011Event,
  validateKind10011TwitterIdentity,
} from '../src/kind-10011'

const secretKey = generateSecretKey()
const link = {
  handle: 'NASA',
  twitterId: '11348282',
  proofPostId: '2080659774136291424',
}

function signedIdentity(): Event {
  return finalizeEvent(
    buildKind10011Event({ ...link, createdAt: 1_700_000_000 }),
    secretKey,
  )
}

describe('kind 10011 Twitter identity protocol', () => {
  it('builds and validates the paired twitter identity tags', () => {
    const event = signedIdentity()
    expect(event.tags).toEqual([
      ['i', 'twitter:nasa', '2080659774136291424', 'post:id:2080659774136291424'],
      [
        'i',
        'twitter_id:11348282',
        '2080659774136291424',
        'post:id:2080659774136291424',
      ],
    ])
    expect(parseKind10011TwitterIdentity(event)).toMatchObject({
      handle: 'nasa',
      twitterId: '11348282',
      proofPostId: '2080659774136291424',
    })
  })

  it('builds a proofless claim without an X proof post', () => {
    const event = finalizeEvent(
      buildKind10011Event({
        handle: 'NASA',
        twitterId: '11348282',
        createdAt: 1_700_000_000,
      }),
      secretKey,
    )

    expect(event.tags).toEqual([
      ['i', 'twitter:nasa'],
      ['i', 'twitter_id:11348282'],
    ])
    expect(parseKind10011TwitterIdentity(event)).toMatchObject({
      handle: 'nasa',
      twitterId: '11348282',
    })
    expect(parseKind10011TwitterIdentity(event)).not.toHaveProperty(
      'proofPostId',
    )
  })

  it('accepts legacy tags and validates the structured fourth hint', () => {
    const event = signedIdentity()
    const legacy = {
      ...event,
      tags: event.tags.map((tag) => tag.slice(0, 3)),
    }
    expect(
      validateKind10011TwitterIdentity(legacy, { verifyEvent: false }).valid,
    ).toBe(true)

    const malformed = {
      ...event,
      tags: event.tags.map((tag) => [
        ...tag.slice(0, 3),
        'post:id:999',
      ]),
    }
    const result = validateKind10011TwitterIdentity(malformed, {
      verifyEvent: false,
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContain(
        'twitter i tag fourth value must match its proof post ID',
      )
      expect(result.errors).toContain(
        'twitter_id i tag fourth value must match its proof post ID',
      )
    }

    const mixed = {
      ...event,
      tags: [event.tags[0]!, event.tags[1]!.slice(0, 3)],
    }
    expect(
      validateKind10011TwitterIdentity(mixed, { verifyEvent: false }).valid,
    ).toBe(false)
  })

  it('preserves unrelated providers and replaces both Twitter tags together', () => {
    const existing = [
      ['i', 'github:octocat', 'proof-a'],
      ['client', 'attentionx'],
      ['i', 'twitter:old_handle', 'old-proof'],
      ['i', 'twitter_id:999', 'old-proof'],
      ['i', 'mastodon:alex@example.com', 'proof-b'],
    ]

    expect(mergeKind10011TwitterTags(existing, link)).toEqual([
      ['i', 'github:octocat', 'proof-a'],
      ['client', 'attentionx'],
      ['i', 'mastodon:alex@example.com', 'proof-b'],
      ['i', 'twitter:nasa', '2080659774136291424', 'post:id:2080659774136291424'],
      [
        'i',
        'twitter_id:11348282',
        '2080659774136291424',
        'post:id:2080659774136291424',
      ],
    ])
    expect(existing[2]).toEqual(['i', 'twitter:old_handle', 'old-proof'])
  })

  it('builds a complete replacement template and preserves prior content', () => {
    expect(
      buildKind10011Event({
        ...link,
        createdAt: 20,
        existingEvent: {
          content: 'provider links',
          tags: [['i', 'github:octocat', 'proof']],
        },
      }),
    ).toEqual({
      kind: 10011,
      created_at: 20,
      content: 'provider links',
      tags: [
        ['i', 'github:octocat', 'proof'],
        ['i', 'twitter:nasa', '2080659774136291424', 'post:id:2080659774136291424'],
        [
          'i',
          'twitter_id:11348282',
          '2080659774136291424',
          'post:id:2080659774136291424',
        ],
      ],
    })
  })

  it('classifies add, refresh, and replace publish changes', () => {
    const target = {
      handle: 'nasa',
      twitterId: '11348282',
      proofPostId: '2080659774136291424',
    }
    expect(classifyKind10011PublishChange(undefined, target)).toBe('add')
    expect(
      classifyKind10011PublishChange({ hasTwitterTags: false }, target),
    ).toBe('add')
    expect(
      classifyKind10011PublishChange(
        {
          hasTwitterTags: true,
          claim: {
            handle: 'nasa',
            twitterId: '11348282',
            proofPostId: '1',
          },
        },
        target,
      ),
    ).toBe('refresh')
    expect(
      classifyKind10011PublishChange(
        {
          hasTwitterTags: true,
          claim: {
            handle: 'old',
            twitterId: '999',
            proofPostId: '1',
          },
        },
        target,
      ),
    ).toBe('replace')
    expect(
      classifyKind10011PublishChange({ hasTwitterTags: true }, target),
    ).toBe('replace')
  })

  it('inspects valid and malformed existing Twitter tags', () => {
    expect(
      inspectExistingTwitterTags([
        ['i', 'github:octocat', 'proof'],
        ['i', 'twitter:nasa', '2080659774136291424'],
        ['i', 'twitter_id:11348282', '2080659774136291424'],
      ]),
    ).toMatchObject({
      hasTwitterTags: true,
      claim: {
        handle: 'nasa',
        twitterId: '11348282',
        proofPostId: '2080659774136291424',
      },
    })
    const malformed = inspectExistingTwitterTags([
      ['i', 'twitter:nasa', '1'],
      ['i', 'twitter_id:11348282', '2'],
    ])
    expect(malformed.hasTwitterTags).toBe(true)
    expect(malformed.claim).toBeUndefined()
    expect(malformed.rawTwitterTags).toEqual([
      'twitter:nasa',
      'twitter_id:11348282',
    ])
    expect(countPreservedKind10011Tags([
      ['i', 'github:octocat', 'proof'],
      ['client', 'attentionx'],
      ['i', 'twitter:nasa', '1'],
      ['i', 'twitter_id:11348282', '1'],
    ])).toBe(2)
  })

  it('rejects absent, duplicate, malformed, or mismatched provider pairs', () => {
    const event = signedIdentity()
    const fixtures: Event[] = [
      { ...event, tags: event.tags.slice(0, 1) },
      { ...event, tags: [...event.tags, [...event.tags[0]]] },
      {
        ...event,
        tags: [
          ['i', 'twitter:NASA', link.proofPostId],
          ['i', `twitter_id:${link.twitterId}`, link.proofPostId],
        ],
      },
      {
        ...event,
        tags: [
          ['i', 'twitter:nasa', '1'],
          ['i', `twitter_id:${link.twitterId}`, '2'],
        ],
      },
      {
        ...event,
        tags: [
          ['i', 'twitter:nasa', link.proofPostId],
          ['i', 'twitter_id:not-numeric', link.proofPostId],
        ],
      },
    ]

    for (const fixture of fixtures) {
      expect(
        validateKind10011TwitterIdentity(fixture, { verifyEvent: false }).valid,
      ).toBe(false)
    }
  })

  it('verifies event IDs and signatures without trusting cached verification', () => {
    const event = signedIdentity()
    const tampered = { ...event, content: 'tampered' }
    const badId = validateKind10011TwitterIdentity(tampered)
    expect(badId.valid).toBe(false)
    if (!badId.valid) {
      expect(badId.errors).toContain(
        'Event id does not match its serialized event hash',
      )
    }

    const badSignature = validateKind10011TwitterIdentity({
      ...event,
      sig: '0'.repeat(128),
    })
    expect(badSignature.valid).toBe(false)
    if (!badSignature.valid) {
      expect(badSignature.errors).toContain('Event signature is invalid')
    }
  })

  it('accepts a signed generic replacement without requiring Twitter tags', () => {
    const generic = finalizeEvent(
      {
        kind: 10011,
        created_at: 1_700_000_001,
        content: 'other identity providers',
        tags: [['i', 'github:octocat', 'proof']],
      },
      secretKey,
    )

    expect(validateSignedKind10011Event(generic)).toEqual({
      valid: true,
      event: generic,
    })
    expect(validateKind10011TwitterIdentity(generic).valid).toBe(false)
  })

  it('builds a clear event that strips Twitter tags and preserves others', () => {
    const existing = signedIdentity()
    existing.tags.push(['i', 'github:octocat', 'proof'])
    const clear = buildKind10011ClearEvent({
      createdAt: 1_700_000_002,
      existingEvent: existing,
    })
    expect(clear.kind).toBe(10011)
    expect(clear.tags).toEqual([['i', 'github:octocat', 'proof']])
    expect(inspectExistingTwitterTags(clear.tags).hasTwitterTags).toBe(false)
    expect(
      classifyKind10011ClearChange(inspectExistingTwitterTags(existing.tags)),
    ).toBe('clear')
    const signed = finalizeEvent(clear, secretKey)
    expect(validateSignedKind10011Event(signed).valid).toBe(true)
    expect(validateKind10011TwitterIdentity(signed).valid).toBe(false)
  })
})
