# TrustGraph library — packages and extraction

Status: **draft** · 2026-09-30

Goal: one TypeScript source for the WoT model, used unchanged by the Attention
extension and the Personal Server, and the executable reference for the Rust
Global Server.

## Why a library

Today the model lives in `AttentionX/src/graph/trust` (locked, vendored from
`DigitalTrustProtocol/Trust`). The Personal Server could copy the folder, but
two copies drift. The folder has only five imports from outside itself, so it
can move into a package with no behaviour change.

| External import in `src/graph/trust` | Moves to |
| --- | --- |
| `TRUST_STATEMENT_KIND` (`lib/nostr/kind-32009`) | `@dtp/trust-graph/constants` |
| `RATING_STATEMENT_KIND` (`lib/nostr/kind-32014`) | `@dtp/trust-graph/constants` |
| `meetsFollowTrustGreen` (`shared/trust-score`) | `@dtp/trust-graph/threshold` |
| `FOLLOW_TRUST_GREEN_DEFAULT` (`shared/wot-follow-trust-threshold`) | `@dtp/trust-graph/constants` |
| `WOT_MAX_DEGREE_HARD_CAP` (`shared/wot-max-degree`) | `@dtp/trust-graph/constants` |
| `EventRecord` type (`storage/types`) | `TrustEdgeRecord` interface; the extension's `EventRecord` satisfies it structurally |

## Packages

Working npm scope `@dtp/*` (confirm availability — decision D2).

