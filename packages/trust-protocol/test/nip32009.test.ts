// Ported from AttentionX src/lib/nostr/nip32009.test.ts (imports rewritten for @dtp/* packages).
import { describe, expect, it } from 'vitest'
import { fillEventRecordColumns, KIND_TRUST } from '../src/nip32009'
import type { EventRecord } from '../src/types'
import { RATING_STATEMENT_KIND } from '../src/kind-32014'

function record(
  overrides: Partial<EventRecord> & Pick<EventRecord, 'tags'>,
): EventRecord {
  return {
    id: 'aa'.repeat(32),
    pubkey: 'bb'.repeat(32),
    created_at: 10,
    kind: KIND_TRUST,
    content: '',
    sig: 'cc'.repeat(64),
    firstSeenAt: 1,
    addressKey: 'k',
    ...overrides,
  }
}

describe('fillEventRecordColumns', () => {
  it('fills heap fields from a stored 32009 winner', () => {
    const pubkey = 'ab'.repeat(32)
    const subject = 'cd'.repeat(32)
    const columns = fillEventRecordColumns(
      record({
        pubkey,
        tags: [
          ['d', 'ff'.repeat(32)],
          ['p', subject],
          ['v', '1'],
          ['c', 'identity'],
        ],
      }),
    )
    expect(columns).toMatchObject({
      subject,
      subjectType: 'p',
      nValue: 1,
      c_tag: 'identity',
    })
    expect(columns?.addressableId).toBeUndefined()
  })

  it('omits nValue on tombstones with empty v', () => {
    const columns = fillEventRecordColumns(
      record({
        tags: [
          ['d', 'ff'.repeat(32)],
          ['p', 'cd'.repeat(32)],
          ['v', ''],
        ],
      }),
    )
    expect(columns?.nValue).toBeUndefined()
    expect(columns?.subjectType).toBe('p')
    expect(columns?.addressableId).toBeUndefined()
  })

  it('fills 32014 score into nValue', () => {
    const columns = fillEventRecordColumns(
      record({
        kind: RATING_STATEMENT_KIND,
        tags: [
          ['d', 'ff'.repeat(32)],
          ['i', 'post:id:9'],
          ['score', '80'],
        ],
      }),
    )
    expect(columns).toMatchObject({
      subject: 'post:id:9',
      subjectType: 'i',
      nValue: 80,
      c_tag: '',
    })
  })
})
