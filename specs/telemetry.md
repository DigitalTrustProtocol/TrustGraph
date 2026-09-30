# Telemetry — admin pages

Status: **draft** · 2026-09-30

Both servers serve the **same telemetry web pages**, the same JSON, and the
same metric names on a local admin listener, so an operator can see what is
going on: health, graph size, ingest, sync, queries, guardrails, memory, and
errors. Like the [resolver protocol](resolver-api.md), telemetry is one
contract for the Personal Server and the Global Server; the Sync Server
(`dtp-sync`) serves the subset that applies to it.

## Admin listener

| Setting | Default | Notes |
| --- | --- | --- |
| `admin.listen` | `127.0.0.1:<protocol port + 1>` (Personal: `127.0.0.1:3871`) | Separate from the protocol socket; never public by default |
| `admin.auth` | `local` | `local`: loopback connections need no login. `nip98`: every request needs a NIP-98 signature by a pubkey in `auth.admins` (required whenever `admin.listen` is not loopback) |

- `Host` and `Origin` checks as on the protocol socket (DNS-rebinding guard).
- For a remote Global Server, the recommended access is an SSH tunnel to the
  loopback listener. Binding the admin listener to another interface is
  allowed only with `admin.auth = nip98`; the login page signs with a NIP-07
  signer in the admin's browser, or accepts a one-time code printed by the
  server CLI.
- The pages are **read-only**. Changing members, relays, or settings goes
  through NIP-86 or the CLI, so there is one management path.

## Pages

| Page | Shows |
| --- | --- |
| **Overview** | Ready / not ready, uptime, version, model and corpus version, `instanceId`, `graphVersion`, epoch lag, and the active alerts (below) |
| **Graph** | Nodes; edges by kind (`32009`, `32014`); `10011` claims; hinted statements; delete floors; graph bytes and bytes per edge; implementation details (segments, resident vs pinned bytes, heap size) |
| **Ingest** | Events per second accepted, by kind; rejects by `OK` prefix (`invalid`, `blocked`, `duplicate`, `rate-limited`, …); NIP-09 deletions; queue depth and pending `OK`s; one row per writer connection: writer pubkey, connected since, events, rejects |
| **Sources** | Relay sync, where the server syncs itself: per relay state, last EOSE, cursor lag, errors, retry backoff; frontier size and truncation reasons. Writers, where events are pushed in. Open `want` demands. Sections a server does not use are shown empty |
| **Queries** | Operations per second by op; latency p50 / p95 / p99, split warm / cold; in-flight; `busy` and `rate-limited` answers; guardrail hits by reason (`timeBudget`, `nodeBudget`, `edgeBudget`, …); background completions; root-field cache hit rate and bytes |
| **Connections** | Open connections by role (anonymous reader, member reader, writer, admin) and by origin class (extension, native app, other); authentications; slow-client disconnects |
| **Memory** | Process limit, each budget share vs its limit, RSS, watchdog state, implementation details (V8 heap, page-cache residency) |
| **Roots** | Number of active roots, number still warming, coverage pushes sent — counts only |
| **Logs** | The last 1 000 warn / error lines (already free of identifiers, see privacy) |
| **Config** | Effective settings with secrets redacted, the NIP-11 document, membership counts per role and the member list (already public in the `13534` event) |

### Alerts

Shown on the Overview page and exported as metrics:

| Alert | Condition (default) |
| --- | --- |
| Not ready | `/readyz` false for more than 2 minutes |
| Memory pressure | RSS above 85 % of the limit, or any share above its limit |
| Ingest backlog | Queue depth above 50 % of its cap for more than 1 minute |
| Guardrail storm | More than 5 % of operations truncated in the last 5 minutes |
| Source down | A relay failing or a writer disconnected for more than 10 minutes |
| Slow queries | p95 above the configured deadline for more than 5 minutes |

## Data endpoints

All on the admin listener:

