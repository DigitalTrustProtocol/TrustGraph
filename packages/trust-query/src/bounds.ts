// Ported from AttentionX src/graph/bounds.ts (imports rewritten for @dtp/* packages).
import {
  WOT_MAX_DEGREE_DEFAULT,
  WOT_MAX_DEGREE_HARD_CAP,
} from './shared/wot-max-degree'
import type { GraphBounds, ResolveBounds } from './types'

/** Defaults for IndexResolver / QUERY_TRUST (fan-out caps do not apply). */
export const DEFAULT_RESOLVE_BOUNDS: Readonly<ResolveBounds> = Object.freeze({
  maxDepth: WOT_MAX_DEGREE_DEFAULT,
})

/** Hard upper bound for resolve maxDepth (Sync and Resolve slider max). */
export const RESOLVE_MAX_DEPTH_HARD_CAP = WOT_MAX_DEGREE_HARD_CAP

/**
 * Defaults for WoT sync expansion when callers pass GraphBounds-shaped limits.
 * Relay synchronizer also has its own DEFAULT_GRAPH_SYNC_LIMITS.
 */
export const DEFAULT_GRAPH_BOUNDS: Readonly<GraphBounds> = Object.freeze({
  maxDepth: WOT_MAX_DEGREE_DEFAULT,
  maxAuthorsPerLevel: 250,
  maxTotalAuthors: 1_000,
  maxEvents: 5_000,
})

function bound(
  name: string,
  value: number | undefined,
  fallback: number,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`)
  }
  return resolved
}

export function normalizeResolveBounds(
  bounds: Partial<ResolveBounds> = {},
): ResolveBounds {
  const maxDepth = bound(
    'maxDepth',
    bounds.maxDepth,
    DEFAULT_RESOLVE_BOUNDS.maxDepth,
  )
  return {
    maxDepth: Math.min(maxDepth, WOT_MAX_DEGREE_HARD_CAP),
  }
}

export function normalizeBounds(
  bounds: Partial<GraphBounds> = {},
): GraphBounds {
  return {
    maxDepth: bound('maxDepth', bounds.maxDepth, DEFAULT_GRAPH_BOUNDS.maxDepth),
    maxAuthorsPerLevel: bound(
      'maxAuthorsPerLevel',
      bounds.maxAuthorsPerLevel,
      DEFAULT_GRAPH_BOUNDS.maxAuthorsPerLevel,
    ),
    maxTotalAuthors: bound(
      'maxTotalAuthors',
      bounds.maxTotalAuthors,
      DEFAULT_GRAPH_BOUNDS.maxTotalAuthors,
    ),
    maxEvents: bound(
      'maxEvents',
      bounds.maxEvents,
      DEFAULT_GRAPH_BOUNDS.maxEvents,
    ),
  }
}
