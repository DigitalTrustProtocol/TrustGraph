// Ported from AttentionX src/lib/nostr/kind-32009.test.ts (imports rewritten for @dtp/* packages).
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  type Event,
  type VerifiedEvent,
} from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import {
  buildKind32009D,
  buildKind32009Event,
  buildKind32009Material,
  canonicalizeWebUrl,
  canonicalScopeString,
  contextFallbackChain,
  getTrustStatementActiveStatus,
  parseStructuredTrustHint,
  isCanonicalTrustContext,
  parseKind32009Event,
  reduceKind32009Events,
  resolveTrustStatementContext,
  sha256Hex,
  serializeStructuredTrustHint,
  validateKind32009Event,
  type BuildKind32009Input,
} from '../src/kind-32009'
import { X_TRUST_SCOPE } from '../src/x-identity'

const secretKey = generateSecretKey()
const accountSubject = {
  type: 'i' as const,
  value: 'user:id:11348282',
}

async function signedStatement(
  overrides: Partial<BuildKind32009Input> = {},
): Promise<VerifiedEvent> {
  return finalizeEvent(
    await buildKind32009Event({
      subject: accountSubject,
      value: '1',
      scopes: [X_TRUST_SCOPE],
      createdAt: 1_700_000_000,
      ...overrides,
    }),
    secretKey,
  )
}

function withTags(event: Event, tags: string[][]): Event {
  return { ...event, tags }
}

