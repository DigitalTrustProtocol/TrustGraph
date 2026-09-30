/**
 * Hop threshold used by the vendored `IndexResolver`. Moved unchanged from
 * AttentionX `shared/trust-score.ts` (library.md § Extraction plan).
 */

/** Trust + distrust. Neutrals are not scored. */
export function trustScoredCount(trust: number, distrust: number): number {
  return trust + distrust
}

/**
 * Share percent: `Math.round((trust * 100) / scored)`.
 * Null when there are no Trust or Distrust edges.
 */
export function trustScorePercent(
  trust: number,
  distrust: number,
): number | null {
  const scored = trustScoredCount(trust, distrust)
  if (scored <= 0) return null
  return Math.round((trust * 100) / scored)
}

/** Green hop / Trusted cut: rounded share percent at or above green. */
export function meetsFollowTrustGreen(
  trust: number,
  distrust: number,
  green: number,
): boolean {
  const percent = trustScorePercent(trust, distrust)
  return percent !== null && percent >= green
}
