// Ported from AttentionX src/graph/incoming.test.ts (imports rewritten for @dtp/* packages).
import { describe, expect, it } from 'vitest'
import {
  incomingSubjectKeys,
  isIncomingUserStatement,
  selectIncomingUserStatements,
} from '../../src/incoming'
import { trustRecord } from '../../src/testing'
import type { TrustSubject, TrustValue } from '../../src/types'

const alice = 'aa'.repeat(32)
const bob = 'bb'.repeat(32)

function statement(spec: {
  eventId: string
  author: string
  subject: TrustSubject
  value: TrustValue
  content?: string
}) {
  return trustRecord(spec.eventId, spec.author, spec.subject, spec.value, {
    context: 'identity',
    createdAt: 1_700_000_000,
    ...(spec.content !== undefined ? { content: spec.content } : {}),
  })
}

describe('isIncomingUserStatement', () => {
  const options = {
    twitterId: '1290800267441532928',
    pubkeyHexes: new Set([alice]),
  }

  it('keeps trust, neutral, and distrust on the target user:id', () => {
    expect(
      isIncomingUserStatement(
        statement({
          eventId: 't',
          author: bob,
          subject: { type: 'i', value: 'user:id:1290800267441532928' },
          value: 1,
        }),
        options,
      ),
    ).toBe(true)
    expect(
      isIncomingUserStatement(
        statement({
          eventId: 'n',
          author: bob,
          subject: { type: 'i', value: 'user:id:1290800267441532928' },
          value: 0,
        }),
        options,
      ),
    ).toBe(true)
    expect(
      isIncomingUserStatement(
        statement({
          eventId: 'd',
          author: bob,
          subject: { type: 'i', value: 'user:id:1290800267441532928' },
          value: -1,
        }),
        options,
      ),
    ).toBe(true)
  })

  it('keeps p-tag evidence onto a bound pubkey', () => {
    expect(
      isIncomingUserStatement(
        statement({
          eventId: 'p',
          author: bob,
          subject: { type: 'p', value: alice },
          value: 1,
        }),
        options,
      ),
    ).toBe(true)
  })

  it('drops other users, posts, and unbound pubkeys', () => {
    expect(
      isIncomingUserStatement(
        statement({
          eventId: 'other',
          author: bob,
          subject: { type: 'i', value: 'user:id:1' },
          value: 1,
        }),
        options,
      ),
    ).toBe(false)
    expect(
      isIncomingUserStatement(
        statement({
          eventId: 'post',
          author: bob,
          subject: { type: 'i', value: 'post:id:99' },
          value: 1,
        }),
        options,
      ),
    ).toBe(false)
    expect(
      isIncomingUserStatement(
        statement({
          eventId: 'unbound',
          author: bob,
          subject: { type: 'p', value: bob },
          value: 1,
        }),
        options,
      ),
    ).toBe(false)
  })
})

describe('selectIncomingUserStatements', () => {
  it('keeps every Graph.in edge, including Neutral and distrust', () => {
    const selected = selectIncomingUserStatements([
      statement({
        eventId: 'trust',
        author: bob,
        subject: { type: 'p', value: alice },
        value: 1,
        content: 'hop mesh',
      }),
      statement({
        eventId: 'distrust',
        author: bob,
        subject: { type: 'i', value: 'user:id:42' },
        value: -1,
        content: 'user slot',
      }),
      statement({
        eventId: 'neutral',
        author: alice,
        subject: { type: 'i', value: 'user:id:42' },
        value: 0,
        content: 'watching',
      }),
    ])
    expect(selected.truncated).toBe(false)
    expect(selected.statements.map((row) => row.eventId).sort()).toEqual([
      'distrust',
      'neutral',
      'trust',
    ])
    expect(selected.statements.map((row) => row.value).sort()).toEqual([
      -1, 0, 1,
    ])
  })

  it('lists the key hop once when the same author also trusts that user:id', () => {
    const selected = selectIncomingUserStatements([
      statement({
        eventId: 'key-hop',
        author: bob,
        subject: { type: 'p', value: alice },
        value: 1,
        content: 'Signs from a stable key and does not bounce identities.',
      }),
      statement({
        eventId: 'account-row',
        author: bob,
        subject: { type: 'i', value: 'user:id:42' },
        value: 1,
        content: 'Followed this account through Starship tests and product launches.',
      }),
    ])
    expect(selected.statements.map((row) => row.eventId)).toEqual(['key-hop'])
  })
})

describe('incomingSubjectKeys', () => {
  it('reads twitterId from user:id and hex from p', () => {
    expect(incomingSubjectKeys({ type: 'i', value: 'user:id:42' })).toEqual({
      twitterId: '42',
      pubkeyHexes: new Set(),
    })
    expect(incomingSubjectKeys({ type: 'p', value: alice })).toEqual({
      pubkeyHexes: new Set([alice]),
    })
  })
})
