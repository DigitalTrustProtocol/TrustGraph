# DTP WoT model — `dtp-wot/1`

Status: **draft** · 2026-09-30 · normative for the TrustGraph library, the
Personal Server, and the Global Server.

This document defines how signed trust (kind `32009`) and rating (kind
`32014`) statements become a Web-of-Trust graph, and how that graph answers
the two questions for one observer:

```text
32009  identity  →  Is this identity worth my trust?
32014  artifact  →  Is this artifact worth my time?
```

An implementation claims `dtp-wot/1` when it passes the conformance corpus
([conformance.md](conformance.md)).

**Origin.** Derived from the Attention heap
(`AttentionX/src/graph/trust`, vendored from `DigitalTrustProtocol/Trust`)
and its mapping layer (`src/graph/query.ts`, `src/graph/ratings/`). Behaviour
not listed in [conformance.md § Known gaps](conformance.md#known-gaps) is
intended to be exactly what the extension does today. Where the code and this
spec differ, the gap table names the difference and the proposed rule.

Keywords MUST / SHOULD / MAY follow RFC 2119. *Root* is the observer pubkey.
*Subject* is the queried node.

## 1. Layers

| Layer | Owns | Specified in |
| --- | --- | --- |
| Protocol | Event validation, `d` material, winner per slot | [NIP-32009](../../AttentionX/docs/NIP-32009.md), [NIP-32014](../../AttentionX/docs/NIP-32014.md) |
| Eligibility | Which scopes a deployment accepts | §2.3 (scope profile) |
| **Model** | Nodes, binds, edges, context buckets, the walk, results | this document |
| Product mapping | Contexts and thresholds per query type | §9 (profile `attention`) |
| Transport | HTTP contract | [resolver-api.md](resolver-api.md) |

The model never parses tags, never verifies signatures, and never talks to
relays. It consumes normalized records, identity claims, and the observer's
own identity evidence, and decides binds itself
([identity-binding.md](identity-binding.md)).

## 2. Inputs

### 2.1 Edge records

| Field | Type | From | Role |
| --- | --- | --- | --- |
| `addressKey` | `"<kind>:<pubkey>:<d>"` | event | Slot identity |
| `id` | 64 lowercase hex | event | Tie-break, provenance |
| `pubkey` | 64 lowercase hex | event | Author node |
| `kind` | `32009` \| `32014` | event | Bucket, score kind |
| `created_at` | integer seconds | event | Slot winner, tie-break |
| `subjectType` | `p` \| `e` \| `i` | primary subject tag | Node type |
| `subject` | string, lowercased | primary subject value (`tag[1]`) | Node key |
| `context` | canonical `c`, or `""` | `c` tag | Bucket |
| `value` | 32009: `-1` \| `0` \| `1`; 32014: number in `[0,100]`; **absent = Delete** | `v` / `score` | Evidence |
| `activate` / `expire` | integer seconds, optional | `x` / `y` | Activity window |
| `scopeRank` | integer ≥ 1 | scope profile | Tie-break (proposal P2) |
| `hintPubkey` | 64 lowercase hex, optional | first bare `npub1…` hint on the primary `i` tag; only for `user:id` subjects whose scope set contains `x.com` | Identity witness ([identity-binding.md](identity-binding.md)) |
| `content`, `labels`, `labelHints`, `dTag` | display | event | Never change results, except the rating label filter (§7.3) |

TypeScript mapping: the extension's `EventRecord` with `c_tag` = `context`,
`nValue` = `value`, `addressableId` = `dTag`
(`fillEventRecordColumns` in `src/lib/nostr/nip32009.ts`).

### 2.2 Validation happens before the model

Only events that pass the NIP-32009 / NIP-32014 validation checklists **and**
the scope profile become records. Subject hints, labels, `content`, and `s`
never enter the model except as the fields above. A malformed npub hint makes
the event invalid, so it never reaches the model.

### 2.3 Scope profiles

Scope (`s`) is not a graph dimension. A deployment selects one profile; the
profile filters events at ingest and assigns `scopeRank`.

Profile **`x.com`** — the only profile in v1, identical to Attention
(`isEligibleXTrustScope`, `isEligibleXRatingScope`, `xTrustScopeRank`):

| Kind | Eligible canonical scope set | `scopeRank` |
| --- | --- | --- |
| `32009` | empty, or contains `x.com` | contains `x.com` → 2; empty → 1 |
| `32014` | contains `x.com` | 2 |

Events with other scope sets are ineligible and MUST be dropped at ingest.
A future multi-site profile MUST NOT change the walk; if scope is ever needed
in resolve, it becomes the first context segment on the resolver side
(AttentionX `docs/architecture.md` § Subject hints, *Future / generic servers*).

### 2.4 Slot winner

For each `addressKey` the winner is the record with the greatest
`created_at`; on equal `created_at` the lexicographically lower `id` wins.

- A record older than the current winner MUST be discarded, also when the
  winner is a Delete or inactive. Older events are never revived.
- A Delete winner is kept as slot state (it keeps older events out) and
  contributes no edge.
- Applying the same record twice is a no-op.
- **NIP-09 deletion.** A kind `5` by the slot's author removes the winner it
  names (`e` tag) or the whole slot (`a` tag), and sets the slot's **floor**
  to the deletion's `created_at` (for `e`: the deleted event's `created_at`).
  Records for that slot at or below the floor are discarded, so nothing older
  is revived and the deleted event cannot come back. A later record above the
  floor is accepted normally. (The extension does not process kind `5` yet —
  gap G11.)