| Path | Returns |
| --- | --- |
| `GET /` | The pages (single-page app, bundled) |
| `GET /admin/api/telemetry` | A JSON snapshot of everything the pages show (schema `TrustGraph/schemas/telemetry.v1.json`) |
| `GET /admin/api/stream` | Server-Sent Events: a snapshot delta every 2 s, for live charts |
| `GET /admin/api/history?series=…&window=…` | Time series from the in-memory ring buffers |
| `GET /metrics` | Prometheus text format, metric names below |

- The JSON has the same field names on both servers. A field that does not
  apply to a server (for example relay sync on a Global Server) is `null`,
  never missing.
- History is kept in memory only: ring buffers of the last 24 hours at 10 s
  resolution for the charted series (a few MB). Long-term history belongs in
  Prometheus.
- `dtp-personal status` and `dtp-global status` print the same snapshot.

## Metric names

Shared metrics, identical names and labels on both servers:

| Metric | Labels |
| --- | --- |
| `dtp_up`, `dtp_ready` | — |
| `dtp_graph_version`, `dtp_epoch_lag_seconds` | — |
| `dtp_graph_nodes` | — |
| `dtp_graph_edges` | `kind` |
| `dtp_graph_bytes` | `tier` = `total` \| `resident` \| `pinned` |
| `dtp_ingest_events_total` | `kind`, `result` (`accepted`, `duplicate`, `invalid`, `blocked`, `rate_limited`, `deleted`) |
| `dtp_ingest_queue_depth`, `dtp_ingest_pending_oks` | — |
| `dtp_source_state` | `source` = relay URL or writer pubkey, `type` = `relay` \| `writer` |
| `dtp_want_open` | — |
| `dtp_operations_total` | `op`, `result` (`ok`, `busy`, `rate_limited`, `invalid`, `error`) |
| `dtp_operation_duration_seconds` (histogram) | `op`, `temperature` = `warm` \| `cold` |
| `dtp_operations_inflight` | — |
| `dtp_guardrail_hits_total` | `reason` |
| `dtp_background_completions_total` | — |
| `dtp_field_cache_hits_total`, `dtp_field_cache_misses_total`, `dtp_field_cache_bytes` | — |
| `dtp_connections` | `role`, `origin` |
| `dtp_memory_bytes` | `share` |
| `dtp_memory_limit_bytes`, `dtp_rss_bytes` | — |
| `dtp_roots` | `state` = `active` \| `warming` |
| `dtp_alert` | `name` |

Implementation-specific metrics are allowed only under the `dtp_impl_`
prefix (for example `dtp_impl_v8_heap_bytes` on the Personal Server,
`dtp_impl_segments` on the Global Server). The pages show them in an
"Implementation" section; they are not part of the shared contract.

## Privacy

Telemetry follows the same rules as the logs:

- Never shows subjects, query parameters, result contents, or the roots that
  clients query — counts and histograms only.
- Pubkeys shown: writers (operational identities), admins, and members
  (already public in the membership list). Readers are counted, never listed.
- No IP addresses; rate-limit statistics are aggregate.
- The pages load no external resources (no CDN, no fonts, no analytics) and
  run under a strict Content Security Policy.

## UI

One small static app, built once in the TrustGraph repo as
`@dtp/telemetry-ui` and embedded by both servers (served from the npm package
by the Personal Server; compiled into the Rust binary by the Global Server and
the Sync Server). Same pages, same code.

- Plain TypeScript or Preact, under 100 KB gzip, works offline.
- Live updates from `/admin/api/stream`; charts are canvas sparklines and
  histograms.
- Light and dark theme; keyboard accessible; numbers also available as text
  tables.

## Conformance

The session suite ([conformance.md](conformance.md#one-api-the-session-suite))
also fetches `/admin/api/telemetry` and `/metrics` from both servers and
checks them against the shared schema and metric list: same fields (with
`null` where not applicable), same metric names and labels.
