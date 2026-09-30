// Ported from AttentionX src/shared/trust-context.test.ts (imports rewritten for @dtp/* packages).
import { describe, expect, it } from 'vitest'
import {
  IDENTITY_TRUST_CONTEXT,
  contextField,
  isPersonTrustSubject,
  isPostTrustSubject,
  ratingPublishContextForSubject,
  ratingQueryContextForSubject,
  trustPublishContextForSubject,
  trustQueryContextForSubject,
} from '../src/shared/trust-context'

describe('trust-context', () => {
  it('classifies person vs post subjects', () => {
    expect(isPersonTrustSubject({ type: 'p', value: 'ab'.repeat(32) })).toBe(
      true,
    )
    expect(
      isPersonTrustSubject({ type: 'i', value: 'user:id:11348282' }),
    ).toBe(true)
    expect(isPostTrustSubject({ type: 'i', value: 'post:id:99' })).toBe(true)
    expect(isPersonTrustSubject({ type: 'i', value: 'post:id:99' })).toBe(
      false,
    )
    expect(isPersonTrustSubject({ type: 'e', value: 'cd'.repeat(32) })).toBe(
      false,
    )
  })

  it('queries all trust through identity and publishes posts without c', () => {
    const user = { type: 'i' as const, value: 'user:id:1' }
    const post = { type: 'i' as const, value: 'post:id:2' }
    const pubkey = { type: 'p' as const, value: 'ab'.repeat(32) }
    expect(trustQueryContextForSubject(user)).toBe(IDENTITY_TRUST_CONTEXT)
    expect(trustQueryContextForSubject(post)).toBe(IDENTITY_TRUST_CONTEXT)
    expect(trustPublishContextForSubject(pubkey)).toBe(IDENTITY_TRUST_CONTEXT)
    expect(trustPublishContextForSubject(post)).toBe('')
    expect(ratingQueryContextForSubject(post)).toBe('')
    expect(ratingPublishContextForSubject(post)).toBe('')
    expect(contextField(IDENTITY_TRUST_CONTEXT)).toEqual({
      context: IDENTITY_TRUST_CONTEXT,
    })
    expect(contextField('')).toEqual({})
  })
})
