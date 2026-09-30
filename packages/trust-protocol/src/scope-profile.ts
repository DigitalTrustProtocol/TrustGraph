/**
 * Scope profiles (wot-model.md §2.3). v1 has one profile, `x.com`, identical
 * to Attention's `isEligibleXTrustScope` / `isEligibleXRatingScope` /
 * `xTrustScopeRank`.
 */

import { TRUST_STATEMENT_KIND } from './kind-32009'
import { RATING_STATEMENT_KIND } from './kind-32014'
import {
  X_TRUST_SCOPE,
  isEligibleXRatingScope,
  isEligibleXTrustScope,
  xTrustScopeRank,
} from './x-identity'

export type ScopeProfileName = 'x.com'

export const DEFAULT_SCOPE_PROFILE: ScopeProfileName = 'x.com'

export interface ScopeVerdict {
  eligible: boolean
  /** 0 when ineligible. */
  scopeRank: number
}

/** Eligibility and rank for one statement's canonical scope set. */
export function scopeVerdict(
  kind: number,
  scopes: readonly string[],
  profile: ScopeProfileName = DEFAULT_SCOPE_PROFILE,
): ScopeVerdict {
  switch (profile) {
    case 'x.com': {
      if (kind === TRUST_STATEMENT_KIND) {
        const eligible = isEligibleXTrustScope(scopes)
        return { eligible, scopeRank: eligible ? xTrustScopeRank(scopes) : 0 }
      }
      if (kind === RATING_STATEMENT_KIND) {
        const eligible = isEligibleXRatingScope(scopes)
        return { eligible, scopeRank: eligible ? 2 : 0 }
      }
      return { eligible: false, scopeRank: 0 }
    }
    default: {
      const _exhaustive: never = profile
      return _exhaustive
    }
  }
}

/** True when the scope set lets an npub hint act as an X identity witness. */
export function scopesCarryXHints(scopes: readonly string[]): boolean {
  return scopes.includes(X_TRUST_SCOPE)
}
