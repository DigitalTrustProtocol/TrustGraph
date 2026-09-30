# `dtp-wot-corpus/1`

Conformance cases for the `dtp-wot/1` model ([specs/conformance.md](../specs/conformance.md)).
Read by the TypeScript runner (`@dtp/conformance`, `npm test` in TrustGraph)
and by the Rust Global Server (`dtp-conformance`). Paths and ids are stable:
new cases are added, existing ones are not renamed.

```text
corpus/
  manifest.json      { corpus, model, cases: [file, …] }   every case file, once
  model/*.json       records + ops → query expectations
  protocol/*.json    signed event → verdict + normalized record
```

A case file holds one case object, or `{ "cases": [ … ] }`.

## Placeholders

Every `@name` inside any string (keys included) is replaced by
`sha256(utf8(name))` as 64 lowercase hex before the case is used — in
records, inputs, and expectations alike. `@alice` ⇒
`2bd806c97f0e00af1a1fc3328fa763a9269723c8db8fac4f93af71db186d6e90`. Names
match `[A-Za-z0-9_.-]+`. Literal hex (for tie-break cases) is used as is.

## Model cases

| Field | Meaning |
| --- | --- |
| `id`, `model`, `tags`, `profile` | Case id (unique), `dtp-wot/1`, tags, scope profile (`x.com`) |
| `records[]` | Edge records in wot-model.md §2.1 field names (below) |
| `claims[]` | `{ pubkey, twitterId }` from winning kind `10011` events |
| `ownEvidence[]` | `{ root, iKey, pubkey, source: "bio" \| "post" }` — only for that root |
| `ops` | Optional explicit sequence (below). When absent: `apply` every record, then `claim` every claim, then `own` every evidence, in order |
| `queries[]` | `{ type, input, expect \| expectModel+expectCurrent \| pages, modes?, note? }` |

**Record** fields: `id`, `pubkey`, `kind` (`32009` \| `32014`), `created_at`,
`subjectType` (`p` \| `e` \| `i`), `subject`, `context` (default `""`),
`value` (32009: `-1` \| `0` \| `1`; 32014: score; **absent = Delete**),
`activate`, `expire`, `scopeRank`, `hintPubkey`, `content`, `labels`,
`labelHints`, `dTag`, `addressKey`. When `addressKey` is absent it defaults
to `"<kind>:<pubkey>:<subjectType>:<subject>:<context>"` — an opaque slot key
that is unique per (author, subject, context), standing in for the real `d`.

**Ops**: `apply { record }`, `remove { addressKey }` (drop the slot),
`claim { claim }`, `unclaim { pubkey }`, `own { evidence }`,
`unown { root, iKey }`, and `delete { author, created_at, addressKey | eventId }`
— a NIP-09 kind `5` by `author`: with `addressKey`, clear the slot's winner if
it is not newer than `created_at` and set the floor to `created_at`; with
`eventId`, remove that event if it is its slot's winner and `author` wrote it,
and set the floor to the event's `created_at`. Records at or below a slot's
floor are discarded. A deletion by another author does nothing.

### Query types and canonical output

`input` is the resolver-protocol params (resolver-api.md) for that query.
Resolver queries always set `now`.

| `type` | Input | Output compared |
| --- | --- | --- |
| `trust` | `TrustQuery` (+ `bindingMode`, `budgets`) | `connected, degree, trust, distrust, neutral (0 when absent), trustValue, resolution, statements[], direct (null when absent), sourceEventIds, pathView, followTrustThreshold, followTrustRed` |
| `rating` | `RatingQuery` | `degree, claimCount, averageScore, claims[], own (null), sourceEventIds, pathView, ratingEdges` |
| `lookup-incoming` / `lookup-outgoing` | lookup params | `items[], nextCursor (bool), totals (null when not requested), truncated (bool)` |
| `lookup-counts` | counts params | `counts` |
| `neighborhood` | `{ centerId: "<type>:<value>", direction, valueFilter, context, limit, now }` | `center, truncated, nodes[{subject, depth}], edges[{eventId, from, to, value}]` |
| `frontier` | `{ roots, maxDepth, maxAuthorsPerLevel, maxTotalAuthors, now }` | `authors[{pubkey, depth, via?}], reasons` |

Canonicalization before comparing (both sides):

- `statements` / `claims` in P3 order: `distance` asc, `createdAt` desc, `eventId` asc.
- Set-valued arrays are sorted: `sourceEventIds`, `reasons`, `pathView.nodes`
  (by `subject` = `"<type>:<value>"`), `pathView.edges` / `ratingEdges` /
  neighborhood `edges` (by `eventId`), neighborhood `nodes` (by `subject`),
  frontier `authors` (by `pubkey`). Heap-local numeric ids are replaced by the
  node's `subject`.
- Lookup `items` keep their order (it is the contract). An expectation may
  list `items` as event ids (strings) or as partial objects.

### Matching

An expectation is **partial**: every key it names must match, keys it omits
are ignored; arrays must have the same length and match element by element;
numbers match within `1e-9`; `null` also matches an absent field.

### Gaps

