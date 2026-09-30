// Ported from AttentionX src/lib/nostr/kind-32014.test.ts (imports rewritten for @dtp/* packages).
import {
  finalizeEvent,
  generateSecretKey,
  type Event,
  type VerifiedEvent,
} from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { buildKind32009D, buildKind32009Material } from '../src/kind-32009'
import {
  buildKind32014Event,
  canonicalizeRatingScore,
  canonicalRatingLabels,
  getRatingStatementActiveStatus,
  parseKind32014Event,
  reduceKind32014Events,
  validateKind32014Event,
  type BuildKind32014Input,
} from '../src/kind-32014'
import { X_TRUST_SCOPE } from '../src/x-identity'

const secretKey = generateSecretKey()
const postSubject = {
  type: 'i' as const,
  value: 'post:id:2080659774136291424',
}

async function signedRating(
  overrides: Partial<BuildKind32014Input> = {},
): Promise<VerifiedEvent> {
  return finalizeEvent(
    await buildKind32014Event({
      subject: postSubject,
      score: '80',
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

describe('kind 32014 protocol', () => {
  it('reuses kind 32009 d material (labels and score are not in d)', async () => {
    expect(buildKind32009Material(postSubject, [X_TRUST_SCOPE])).toBe(
      'post:id:2080659774136291424:x.com:',
    )
    const event = await signedRating({
      labels: ['genuine', 'spam'],
      score: '80',
    })
    expect(event.tags).toContainEqual([
      'd',
      await buildKind32009D(postSubject, [X_TRUST_SCOPE]),
    ])
    const cancelled = await signedRating({ score: '', createdAt: 1_700_000_001 })
    expect(cancelled.tags).toContainEqual([
      'd',
      await buildKind32009D(postSubject, [X_TRUST_SCOPE]),
    ])
    const withContext = await signedRating({
      context: 'product',
      createdAt: 1_700_000_002,
    })
    expect(withContext.tags).toContainEqual([
      'd',
      await buildKind32009D(postSubject, [X_TRUST_SCOPE], 'product'),
    ])
  })

  it('canonicalizes scores: empty cancel, 0 active, no trailing zeros', () => {
    expect(canonicalizeRatingScore('')).toBe('')
    expect(canonicalizeRatingScore('0')).toBe('0')
    expect(canonicalizeRatingScore('0.0')).toBe('0')
    expect(canonicalizeRatingScore('80')).toBe('80')
    expect(canonicalizeRatingScore('50.598334')).toBe('50.598334')
    expect(canonicalizeRatingScore('50.10')).toBe('50.1')
    expect(canonicalizeRatingScore('100')).toBe('100')
    expect(canonicalizeRatingScore('050')).toBeUndefined()
    expect(canonicalizeRatingScore('101')).toBeUndefined()
    expect(canonicalizeRatingScore('-1')).toBeUndefined()
    expect(canonicalizeRatingScore('1e2')).toBeUndefined()
    expect(canonicalizeRatingScore(' ')).toBeUndefined()
    expect(canonicalizeRatingScore('50.5983341')).toBeUndefined()
  })

  it('collapses duplicate labels', () => {
    expect(canonicalRatingLabels(['spam', 'spam', 'genuine'])).toEqual([
      'spam',
      'genuine',
    ])
  })

  it('parses sanitized label descriptions without changing d or the signed event', async () => {
    const d = await buildKind32009D(postSubject, [X_TRUST_SCOPE])
    const template = await buildKind32014Event({
      subject: postSubject,
      score: '80',
      scopes: [X_TRUST_SCOPE],
      createdAt: 1_700_000_000,
      labels: ['genuine', 'spam'],
      content: '<script>Worth reading.</script>',
    })
    template.tags = template.tags.map((tag) =>
      tag[0] === 'l' && tag[1] === 'genuine'
        ? ['l', 'genuine', '<script>Looks like a real person</script>']
        : tag,
    )
    const event = finalizeEvent(template, secretKey)
    const parsed = await parseKind32014Event(event)

    expect(parsed.labels).toEqual(['genuine', 'spam'])
    expect(parsed.labelHints).toEqual({
      genuine: 'scriptLooks like a real person/script',
    })
    expect(parsed.content).toBe('scriptWorth reading./script')
    expect(parsed.d).toBe(d)
    expect(event.content).toBe('<script>Worth reading.</script>')
    expect(event.tags).toContainEqual(['d', d])
  })

  it('builds, signs, parses active ratings and empty-score cancels', async () => {
    const event = await signedRating({
      labels: ['genuine'],
      content: 'Worth reading.',
    })
    const parsed = await parseKind32014Event(event)
    expect(parsed).toMatchObject({
      subject: postSubject,
      score: '80',
      scoreValue: 80,
      context: '',
      scopes: [X_TRUST_SCOPE],
      k: 'post:id',
      labels: ['genuine'],
    })
    expect(event.kind).toBe(32014)
    expect(event.tags).toContainEqual(['score', '80'])
    expect(event.tags).not.toContainEqual(expect.arrayContaining(['v']))

    const cancelled = await parseKind32014Event(
      await signedRating({ score: '', createdAt: 1_700_000_003 }),
    )
    expect(cancelled.score).toBe('')
    expect(cancelled.scoreValue).toBeUndefined()
    expect(getRatingStatementActiveStatus(cancelled, 1_700_000_003)).toBe(
      'cancelled',
    )
  })

  it('treats score 0 as an active low rating, not cancel', async () => {
    const event = await signedRating({
      score: '0',
      labels: ['spam'],
    })
    const parsed = await parseKind32014Event(event)
    expect(parsed.score).toBe('0')
    expect(parsed.scoreValue).toBe(0)
    expect(getRatingStatementActiveStatus(parsed, 1_700_000_000)).toBe(
      'active',
    )
  })

  it('rejects non-canonical scores, missing score, and d mismatch from labels', async () => {
    const valid = await signedRating()
    const fixtures: Event[] = [
      withTags(
        valid,
        valid.tags.map((tag) =>
          tag[0] === 'score' ? ['score', '50.0'] : tag,
        ),
      ),
      withTags(
        valid,
        valid.tags.map((tag) => (tag[0] === 'score' ? ['score', ' '] : tag)),
      ),
      withTags(
        valid,
        valid.tags.filter((tag) => tag[0] !== 'score'),
      ),
      withTags(valid, [...valid.tags, ['score', '40']]),
      withTags(
        valid,
        valid.tags.map((tag) =>
          tag[0] === 'd' ? ['d', '0'.repeat(64)] : tag,
        ),
      ),
    ]
    for (const fixture of fixtures) {
      const result = await validateKind32014Event(fixture, {
        verifyEvent: false,
      })
      expect(result.valid).toBe(false)
    }
  })

  it('does not fall back across context; exact c only', async () => {
    const generic = await signedRating({ context: undefined, createdAt: 1 })
    const product = await signedRating({ context: 'product', createdAt: 2 })
    const reduced = await reduceKind32014Events([generic, product])
    expect(reduced.statements).toHaveLength(2)
    expect(reduced.statements.map((row) => row.context).sort()).toEqual([
      '',
      'product',
    ])
  })

  it('uses highest created_at then lexically lowest id for replacement', async () => {
    const older = await signedRating({ score: '20', createdAt: 10 })
    const newestA = await signedRating({ score: '80', createdAt: 11 })
    const newestB = await signedRating({ score: '', createdAt: 11 })
    const expected = [newestA, newestB].sort((left, right) =>
      left.id.localeCompare(right.id),
    )[0]

    const reduced = await reduceKind32014Events([
      expected === newestA ? newestB : newestA,
      older,
      expected,
    ])
    expect(reduced.rejected).toEqual([])
    expect(reduced.statements).toHaveLength(1)
    expect(reduced.statements[0].event.id).toBe(expected.id)
  })

  it('reports inclusive active windows; cancel ignores x/y', async () => {
    const active = await parseKind32014Event(
      await signedRating({ activationTime: 10, expirationTime: 20 }),
    )
    expect(getRatingStatementActiveStatus(active, 9)).toBe('not_yet_active')
    expect(getRatingStatementActiveStatus(active, 10)).toBe('active')
    expect(getRatingStatementActiveStatus(active, 20)).toBe('active')
    expect(getRatingStatementActiveStatus(active, 21)).toBe('expired')

    const cancelled = await parseKind32014Event(
      await signedRating({
        score: '',
        activationTime: 100,
        expirationTime: 200,
        createdAt: 1_700_000_004,
      }),
    )
    expect(getRatingStatementActiveStatus(cancelled, 150)).toBe('cancelled')
  })
})
