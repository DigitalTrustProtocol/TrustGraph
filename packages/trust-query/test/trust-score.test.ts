// Ported from AttentionX src/shared/trust-score.test.ts (imports rewritten for @dtp/* packages).
import { describe, expect, it } from 'vitest'
import {
  meetsFollowTrustGreen,
  trustScorePercent,
  trustScoreResolution,
  trustScoredCount,
} from '../src/shared/trust-score'

describe('trustScoredCount', () => {
  it('sums trust and distrust', () => {
    expect(trustScoredCount(3, 1)).toBe(4)
    expect(trustScoredCount(0, 0)).toBe(0)
  })
})

describe('trustScorePercent', () => {
  it('rounds trust * 100 / (trust + distrust)', () => {
    expect(trustScorePercent(3, 1)).toBe(75)
    expect(trustScorePercent(1, 0)).toBe(100)
    expect(trustScorePercent(0, 2)).toBe(0)
    expect(trustScorePercent(1, 1)).toBe(50)
    expect(trustScorePercent(5, 2)).toBe(71)
  })

  it('is null when nothing is scored', () => {
    expect(trustScorePercent(0, 0)).toBeNull()
  })
})

describe('meetsFollowTrustGreen', () => {
  it('is a hop at or above green', () => {
    expect(meetsFollowTrustGreen(3, 1, 75)).toBe(true)
    expect(meetsFollowTrustGreen(1, 1, 75)).toBe(false)
    expect(meetsFollowTrustGreen(0, 0, 75)).toBe(false)
  })
})

describe('trustScoreResolution', () => {
  it('maps share percent onto the default 25 / 75 band', () => {
    expect(trustScoreResolution(3, 1, true)).toBe('trusted')
    expect(trustScoreResolution(1, 1, true)).toBe('mixed')
    expect(trustScoreResolution(0, 1, true)).toBe('distrusted')
    expect(trustScoreResolution(1, 0, false)).toBe('none')
    expect(trustScoreResolution(0, 0, true)).toBe('none')
  })

  it('turns Tesla-style 71% green when green is 60', () => {
    const tesla = { trust: 5, distrust: 2 }
    expect(trustScorePercent(tesla.trust, tesla.distrust)).toBe(71)
    expect(
      trustScoreResolution(tesla.trust, tesla.distrust, true, {
        red: 25,
        green: 60,
      }),
    ).toBe('trusted')
    expect(
      trustScoreResolution(tesla.trust, tesla.distrust, true, {
        red: 25,
        green: 75,
      }),
    ).toBe('mixed')
  })

  it('has no mixed band when red equals green', () => {
    const collapsed = { red: 4, green: 4 }
    expect(trustScoreResolution(1, 1, true, collapsed)).toBe('trusted')
    expect(trustScoreResolution(0, 1, true, collapsed)).toBe('distrusted')
  })
})
