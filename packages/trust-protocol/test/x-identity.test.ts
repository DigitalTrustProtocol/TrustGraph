// Ported from AttentionX src/shared/x-identity.test.ts (imports rewritten for @dtp/* packages).
import { describe, expect, it } from 'vitest'
import {
  buildNip39TwitterLinkTags,
  canonicalTwitterAccountClass,
  canonicalTwitterAccountSubject,
  canonicalTwitterPostClass,
  canonicalTwitterPostSubject,
  canonicalTwitterPostUrl,
  canonicalTwitterProfileId,
  canonicalTwitterProfileUrl,
  isEligibleXRatingScope,
  isEligibleXTrustScope,
  normalizeTwitterHandle,
  parseCanonicalTwitterSubject,
  parseTwitterIdFromAuthorMeta,
  xAccountTrustSubject,
  scopesFromEventTags,
  xTrustScopeRank,
  X_TRUST_SCOPE,
} from '../src/x-identity'

describe('x-identity', () => {
  it('normalizes Twitter handles', () => {
    expect(normalizeTwitterHandle('@NASA')).toBe('nasa')
    expect(normalizeTwitterHandle('NASA')).toBe('nasa')
  })

  it('parses numeric author identifiers from Schema.org metadata', () => {
    expect(parseTwitterIdFromAuthorMeta('11348282')).toBe('11348282')
    expect(parseTwitterIdFromAuthorMeta('nasa')).toBeUndefined()
    expect(parseTwitterIdFromAuthorMeta(undefined)).toBeUndefined()
  })

  it('prefers twitter_id for canonical profile references', () => {
    expect(
      canonicalTwitterProfileUrl({ handle: 'nasa', twitterId: '11348282' }),
    ).toBe('https://x.com/i/user/11348282')
    expect(
      canonicalTwitterProfileId({ handle: 'nasa', twitterId: '11348282' }),
    ).toBe('11348282')
  })

  it('falls back to handle when twitter_id is unavailable', () => {
    expect(canonicalTwitterProfileUrl({ handle: 'NASA' })).toBe(
      'https://x.com/nasa',
    )
    expect(canonicalTwitterProfileId({ handle: 'NASA' })).toBe('nasa')
  })

  it('builds stable account and post subjects and URLs', () => {
    expect(canonicalTwitterAccountSubject('0011348282')).toBe(
      'user:id:0011348282',
    )
    expect(canonicalTwitterPostSubject('2080659774136291424')).toBe(
      'post:id:2080659774136291424',
    )
    expect(canonicalTwitterAccountClass()).toBe('user:id')
    expect(canonicalTwitterPostClass()).toBe('post:id')
    expect(X_TRUST_SCOPE).toBe('x.com')
    expect(canonicalTwitterPostUrl('2080659774136291424')).toBe(
      'https://x.com/i/web/status/2080659774136291424',
    )
    expect(parseCanonicalTwitterSubject('user:id:11348282')).toEqual({
      type: 'account',
      twitterId: '11348282',
    })
    expect(
      parseCanonicalTwitterSubject('post:id:2080659774136291424'),
    ).toEqual({ type: 'post', postId: '2080659774136291424' })
    expect(xAccountTrustSubject('11348282')).toEqual({
      type: 'i',
      value: 'user:id:11348282',
    })
    expect(xAccountTrustSubject('nasa')).toBeUndefined()
    expect(xAccountTrustSubject(undefined)).toBeUndefined()
  })

  it('treats empty and x.com scopes as X-eligible with x.com precedence', () => {
    expect(isEligibleXTrustScope([])).toBe(true)
    expect(isEligibleXTrustScope(['x.com'])).toBe(true)
    expect(isEligibleXTrustScope(['x.com', 'twitter.com'])).toBe(true)
    expect(isEligibleXTrustScope(['github.com'])).toBe(false)
    expect(xTrustScopeRank([])).toBe(1)
    expect(xTrustScopeRank(['x.com'])).toBe(2)
    expect(xTrustScopeRank(['github.com'])).toBe(0)
    expect(scopesFromEventTags([['s', 'X.COM'], ['i', 'user:id:1']])).toEqual([
      'x.com',
    ])
    expect(scopesFromEventTags([['i', 'user:id:1']])).toEqual([])
  })

  it('requires s=x.com for kind 32014 ratings', () => {
    expect(isEligibleXRatingScope([])).toBe(false)
    expect(isEligibleXRatingScope(['x.com'])).toBe(true)
    expect(isEligibleXRatingScope(['github.com'])).toBe(false)
    expect(isEligibleXRatingScope(['x.com', 'github.com'])).toBe(true)
  })

  it('rejects non-numeric durable identifiers and invalid handles', () => {
    expect(() => canonicalTwitterAccountSubject('1e3')).toThrow()
    expect(() => canonicalTwitterPostSubject('')).toThrow()
    expect(() => canonicalTwitterPostUrl('-1')).toThrow()
    expect(() => canonicalTwitterProfileUrl({ handle: 'not valid' })).toThrow()
    expect(() =>
      canonicalTwitterProfileUrl({ handle: 'nasa', twitterId: 'invalid' }),
    ).toThrow()
    expect(parseCanonicalTwitterSubject('user:id:abc')).toBeUndefined()
  })

  it('builds NIP-39 kind 10011 tags for handle and twitter_id', () => {
    expect(
      buildNip39TwitterLinkTags('NASA', '11348282', '2080659774136291424'),
    ).toEqual([
      ['i', 'twitter:nasa', '2080659774136291424', 'post:id:2080659774136291424'],
      [
        'i',
        'twitter_id:11348282',
        '2080659774136291424',
        'post:id:2080659774136291424',
      ],
    ])
  })

  it('rejects invalid NIP-39 link values', () => {
    expect(() => buildNip39TwitterLinkTags('NASA', 'abc', '123')).toThrow()
    expect(() => buildNip39TwitterLinkTags('NASA', '123', 'proof')).toThrow()
  })
})
