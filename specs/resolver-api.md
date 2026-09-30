# Resolver protocol v1

Status: **draft** · 2026-09-30

**One API.** The Personal Server and the Global Server implement exactly the
same protocol: the same messages, operations, parameters, defaults, results,
errors, push topics, authentication, ingest rules, and guardrail semantics.
A client never branches on which server it talks to; switching servers is a
change of URL.

What may differ is only:

- **configuration** — named settings with the same meaning on both servers,
  reported in the NIP-11 document (listen address, allowed origins, access
  policy, guardrail values);
- **deployment** — how events reach the server (its own relay sync, or Sync
  Servers pushing `EVENT`s), which is invisible to clients.

## Design

- **One WebSocket per server is the main interface.** Clients such as
  Attention send a steady stream of small batches while the user scrolls;
  one long-lived connection with pipelined requests avoids per-call
  connection and header cost, and lets the server push graph changes.
- **It is a Nostr relay connection.** Framing is NIP-01 (JSON arrays).
  Standard messages carry ingest (`EVENT` / `OK`), authentication (NIP-42
  `AUTH`), and limited reads (`REQ`). Resolver and lookup operations use
  additional `DTP` messages. Generic Nostr tools (sync services, relay
  routers, client libraries) can push events and authenticate without knowing
  the resolver.
- Request and result shapes reuse the extension's existing types
  (`TrustQueryResult`, `RatingQueryResult`, `QueryTrustBatchResult`, …), so
  the extension adapter is a pass-through.

## Data scope

Both servers hold kinds `32009`, `32014`, and `10011`, plus the NIP-09
deletions that target them. Neither holds kind `0`, X identity or post data
(`xIdentities`, `xPosts`), or client identity evidence; those stay in the
extension. Binding therefore uses only public events: `32009` npub hints and
`10011` claims ([identity-binding.md](identity-binding.md)).

## Configuration

Every setting exists on both servers. The table shows the recommended default
for each deployment; operators may change any of them.