### 2.5 Identity binds

A bind says that `user:id:X` is controlled by pubkey P, so trust addressed to
the X account and trust addressed to P land on one node. Binds are decided
**per observer, inside the walk**, in one of two modes (`lenient`,
`strict`). The full rules and tables are in
[identity-binding.md](identity-binding.md); in short:

| Input | Role |
| --- | --- |
| Own evidence (Bio or linking post seen by the observer's own client) | Strongest source, for that client's roots only. Only available where the X data lives: the extension's local heap. Always empty on the Personal Server and the Global Server |
| Witness statements (`32009`, `v=1`, npub hint, `s=x.com`) by the root or by qualifying authors | Nearest witness decides |
| Claims (P's kind `10011` names X) | Required in strict mode; ignored for ranking in lenient mode |

Structural rules, both modes:

1. At any level, `user:id:X` binds to at most one pubkey.
2. One pubkey may carry any number of X accounts (1 Nostr → N X).
3. Only `user:id:*` binds; `post:id:*`, `e`, and other `i` subjects never do.
4. A `10011` alone, or a hint from outside the observer's web of trust, never
   binds.

### 2.6 Identity claims

A claim is the pair `(P, X)` taken from P's winning, valid kind `10011`
containing `twitter_id:X` with its matching `twitter` tag (NIP-39). Claims
are not edges and never hops; they only confirm binds.

## 3. Nodes

The node key is the lowercase subject string: 64-hex for `p` and `e`,
`class:property:value` for `i` (see gap G5 on lowercasing).

- An author is always the `p` node of its pubkey.
- `resolve(key, ℓ)` = P if `key` is `user:id:X` and `bind(R, X, ℓ)` = P
  ([identity-binding.md §4](identity-binding.md#4-bind-decision)), else `key`.
  A bound X account and its pubkey denote **one node of type `p`**;
  statements addressed to either string count for that node.
- `p` nodes are **traversable**.
- Unbound `i` nodes and all `e` nodes are **terminal**: they receive edges and
  are never expanded.

## 4. Edges

### 4.1 Active

A record `r` is active at time `t` iff `r.value` is present **and**
(`activate` absent or `t ≥ activate`) **and** (`expire` absent or
`t ≤ expire`). Both bounds are inclusive.

### 4.2 Context buckets and chains

Every non-Delete record sits in bucket `B(kind, context)`: `"<kind>"` when the
context is empty, else `"<kind>:<context>"`.

`Chain(kind, C)` is the ordered list of buckets consulted for context `C`:

| Kind | Chain | Example for `C = security:access:frontdoor` |
| --- | --- | --- |
| `32009` | exact, each parent prefix, then global | `32009:security:access:frontdoor`, `32009:security:access`, `32009:security`, `32009` |
| `32014` | exact only | `32014:security:access:frontdoor` |

For `C = ""` both kinds use the single bucket `"<kind>"`. The `32014` exact
rule is NIP-32014 "No fallback" (gap G1: TypeScript falls back for non-empty
`c`; product queries use `""`, so results are unaffected today).

### 4.3 Selected statement

`sel(A, N, kind, C, t)` is author `A`'s statement about node `N`:

1. Walk `Chain(kind, C)` in order. Take the first bucket that holds at least
   one **active** record from `A` whose `resolve(subject, level(A))` is `N`.
2. Inside that bucket, if several records qualify (for example an empty-scope
   slot and an `x.com` slot, or `p:<hex>` plus a bound `user:id`), pick by
   higher `scopeRank`, then greater `created_at`, then lower `id`
   (proposal P2; TypeScript takes the first inserted — gap G2).
3. Inactive records and Deletes do not occupy a bucket; the walk continues to
   the parent. A Neutral (`0`) record is active and **does** occupy it.

At most one selected statement counts per `(A, N)` in any query.

## 5. Counters and qualification

For a `p` node `X` first reached at level `L`, its trust counters are the
number of selected hop statements (`sel(·, X, 32009, TC, t)`) with value
`1` / `-1` / `0` from **qualifying** authors at level `L − 1`:
`trust`, `distrust`, `neutral`.

```text
s          = trust + distrust
percent(X) = undefined                           if s = 0
           = floor((200 · trust + s) / (2 · s))  otherwise
```

The integer form is normative. It equals JavaScript
`Math.round(100 * trust / s)` for every count, so Rust needs no floating
point.

`qualifies(X, G)` is true iff `X` is the root, or `percent(X)` is defined and
`percent(X) ≥ G`. Neutral never contributes to `percent` and never makes a
node qualify.

## 6. The trust walk

Inputs: root `R`; subject key `S`; score kind `K ∈ {32009, 32014}`; hop context
`TC`; score context `SC`; hop threshold `G ∈ [0, 100]`; maximum degree
`D ∈ [1, 7]`; time `t`; binding mode `M ∈ {lenient, strict}`; the root's own
evidence `O` (may be empty).

The walk is breadth-first and level-synchronous. It stops at the **nearest
hitting degree**: the first degree at which a qualifying author has counted
evidence about the subject. Farther evidence never dilutes nearer evidence.

```text
NR = node(R)
if NR is missing: return EMPTY
NS(ℓ) = node(resolve(S, ℓ))          // the subject's node as seen at level ℓ

level[NR] = 0;  frontier = [NR];  seen = {NR}
for d in 1 ..= D:
    ℓ = d − 1                         // binds used here: bind(R, ·, ℓ)
    hits = [ sel(A, NS(ℓ), K, SC, t) for A in frontier
             if A ≠ NS(ℓ) and qualifies(A, G) and that statement exists ]
    if counted(hits) > 0: return CONNECTED(degree = d, evidence = hits)

    next = []
    for A in frontier where qualifies(A, G) and expandable(A):
        for each p-type peer X = resolve(subject, ℓ) with e = sel(A, X, 32009, TC, t) active:
            if level[X] is defined and level[X] < d: continue
            level[X] = d;  add value(e) to counters(X)
            if value(e) = 1 and X ∉ seen: seen += X;  next += X
    if next is empty: return DISCONNECTED
    frontier = next
return DISCONNECTED
```

`bind(R, X, ℓ)` depends only on levels `≤ ℓ`, which are complete when level
`ℓ` is processed, and it never changes at deeper levels
([identity-binding.md §4](identity-binding.md#4-bind-decision)). An
implementation MAY return early when no record can address the subject or any
X account that could bind to it.

- `counted(hits)`: for `K = 32009`, the number of hits with value `1` or `-1`
  (Neutral-only degrees do not stop the walk); for `K = 32014`, the number of
  hits (a `0` score counts).
- `expandable(A)`: true, except that for `K = 32009` the subject `NS` is not
  expanded unless it is the root. For `K = 32014` the subject is expanded
  like any node (gap G7 documents this asymmetry).
- Hit counters of the subject are separate from its peer counters (gap G7:
  TypeScript shares one object when `K = 32009`, which only matters if
  `SC ≠ TC`).
- Only 32009 statements with value `1` expand the frontier. Ratings are
  never hops. Distrust and Neutral are counted evidence, never hops.
- A statement about an unbound `user:id:X` is terminal evidence about the X
  account; it never expands the frontier
  ([identity-binding.md §6](identity-binding.md#6-hop-rules)).
- Self-loops (`A = NS`) are never evidence.

### 6.1 Disconnected results

A `DISCONNECTED` result has `connected = false`, `degree = 0`,
`trust = distrust = neutral = 0`, `resolution = none`, empty `statements` and
`sourceEventIds`, and no `direct` (absent or `null`). Neutral hits seen at
examined degrees are not reported: they did not stop the walk, so they are
not the answer. This also holds when the root's own statement is a Neutral
that occupies its context bucket (it hides the root's broader statements, §4.3,
but is not evidence by itself).

This is option A of decision D4 (§9, decided).

A disconnected result about `user:id:X` reports the bind at the deepest level
the walk examined, `bind(R, X, ℓ*)`, where `ℓ*` is the level of the last hit
check: `D − 1` when the walk ran to `maxDepth`, the last non-empty level when
the frontier ran out, and `completeDepth` when a budget stopped the walk
(§6.2). Binds never change at deeper levels (§6), so this is the most
informed bind the walk saw. A connected result at degree `d` reports
`bind(R, X, d − 1)`.

### 6.2 Guardrails

A walk runs under budgets: a time deadline, a maximum degree, a maximum number
of reached nodes, and a maximum number of scanned records. The result must
stay honest when a budget stops it.

- **Level `ℓ` is complete** when every qualifying node of level `ℓ − 1` has
  been expanded. `completeDepth` is the deepest complete level (the root's
  level 0 is always complete).
- **Reached nodes** are the nodes that have a level: the root (level 0) and
  every `p` node that received a `level` in the pseudo-code above, whatever
  the value of the statement that reached it (trust, Neutral, or distrust).
  Subjects that are not `p` nodes (`user:id` unbound, `post:id`, `e`, other
  `i`) never get a level and are not counted; neither is the query subject
  unless it is itself a reached `p` node. Each node counts once.
- **Scanned records** are the selected statements the expansion step
  examines: one per (qualifying frontier author, peer subject) pair visited
  in the buckets of `Chain(32009, TC)`, including records that are then
  skipped (inactive, not value `1`, not a `p` subject, or already levelled).
  The hit check (`sel(A, NS(ℓ), …)`, at most one record per frontier author)
  is not counted. The count is cumulative over the walk.
- Node and record budgets are checked **before** a level is committed: the
  walk computes level `d` (the `next` list and the levels it assigns); if the
  reached-node total would exceed `maxReachedNodes`, or the scanned-record
  total would exceed `maxWalkRecords`, the walk stops, level `d` is discarded,
  and `completeDepth = d − 1`. Equal to the budget is allowed. These budgets
  are deterministic, so every implementation stops at the same level.
- In the pseudo-code this gives one order per degree `d`: hit check with
  level `d − 1` (complete), then build level `d`, then the budget check. So a
  walk stopped while building level `d` has already made the hit check at
  degree `d = completeDepth + 1`.
- The deadline is checked before each level and at least every 4 096 scanned
  records inside a level. When it fires inside a level, the partial level is
  discarded.
- The hit check at degree `completeDepth + 1` uses only complete levels, so
  a hit at any degree `≤ completeDepth + 1` is **exact** and returned
  normally.
- If no hit was found up to `completeDepth + 1` and the walk stopped early,
  the result is disconnected with `truncated: true`, `completeDepth`, and the
  reason (`timeBudget`, `nodeBudget`, `edgeBudget`). It never claims "no
  evidence" when it did not look.
- **When `completeDepth` is reported:** only on results that a walk budget
  truncated (`truncatedReasons` contains `timeBudget`, `nodeBudget`, or
  `edgeBudget`). Connected results, and disconnected results that ended by
  exhaustion or at `maxDepth`, omit it. `statementLimit`, `pathLimit`, and
  `neighborhoodLimit` truncations do not stop the walk and do not add it.
  `graph.field` always reports it (the field is the walk's level structure).
- `maxDepth` is not truncation: stopping at `D` is the normal end of the walk.
- The same rules apply to root-field builds and to the sync frontier.

Time budgets depend on the machine, so conformance cases use node and record
budgets only (gap G10: the TypeScript walk has no budgets yet).

## 7. Results

### 7.1 Trust (`K = 32009`)

| Field | Rule |
| --- | --- |
| `connected` | `degree > 0` |
| `degree` | Hitting degree `d` (root = 0; a root's own statement = 1) |
| `trust` / `distrust` / `neutral` | Counts over the evidence by value |
| `trustValue` | `trust − distrust` |
| `statements[]` | One per evidence record: `eventId`, `connectionKey` (= `addressKey`), `author`, `subject` (as queried), `context`, `requestedContext` (= `SC`), `contextMatch` (`exact` if equal to `SC`, `general` if `""`, else `parent`), `value`, `createdAt`, optional `activeFrom` / `activeUntil` / `content` / `labels` / `labelHints`, `distance = d − 1` |
| `direct` | The statement authored by the root, if any (only possible at `d = 1`) |
| `sourceEventIds` | Sorted unique evidence ids |
| `resolution` | `none` if not connected; else with `p = percent(trust, distrust)`: `trusted` if `p ≥ green`, `distrusted` if `p < red`, otherwise `mixed` |
| `binding` | For `user:id` subjects: mode, bound pubkey, source, confirmation, witness and claim ids ([identity-binding.md §8](identity-binding.md#8-result-provenance)) |

Statement order (proposal P3): `distance` ascending, `createdAt` descending,
`eventId` ascending. TypeScript returns walk order today; conformance compares
sorted.

### 7.2 Path format

`pathView` is the backward union of contributing statements: start with the
evidence; for every author `A ≠ R` of a collected statement, add every
statement that contributed to `counters(A)` (qualifying authors at
`level(A) − 1`, any value), and recurse until the root. Node depth is the
node's level; the subject's depth is `d`.

Node `id`s are implementation-local (heap index). Remote results MUST also
carry `subject` on every node; conformance compares nodes by subject.

### 7.3 Rating (`K = 32014`)

| Field | Rule |
| --- | --- |
| Label filter | If request `labels` is non-empty, keep claims with at least one listed label. If none remain, the result is empty; the walk does **not** continue to farther degrees. |
| `claims[]` | `eventId`, `author`, `subject`, `context`, `score`, `labels`, `labelHints?`, `content`, `createdAt`, `activeFrom?`, `activeUntil?`, `distance = d − 1`; sorted by `distance` asc, `createdAt` desc, `eventId` asc |
| `averageScore` | Arithmetic mean of claim scores, `null` when none. Conformance tolerance `1e-9`. |
| `claimCount`, `degree`, `own` | Count; hitting degree; the root's own claim |
| `ratingEdges` (path format) | One per distinct issuer → subject; display value `1` if score ≥ 50, else `-1` |

## 8. Read helpers (not scores)

Two families of queries exist. The **resolver** (§6–§7) walks several degrees
and depends on the observer, the threshold, and the binding mode. **Lookups**
(this section) read one degree of stored winners and depend on none of these:
the same request gives the same answer for every observer.

### 8.1 Lookups

**Keys.** A lookup takes a set of keys `Ks`: subject or author strings as
written (`p` / `e` hex, `user:id:<n>`, `post:id:<n>`, other `i`), lowercased
as in §3. Keys are **not** resolved through binds. A client that wants "all
statements about this person" sends the person's alias set itself (for
Attention: `user:id:X` plus the npubs its own `xIdentities` row knows).

**Directions.**

| Lookup | Records |
| --- | --- |
| Incoming | Winners whose primary subject is in `Ks` |
| Outgoing | Winners whose author is in `Ks` (pubkey keys only) |

**Filters** (all optional):

| Filter | Default | Rule |
| --- | --- | --- |
| `kinds` | `[32009]` | `32009`, `32014`, or both |
| `context` + `contextMatch` | `""` + `chain` for 32009, `exact` for 32014 | `chain`: buckets of `Chain(kind, context)` (§4.2); `exact`: the one bucket; `any`: every bucket |
| `values` | all | 32009 only: subset of `1`, `0`, `-1` |
| `subjectTypes` | all | Outgoing only: `p`, `user:id`, `post:id`, `e`, other |
| `labels` | none | 32014 only: keep records with at least one listed label |
| Activity | active at `now` | `includeInactive` also returns records outside their `x` / `y` window |
| `since` / `until` | none | `created_at` range, inclusive |

Delete winners never appear (they are slot state, not statements).

**Mode.**

- `selected` (default): at most one record per (author, key, kind): the
  selected statement of §4.3 over the filter's buckets. With `contextMatch:
  any` there is no chain order, so the P2 order (`scopeRank` desc,
  `created_at` desc, `id` asc) picks across all buckets. With
  `includeInactive`, inactive records take part in the selection.
  `values`, `labels`, `subjectTypes`, `since`, and `until` apply to the
  selected record, so a filter never surfaces a statement that selection
  set aside.
- `raw`: every winner that passes the filters (for event lists and exports).

**Merging keys** (`mergeKeys: true`, incoming only): the keys are one
person's aliases. When the same author has a `user:id` record and a `p`
record with the same value, the `user:id` record is dropped; records with
different values are all kept, so conflicts stay visible. This is the rule the
extension applies today (`omitSameValueUserIdDuplicate` in
`src/graph/incoming.ts`).

**Order and pages.** Results are totally ordered, so paging is deterministic:

| `order` | Sort |
| --- | --- |
| `recent` (default) | `created_at` descending, then event id ascending |
| `author` | author pubkey ascending, then `created_at` descending, then event id |

A page holds at most `limit` records; the next page starts strictly after the
last record's sort key (keyset paging). Concatenating all pages at one
`graphVersion` equals the unpaged result.

**Counts.** Exact totals per key (or for the merged set): for 32009 the
number of records per value (`trust`, `neutral`, `distrust`); for 32014 the
number of ratings. Lookups never average ratings: an average over everyone
who rated is a crowd score, which the protocol avoids. Averages come only from
the resolver, at the nearest trusted degree (§7.3).

**Determinism.** A lookup result depends only on the stored winners, the keys,
the filters, `now` (for activity), and the page cursor. It does not depend on
the root, the threshold, the binding mode, or walk budgets.

**Neighborhood** (graph views) is an incoming plus an outgoing lookup for one
center, limited in size and shaped as nodes and edges. Node ids in that shape
are implementation-local; nodes also carry their `subject`.

**Sync frontier.** Decides *whose events to fetch*; it is not a trust result
and ignores the threshold.

```text
F0 = sorted unique roots, capped
F(k+1) = sorted pubkeys P not yet discovered such that some A ∈ F(k) has an
         active value-1 32009 record in any bucket of Chain(32009, identity)
         whose resolve(subject, k) is P
```

`maxAuthorsPerLevel` and `maxTotalAuthors` truncate the sorted lists; the
reasons (`maxDepth`, `maxAuthorsPerLevel`, `maxTotalAuthors`) are reported.
This is `GraphManager.positiveAuthorFrontier` in the extension.

For the frontier, binds use **lenient** rules with "qualifying" replaced by
"in the frontier", so sync fetches every candidate route. Witnessed candidate
npubs are also queued for a `10011` fetch, which strict mode needs.

## 9. Product profile `attention` (scope profile `x.com`)

| Query | `K` | `TC` | `SC` | `G` | Band |
| --- | --- | --- | --- | --- | --- |
| Person trust (`user:id`, `p`) | 32009 | `identity` | `identity` | `followTrustThreshold` (default 75) | red 25 / green 75 |
| Post trust (`post:id`) | 32009 | `identity` | `identity` → falls back to global, where post trust is published | same | same |
| Artifact rating | 32014 | `identity` | `""` | 1 | Tone uses the same band |

- Default `D` = 4; allowed 1–7.
- Binding mode: `lenient` by default on every runtime (decision D5);
  `strict` selectable per query.
- Publish contexts: person trust `c=identity`; post trust and ratings omit `c`.
  Witness-only statements by verifier services use `c=identity:attest`.
- Npub hints are published only from own evidence or confirmed binds
  ([identity-binding.md §9](identity-binding.md#9-publishing-rule)).
- Question actions are local-only and never reach the model.

**Decided product decisions** (by the owner, 2026-10-01).

| ID | Question | Decision |
| --- | --- | --- |
| D3 | May the locked heap change to close the model gaps? | Yes, for the TypeScript library `@dtp/trust-graph` only. AttentionX `src/graph/trust` is not updated by that change; the library records each divergence from the AttentionX origin commit |
| D4 | What a disconnected result says about Neutral evidence | **Option A**: nothing. No statements, `neutral = 0`, no `direct` (§6.1). Option B (report the nearest Neutral-only degree, still `connected = false`) was rejected. Closes gap G4 |
| D5 | Default binding mode | **`lenient` on every runtime** (extension, Personal Server, Global Server). `strict` is available whenever the caller asks for it (`bindingMode` per query or in the session defaults) |

**Open product decisions.** These are the owner's to take; the spec states
the options and what v1 does meanwhile.

| ID | Question | Option A | Option B | v1 meanwhile |
| --- | --- | --- | --- | --- |
| D6 | Context for witness-only statements by verifier services | `identity:attest`: not in `Chain(32009, identity)`, so the statement witnesses a bind (witnesses accept any `c`) without being a hop or trust evidence ([identity-binding.md §2](identity-binding.md#2-witness-statements)) | No separate context: verifiers publish `c=identity` like everyone else, so their witness is also a trust hop and trust evidence | `identity:attest` as written in identity-binding.md §2; nothing publishes it yet |

## 10. Constants and limits

| Constant | Value |
| --- | --- |
| Max degree hard cap | 7 (default 4) |
| Green / red defaults | 75 / 25, integers 0–100, `red ≤ green` |
| Batch cap | 200 items |
| `content` | ≤ 1024 Unicode characters |
| `c`, `l`, `s` value | ≤ 128 UTF-8 bytes |
| Rating score | `[0, 100]`, ≤ 6 decimal digits |

## 11. Determinism

Given the same final set of records, claims, own evidence, and mode, results
MUST NOT depend on the order in which they were applied. Level assignment is
level-synchronous, counters are commutative, §4.3 is a total order, and the
bind ranking is a total order, so a parallel implementation that respects
levels is deterministic. The current TypeScript
heap violates order independence only in the gap G2 / G3 setups.

## 12. Versioning

Any change that alters a corpus expectation bumps the model version
(`dtp-wot/2`, …). Servers report the version in their NIP-11 `dtp` object
and in `DTP info` ([resolver-api.md](resolver-api.md)). While `dtp-wot/1` is a draft, accepted
gap fixes update this document in place and add corpus cases.