| Package | Contents (from AttentionX) | Depends on | Change policy |
| --- | --- | --- | --- |
| `@dtp/trust-graph` | `src/graph/trust/*` verbatim: `Graph`, `Node`, `Edge`, `IndexResolver`, `Score`, `pathStrategyJson`, `IResolveStrategy`, `types`; plus the constants above. Diverged from the origin under decision D3 (`DIVERGENCE.json`): walk budgets (gap G10, [wot-model.md §6.2](wot-model.md#62-guardrails)), the per-walk identity-binding decision, lenient and strict (gaps G6 / G8, [identity-binding.md](identity-binding.md)), the level structure for `graph.field` (gap G12), and gaps G1 / G2 / G3 / G4 / G7, all inside the walk, not in a wrapper | nothing | **Locked** — owner approval + corpus cases |
| `@dtp/trust-protocol` | `lib/nostr/kind-32009.ts`, `kind-32014.ts`, `kind-10011.ts`, `nip32009.ts`; scope helpers from `shared/x-identity.ts`; `shared/trust-content.ts`. Normalization adds `hintPubkey` to records and extracts `(pubkey, twitterId)` claims from `10011` | `nostr-tools` (or `@noble/*`) | Normal review; protocol corpus |
| `@dtp/trust-query` | `graph/types.ts`, `bounds.ts`, `query.ts`, `score-read.ts`, `path-view.ts`, `adapter.ts`, `graph.ts` (neighborhood), `ratings/ArtifactRatingResolver.ts`; lookups ([wot-model.md §8.1](wot-model.md#81-lookups)) grown from `graph/incoming.ts` and `graph/outgoing.ts` plus the `GraphManager` record helpers (`incomingRecords`, `outgoingUserRecords`) — filters, `selected` / `raw`, `mergeKeys`, order, keyset pages, counts; `shared/trust-context.ts`, `trust-score.ts`, `rating-score.ts`, `wot-follow-trust-threshold.ts`, `wot-max-degree.ts`; `subjectNodeId` / `parseNodeId` from `shared/graph-deeplink.ts`; sync frontier from `GraphManager.positiveAuthorFrontier` | trust-graph, trust-protocol | Normal review; model corpus |
| `@dtp/relay-sync` (phase 2) | `relay/synchronizer.ts`, `filters.ts`, `live-supervisor.ts`; storage behind the existing ports (`RelayQueryClient`, `SyncCursorRepository`, `RelayEventRepository`, `GraphFrontierReader`) | trust-protocol | Normal review |
| `@dtp/resolver-client` | WebSocket client for the [resolver protocol](resolver-api.md): NIP-01 framing, NIP-42 with a signer callback (keys stay in the caller), session defaults, pipelining, reconnect, subscriptions; also used by the Website | trust-query types | Normal review |
| `@dtp/telemetry-ui` | The admin telemetry pages ([telemetry.md](telemetry.md)), built once as static assets and embedded by the Personal Server, the Global Server, and the Sync Server | none | Normal review |
| `@dtp/conformance` | Corpus runner, fixture helpers, session suite (including the telemetry schema check) | all | — |

Not extracted: vault, signing, X observation (content script, page-world),
`xIdentities` / `xPosts` and their rules (`src/identity`), outbox, panel
session. Those stay in the extension; neither server holds X data.

## Repository

Home: `TrustProtocol/TrustGraph` → GitHub `DigitalTrustProtocol/TrustGraph`,
or fold into the upstream `DigitalTrustProtocol/Trust` repo the heap came from
(decision D1).

```text
TrustGraph/
  packages/
    trust-graph/  trust-protocol/  trust-query/  relay-sync/
    resolver-client/  conformance/
  corpus/                   see conformance.md
  schemas/                  JSON Schema for DTOs, generated from trust-query types
  asyncapi/resolver.v1.yaml WebSocket protocol
  specs/                    this folder
```

Build: `tsc` to ESM + `.d.ts`, target ES2022 (Chrome service worker,
Node.js 24, evergreen browsers), `sideEffects: false`, no bundler. Tests with
Vitest. Lint with oxlint (same as the extension).

The generated JSON Schemas are the bridge to Rust (serde structs are checked
against them in tests) and to the Website (API reference rendered from the
OpenAPI file).

## Extraction plan

`src/graph/trust` is locked. Step 1 needs explicit permission from the owner.

1. **Move, don't change.** Copy the files verbatim into
   `packages/trust-graph`. Change only the five external imports. Keep the
   "Vendored from DigitalTrustProtocol/Trust" headers.
2. **Shim.** In the extension, `src/graph/trust/index.ts` becomes
   `export * from '@dtp/trust-graph'`; delete the other files. Moved modules
   outside `trust/` get the same one-line re-export shims so no import site
   changes in this step.
3. **Prove.** `npm run check` in the extension passes with **zero** test
   edits.
4. **Seed the corpus** from the extension tests (see
   [conformance.md](conformance.md)).
5. **Fix gaps** in `@dtp/trust-graph` (done under D3: G2, G3, G1, G4, G6,
   G8, G10, G12, G7; G5 and G9 open), each with corpus cases.
6. **Remove shims** by updating import sites, one module family per change.

Wiring during development:
`"@dtp/trust-graph": "file:../TrustGraph/packages/trust-graph"` in each
consumer. Releases use published versions. Vite bundles the package into the
extension's classic service worker. Content scripts must keep not importing it.

## Rules carried over from the extension

- `@dtp/trust-graph` is locked, exactly as `src/graph/trust` is today.
- `IndexResolver` is the only trust walk in TypeScript. Consumers wrap it;
  they do not write another resolver. Rust is the only other implementation,
  and the corpus gates it.
- The heap is runtime truth. Wrappers map `Score[]` to DTOs and attach caches
  on the `Graph` instance; they never keep a second event list.
- Trust results are subjective evidence for one root, never an objective score.

## Versioning

Semver per package. A change to `@dtp/trust-graph` or `@dtp/trust-query`
that alters a corpus expectation is a major version, paired with a
`dtp-wot/N` bump.

A root-field acceleration (see
[GlobalServer resolver-engine.md](../../GlobalServer/specs/resolver-engine.md))
could later be added inside `@dtp/trust-graph` for the Personal Server. It is
not needed for v1 and would need the same approval as any other change there.
