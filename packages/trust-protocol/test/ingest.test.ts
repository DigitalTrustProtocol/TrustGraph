import { finalizeEvent, generateSecretKey, getPublicKey, nip19, type Event } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import {
  buildKind10011ClearEvent,
  buildKind10011Event,
  buildKind32009Event,
  buildKind32014Event,
  classifyEvent,
  hintPubkeyFromTags,
  identityClaimFromEvent,
  scopeVerdict,
  validateDeletionEvent,
  type BuildKind32009Input,
} from '../src/index'

const alice = generateSecretKey()
const alicePub = getPublicKey(alice)
const carol = generateSecretKey()
const carolPub = getPublicKey(carol)
const carolNpub = nip19.npubEncode(carolPub)

async function trustEvent(overrides: Partial<BuildKind32009Input> = {}): Promise<Event> {
  return finalizeEvent(
    await buildKind32009Event({
      subject: { type: 'i', value: 'user:id:11348282' },
      value: '1',
      context: 'identity',
      scopes: ['x.com'],
      createdAt: 1_700_000_000,
      ...overrides,
    }),
    alice,
  )
}

describe('scope profile x.com', () => {
  it('matches the Attention eligibility and rank rules', () => {
    expect(scopeVerdict(32009, [])).toEqual({ eligible: true, scopeRank: 1 })
    expect(scopeVerdict(32009, ['x.com'])).toEqual({ eligible: true, scopeRank: 2 })
    expect(scopeVerdict(32009, ['example.com'])).toEqual({ eligible: false, scopeRank: 0 })
    expect(scopeVerdict(32014, [])).toEqual({ eligible: false, scopeRank: 0 })
    expect(scopeVerdict(32014, ['x.com'])).toEqual({ eligible: true, scopeRank: 2 })
    expect(scopeVerdict(10011, ['x.com']).eligible).toBe(false)
  })
})

describe('classifyEvent', () => {
  it('normalizes a 32009 with model columns, scope rank, and hint pubkey', async () => {
    const event = await trustEvent({ subjectHints: [{ kind: 'npub', npub: carolNpub }] })
    const result = await classifyEvent(event, { now: 5 })
    expect(result.type).toBe('statement')
    if (result.type !== 'statement') return
    const d = event.tags.find((t) => t[0] === 'd')![1]
    expect(result.record).toMatchObject({
      id: event.id,
      pubkey: alicePub,
      firstSeenAt: 5,
      addressKey: `32009:${alicePub}:${d}`,
      subject: 'user:id:11348282',
      subjectType: 'i',
      c_tag: 'identity',
      nValue: 1,
      scopeRank: 2,
      hintPubkey: carolPub,
      sig: event.sig,
    })
  })

  it('keeps Delete winners (empty v) as records without a value', async () => {
    const result = await classifyEvent(await trustEvent({ value: '' }))
    expect(result.type).toBe('statement')
    if (result.type === 'statement') expect(result.record.nValue).toBeUndefined()
  })

  it('does not read npub hints without s=x.com or on non user:id subjects', async () => {
    const empty = await classifyEvent(
      await trustEvent({ scopes: [], subjectHints: [{ kind: 'npub', npub: carolNpub }] }),
    )
    expect(empty.type).toBe('statement')
    if (empty.type === 'statement') expect(empty.record.hintPubkey).toBeUndefined()
    expect(
      hintPubkeyFromTags([
        ['i', 'post:id:1', carolNpub],
        ['s', 'x.com'],
      ]),
    ).toBeUndefined()
    expect(
      hintPubkeyFromTags([
        ['i', 'user:id:1', 'web:profile:x', carolNpub],
        ['s', 'x.com'],
      ]),
    ).toBe(carolPub)
  })

  it('blocks ineligible scopes and rejects invalid signatures', async () => {
    const other = await classifyEvent(await trustEvent({ scopes: ['example.com'] }))
    expect(other).toMatchObject({ type: 'rejected', prefix: 'blocked' })
    const forged = { ...(await trustEvent()), sig: 'ab'.repeat(64) }
    expect(await classifyEvent(forged)).toMatchObject({ type: 'rejected', prefix: 'invalid' })
    expect(await classifyEvent({ kind: 1 })).toMatchObject({ type: 'rejected', prefix: 'invalid' })
  })

  it('blocks ratings without s=x.com and other kinds', async () => {
    const rating = finalizeEvent(
      await buildKind32014Event({
        subject: { type: 'i', value: 'post:id:9' },
        score: '80',
        createdAt: 10,
      }),
      alice,
    )
    expect(await classifyEvent(rating)).toMatchObject({ type: 'rejected', prefix: 'blocked' })
    const note = finalizeEvent({ kind: 1, created_at: 1, tags: [], content: 'hi' }, alice)
    expect(await classifyEvent(note)).toMatchObject({ type: 'rejected', prefix: 'blocked' })
  })

  it('extracts the 10011 claim and keeps a revoked 10011 as a claimless winner', async () => {
    const claimEvent = finalizeEvent(
      buildKind10011Event({ handle: 'nasa', twitterId: '11348282', createdAt: 100 }),
      carol,
    )
    const claimed = await classifyEvent(claimEvent)
    expect(claimed).toMatchObject({
      type: 'identity',
      record: { addressKey: `10011:${carolPub}:` },
      claim: { pubkey: carolPub, twitterId: '11348282', eventId: claimEvent.id },
    })
    expect(identityClaimFromEvent(claimEvent)?.twitterId).toBe('11348282')

    const revoked = finalizeEvent(
      buildKind10011ClearEvent({ createdAt: 200, existingEvent: claimEvent }),
      carol,
    )
    const cleared = await classifyEvent(revoked)
    expect(cleared.type).toBe('identity')
    expect(cleared.type === 'identity' && cleared.claim).toBeUndefined()
  })
})

describe('NIP-09 deletions', () => {
  it('accepts e targets and own a targets for held kinds', async () => {
    const target = await trustEvent()
    const d = target.tags.find((t) => t[0] === 'd')![1]
    const deletion = finalizeEvent(
      {
        kind: 5,
        created_at: 1_700_000_100,
        content: '',
        tags: [
          ['e', target.id],
          ['a', `32009:${alicePub}:${d}`],
          ['a', `32009:${carolPub}:${d}`],
          ['a', `30023:${alicePub}:post`],
        ],
      },
      alice,
    )
    const result = validateDeletionEvent(deletion)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.deletion.eventIds).toEqual([target.id])
    expect(result.deletion.addresses.map((a) => a.addressKey)).toEqual([
      `32009:${alicePub}:${d}`,
    ])
  })

  it('blocks deletions that only target other kinds or other authors', async () => {
    const deletion = finalizeEvent(
      { kind: 5, created_at: 1, content: '', tags: [['a', `30023:${alicePub}:post`]] },
      alice,
    )
    expect(await classifyEvent(deletion)).toMatchObject({ type: 'rejected', prefix: 'blocked' })
    const malformed = finalizeEvent(
      { kind: 5, created_at: 1, content: '', tags: [['e', 'nothex']] },
      alice,
    )
    expect(await classifyEvent(malformed)).toMatchObject({ type: 'rejected', prefix: 'invalid' })
  })
})
