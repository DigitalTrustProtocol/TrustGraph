// Ported from AttentionX src/shared/rating-score.ts (imports rewritten for @dtp/* packages).
import {
  DEFAULT_FOLLOW_TRUST_BAND,
  toneFromPercent,
  type FollowTrustBand,
  type FollowTrustTone,
} from './wot-follow-trust-threshold'

/** Mean of 0–100 claim scores. Empty → null. */
export function averageRatingScore(
  scores: readonly number[],
): number | null {
  if (scores.length === 0) return null
  const sum = scores.reduce((total, score) => total + score, 0)
  return sum / scores.length
}

export function roundRatingScore(score: number): number {
  return Math.round(score)
}

/** Same red / green knobs as user trust. No score stays gray. */
export function ratingScoreTone(
  score: number | null,
  band: FollowTrustBand = DEFAULT_FOLLOW_TRUST_BAND,
): FollowTrustTone {
  if (score === null) return 'neutral'
  return toneFromPercent(score, band)
}
