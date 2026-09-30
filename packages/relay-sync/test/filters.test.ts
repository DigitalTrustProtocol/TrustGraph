// Ported from AttentionX src/relay/filters.test.ts (imports rewritten for @dtp/* packages).
import { describe, expect, it } from 'vitest'
import {
  batchXTrustSubjectIds,
  buildAuthorRatingSyncFilter,
  buildAuthorTrustSyncFilter,
  buildGlobalKindSyncFilter,
  buildTrustSlotFilter,
  buildXAccountTrustDiscoveryFilter,
  buildXPostSubjectFilter,
  buildXScopedTrustFilter,
  frontierKindSyncScope,
  globalKindSyncScope,
  xSubjectSyncScope,
} from '../src/filters'

describe('buildXPostSubjectFilter', () => {
  it('asks for trust and ratings about the posts by #i only', () => {
    expect(buildXPostSubjectFilter(['9', ' 10 ', '9'])).toEqual({
      kinds: [32009, 32014],
      '#i': ['post:id:9', 'post:id:10'],
    })
    expect(buildXPostSubjectFilter(['9'], 50)).toEqual({
      kinds: [32009, 32014],
      '#i': ['post:id:9'],
      since: 50,
    })
  })

  it('rejects non-numeric post ids', () => {
    expect(() => buildXPostSubjectFilter([])).toThrow(/numeric X post id/i)
    expect(() => buildXPostSubjectFilter(['abc'])).toThrow(/numeric X post id/i)
  })
})

describe('relay trust filters', () => {
  const author = 'a'.repeat(64)
  const d = 'b'.repeat(64)

  it('builds author WoT sync without #s so empty-scope user trusts match', () => {
    expect(buildAuthorTrustSyncFilter(author)).toEqual({
      kinds: [32009],
      authors: [author],
    })
    expect(buildAuthorTrustSyncFilter(author, 100)).toEqual({
      kinds: [32009],
      authors: [author],
      since: 100,
    })
  })

  it('builds a separate author rating sync for kind 32014', () => {
    expect(buildAuthorRatingSyncFilter(author)).toEqual({
      kinds: [32014],
      authors: [author],
      '#s': ['x.com'],
    })
    expect(buildAuthorRatingSyncFilter(author, 100)).toEqual({
      kinds: [32014],
      authors: [author],
      '#s': ['x.com'],
      since: 100,
    })
  })

  it('builds X account discovery with user:id and k, without requiring #s', () => {
    expect(buildXAccountTrustDiscoveryFilter(['42', '11348282'])).toEqual({
      kinds: [32009],
      '#k': ['user:id'],
      '#i': ['user:id:42', 'user:id:11348282'],
    })
    expect(
      buildXAccountTrustDiscoveryFilter(['42', '42'], 50),
    ).toEqual({
      kinds: [32009],
      '#k': ['user:id'],
      '#i': ['user:id:42'],
      since: 50,
    })
  })

  it('builds an explicit x.com-scoped companion filter', () => {
    expect(
      buildXScopedTrustFilter({
        authors: [author],
      }),
    ).toEqual({
      kinds: [32009],
      authors: [author],
      '#s': ['x.com'],
    })
  })

  it('rejects empty X subject discovery batches', () => {
    expect(() => buildXAccountTrustDiscoveryFilter([])).toThrow(
      /numeric X user id/i,
    )
    expect(() => buildXAccountTrustDiscoveryFilter(['nasa'])).toThrow(
      /numeric X user id/i,
    )
  })

  it('builds slot refresh filters', () => {
    expect(buildTrustSlotFilter(author, d)).toEqual({
      kinds: [32009],
      authors: [author],
      '#d': [d],
    })
  })

  it('batches observed X ids for relay subject filters', () => {
    expect(batchXTrustSubjectIds(['1', '2', '3'], 2)).toEqual([
      ['1', '2'],
      ['3'],
    ])
    expect(xSubjectSyncScope('attentionx-wot-v1')).toBe(
      'attentionx-wot-v1:x-subjects',
    )
  })

  it('builds global allowlist filters without authors', () => {
    expect(buildGlobalKindSyncFilter(32009, 50)).toEqual({
      kinds: [32009],
      since: 50,
    })
    expect(globalKindSyncScope('attentionx-wot-v1', 10011)).toBe(
      'attentionx-wot-v1:kind:10011:global',
    )
    expect(frontierKindSyncScope('attentionx-wot-v1', 32014)).toBe(
      'attentionx-wot-v1:kind:32014:frontier-live',
    )
  })
})