describe('kind 32009 protocol', () => {
  it('builds the documented SHA-256 d tag deterministically', async () => {
    expect(buildKind32009Material(accountSubject, [X_TRUST_SCOPE])).toBe(
      'user:id:11348282:x.com:',
    )
    expect(
      await buildKind32009D(accountSubject, [X_TRUST_SCOPE], 'identity'),
    ).toBe(
      await sha256Hex('user:id:11348282:x.com:identity'),
    )

    const hexSubject = {
      type: 'p' as const,
      value: 'ab'.repeat(32),
    }
    expect(await buildKind32009D(hexSubject)).toBe(
      await sha256Hex(`p:${hexSubject.value}::`),
    )
    expect(canonicalScopeString(['x.com', 'twitter.com'])).toBe(
      'twitter.com,x.com',
    )
  })

  it('builds, signs, parses, and verifies complete statements', async () => {
    const event = await signedStatement({
      value: '-1',
      context: 'news:accuracy',
      activationTime: 1_699_999_999,
      expirationTime: 1_700_000_001,
      content: 'Primary sources conflict with this account.',
      extraTags: [['source', 'manual']],
    })

    const parsed = await parseKind32009Event(event)
    expect(parsed).toMatchObject({
      subject: accountSubject,
      value: '-1',
      context: 'news:accuracy',
      scopes: [X_TRUST_SCOPE],
      k: 'user:id',
      activationTime: 1_699_999_999,
      expirationTime: 1_700_000_001,
    })
    expect(event.tags).toContainEqual(['k', 'user:id'])
    expect(event.tags).toContainEqual(['s', X_TRUST_SCOPE])
    expect(event.tags).toContainEqual(['source', 'manual'])
  })

  it('preserves structured subject hints and bare npub hints', async () => {
    const realNpub = nip19.npubEncode(getPublicKey(generateSecretKey())).toLowerCase()
    const event = await signedStatement({
      subjectHints: [
        { kind: 'structured', class: 'user', property: 'name', value: 'nasa' },
        { kind: 'npub', npub: realNpub },
      ],
    })

    expect(event.tags).toContainEqual([
      'i',
      accountSubject.value,
      'user:name:nasa',
      realNpub,
    ])
    const parsed = await parseKind32009Event(event)
    expect(parsed.subjectHints).toEqual([
      { kind: 'structured', class: 'user', property: 'name', value: 'nasa' },
      { kind: 'npub', npub: realNpub },
    ])
    expect(event.tags).toContainEqual(['d', await buildKind32009D(
      accountSubject,
      [X_TRUST_SCOPE],
    )])
  })

  it('parses structured hints and bare npubs; rejects malformed hints', async () => {
    expect(parseStructuredTrustHint('post:id:123')).toEqual({
      class: 'post',
      property: 'id',
      value: '123',
    })
    expect(parseStructuredTrustHint('missing-separators')).toBeUndefined()
    expect(
      serializeStructuredTrustHint({
        class: 'user',
        property: 'name',
        value: 'Jane Doe',
      }),
    ).toBe('user:name:Jane Doe')

    const valid = await signedStatement()
    const malformedSubjectHint = withTags(valid, [
      ...valid.tags.map((tag) =>
        tag[0] === 'i' ? [...tag, 'not-a-hint'] : tag,
      ),
    ])
    const subjectResult = await validateKind32009Event(malformedSubjectHint, {
      verifyEvent: false,
    })
    expect(subjectResult.valid).toBe(false)
  })

  it('supports general context with a missing or empty c tag', async () => {
    const withoutContext = await signedStatement({ context: undefined })
    const emptyContext = finalizeEvent(
      {
        ...(await buildKind32009Event({
          subject: accountSubject,
          value: '1',
          scopes: [X_TRUST_SCOPE],
          createdAt: 1_700_000_001,
        })),
        tags: [
          ['d', await buildKind32009D(accountSubject, [X_TRUST_SCOPE])],
          ['i', accountSubject.value],
          ['v', '1'],
          ['k', 'user:id'],
          ['s', X_TRUST_SCOPE],
          ['c', ''],
        ],
      },
      secretKey,
    )

    await expect(parseKind32009Event(withoutContext)).resolves.toMatchObject({
      context: '',
    })
    await expect(parseKind32009Event(emptyContext)).resolves.toMatchObject({
      context: '',
    })
  })

  it('enforces canonical context grammar, byte limits, and hierarchy', () => {
    expect(isCanonicalTrustContext('security:audit:web')).toBe(true)
    expect(isCanonicalTrustContext('Security:audit')).toBe(false)
    expect(isCanonicalTrustContext('security::audit')).toBe(false)
    expect(isCanonicalTrustContext(`a${'b'.repeat(128)}`)).toBe(false)
    expect(contextFallbackChain('security:audit:web')).toEqual([
      'security:audit:web',
      'security:audit',
      'security',
      '',
    ])
    expect(() => contextFallbackChain(':invalid')).toThrow()
  })

  it('canonicalizes web subjects and rejects noncanonical identifiers', async () => {
    expect(canonicalizeWebUrl('HTTPS://Example.COM:443/path#fragment')).toBe(
      'https://example.com/path',
    )
    await expect(
      buildKind32009D({
        type: 'i',
        value: 'web:HTTPS://Example.COM:443/path#fragment',
      }),
    ).rejects.toThrow('canonical')
    await expect(
      buildKind32009D({ type: 'i', value: 'user:id:not-a-number' }),
    ).rejects.toThrow('decimal digits')
    await expect(
      buildKind32009D({ type: 'i', value: 'ext:twitter_id:123' }),
    ).rejects.toThrow('ext:twitter')
  })

  it('rejects malformed tags, values, times, ordering, and oversized content', async () => {
    const valid = await signedStatement()
    const fixtures: Event[] = [
      withTags(valid, [...valid.tags, ['p', 'ab'.repeat(32)]]),
      withTags(
        valid,
        valid.tags.map((tag) => (tag[0] === 'v' ? ['v', '2'] : tag)),
      ),
      withTags(valid, [...valid.tags, ['c', 'identity']]),
      withTags(valid, [...valid.tags, ['x', '-1']]),
      withTags(valid, [...valid.tags, ['x', '20'], ['y', '10']]),
      withTags(
        valid,
        valid.tags.map((tag) =>
          tag[0] === 'd' ? ['d', '0'.repeat(64)] : tag,
        ),
      ),
      { ...valid, content: '😀'.repeat(1025) },
    ]

    for (const fixture of fixtures) {
      const result = await validateKind32009Event(fixture, {
        verifyEvent: false,
      })
      expect(result.valid).toBe(false)
    }
  })

  it('rejects a mismatched event id and an invalid signature', async () => {
    const event = await signedStatement()
    const badId = { ...event, content: 'tampered' }
    const idResult = await validateKind32009Event(badId)
    expect(idResult.valid).toBe(false)
    if (!idResult.valid) {
      expect(idResult.errors).toContain(
        'Event id does not match its serialized event hash',
      )
    }

    const badSignature = { ...event, sig: '0'.repeat(128) }
    const signatureResult = await validateKind32009Event(badSignature)
    expect(signatureResult.valid).toBe(false)
    if (!signatureResult.valid) {
      expect(signatureResult.errors).toContain('Event signature is invalid')
    }
  })

  it('uses highest created_at then lexically lowest id for replacement', async () => {
    const older = await signedStatement({
      value: '-1',
      createdAt: 10,
      content: 'older',
    })
    const newestA = await signedStatement({
      value: '1',
      createdAt: 11,
      content: 'candidate a',
    })
    const newestB = await signedStatement({
      value: '0',
      createdAt: 11,
      content: 'candidate b',
    })
    const expected = [newestA, newestB].sort((left, right) =>
      left.id.localeCompare(right.id),
    )[0]

    const reduced = await reduceKind32009Events([
      expected === newestA ? newestB : newestA,
      older,
      expected,
    ])
    expect(reduced.rejected).toEqual([])
    expect(reduced.statements).toHaveLength(1)
    expect(reduced.statements[0].event.id).toBe(expected.id)
  })

  it('builds Neutral and Delete values and keeps labels out of d', async () => {
    const d = await buildKind32009D(accountSubject, [X_TRUST_SCOPE])
    const neutral = await signedStatement({
      value: '0',
      labels: ['reviewer', 'reviewer', 'badge:moderator'],
      content: 'Watching this account.',
    })
    const deleted = await signedStatement({ value: '' })

    expect(neutral.tags).toContainEqual(['v', '0'])
    expect(neutral.tags).toContainEqual(['l', 'reviewer'])
    expect(neutral.tags).toContainEqual(['l', 'badge:moderator'])
    expect(neutral.tags.filter((tag) => tag[0] === 'l')).toHaveLength(2)
    expect(neutral.tags).toContainEqual(['d', d])
    expect(deleted.tags).toContainEqual(['v', ''])
    expect(deleted.tags).toContainEqual(['d', d])

    const parsedNeutral = await parseKind32009Event(neutral)
    const parsedDeleted = await parseKind32009Event(deleted)
    expect(parsedNeutral).toMatchObject({
      value: '0',
      labels: ['reviewer', 'badge:moderator'],
    })
    expect(parsedDeleted.value).toBe('')
    expect(parsedDeleted.labels).toEqual([])
  })

  it('parses sanitized label descriptions without changing d or the signed event', async () => {
    const d = await buildKind32009D(accountSubject, [X_TRUST_SCOPE])
    const template = await buildKind32009Event({
      subject: accountSubject,
      value: '0',
      scopes: [X_TRUST_SCOPE],
      createdAt: 1_700_000_000,
      labels: ['reviewer', 'badge:moderator'],
      content: '<script>Watching this account.</script>',
    })
    template.tags = template.tags.flatMap((tag) => {
      if (tag[0] === 'l' && tag[1] === 'reviewer') {
        return [
          [
            'l',
            'reviewer',
            '<script>Trusted reviewer of aerospace accounts</script>',
            'ignored-extra',
          ],
          ['l', 'reviewer', 'later hint should lose'],
        ]
      }
      return [tag]
    })
    const event = finalizeEvent(template, secretKey)
    const parsed = await parseKind32009Event(event)

    expect(parsed.labels).toEqual(['reviewer', 'badge:moderator'])
    expect(parsed.labelHints).toEqual({
      reviewer: 'scriptTrusted reviewer of aerospace accounts/script',
    })
    expect(parsed.content).toBe('scriptWatching this account./script')
    expect(parsed.d).toBe(d)
    expect(event.content).toBe('<script>Watching this account.</script>')
    expect(event.tags).toContainEqual([
      'l',
      'reviewer',
      '<script>Trusted reviewer of aerospace accounts</script>',
      'ignored-extra',
    ])
    expect(event.tags).toContainEqual(['d', d])
  })

  it('reports inclusive active windows; empty v is deleted; Neutral is active', async () => {
    const active = await parseKind32009Event(
      await signedStatement({ activationTime: 10, expirationTime: 20 }),
    )
    expect(getTrustStatementActiveStatus(active, 9)).toBe('not_yet_active')
    expect(getTrustStatementActiveStatus(active, 10)).toBe('active')
    expect(getTrustStatementActiveStatus(active, 20)).toBe('active')
    expect(getTrustStatementActiveStatus(active, 21)).toBe('expired')

    const neutral = await parseKind32009Event(
      await signedStatement({
        value: '0',
        activationTime: 100,
        expirationTime: 200,
      }),
    )
    expect(getTrustStatementActiveStatus(neutral, 150)).toBe('active')

    const deleted = await parseKind32009Event(
      await signedStatement({
        value: '',
        activationTime: 100,
        expirationTime: 200,
      }),
    )
    expect(getTrustStatementActiveStatus(deleted, 50)).toBe('cancelled')
    expect(getTrustStatementActiveStatus(deleted, 150)).toBe('cancelled')
  })

  it('resolves exact, nearest-parent, and general context slots', async () => {
    const general = await parseKind32009Event(
      await signedStatement({ context: undefined, createdAt: 1 }),
    )
    const security = await parseKind32009Event(
      await signedStatement({ context: 'security', createdAt: 2 }),
    )
    const deletedAudit = await parseKind32009Event(
      await signedStatement({
        context: 'security:audit',
        value: '',
        createdAt: 3,
      }),
    )
    const neutralAudit = await parseKind32009Event(
      await signedStatement({
        context: 'security:audit',
        value: '0',
        createdAt: 4,
      }),
    )

    expect(
      resolveTrustStatementContext(
        [general, security, deletedAudit],
        'security:audit:web',
      ),
    ).toBe(security)
    expect(
      resolveTrustStatementContext(
        [general, security, neutralAudit],
        'security:audit:web',
      ),
    ).toBe(neutralAudit)
    expect(
      resolveTrustStatementContext([general, security], 'security:review'),
    ).toBe(security)
    expect(resolveTrustStatementContext([general], 'news:accuracy')).toBe(
      general,
    )
  })
})
