# @dtp/relay-sync

Bounded Nostr relay synchronizer for the kind `32009` trust / kind `32014`
rating graph. Ported from the Attention extension (`AttentionX src/relay/`):
`synchronizer.ts`, `filters.ts`, `live-supervisor.ts`, `types.ts`, `retry.ts`,
`graph.ts`, and their tests. Only import specifiers changed (x-identity helpers
and `RATING_STATEMENT_KIND` now come from `@dtp/trust-protocol`). The durable
outbox (`outbox.ts`, `outbox-hold.ts`) was not ported — publishing stays in the
extension.

The package owns no sockets and no storage. A host implements these ports
(see `src/types.ts`):

| Port | Methods |
|------|---------|
| `RelayQueryClient` | `query(request: RelayQueryRequest): Promise<void>` — resolve after EOSE, reject on disconnect/timeout |
| `RelaySubscribeClient` (optional, live only) | `subscribe(request: RelaySubscribeRequest): RelaySubscription`, `releaseRelay?(relayUrl)` |
| `SyncCursorRepository` | `getCursor(relayUrl, scope)`, `setCursor(cursor)` |
| `RelayEventRepository` | `ingestEvent(event): Promise<'stored' \| 'duplicate' \| 'rejected'>`, `listEventsByAuthor(author, kind)` |
| `GraphFrontierReader` (optional) | `positiveChildren(authors, nowSeconds)`, `authorsFromRoots(roots, nowSeconds, limits)` |
| `Clock` (optional) | `now()`, `sleep(ms, signal?)` — defaults to `systemClock` |

## Entry points

- `RelaySynchronizer.synchronize(options)` — one bounded catch-up pass: BFS
  from `rootPubkeys` over positive `p` edges (via `GraphFrontierReader`, or
  `activePositivePubkeyEdges` over stored events), paged `32009` then `32014`
  author REQs per relay, optional `#i=user:id` discovery for `xUserIds`,
  per-scope cursors with overlap, retry with backoff, and a full refresh once
  per 24 h. Returns `SynchronizeResult` with truncation reasons.
- `RelaySynchronizer.refreshXPostSubjects(options)` — `#i=post:id` catch-up.
- `LiveSyncSupervisor.start / stop / replaceAuthors / replaceRelays` — live
  subscriptions (`mode: 'frontier'` per author batch, or `'global'` for
  author-unfiltered `GLOBAL_SYNC_KINDS`), with backpressure and EOSE
  checkpoints written to the same cursor repository.

## Strategies (PersonalServer `specs/sync.md`)

| Strategy | Composition |
|----------|-------------|
| Interval frontier (`frontier-interval`) | `synchronize()` on a timer |
| Continuous frontier (`frontier-continuous`) | `synchronize()` then `LiveSyncSupervisor` `mode: 'frontier'`, `replaceAuthors()` after each pass |
| Subscribe all (`global-continuous`) | `LiveSyncSupervisor` `mode: 'global'` |

Use the same `scope` string for the synchronizer and the supervisor: frontier
live mode seeds its `since` from the synchronizer's per-author cursors.
