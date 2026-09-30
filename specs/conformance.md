# Conformance — `dtp-wot/1`

Status: **draft** · 2026-09-30

Three runtimes must answer the same question the same way:

| Runtime | Implementation | How equality is achieved |
| --- | --- | --- |
| Attention extension (service worker) | `@dtp/trust-graph` (TypeScript) | Same code |
| Personal Server (Node.js) | `@dtp/trust-graph` (TypeScript) | Same code |
| Global Server (Rust) | `dtp-graph` + `dtp-resolve` | This corpus + differential fuzzing |

Sharing code covers the two TypeScript runtimes. The corpus proves the Rust
engine and guards the TypeScript package against regressions.

## Corpus layout

```text
TrustGraph/corpus/
  manifest.json          { "corpus": "dtp-wot-corpus/1", "model": "dtp-wot/1", "cases": [...] }
  protocol/              signed event  → verdict + normalized record
  model/                 records + claims + own evidence + ops → query expectations
  generators/            seeded random-graph generators (perf and fuzz)
```

### Protocol cases

Input: one signed Nostr event (seven NIP-01 fields) plus the scope profile.
Expected: `valid` / `invalid` with error codes, `eligible` for the profile,
and the normalized record (§2.1 of [wot-model.md](wot-model.md)). Covers
`d` recomputation, one-subject rule, hints, `v` / `score` grammar, `x`/`y`,
content limits, and scope eligibility.

### Model cases

```json
{
  "id": "walk-threshold-blocks-hop",
  "model": "dtp-wot/1",
  "tags": ["walk", "threshold"],
  "profile": "x.com",
  "records": [
    { "addressKey": "32009:@alice:…", "id": "@e1", "pubkey": "@alice",
      "kind": 32009, "created_at": 100, "subjectType": "p",
      "subject": "@bob", "context": "identity", "value": 1, "scopeRank": 1 },
    { "addressKey": "32009:@bob:…", "id": "@e2", "pubkey": "@bob",
      "kind": 32009, "created_at": 110, "subjectType": "i",
      "subject": "user:id:11348282", "context": "identity", "value": 1,
      "scopeRank": 2, "hintPubkey": "@carol" }
  ],
  "claims": [{ "pubkey": "@carol", "twitterId": "11348282" }],
  "ownEvidence": [],
  "ops": null,
  "queries": [
    {
      "type": "trust",
      "input": {
        "rootPubkey": "@alice",
        "subject": { "type": "i", "value": "user:id:11348282" },
        "context": "identity", "now": 1000, "bounds": { "maxDepth": 4 },
        "followTrustThreshold": 75, "followTrustRed": 25, "format": "default",
        "bindingMode": "strict"
      },
      "expect": { "connected": true, "degree": 2, "trust": 1, "distrust": 0,
                  "resolution": "trusted", "statements": ["…"] }
    }
  ]
}
```

- `@name` placeholders expand to deterministic hex (`sha256("name")`) in
  both runners, so cases stay readable.
- `claims` are `(pubkey, twitterId)` pairs from winning kind `10011` events;
  `ownEvidence` entries are `{ root, iKey, pubkey, source: "bio" | "post" }`
  and apply only to their `root`.
- `ops` (optional) is an explicit sequence of `apply` / `remove` / `claim` /
  `unclaim` / `own` / `unown`. When omitted: records, then claims, then own
  evidence, in order.
- `type` is one of `trust`, `rating` (resolver), `lookup-incoming`,
  `lookup-outgoing`, `lookup-counts`, `neighborhood` (lookups), `frontier`.
  Lookup cases list the expected items in full order, including page
  boundaries (`pages: [{ limit, expectItems, expectNextCursor: bool }]`); the
  opaque cursor value itself is not compared.
