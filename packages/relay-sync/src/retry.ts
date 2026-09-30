// Ported from AttentionX src/relay/retry.ts (imports rewritten for @dtp/* packages).
import type { RetryPolicy } from './types'

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  multiplier: 2,
  jitterRatio: 0.2,
}

export function assertRetryPolicy(policy: RetryPolicy): void {
  if (
    !Number.isInteger(policy.maxAttempts) ||
    policy.maxAttempts < 1 ||
    !Number.isFinite(policy.initialDelayMs) ||
    policy.initialDelayMs < 0 ||
    !Number.isFinite(policy.maxDelayMs) ||
    policy.maxDelayMs < policy.initialDelayMs ||
    !Number.isFinite(policy.multiplier) ||
    policy.multiplier < 1 ||
    !Number.isFinite(policy.jitterRatio) ||
    policy.jitterRatio < 0 ||
    policy.jitterRatio > 1
  ) {
    throw new Error('Invalid retry policy')
  }
}

export function retryDelayMs(
  policy: RetryPolicy,
  failedAttempts: number,
  random: () => number = Math.random,
): number {
  assertRetryPolicy(policy)
  if (!Number.isInteger(failedAttempts) || failedAttempts < 1) {
    throw new Error('failedAttempts must be a positive integer')
  }

  const exponential = Math.min(
    policy.maxDelayMs,
    policy.initialDelayMs *
      Math.pow(policy.multiplier, failedAttempts - 1),
  )
  const boundedRandom = Math.min(1, Math.max(0, random()))
  const jitter = exponential * policy.jitterRatio * (boundedRandom * 2 - 1)
  return Math.max(0, Math.round(exponential + jitter))
}
