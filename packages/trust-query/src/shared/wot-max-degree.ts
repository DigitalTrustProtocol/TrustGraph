// Ported from AttentionX src/shared/wot-max-degree.ts (imports rewritten for @dtp/* packages).
/** Default Sync and Resolve max degree (slider default). */
export const WOT_MAX_DEGREE_DEFAULT = 4

/** Hard upper bound for Sync and Resolve degree (slider max). */
export const WOT_MAX_DEGREE_HARD_CAP = 7

/** Minimum Sync and Resolve degree (slider min). */
export const WOT_MAX_DEGREE_MIN = 1

/** Inclusive slider degrees. Must stay contiguous from min through the hard cap. */
export const WOT_DEGREES = [1, 2, 3, 4, 5, 6, 7] as const

export type WotDegree = (typeof WOT_DEGREES)[number]

/** Soft hint threshold (ms) for popup guidance — not auto-lower. */
export const WOT_RESOLVE_SOFT_HINT_MS = 25

/** Auto-lower slider by one when a single cold resolve exceeds this (ms). */
export const WOT_RESOLVE_AUTO_LOWER_MS = 2_000

export const WOT_MAX_DEGREE_CHANGED_MESSAGE = 'WOT_MAX_DEGREE_CHANGED' as const

export const RESOLVE_TIMING_STORAGE_KEY = 'attentionxResolveTimingV1'

export function clampWotMaxDegree(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.round(value)
    if (Number.isSafeInteger(rounded)) {
      return Math.min(
        WOT_MAX_DEGREE_HARD_CAP,
        Math.max(WOT_MAX_DEGREE_MIN, rounded),
      )
    }
  }
  return WOT_MAX_DEGREE_DEFAULT
}