- Every `bind-*` case lists expectations for **both** binding modes
  (`expect.lenient`, `expect.strict`), built from the situation table in
  [identity-binding.md §5](identity-binding.md#5-situations-side-by-side).

### Canonical comparison

Before comparing, both runners:

1. drop `computedAt`, `graphVersion`, node `label`, and heap-index `id`s;
2. sort `statements` / `claims` by (`distance`, `createdAt` desc, `eventId`);
3. sort `sourceEventIds`;
4. key `pathView` nodes by `subject` (`type:value`) and edges by `eventId`;
5. compare `averageScore` with absolute tolerance `1e-9`.

## Properties

Both runners execute these over every model case and over generated graphs:

| Property | Statement |
| --- | --- |
| Order independence | Any permutation of record / claim / own-evidence application yields identical canonical results |
| Strict needs a claim | In strict mode no result's `binding.pubkey` lacks a matching claim |
| No outside witness | Removing every hint by authors that do not qualify for the root changes no result, in either mode |
| Bind stability | `bind(R, X, ℓ)` equals `bind(R, X, ℓ + 1)` whenever it is bound at `ℓ` |
| Idempotence | Applying a record twice changes nothing |
| Older discarded | An older record for an existing slot changes nothing, even after a Delete |
| Batch = single | Each batch item equals the same query issued alone (resolver and `lookup.batch`) |
| Lookups ignore the observer | A lookup gives the same result for any root, threshold, and binding mode |
| Pages add up | At one graph state, concatenating every page of a lookup equals the unpaged result, with no duplicates or gaps; `totals` equals the item count per value |
| Counts = items | `lookup.counts` equals the per-value tally of the unpaged `lookup.incoming` / `lookup.outgoing` with the same filters |
| Field = walk (Rust) | The root-field fast path equals the exact walk ([GlobalServer resolver-engine.md](../../GlobalServer/specs/resolver-engine.md)) |

A `gap:Gn` tag marks a case whose gap is **still open** in the
`@dtp/trust-graph` heap. A tagged case carries two expectations per query:

- `expectModel` is what this spec requires. A runner for a model-correct
  implementation (the Rust runner) asserts it, and reports the case as
  **gap fixed** rather than as a failure of the heap.
- `expectCurrent` is what the TypeScript heap does today. The TypeScript
  runner asserts it, so the heap stays pinned: a change in its behaviour
  fails the case until the owner updates the gap.
- A runner never asserts `expect` on a gap case (the lint forbids `expect`
  beside `expectModel`). When a gap is fixed in the heap, its cases drop the
  tag and `expectCurrent`, and `expectModel` becomes `expect`. Case ids
  (`gap-g1-…`) are kept for traceability; the tag alone says a gap is open.
- Where the gap setup hides a rule that holds anyway, a **companion case**
  without the tag pins that rule for both runners (for example
  `context-neutral-occupies-its-bucket-connected` next to
  `context-neutral-occupies-its-bucket`).

Generators and order-independence properties skip gap cases until the gaps
are closed.

## Differential fuzzing

A seeded generator produces graphs (node count, fan-out distribution, value
mix, contexts, npub hints, claims, own evidence, `x`/`y` windows) and random
queries in both binding modes. The TypeScript
runner writes canonical JSON; the Rust runner compares. Nightly CI runs
10 000 seeds; any mismatch is minimized and committed as a regression case.

## Seeding the corpus

Port the extension's existing graph tests before writing new ones:

| Source (AttentionX) | Becomes |
| --- | --- |
| `src/graph/graph.test.ts`, `index-resolver.test.ts`, `path-resolve.test.ts` | `model/walk-*`, `model/path-*` |
| `src/graph/follow-trust-threshold.test.ts` | `model/threshold-*` |
| `src/graph/bind-identity.test.ts`, `src/identity/x-identity-row.test.ts`, backend `#projectTrust32009Identity` tests | `model/bind-*` |
| `src/graph/ratings.test.ts` | `model/rating-*` |
| `src/graph/incoming.test.ts`, `outgoing.test.ts` | `model/lookup-*` (including the `mergeKeys` duplicate rule) |
| `src/lib/nostr/kind-32009.test.ts`, `kind-32014.test.ts`, `nip32009.test.ts` | `protocol/*` |
| `docs/demo-wot.md` seed planner | `model/demo-chain-*` and the Website playground dataset |
| NIP-32009 / NIP-32014 examples | `protocol/nip-examples-*` |

Large realistic datasets (for example the local test-relay playback exports)
stay out of the public corpus when they contain X display chrome. Use them for
local benchmarks only.

## Runners and CI

| Repo | Runner | Gate |
| --- | --- | --- |
| TrustGraph | `@dtp/conformance` (Vitest) | Every PR |
| AttentionX | Same runner against the bundled package version | `npm run check` |
| PersonalServer | Same runner | Every PR |
| GlobalServer | `dtp-conformance` (`cargo test`), corpus pinned by release tag | Every PR; nightly fuzz |

## One API: the session suite

The corpus proves the model. The **session suite** proves the two servers
expose exactly the same API ([resolver-api.md](resolver-api.md)):

- Scripted WebSocket sessions (`corpus/sessions/*.json`): a configuration, a
  list of events to push with `EVENT`, then messages to send and the expected
  messages back — `OK` prefixes, `AUTH` flows under each access setting,
  `REQ` answers, every `DTP` operation, `DTP-ERR` codes, pushes, NIP-09
  deletions, guardrail responses (using node and record budgets, not time).
- The same suite runs against a started Personal Server and a started Global
  Server with identical configuration. Each server's answers must match the
  scripted expectations, so the two transcripts agree after canonicalization
  (drop `instanceId`, `graphVersion`, numeric node ids, timestamps the server
  chose).
- **Numbers compare by value.** Frames are parsed as JSON and numbers match
  within `1e-9`, so a server may write `1.5e-6` where another writes
  `0.0000015` (JavaScript and Rust format small floats differently). No step
  compares number text.
- **Order.** Frames of one step arrive in the listed order unless the step
  says `unordered` (for example an `OK` and the `DTP-PUSH` it causes).
  Arrays whose order is implementation-local (neighborhood nodes and edges)
  use the `$unordered` matcher. `DTP-PUSH` frames are matched only by steps
  that expect one; other pushes are ignored.
- **Capability gating.** A session or step may list `requires`: an operation
  name that must appear in `dtp.capabilities`, or `fixed:Gn` for a gap the
  server must not list in `dtp.gaps`. The runner reads both with `info`
  before the first step. An unmet step asserts its `otherwise` frames (for
  `graph.field`: `DTP-ERR unsupported`), or is skipped when it has none. The
  walk-budget session (`requires: ["fixed:G10"]`) needs the server started
  with the session's `config` limits.
- A server may not ship an operation, field, error code, or default that the
  suite does not cover on both.
- The suite also checks the admin telemetry JSON and `/metrics` of both
  servers against the shared schema and metric list ([telemetry.md](telemetry.md)).

| Repo | Gate |
| --- | --- |
| PersonalServer | Every PR, against its own build |
| GlobalServer | Every PR, against its own build |
| TrustGraph | Nightly, both servers' latest builds side by side |

## Known gaps

Differences between the extension heap (AttentionX `src/graph/trust`, locked)
and this model. Decision D3 allowed fixing them in the `@dtp/trust-graph`
package only; the package records each divergence from the AttentionX origin
in `packages/trust-graph/DIVERGENCE.json`. The AttentionX copy keeps every
gap until the extension shim (TG-8) adopts the package.

| ID | Status in `@dtp/trust-graph` |
| --- | --- |
| G1, G2, G3, G4, G6, G7, G8, G10, G12 | **Fixed.** Their corpus cases assert `expect` |
| G5 | Open (`gap:G5`). Needs a protocol-layer key normalization, not a heap change |
| G9 | Open. A publish rule in the extension backend, outside the heap |
| G11 | Handled by the servers' ingest (PersonalServer applies kind `5`); not a heap concern |

The table keeps the original description of each gap in the AttentionX heap.

| ID | Where (AttentionX) | Behaviour there | Model rule | Product impact in the extension |
| --- | --- | --- | --- | --- |
| G1 | `Graph.getContextIndexes`, used by `IndexResolver` for `32014` | Non-empty `c` on a rating query falls back to parent and global buckets | Exact `c` only (NIP-32014) | None — product rating queries use `c = ""` |
| G2 | `Node` peer lists; `IndexResolver.buildIncomingEdges` and expansion | When one author has several active records to one node in one bucket (empty-scope + `x.com` slots, or `p:<hex>` + bound `user:id`), the first inserted wins; the winner can change after a worker restart | `scopeRank` desc, `created_at` desc, `id` asc (P2) | Rare |
| G3 | `Graph.applyTrustEvent` → `Node.removeOut` / `removeIn` | A Delete unlinks **every** same-kind record from that author to that node in the bucket with `created_at ≤` the Delete, not only its own slot; at load the outcome depends on iteration order | A Delete affects its own slot only | Rare (same setup as G2) |
| G4 | `IndexResolver` final degree | A disconnected result may carry Neutral statements (and a Neutral `direct`) from the last examined degree, and can count one twice when the subject is also a peer | Disconnected ⇒ no statements, `neutral = 0`, no `direct` ([wot-model.md §6.1](wot-model.md#61-disconnected-results); option A of decision D4) | Cosmetic: the extension shows the root's own Neutral on a disconnected result |
| G5 | `Graph.addNode` / `getNode` | Every node key is lowercased, so `web:` URLs that differ only in path case collide | Lowercase only case-insensitive parts, at the protocol layer | None for X |
| G6 | `Graph` | No unbind; removing a bind needs a full reload | Add `unbindIdentity(iKey)` | Servers need live unbind |
| G7 | `IndexResolver` subject score | For `32009` the subject's hit counters and peer counters share one object; with `SC ≠ TC` hop statements can leak into evidence. The subject is never expanded for `32009` but is for `32014` | Keep counters separate; keep the expansion asymmetry, documented | None — product uses `SC = TC` for trust |
| G8 | `backend.ts` `#projectTrust32009Identity`, `evaluateXIdentityRow`, `Graph.bindIdentity` | Binds are decided **outside** the walk, once, for the current operator, and applied to the heap for every query. The 32009 hint ranking runs a full trust query per issuer. Only lenient behaviour exists. | Binds decided inside the walk per root and level, in lenient or strict mode ([identity-binding.md](identity-binding.md)) | Same binds for the operator in most cases; differs for other roots and when a bind would only be decided at a deeper level |
| G9 | `backend.ts` `#subjectHintsForTrust` → `primaryNpubFromRow` | Publishing trust attaches the winning npub, which can come from another issuer's hint (`eventNpub`) | Attach only own-evidence or confirmed npubs ([identity-binding.md §9](identity-binding.md#9-publishing-rule)) | A second-hand hint looks first-hand to the next observer |
| G12 | `IndexResolver.resolve` | Returns only `Score[]`; the level structure (qualifying nodes per level) and decided binds are internal | Expose them so `graph.field` and field mode work in TypeScript | The Personal Server cannot offer `graph.field` until this lands |
| G11 | Relay sync and ingest | Kind `5` (NIP-09) deletions are not synced or applied; a statement deleted that way stays in the local heap | Deletion removes the winner and sets a slot floor ([wot-model.md §2.4](wot-model.md#24-slot-winner)) | Rare: Attention itself deletes with empty `v` / `score`, not kind `5` |
| G10 | `IndexResolver.resolve` | No time, node, or record budget: a walk runs to `maxDepth` or exhaustion, and a synchronous JavaScript walk cannot be interrupted from outside | Budgets checked inside the walk with the level-boundary rules of [wot-model.md §6.2](wot-model.md#62-guardrails); result reports `completeDepth` and the reason | The Personal Server cannot enforce its time guardrail until this lands |
| P3 | `src/graph/query.ts` (not locked) | Trust statements in walk order | Canonical order (§7.1) | None |

The package fixed them in the order G2, G3, G1, G4, G6, G8, G10, G12, G7.
What remains: G9 (a publish rule outside the heap, for the extension) and G5
(protocol-layer key normalization).

Budget cases in the corpus (`gap-g10-*`) use node and record budgets only,
never time, so both runners get identical `completeDepth` and results.
