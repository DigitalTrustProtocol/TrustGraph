/**
 * Package-local homes of the five constants the vendored heap imported from
 * outside `src/graph/trust` (library.md § Extraction plan). Values are
 * identical to AttentionX `lib/nostr/kind-32009`, `lib/nostr/kind-32014`,
 * `shared/wot-follow-trust-threshold`, and `shared/wot-max-degree`.
 */

/** Kind 32009 trust statement (AttentionX `lib/nostr/kind-32009`). */
export const TRUST_STATEMENT_KIND = 32009

/** Kind 32014 rating statement (AttentionX `lib/nostr/kind-32014`). */
export const RATING_STATEMENT_KIND = 32014

/** Green/hop boundary default percent (AttentionX `shared/wot-follow-trust-threshold`). */
export const FOLLOW_TRUST_GREEN_DEFAULT = 75

/** Hard upper bound for resolve degree (AttentionX `shared/wot-max-degree`). */
export const WOT_MAX_DEGREE_HARD_CAP = 7