A query in a case tagged `gap:Gn` carries `expectModel` (the model rule)
and `expectCurrent` (today's TypeScript heap) instead of `expect`:

- The TypeScript runner asserts `expectCurrent`, which pins the locked heap.
- A model-correct runner (the Rust Global Server) asserts `expectModel`. A
  pass there means the implementation has the gap **fixed**; a runner
  should report it that way (for example "105 pass, 1 gap fixed"), not as a
  heap mismatch. Asserting `expect`-style behaviour from the TS heap on a gap
  case is a runner bug.
- A companion case without the tag pins what holds regardless of the gap
  (`context-neutral-occupies-its-bucket-connected` beside the G4 case
  `context-neutral-occupies-its-bucket`).

See the gap table in [specs/conformance.md](../specs/conformance.md#known-gaps).

### Binding modes

`modes: ["lenient", "strict"]` runs the query once per mode (setting
`input.bindingMode`). An expectation is either one value for both modes or
`{ "lenient": …, "strict": … }`. Every `bind` case lists both modes. Today's
TypeScript heap has one behaviour for both modes (gap G8): own evidence binds
through `Graph.bindIdentity`; witness hints and claims are not used.

### Paging

`pages: [{ limit, expectItems, expectNextCursor }]` lists consecutive pages at
the first entry's `limit`, following `nextCursor`. The cursor value itself is
opaque and never compared.

## Protocol cases

`{ id, model, tags, profile, description, event, expect }` with `event` the
seven NIP-01 fields. `expect`:

| Field | Meaning |
| --- | --- |
| `valid` | Passes the NIP checklists (a well-formed event of a kind that is not held is `valid` but `blocked`) |
| `prefix` | The NIP-01 `OK` prefix when rejected: `invalid` or `blocked` |
| `eligible` | Accepted by the scope profile and held |
| `record` | Partial normalized record in model field names; `value`, `activate`, `expire`, `hintPubkey`, `labelHints` are `null` when absent, `labels` `[]` |
| `claim` | Kind 10011: `{ pubkey, twitterId, eventId }` or `null` |
| `deletion` | Kind 5: `{ eventIds, addressKeys }` (own-author `a` targets for held kinds only) |

`protocol/*.json` is generated by
`packages/conformance/scripts/generate-protocol-cases.ts` from fixed test keys
(`sha256("dtp-corpus-key:<name>")`). Expected `addressKey`s are computed from
the NIP-32009 `d` material independently of the implementation. Signatures
use random aux data, so regenerating changes `sig` values, never verdicts.

## Session suite (`sessions/*.json`, listed under `manifest.sessions`)

The one-API suite ([conformance.md § One API](../specs/conformance.md#one-api-the-session-suite)):
`{ id, api: "v1", description, config, requires?, steps: [{ note?, send,
expect, unordered?, requires?, otherwise? }] }`. A runner starts a server
with `config` (for example `auth.reads` / `auth.writes`, or
`limits.maxReachedNodes`), opens one WebSocket, ignores the server's `AUTH`
challenge, and for each step sends `send` and reads exactly
`expect.length` frames, matching each in order (in any order with
`unordered: true`).

Matching is partial (as above), **numbers compare by value within `1e-9`**
(frames are parsed JSON, so `1.5e-6` from Rust equals `0.0000015` from
JavaScript; number text is never compared), plus matchers for
server-chosen values: `{ "$prefix": "invalid:" }` (NIP-01 message prefix),
`{ "$type": "number" }`, `{ "$any": true }`, and `{ "$unordered": [ . ] }`
(the array holds the listed patterns in any order; used for neighborhood
nodes and edges, whose order is implementation-local). `DTP-PUSH` frames
are matched only by steps that expect one; other pushes are dropped.

**Capability gating.** `requires` entries are operation names (must be in
`dtp.capabilities`) or `fixed:Gn` (the server must not list `Gn` in
`dtp.gaps`; an absent `gaps` means none open). When a session or step has
requirements the runner first sends `["DTP", "$features", "info", {}]`. A
step whose requirements fail asserts `otherwise` if it has one, else it is
skipped (`skipped: true` in the outcome). `graph.field` steps expect
`DTP-ERR unsupported` otherwise; `walk-budgets.json` requires `fixed:G10`
and is skipped whole by a server whose walk has no budgets.

| Session | Steps | Covers |
| --- | --- | --- |
| `basic-open.json` | 29 | ingest `OK` prefixes, NIP-09 `e` deletion, `REQ` ids, `trust.query`, `trust.batch`, `rating.query`, `lookup.incoming`, `lookup.counts`, `graph.frontier`, `identity.claims`, `session.update`, `DTP-ERR invalid` |
| `ops-open.json` | 27 | `info`, `rating.batch`, `lookup.outgoing`, `lookup.batch` (with item errors), `graph.neighborhood` (trust edges, rating arrows, `valueFilter`), `subscribe` / `unsubscribe` with a `graph` push, NIP-09 `a` deletion, `REQ` authors + kinds, scores below 0.001, `graph.field` (gated) |
| `walk-budgets.json` | 5 | `maxReachedNodes` truncation and `completeDepth` (gated on `fixed:G10`) |

Generated by `packages/conformance/scripts/generate-sessions.ts` (after
`npm run build`); signatures use random aux data, so regenerating changes
`sig` values only. The TypeScript runner is `runSession()` in
`@dtp/conformance`, used by the Personal Server tests.

## Properties checked over every model case

Idempotence, older-discarded, order independence (outside gap and
own-evidence setups), lookups ignore the observer, pages add up, counts =
items (`packages/conformance/test/properties.test.ts`).