| Setting | Meaning | Personal deployment | Global deployment |
| --- | --- | --- | --- |
| `listen` | Where the socket accepts connections | This machine (or LAN, private addresses only) | Public, TLS |
| `allowedOrigins` | Web `Origin`s accepted at upgrade; clients without `Origin` are always allowed | `chrome-extension://<Attention id>` | any |
| `allowedHosts` | `Host` values accepted (DNS-rebinding guard) | the local name and addresses | the public host names |
| `auth.reads` | `open` or `members` (role `read`) | `open` | `open` |
| `auth.writes` | `open` or `members` (role `write`) | `open` | `members` |
| `auth.admins` | Pubkeys allowed to use NIP-86 | none (CLI only) | operator pubkeys |
| `membership.source` | `nip43` (managed list); later `wot` | `nip43` | `nip43` |
| `rateLimit` | Cost units per second per client (IP or pubkey), per role | none | set by the operator |
| Guardrail values | See [§ Guardrails](#guardrails) | protocol defaults | tighter deadlines, `maxDepth` 6, `maxInFlight` 16 |

The NIP-11 document reports the effective values: `limitation.auth_required`
(reads), `limitation.restricted_writes` (writes), `limitation.max_message_length`,
and `dtp.limits`.

## Conventions

- Version `v1`. Changes within v1 are additive: new optional fields, new
  operations, new push topics. Clients ignore unknown fields, message types,
  and topics; servers reject unknown operations with `invalid: unknown op`.
- Pubkeys and event ids are 64 lowercase hex (no `npub`; clients convert).
- Subjects are `{ "type": "p" | "e" | "i", "value": string }`. A wire node id
  is `"<type>:<value>"` (the extension's `subjectNodeId` format).
- Times are Unix seconds. `now` is optional; the server clock is the default.
- Scores and averages are JSON numbers. A server may write any valid JSON
  form of a number (`1.5e-6` and `0.0000015` are the same value); clients
  and the conformance suite compare values, never number text. Averages are
  compared within `1e-9` ([wot-model.md §7.3](wot-model.md#73-rating-k--32014)).
- Every result carries `graphVersion` (monotonic per `instanceId`). Numeric
  node ids in `pathView` and neighborhood results are valid only for that
  `instanceId`.

## Connection

- URL: the server's WebSocket URL, for example `ws://127.0.0.1:3870/` or
  `wss://<host>/`. The NIP-11 document is served on the same URL for
  `GET` with `Accept: application/nostr+json`.
- Upgrade checks: `Host` in `allowedHosts`; web `Origin` in `allowedOrigins`.
- `permessage-deflate` is supported; clients on loopback may skip it.
- Maximum message size: 4 MB (default).

The NIP-11 document lists `supported_nips`, `self` (the
server's own pubkey, used to sign its membership list), `limitation`, and a
`dtp` object: `{ api, model, corpus, instanceId, scopeProfile, capabilities,
limits }`. In v1 `capabilities` always contains every operation in this
document; it exists so later versions can add operations.

`supported_nips` lists only what the server implements: always 1, 9, 11,
42, and 43; **86 only when the NIP-86 management endpoint answers** (a server
whose `POST /` management returns an `unsupported:` error for every method
does not list 86). Clients discover management support from this list, not
from the server's name.

*Interim (until decision D3 lands gaps G8 / G10 / G12 in `@dtp/trust-graph`):*
a TypeScript server lists only the operations it implements in
`capabilities`, names each missing one with its reason in
`dtp.unsupported` (`{ "graph.field": "…" }`), and lists the open model gaps
in `dtp.gaps` (`["G8", "G10", "G12"]`). Calls to a missing operation answer
`DTP-ERR <reqId> unsupported <reason>`. Both fields disappear when the gaps
close.

## Messages

| Direction | Message | Meaning |
| --- | --- | --- |
| client → server | `["EVENT", <event>]` | Ingest one signed event ([§ Ingest](#ingest-event)) |
| client → server | `["AUTH", <kind 22242 event>]` | NIP-42 authentication |
| client → server | `["REQ", <sub>, <filter>, …]` | Limited reads: `ids` (≤ 500), `authors` + `kinds` for the held kinds (≤ 20 authors), and the NIP-43 kinds `13534` / `33534`; anything else is `CLOSED` with `unsupported:`. A read ends with `EOSE`; later events are not streamed |
| client → server | `["CLOSE", <sub>]` | End a read |
| client → server | `["DTP", <reqId>, <op>, <params>]` | Resolver or lookup operation |
| client → server | `["DTP-CANCEL", <reqId>]` | Abandon an in-flight operation |
| server → client | `["AUTH", <challenge>]` | Sent right after connect |
| server → client | `["OK", <eventId>, <bool>, <message>]` | Answer to each `EVENT` and `AUTH` |
| server → client | `["EVENT", <sub>, <event>]`, `["EOSE", <sub>]`, `["CLOSED", <sub>, <message>]`, `["NOTICE", <message>]` | NIP-01 |
| server → client | `["DTP-OK", <reqId>, <result>]` | Operation result |
| server → client | `["DTP-ERR", <reqId>, <code>, <message>]` | Operation failure |
| server → client | `["DTP-PUSH", <topic>, <data>]` | Subscription push |

- `reqId` is chosen by the client and unique among its in-flight requests.
  Operations are **pipelined**; results can arrive in any order.
- Past the in-flight limit the server answers `DTP-ERR busy` instead of
  queueing.
- Identical in-flight queries on one connection MAY be computed once.
- `DTP-ERR` codes reuse the NIP-01 / NIP-42 machine-readable prefixes where
  they fit; see [§ Error codes](#error-codes).

### Error codes

One vocabulary for `DTP-ERR` codes, batch item errors, and the
machine-readable prefixes of `OK`, `CLOSED`, and `NOTICE` messages. Clients
branch on the code only; the message after it is human text and differs
between servers.

| Code | `DTP-ERR` when | As a prefix (`OK` / `CLOSED` / `NOTICE`) |
| --- | --- | --- |
| `invalid` | Malformed `params` or field; unknown operation (`invalid: unknown op`); unknown push topic; over `maxBatchItems`, `maxLookupKeys`, or `maxLookupBatch`; a `reqId` already in flight on the connection; a non-string `op` | Event fails validation (shape, id, signature, NIP rules); malformed `REQ` filter; malformed frame or binary frame (`NOTICE`) |
| `auth-required` | `auth.reads = members` and the connection has not authenticated | Same for `EVENT` (`auth.writes`) and `REQ`; failed `AUTH` answers use `invalid:` or `restricted:` |
| `restricted` | Authenticated, but no pubkey on the connection has the needed role | `EVENT` without the `write` role; banned pubkey; `AUTH` by a banned pubkey |
| `rate-limited` | The client exceeded its `rateLimit` cost budget | `EVENT` refused by a write limit (cost budget, or a server capacity limit such as a full heap) |
| `busy` | Over `maxInFlight`, or the `maxColdWalks` queue is full; retry later | - |
| `cancelled` | Answer to `DTP-CANCEL` for an in-flight operation. The server sends it at most once, immediately or when the operation next checks, and never also a `DTP-OK`. A `DTP-CANCEL` for an unknown `reqId` gets no answer | - |
| `unsupported` | An operation or option the server does not implement (interim: listed in `dtp.unsupported`, see [§ Connection](#connection)) | `REQ` outside the limited reads (`CLOSED`); NIP-86 methods a server does not implement (HTTP body) |
| `not-found` | Reserved; no v1 operation emits it. Clients treat it like `error` | - |
| `error` | Internal failure; the request may be retried | `OK` false when storage fails |
| - | - | `duplicate:` (`OK` true: already stored, or older than the stored winner) and `blocked:` (`OK` false: kind or scope not accepted, deleted, deletion without a held target) are ingest-only ([§ Ingest](#ingest-event)) |

Batch operations (`trust.batch`, `rating.batch`, `lookup.batch`) report
per-item failures in `errors`, not as `DTP-ERR`: the value is `"timeout"`
for items the `batchDeadline` did not reach, or `"<code>: <message>"` with
code `invalid` or `unsupported` for an item whose own params fail. Any other
failure (`busy`, `cancelled`, `error`, auth) fails the whole operation with
`DTP-ERR`.

### Session defaults

`["DTP", "1", "session.update", { "defaults": { "rootPubkey": "<hex>",
"bindingMode": "lenient", "followTrustThreshold": 75, "followTrustRed": 25,
"bounds": { "maxDepth": 4 }, "statementLimit": 50 } }]`

Defaults apply to every later resolver query on the connection that does not
set the field itself, so a scrolling client sends only subjects. Send
`session.update` again when a setting or the active root changes. A root set
in the session defaults becomes an **active root** for the server: its data is
kept warm and, where the server syncs itself, its frontier joins the sync.

### Keepalive, idle, reconnect

- The server sends WebSocket pings every 20 s and closes a connection with no
  pong for 60 s; it closes idle read-only connections after 5 minutes.
- Clients connect on demand and MAY close when idle. Attention does, so the
  socket never keeps its service worker alive by itself.
- On reconnect: answer the new `AUTH` challenge if needed, send
  `session.update`, re-`subscribe`. If `instanceId` changed, numeric node ids
  are stale. Backoff 0.5 s → 30 s with jitter.

## Authentication and access

Standard Nostr relay authentication (NIP-42).

1. On connect the server sends `["AUTH", <challenge>]`.
2. A client that wants to authenticate signs a kind `22242` event with tags
   `["relay", <server URL>]` and `["challenge", <challenge>]` and sends
   `["AUTH", <event>]`. Several pubkeys MAY authenticate on one connection.
3. The server checks kind, `created_at` within ±10 minutes, challenge, and
   relay URL, and answers `OK`.
4. When `auth.reads` or `auth.writes` is `members`, a request of that class
   without authentication is refused with `auth-required:`; an authenticated
   pubkey without the needed role gets `restricted:`.

| Request class | Governed by | Role needed when `members` |
| --- | --- | --- |
| `DTP` operations, `REQ` | `auth.reads` | `read` |
| `EVENT` | `auth.writes` | `write` |
| NIP-86 management over HTTP (NIP-98) | `auth.admins` | `admin`, or listed in `auth.admins` |

### The whitelist is a NIP-43 membership list

- The server's own key (`self` in NIP-11) signs a kind `13534` membership
  list with one `["member", <pubkey>, <role>, …]` tag per member, and kind
  `33534` role definitions (`d` = `read`, `write`, `admin`). Clients can read
  both with `REQ`.
- Members are managed with NIP-86 (`allowpubkey`, `unallowpubkey`,
  `listallowedpubkeys`, `assignrole`, `unassignrole`, `banpubkey`), authorized
  by NIP-98, or with the server CLI. The server re-signs `13534` after every
  change.
- **Later: WoT as the whitelist.** `membership.source = wot` will derive the
  members from the operator's own web of trust (pubkeys that qualify within a
  configured degree and threshold of the operator root). The derived list is
  still published as `13534`, so clients see the same standard. The protocol
  does not change.

## Ingest (`EVENT`)

- Accepted kinds: `32009`, `32014`, `10011`, and NIP-09 kind `5` deletions
  that target them. Each event is validated fully (id, signature, NIP-32009 /
  NIP-32014 / NIP-39 / NIP-09 rules, scope profile), whoever sends it.
- **Deletions (NIP-09).** A kind `5` from the same author as the target
  removes it: an `e` tag removes that event if it is the slot's current
  winner; an `a` tag clears the slot. Either way the slot gets a floor at the
  deletion's time, so older versions are never revived and re-pushes of the
  deleted event are refused with `blocked: deleted`
  ([wot-model.md §2.4](wot-model.md#24-slot-winner)). Attention uses this to
  withdraw a statement the user removed from its outbox during the regret
  hold.
- `OK` messages use NIP-01 prefixes: `duplicate:` (already stored, or older
  than the stored winner), `invalid:`, `blocked:` (kind or scope not
  accepted, or deleted), `rate-limited:`, `auth-required:`, `restricted:`,
  `error:`. `duplicate:` answers carry `true`; a kind `5` that matches no
  held event (and names no own `a` slot) is not stored and answers
  `false` with `blocked:`. Signature checks run before slot reduction, so a
  forged copy of a stored event is `invalid:`, not `duplicate:`.
- Backpressure: at most `maxPendingOks` events per connection may be waiting
  for `OK`; beyond that the server stops reading the socket, so a fast writer
  is slowed by TCP instead of growing queues.
- Several writer connections may be open at once (`maxWriterConnections` per
  pubkey); events are deduplicated by id across connections.

## Operations

Two families, plus a few session and helper operations. Every operation is
available on both servers.

| Family | Walks | Depends on the observer | Budgets |
| --- | --- | --- | --- |
| **Resolver** | several degrees | yes: root, thresholds, binding mode | walk budgets and deadline |
| **Lookups** | one degree | **no** — deterministic for everyone | page size, keys per request, scanned records, deadline |

`params` are the extension message minus `type` and `version`; missing query
fields come from the session defaults (resolver operations only; lookups do
not use a root).

### Resolver operations

| Op | Params | Result |
| --- | --- | --- |
| `trust.query` | `{ subject, context?, …query }` | `TrustQueryResult` |
| `trust.batch` | `{ items: [{ key, subject, context? }] (≤ 200), …query }` | `QueryTrustBatchResult` `{ graphVersion, results: { [key]: TrustQueryResult }, errors? }` |
| `rating.query` | `{ subject, context?, labels?, …query }` | `RatingQueryResult` |
| `rating.batch` | `{ items: [{ key, subject, context?, labels? }] (≤ 200), …query }` | `QueryRatingBatchResult` |
| `graph.field` | `{ rootPubkey?, hopContext?, threshold?, maxDepth?, bindingMode? }` | `{ graphVersion, completeDepth, levels: [[pubkey, …], …], binds }` |

### Lookup operations

One degree of stored winners, defined in
[wot-model.md §8.1](wot-model.md#81-lookups): "who trusts this npub", "whom
does this npub trust", "who rated this post", "what did this npub rate", with
counts and pages. They feed lists, profile panels, and graph views.

| Op | Params | Result |
| --- | --- | --- |
| `lookup.incoming` | `{ keys, …lookup }` | `LookupPage` of statements **about** the keys |
| `lookup.outgoing` | `{ keys, …lookup }` | `LookupPage` of statements **by** the keys (pubkeys) |
| `lookup.counts` | `{ keys, direction, kinds?, context?, contextMatch?, values?, subjectTypes?, labels?, mergeKeys?, includeInactive?, now? }` | `{ graphVersion, counts: { [key \| "merged"]: { trust, neutral, distrust, ratings } } }` |
| `lookup.batch` | `{ queries: [{ id, op: "incoming" \| "outgoing" \| "counts", params }] (≤ 50) }` | `{ graphVersion, results: { [id]: result }, errors? }` |
| `graph.neighborhood` | `{ keys \| centerId: number \| "<type>:<value>", direction?, valueFilter?, context?, limit? }` | `{ graphVersion, centerId, truncated, nodes, edges }` — incoming + outgoing lookups for one center, shaped for graph views (no X chrome), with rating arrows on post centers; see [below](#graphneighborhood) |

Lookup fields (`…lookup`):

| Field | Default | Meaning |
| --- | --- | --- |
| `keys` | required, ≤ 50 | Wire node ids (`"p:<hex>"`, `"i:user:id:<n>"`, `"i:post:id:<n>"`, `"e:<hex>"`); not resolved through binds |
| `kinds` | `[32009]` | `32009`, `32014`, or both |
| `context`, `contextMatch` | `""`, `chain` for 32009 / `exact` for 32014 | `chain`, `exact`, or `any` |
| `values` | all | 32009: subset of `1`, `0`, `-1` |
| `subjectTypes` | all | Outgoing: `p`, `user:id`, `post:id`, `e`, `other` |
| `labels` | none | 32014: at least one of these labels |
| `includeInactive`, `now` | `false`, server clock | Activity window filter |
| `since`, `until` | none | `created_at` range |
| `mode` | `selected` | `selected` (one per author, key, kind) or `raw` (every winner) |
| `mergeKeys` | `false` | Incoming: treat the keys as one person's aliases |
| `order` | `recent` | `recent` or `author` |
| `limit` | 100 | ≤ 500 |
| `cursor` | none | From the previous page's `nextCursor` |
| `withTotals` | `false` | Also return the exact counts for the whole result |

```json
{
  "graphVersion": 4812,
  "items": [{
    "eventId": "…", "connectionKey": "32009:<author>:<d>", "kind": 32009,
    "author": "<hex>", "subject": { "type": "i", "value": "user:id:11348282" },
    "context": "identity", "value": 1, "createdAt": 1790000000,
    "activeFrom": 1790000000, "labels": ["reviewer"], "content": "…"
  }],
  "nextCursor": "opaque",
  "totals": { "trust": 812, "neutral": 40, "distrust": 17, "ratings": 0 }
}
```

- Items reuse the `ResolvedStatement` / `RatingClaimEvidence` fields without
  the walk-only ones (`distance`, `requestedContext`, `contextMatch`);
  ratings carry `score` instead of `value`.
- Paging is keyset: `nextCursor` encodes the last item's sort key and the
  filter, so pages stay correct while the graph changes, but a page is not a
  snapshot of the whole list. Each page carries its `graphVersion`.
- Lookups never return an average rating: that would be a crowd score. Use the
  resolver for "what does my network think".
- `lookup.counts` answers headers and badges without shipping rows.

#### `graph.neighborhood`

One degree around a center, shaped for graph views. Params:

| Field | Default | Meaning |
| --- | --- | --- |
| `centerId` / `keys` | required | The center as a heap index from an earlier result (same `instanceId`), a wire id, or the first of `keys`. The other `p:` keys also expand outward. A bound `user:id` center also expands its bound pubkey |
| `direction` | `both` | `out` (statements by the center, only if it is a pubkey), `in` (statements about it), or `both` |
| `valueFilter` | `both` | Which edge values to draw: `trust` keeps value `1`, `distrust` keeps `-1`, `both` keeps `1`, `0`, and `-1`. Neutral edges therefore appear only with `both` |
| `context` | `""` | Trust edges come from the buckets of `Chain(32009, context)` ([wot-model.md §4.2](wot-model.md#42-context-buckets-and-chains)); every active winner in those buckets is an edge (no per-author selection) |
| `limit` | 200 | ≤ `maxNeighborhoodLimit` |
| `now` | server clock | Activity window |

Result `{ graphVersion, centerId, truncated, truncatedReasons?, nodes, edges }`:

- `nodes`: `{ id, kind, depth, label, subject }`; the center has depth `0`,
  every other node `1`. `id` is implementation-local; compare by `subject`.
- `edges`: `{ id, from, to, value, context, eventId, depth: 1 }`, one per
  statement. `from` / `to` are node ids.
- **Rating arrows.** When `direction` includes `in` and the center is a post
  (`i:post:id:*` or `e`), active `32014` ratings about it in the exact empty
  context are drawn as edges too: `value` is the display polarity (`1` if
  score ≥ 50, else `-1`, as `ratingEdges` in [wot-model.md §7.3](wot-model.md#73-rating-k--32014)),
  `id` and `eventId` are the rating's event id, and `valueFilter` applies to
  that polarity. An author whose `32009` edge to the center is already in the
  result (after `valueFilter`) gets no rating arrow, so each author draws at
  most one arrow. Ratings are never hops; a rating arrow is display only.
- Past `limit`, edges are kept in `eventId` order, nodes without a kept edge
  are dropped (the center stays), and the result carries `truncated: true`
  and `truncatedReasons: ["neighborhoodLimit"]`.

### Other operations

| Op | Params | Result |
| --- | --- | --- |
| `info` | — | The NIP-11 `dtp` object plus `graphVersion` and memory status |
| `session.update` | `{ defaults }` | `{ defaults }` |
| `graph.frontier` | `{ roots, maxDepth?, maxAuthorsPerLevel?, maxTotalAuthors? }` | `{ graphVersion, authors: [{ pubkey, depth, via? }], reasons[] }` — sync frontier ([wot-model.md §8](wot-model.md#8-read-helpers-not-scores)) |
| `identity.claims` | `{ twitterId }` | `{ claims: [{ pubkey, eventId }] }` |
| `subscribe` / `unsubscribe` | `{ topics }` | `{ topics }` |

Signed events are read with standard `REQ` (`ids`), not a custom operation.

## Query fields (resolver)

| Field | Default | Meaning |
| --- | --- | --- |
| `rootPubkey` | session default; required if the session has none | Observer |
| `context` | `identity` for `trust.*`, `""` for `rating.*` (product profile `attention`, [wot-model.md §9](wot-model.md#9-product-profile-attention-scope-profile-xcom)) | Score context `SC` |
| `now` | server clock | Activity time for `x` / `y` |
| `bounds.maxDepth` | 4 | 1–7, capped by the server's `maxDepth` guardrail |
| `format` | `default` | `path` adds `pathView` |
| `followTrustThreshold` | 75 | Green knob; hop threshold for trust queries |
| `followTrustRed` | 25 | Red knob |
| `hopContext` | `identity` | Hop context `TC` ([wot-model.md §6](wot-model.md#6-the-trust-walk)) |
| `statementLimit` | 50 | Max statements / claims per result, up to `maxStatementLimit`; counts stay exact. Statements and claims are returned in P3 order (`distance` asc, `createdAt` desc, `eventId` asc) and cut after that sort, so the cut is the same on every server. Full lists come from lookups |
| `bindingMode` | `lenient` (decision D5) | `lenient` or `strict` ([identity-binding.md](identity-binding.md)) |
| `deadlineMs` | server's `operationDeadline` | Lower (never raise) the time guardrail for this request |

The rating hop threshold is fixed at 1 by the product profile
([wot-model.md §9](wot-model.md#9-product-profile-attention-scope-profile-xcom)).

## Additive result fields

| Field | Meaning |
| --- | --- |
| `truncated: true`, `truncatedReasons[]` | `timeBudget`, `nodeBudget`, `edgeBudget`, `statementLimit`, `neighborhoodLimit`, `pathLimit` |
| `completeDepth` | Deepest walk level fully built before a guardrail stopped it ([wot-model.md §6.2](wot-model.md#62-guardrails)) |
| `statementsTruncated: true` | `statements` / `claims` were cut by `statementLimit` |
| `coverage` | `complete` \| `partial` |
| `coverageReasons[]` | `root-warming` (the server is still fetching data for this root: first sync of a new root, or open requests to writers), `claims-pending` (strict mode is waiting for a candidate's `10011`), `binding-unsupported` (interim: the server cannot bind X accounts yet — gap G8 — so a `user:id` subject is answered without binds and routes through X accounts are missing) |
| `binding` | For `user:id` subjects: `{ mode, pubkey?, source, confirmed, witnessEventId?, witnessDegree?, claimEventId?, cutCandidate?, cutReason? }` ([identity-binding.md §8](identity-binding.md#8-result-provenance)) |

## Push topics

| Topic | Data |
| --- | --- |
| `graph` | `{ graphVersion, changed?: { subjects: wire ids } }`, coalesced to ≤ 4 per second; `changed` is included when at most 500 subjects changed since the last push. A changed statement lists its subject and its author (`p:<hex>`); a changed claim lists `i:user:id:<n>`. Results for other subjects can change through hops, so a client that caches walks refreshes them on any push |
| `coverage` | `{ rootPubkey, coverage, reasons }` when a root's warming finishes |
| `want` | `{ demandId, authors?, ids?, kinds }` — data the server is missing; only useful to writers that can fetch it ([GlobalServer sync-server.md](../../GlobalServer/specs/sync-server.md#optional-demand-hints)) |

## Guardrails

One set of guardrails with the same names, semantics, and defaults on both
servers; operators may change the values, and `dtp.limits` in NIP-11 reports
the effective ones. The walk semantics under a limit are normative
([wot-model.md §6.2](wot-model.md#62-guardrails)). Lookups do not walk, so
node budgets do not apply to them; page size, keys, scanned records, and the
per-operation deadline do.

| Guardrail (`dtp.limits` name) | Default | On breach |
| --- | --- | --- |
| `operationDeadline` | 500 ms | Stop at the next check; return what is exact, `truncated` with `timeBudget` |
| `batchDeadline` | 1 000 ms | Remaining items get `errors[key] = "timeout"` |
| `maxDepth` | 7 | Clamp `bounds.maxDepth` |
| `maxReachedNodes` | 5 M | `nodeBudget` |
| `maxWalkRecords` | 50 M scanned per walk | `edgeBudget` |
| `maxStatementLimit` | 500 | Clamp `statementLimit` |
| `maxPathNodes` | 1 000 | `pathLimit` |
| `maxNeighborhoodLimit` | 500 | `neighborhoodLimit` |
| `maxBatchItems` | 200 | `invalid:` |
| `maxLookupKeys` | 50 | `invalid:` |
| `maxLookupPage` | 500 | Clamp `limit` |
| `maxLookupBatch` | 50 | `invalid:` |
| `maxLookupRecords` | 5 M scanned per lookup page | Page ends early with `nextCursor`; totals are omitted with `truncatedReasons: ["edgeBudget"]` |
| `maxInFlight` | 32 per connection | `busy` |
| `maxConnections` | 16 per client (IP or pubkey) | Refused at upgrade |
| `maxColdWalks` | server-wide, from cores | Queued, then `busy` |
| `maxUnsentOutput` | 8 MB per connection | Slow client disconnected |
| `maxPendingOks` | 5 000 per connection | Stop reading the socket |
| `maxWriterConnections` | 8 per pubkey | Refused at upgrade |

Memory guardrails depend on the implementation and are described in each
server's architecture spec; they never change the protocol behaviour above.

## Mapping from Attention messages

| Extension message (`src/shared/contracts.ts`) | Protocol |
| --- | --- |
| `QUERY_TRUST` / `QUERY_TRUST_BATCH` | `DTP trust.query` / `trust.batch` |
| `QUERY_RATING` / `QUERY_RATING_BATCH` | `DTP rating.query` / `rating.batch` |
| `QUERY_OUTGOING_TRUST` | `DTP lookup.outgoing { keys: <person's pubkeys>, kinds: [32009], context: "identity", subjectTypes: ["p", "user:id"] }` |
| `QUERY_INCOMING_TRUST` | `DTP lookup.incoming { keys: ["i:user:id:<n>", "p:<hex>", …], kinds: [32009], context: "identity", mergeKeys: true }` — the key set comes from the extension's own `xIdentities` row |
| Notes: who rated this post; what this user rated | `DTP lookup.incoming` / `lookup.outgoing` with `kinds: [32014]` |
| Application pages (Users, Posts, Events drill-down) | `DTP lookup.*` with `order`, `limit`, `cursor`, and `lookup.counts` for headers |
| `GET_GRAPH_NEIGHBORHOOD`, Graph View expand | `DTP graph.neighborhood`; several centers at once with `lookup.batch` |
| Local publish write-through (`GraphManager.applyRecord`) | `EVENT` with the full signed event from IndexedDB (heap records have `sig` stripped), when the server lets the user write |
| Outbox removal during the regret hold | `EVENT` with a NIP-09 kind `5` for that event id, to the same server |

The service worker fills the session defaults from its settings (active
root, thresholds, max degree, binding mode, statement limit) and decorates
results with X chrome from its own `xIdentities` / `xPosts`. Whether the user
may write is known from NIP-11 (`restricted_writes`) and, when restricted,
from the membership list.

## HTTP

Only for discovery, health, and management:

| Path | Purpose |
| --- | --- |
| `GET /` with `Accept: application/nostr+json` | NIP-11 document |
| `POST /` with `Content-Type: application/nostr+json+rpc` | NIP-86 management (NIP-98 auth) |
| `GET /healthz`, `GET /readyz` | Process up; graph loaded and ingest caught up |

Telemetry web pages, their JSON, and Prometheus metrics are served on a
separate admin listener (loopback by default) with the same contract on both
servers ([telemetry.md](telemetry.md)).

## Machine-readable contract

Written during implementation, from JSON Schemas generated from the
`@dtp/trust-query` types: `TrustGraph/asyncapi/resolver.v1.yaml` (AsyncAPI 3)
describes the WebSocket messages. The TypeScript client
`@dtp/resolver-client` implements NIP-01 framing, NIP-42 (with a signer
callback, so keys stay in the caller), pipelining, reconnect, and
subscriptions once for Attention, the Website, and other apps.

**One API test suite.** A protocol conformance suite (`@dtp/conformance`,
protocol part) runs the same scripted sessions — messages, operations, errors,
auth, ingest, deletions, guardrail responses — against a running Personal
Server and a running Global Server with the same configuration and the same
events, and requires equal results after canonicalization (numbers compared
by value within `1e-9`, never by text). Steps for operations or behaviour a
server does not have yet are gated on `dtp.capabilities` and `dtp.gaps`. It
sits beside the model corpus ([conformance.md](conformance.md)).
