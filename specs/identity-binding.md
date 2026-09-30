# Identity binding — part of `dtp-wot/1`

Status: **draft** · 2026-09-30 · normative; extends
[wot-model.md §2.5](wot-model.md#25-identity-binds)

On Nostr, trust points at a pubkey (`p`). On X, trust points at an X user id
(`i=user:id:X`). A trust statement about an X account becomes a **hop** only
when, for the observer, `user:id:X` is **bound** to the npub that controls it.
This document defines when that happens, in two modes:

| Mode | Idea | Effect |
| --- | --- | --- |
| **Lenient** | Believe the X ↔ npub link your web of trust reports | Routes can differ per observer: two people with different webs of trust may bind the same X account to different npubs |
| **Strict** | Both sides must agree: someone you trust saw the link on X, **and** the npub claims the X account in kind `10011` | Unverified hints, false hints, and npubs without a `10011` claim are cut; routes converge on the key that claims the account |

The mode is a query parameter (`bindingMode`). The same mode on the same data
gives the same answer in every runtime.

## 1. Inputs

| Input | Meaning | Where it comes from |
| --- | --- | --- |
| **Own evidence** | The observer's own client saw the link on X: the npub in X's Bio, or in a linking post already loaded by X | Attention `xIdentities` (`xNpub`, `postNpub`), used by the extension's local heap only. **Personal Server and Global Server: none** — X data stays in the extension. |
| **Witness statement** | A kind `32009` about `i=user:id:X` whose primary `i` tag carries a bare `npub1…` hint, read under `s=x.com` | Relays |
| **Claim** | Pubkey P's winning, valid kind `10011` contains `twitter_id:X` (with the matching `twitter` tag, per NIP-39) | Relays |

Only `user:id:<digits>` subjects bind. `post:id`, `e`, and other `i`
subjects never bind.

## 2. Witness statements

For each author A and X, **A's witness** is A's newest active `v=1`
statement about `user:id:X` that passes every row below (tie on
`created_at` → lower event id). One witness per author.

| Condition | Rule | Why |
| --- | --- | --- |
| Hint present | The primary `i` tag carries a bare `npub1…`; the first one counts | Same as `subjectNpubFromHints` today |
| Hint well-formed | A malformed hint makes the **event invalid** at the protocol layer (NIP-32009 checklist item 7); it never reaches the model | — |
| Scope | The statement's scope set contains `x.com` | NIP-32009: `s` selects the hint vocabulary; an empty-scope hint is not interpreted |
| Value | `v = 1` | `0` and `-1` statements are evidence about the account, not identity witnesses. They are not vetoes. |
| Not self | Hint npub ≠ A | An issuer naming itself is a claim, worth the same as its `10011` |
| Context | Any `c` | The hint describes who controls the account, whatever the purpose |
| Author counts for this root | A is the root (**own witness**), or A qualifies at level ℓ in the root's walk (**WoT witness**) | A hint from outside your web of trust never counts |

Witness-only statements: a verifier service (for example X OAuth plus a
signed Nostr challenge) can publish with `c=identity:attest`. That context is
not in `Chain(32009, identity)`, so the statement witnesses a bind without
becoming a trust hop or trust evidence.

## 3. Claim states

| P's kind `10011` | Lenient | Strict |
| --- | --- | --- |
| Valid winner names `twitter_id:X` | Confirmed | Confirmed |
| No `10011` known for P | Allowed, unconfirmed | **Cut** |
| Winner names other X accounts only | Allowed, unconfirmed (one npub may have several X accounts) | **Cut** (false hint) |
| Winner revoked (X tags removed) | Allowed, unconfirmed | **Cut** |
| Invalid `10011` | Treated as none | **Cut** |

A `10011` alone never creates a candidate. Anyone can claim any X id; a claim
only confirms a candidate that someone the observer trusts has witnessed.

## 4. Bind decision

`bind(R, X, ℓ)` — the npub X is bound to when the root R counts statements
made by authors at level ℓ. It is a pure function of the root's walk up to
level ℓ, the witnesses, the claims, the mode, and the own evidence.

| Step | Lenient | Strict |
| --- | --- | --- |
| 1. Own evidence exists (Bio beats linking post) | Bound to that P. Stop. | Bound to that P **if P claims X**, else **unbound**. Stop. Other witnesses are not consulted: the X owner's own Bio outranks anyone's hint. |
| 2. Own witness exists | Bound to that P. Stop. | Bound to that P if P claims X, else unbound. Stop. |
| 3. WoT witnesses by qualifying authors at levels ≤ ℓ | All count | Only witnesses whose P claims X count |
| 4. Rank the remaining witnesses | Lower author level, then higher author trust count, then newer `created_at`, then lower author pubkey | Same |
| 5. Result | The top witness's P, or **unbound** if none | Same |

Because ranking starts with the lowest level, a bind made at level ℓ never
changes at deeper levels: the **nearest** eligible witness decides. In strict
mode a nearer *false* hint is skipped, so a correct farther witness can still
bind.

## 5. Situations, side by side

From one root's point of view. "Claims" means P's `10011` names X.

| # | Situation | Lenient | Strict |
| --- | --- | --- | --- |
| 1 | Own Bio (or linking post) shows P; P claims X | Bound to P | Bound to P |
| 2 | Own Bio shows P; P has no `10011` | Bound to P | **Unbound** |
| 3 | Own Bio shows P; your friends' hints say Q, and Q claims X | Bound to P | **Unbound** (Bio outranks hints; P unconfirmed) |
| 4 | Your own `32009` hint says P; P claims X | Bound to P | Bound to P |
| 5 | Your own `32009` hint says P; P has no `10011` | Bound to P | **Unbound** |
| 6 | Nearest WoT witness says P; P claims X | Bound to P | Bound to P |
| 7 | Nearest WoT witness says P (no claim); a farther witness says Q (claims X) | Bound to P | Bound to Q |
| 8 | Two witnesses at the same level: P (author trust count 5) and Q (count 3); only Q claims X | Bound to P | Bound to Q |
| 9 | Witness says P; P's `10011` names a different X account | Bound to P | **Unbound** (false hint) |
| 10 | Only authors outside your web of trust hint P | Unbound | Unbound |
| 11 | No witness at all; P's `10011` claims X | Unbound | Unbound |
| 12 | Witness says P, but in a `v=0` / `v=-1` statement, or without `s=x.com`, or the hint names the author itself | Not a witness | Not a witness |
| 13 | Witnesses say P; another key Q also claims X in its `10011`, nobody witnessed Q | Bound to P | Bound to P if P claims X, else unbound (Q is never a candidate) |

## 6. Hop rules

A qualifying author A at level ℓ has a selected statement `e` about subject
`s` (wot-model §4.3). Both modes, with `bind(R, X, ℓ)` from §4:

| `s` | Bind at level ℓ | `e.v` | Effect on the walk |
| --- | --- | --- | --- |
| `p:P` | — | `1` | Trust counts for P at level ℓ+1; P is queued and **hops** if it qualifies |
| `p:P` | — | `-1` / `0` | Distrust / Neutral counts for P; **no hop** |
| `user:id:X` | Bound to P | `1` | Same as `p:P`: X and P are one node; **hop** |
| `user:id:X` | Bound to P | `-1` / `0` | Same as `p:P`; **no hop** |
| `user:id:X` | Unbound | any | Terminal evidence about the X account; **this branch stops** |
| `post:id`, `e`, other `i` | never bound | any | Terminal evidence |

- If A has statements about both `p:P` and a bound `user:id:X`, one of them
  counts (wot-model §4.3 tie-break).
- For a query about `user:id:X`, the evidence at hitting degree `d` includes
  statements about `p:P` only when `bind(R, X, d − 1)` is P.

## 7. Different observers, different routes

Carol and Dave both trust X's account and hint different npubs. P2 is the
real owner and published a `10011`; P1 did not.

| | Alice (trusts Carol) | Bob (trusts Dave) |
| --- | --- | --- |
| Witness | Carol (level 1): X is P1 | Dave (level 1): X is P2 |
| Lenient | X → P1: Alice's trust in X flows to P1, and P1's statements become hops for Alice | X → P2 |
| Strict | Carol's hint is cut (P1 has no claim); X is unbound for Alice unless another witness names P2 | X → P2 |

Lenient keeps each person's view; a wrong witness misleads exactly the people
for whom that witness is the nearest. Strict gives up hops for accounts
without a `10011` and closes that door.

## 8. Result provenance

Trust and rating results about `user:id:X` carry an additive `binding` field
([resolver-api.md](resolver-api.md#additive-result-fields)):

```json
{
  "mode": "strict",
  "pubkey": "<hex>",
  "source": "own-bio",
  "confirmed": true,
  "witnessEventId": "<id>",
  "witnessDegree": 2,
  "claimEventId": "<id>"
}
```

`source` is one of `own-bio`, `own-post`, `own-statement`, `witness`, `none`
(`own-bio` / `own-post` occur only in the extension's local heap; servers hold
no X data).

`witnessDegree` is the degree of the witness statement, counted like the
result `degree`: `level(A) + 1` for witness author `A`. The root's own
statement (`own-statement`) has `witnessDegree: 1`; a witness by a level-1
author has `2`. It is present exactly when `witnessEventId` is: for sources
`own-statement` and `witness`, and on a strict-mode unbound result with a
`cutCandidate`, where both describe the cut candidate's witness. A bind used
at level `ℓ` always has `witnessDegree ≤ ℓ + 1`.

**Which level's bind a result reports.** A connected result at degree `d`
reports `bind(R, X, d − 1)`, the bind its evidence was counted under. A
disconnected result reports `bind(R, X, ℓ*)` at the level of the walk's last
hit check ([wot-model.md §6.1](wot-model.md#61-disconnected-results)): `D − 1`
at `maxDepth`, the last non-empty level when the frontier ran out, or
`completeDepth` when a budget stopped the walk.
Unbound results carry `source: "none"` and, in strict mode, the top cut
candidate and the reason (`no-claim`, `false-hint`) so the UI can explain it.

## 9. Publishing rule

A client SHOULD attach an npub hint to its trust statements only from **own
evidence** (Bio or linking post), or from a bind that is **confirmed** by a
`10011`. It SHOULD NOT re-publish a bind it learned only from someone else's
hint: that turns a second-hand guess into what looks like a first-hand
witness for the next observer.

Attention today attaches its winning npub, which can come from another
issuer's hint (`primaryNpubFromRow` → `eventNpub`). See conformance gap G9.

## 10. Runtimes

| Runtime | Own evidence | Witnesses | Claims | Default mode |
| --- | --- | --- | --- | --- |
| Attention (local heap) | `xIdentities` Bio / linking post | Synced `32009` | `10011` fetched for Bio npubs today; strict also needs claims for witnessed candidates | Lenient (closest to today) |
| Personal Server | **None** — public events only; step 1 of §4 never applies | Synced `32009` and the extension's own signed events | Synced `10011` for candidates | Set per query; default is decision D5 |
| Global Server | **None** — public events only; step 1 of §4 never applies | All `32009` its Sync Servers push | All `10011` its Sync Servers push | Set per query; default is decision D5 |

Both servers bind the same way. When Attention uses a server, the user's own
X observation (Bio / linking post) counts only once it is published as the
user's own witness (§9): Attention attaches that npub as the hint when the
user trusts the account. Until then only the local heap can use it.

## 11. Security notes

- **Lenient risk:** a trusted but careless or malicious witness can bind an X
  account to the wrong npub for the people who trust that witness most
  closely. The damage is limited to their webs of trust and visible in
  `binding` provenance.
- **Strict cost:** X accounts whose owners never published `10011` stay
  terminal, including accounts with an npub in their Bio. Fewer hops,
  especially early in adoption.
- **Both modes:** a `10011` alone, or a hint from outside the observer's web of
  trust, never binds. Distrust statements are not vetoes of a bind.
- A verifier service is just an issuer. Observers who trust it (directly or
  through their web of trust) get its binds; there are no server-wide
  aliases outside this model.
