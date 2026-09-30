// Ported from AttentionX src/shared/rating-score.test.ts (imports rewritten for @dtp/* packages).
import { describe, expect, it } from 'vitest'
import {
  averageRatingScore,
  ratingScoreTone,
  roundRatingScore,
} from '../src/shared/rating-score'

describe('averageRatingScore', () => {
  it('is the mean of claim scores', () => {
    expect(averageRatingScore([80, 40])).toBe(60)
    expect(averageRatingScore([100])).toBe(100)
  })

  it('is null when there are no claims', () => {
    expect(averageRatingScore([])).toBeNull()
  })
})

describe('roundRatingScore', () => {
  it('rounds to the nearest integer', () => {
    expect(roundRatingScore(71.4)).toBe(71)
    expect(roundRatingScore(71.5)).toBe(72)
  })
})

describe('ratingScoreTone', () => {
  it('uses the same 25 / 75 cuts as trust', () => {
    expect(ratingScoreTone(null)).toBe('neutral')
    expect(ratingScoreTone(100)).toBe('trust')
    expect(ratingScoreTone(75)).toBe('trust')
    expect(ratingScoreTone(74)).toBe('question')
    expect(ratingScoreTone(25)).toBe('question')
    expect(ratingScoreTone(24)).toBe('misleading')
    expect(ratingScoreTone(0)).toBe('misleading')
  })

  it('turns 71 green when green is 60', () => {
    expect(ratingScoreTone(71, { red: 25, green: 60 })).toBe('trust')
    expect(ratingScoreTone(71, { red: 25, green: 75 })).toBe('question')
  })
})
