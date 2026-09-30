// Ported from AttentionX src/shared/wot-follow-trust-threshold.test.ts (imports rewritten for @dtp/* packages).
import { describe, expect, it } from 'vitest'
import {
  FOLLOW_TRUST_GREEN_DEFAULT,
  FOLLOW_TRUST_RED_DEFAULT,
  FOLLOW_TRUST_THRESHOLD_DEFAULT,
  FOLLOW_TRUST_THRESHOLD_MAX,
  FOLLOW_TRUST_THRESHOLD_MIN,
  clampFollowTrustBand,
  clampFollowTrustRed,
  clampFollowTrustThreshold,
  followTrustBandFromStored,
  moveFollowTrustKnob,
  resolutionFromPercent,
  toneFromPercent,
} from '../src/shared/wot-follow-trust-threshold'

describe('clampFollowTrustThreshold', () => {
  it('keeps integers in [0, 100]', () => {
    expect(clampFollowTrustThreshold(0)).toBe(FOLLOW_TRUST_THRESHOLD_MIN)
    expect(clampFollowTrustThreshold(75)).toBe(FOLLOW_TRUST_THRESHOLD_DEFAULT)
    expect(clampFollowTrustThreshold(100)).toBe(FOLLOW_TRUST_THRESHOLD_MAX)
    expect(clampFollowTrustThreshold(50.4)).toBe(50)
    expect(clampFollowTrustThreshold(50.6)).toBe(51)
    expect(clampFollowTrustThreshold(1)).toBe(1)
  })

  it('clamps out of range and falls back for invalid values', () => {
    expect(clampFollowTrustThreshold(-1)).toBe(FOLLOW_TRUST_THRESHOLD_MIN)
    expect(clampFollowTrustThreshold(101)).toBe(FOLLOW_TRUST_THRESHOLD_MAX)
    expect(clampFollowTrustThreshold(Number.NaN)).toBe(
      FOLLOW_TRUST_GREEN_DEFAULT,
    )
    expect(clampFollowTrustThreshold('75')).toBe(FOLLOW_TRUST_GREEN_DEFAULT)
    expect(clampFollowTrustThreshold(undefined)).toBe(
      FOLLOW_TRUST_GREEN_DEFAULT,
    )
    expect(clampFollowTrustThreshold(Number.POSITIVE_INFINITY)).toBe(
      FOLLOW_TRUST_GREEN_DEFAULT,
    )
  })
})

describe('clampFollowTrustBand', () => {
  it('defaults to 25 / 75', () => {
    expect(clampFollowTrustBand(undefined, undefined)).toEqual({
      red: FOLLOW_TRUST_RED_DEFAULT,
      green: FOLLOW_TRUST_GREEN_DEFAULT,
    })
  })

  it('keeps integer percents and allows a yellow span', () => {
    expect(clampFollowTrustBand(27, 73)).toEqual({ red: 27, green: 73 })
    expect(clampFollowTrustBand(20, 50)).toEqual({ red: 20, green: 50 })
  })

  it('lets the knobs meet with no yellow', () => {
    expect(clampFollowTrustBand(4, 4)).toEqual({ red: 4, green: 4 })
    expect(clampFollowTrustBand(0, 0)).toEqual({
      red: FOLLOW_TRUST_THRESHOLD_MIN,
      green: FOLLOW_TRUST_THRESHOLD_MIN,
    })
    expect(clampFollowTrustBand(100, 100)).toEqual({
      red: FOLLOW_TRUST_THRESHOLD_MAX,
      green: FOLLOW_TRUST_THRESHOLD_MAX,
    })
  })

  it('squeezes red down when the pair would cross', () => {
    expect(clampFollowTrustBand(25, 4)).toEqual({ red: 4, green: 4 })
    expect(clampFollowTrustBand(undefined, 20)).toEqual({
      red: 20,
      green: 20,
    })
  })
})

describe('moveFollowTrustKnob', () => {
  const start = { red: 25, green: 75 }

  it('pulls green down onto red and removes yellow', () => {
    expect(moveFollowTrustKnob(start, 'green', 4)).toEqual({
      red: 4,
      green: 4,
    })
  })

  it('pushes green up when red is dragged past it', () => {
    expect(moveFollowTrustKnob(start, 'red', 80)).toEqual({
      red: 80,
      green: 80,
    })
  })

  it('slides either knob to 0 or 100 without a forced gap', () => {
    expect(moveFollowTrustKnob(start, 'red', 0)).toEqual({
      red: 0,
      green: 75,
    })
    expect(moveFollowTrustKnob(start, 'green', 100)).toEqual({
      red: 25,
      green: 100,
    })
    expect(moveFollowTrustKnob(start, 'green', 0)).toEqual({
      red: 0,
      green: 0,
    })
  })
})

describe('followTrustBandFromStored', () => {
  it('migrates a single stored 75 into the default pair', () => {
    expect(
      followTrustBandFromStored({ followTrustThreshold: 75 }),
    ).toEqual({
      red: FOLLOW_TRUST_RED_DEFAULT,
      green: FOLLOW_TRUST_GREEN_DEFAULT,
    })
  })

  it('preserves a stored green of 50 and keeps default red', () => {
    expect(
      followTrustBandFromStored({ followTrustThreshold: 50 }),
    ).toEqual({ red: FOLLOW_TRUST_RED_DEFAULT, green: 50 })
  })

  it('squeezes red when a legacy green sits below the default red', () => {
    expect(
      followTrustBandFromStored({ followTrustThreshold: 20 }),
    ).toEqual({ red: 20, green: 20 })
  })

  it('prefers explicit red/green over the legacy field', () => {
    expect(
      followTrustBandFromStored({
        followTrustRed: 30,
        followTrustGreen: 80,
        followTrustThreshold: 40,
      }),
    ).toEqual({ red: 30, green: 80 })
  })
})

describe('clampFollowTrustRed', () => {
  it('defaults to 25 and may equal green', () => {
    expect(clampFollowTrustRed(undefined, 75)).toBe(FOLLOW_TRUST_RED_DEFAULT)
    expect(clampFollowTrustRed(25, 1)).toBe(1)
    expect(clampFollowTrustRed(80, 75)).toBe(75)
  })
})

describe('toneFromPercent', () => {
  it('uses the same 25 / 75 cuts as trust resolution', () => {
    expect(toneFromPercent(null)).toBe('neutral')
    expect(toneFromPercent(100)).toBe('trust')
    expect(toneFromPercent(75)).toBe('trust')
    expect(toneFromPercent(74)).toBe('question')
    expect(toneFromPercent(25)).toBe('question')
    expect(toneFromPercent(24)).toBe('misleading')
    expect(toneFromPercent(0)).toBe('misleading')
  })
})

describe('resolutionFromPercent', () => {
  it('maps share percent onto the default 25 / 75 band', () => {
    expect(resolutionFromPercent(null)).toBe('none')
    expect(resolutionFromPercent(75)).toBe('trusted')
    expect(resolutionFromPercent(74)).toBe('mixed')
    expect(resolutionFromPercent(25)).toBe('mixed')
    expect(resolutionFromPercent(24)).toBe('distrusted')
  })

  it('follows a custom red / green band', () => {
    const band = { red: 40, green: 60 }
    expect(resolutionFromPercent(60, band)).toBe('trusted')
    expect(resolutionFromPercent(59, band)).toBe('mixed')
    expect(resolutionFromPercent(40, band)).toBe('mixed')
    expect(resolutionFromPercent(39, band)).toBe('distrusted')
  })
})
