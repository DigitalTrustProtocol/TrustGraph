# TrustGraph — implementation plan

Status: living document · started 2026-09-30. Source of truth: [README.md](README.md)
and [specs/](specs/). This plan maps the specs to increments, records what each
session delivered, the decisions taken, and what is blocked.

Legend: ✅ done this session · ⏳ remaining · ⛔ blocked on a decision.

## Increments

Mapped from [library.md § Extraction plan](specs/library.md#extraction-plan)
(steps 1–6) and the package table. Each increment lands as one commit with
`npm run check` green.

### TG-0 Repository and infrastructure ✅

- [x] `git init -b main`; first commit = the imported specs.
- [x] npm workspaces, `tsconfig.base.json` (strict, ESM, ES2022), oxlint
      (`--deny-warnings`), Vitest from the root against package sources,
      `tsconfig.test.json` (tests are typechecked too), CI workflow
      (lint, typecheck, test, build), LICENSE (MIT, holder from AttentionX),
      `.editorconfig`, `AGENTS.md`.
- [x] `scripts/fix-esm-extensions.mjs`: post-`tsc` step that adds `.js` to
      relative specifiers, so the vendored heap can stay byte-identical
      (it uses extensionless imports) while `dist/` is valid Node ESM.

Acceptance: `npm run check` green on an empty package set.

### TG-1 Extract `@dtp/trust-graph` (library step 1 — "move, don't change") ✅

- [x] Copy `AttentionX/src/graph/trust/*` from AttentionX **git HEAD**
      verbatim (`scripts/vendor-trust-graph.mjs`).
- [x] Change only the five external imports (→ `./constants`,
      `./threshold`) and the `EventRecord` type import
      (→ `import type { TrustEdgeRecord as EventRecord } from './record'`, so
      the body of `types.ts` is untouched). "Vendored from
      DigitalTrustProtocol/Trust" headers kept.
- [x] `src/record.ts` `TrustEdgeRecord` (the extension's `EventRecord`
      satisfies it structurally; `scopeRank` / `hintPubkey` are additive and
      unread by the heap), `src/constants.ts`, `src/threshold.ts`
      (`meetsFollowTrustGreen` + its two helpers, unchanged), `src/main.ts`
      package entry (the vendored `index.ts` barrel stays byte-identical).
- [x] `VENDORED.json` records the AttentionX commit, the ten rewrites, and
      the SHA-256 of every vendored file; `test/vendored.test.ts` fails on
      any edit. `npm run vendor:check` re-derives the files from AttentionX.
- [x] No behaviour change, no gap fix (G1–G12 untouched), no second walk.

Acceptance: vendored bytes match; the ported extension tests pass (TG-3).

### TG-2 `@dtp/trust-protocol` ✅

- [x] Ported from AttentionX HEAD with only import rewrites:
      `kind-32009.ts`, `kind-32014.ts`, `kind-10011.ts`, `nip32009.ts`,
      `shared/x-identity.ts` (scope profile x.com helpers, Twitter id
      helpers), `shared/trust-content.ts`. Transitive deps traced: only
      `nostr-tools`.
- [x] Not ported: `buildNip39ProofText` / `containsNip39Proof` (they need
      AttentionX `shared/proof-composer`, X proof-post composition; servers
      never compose posts). Their one test case is dropped.
- [x] New: `scope-profile.ts` (`scopeVerdict`: eligibility + `scopeRank`),
      `hint.ts` (`hintPubkey`: first bare npub hint on `user:id` subjects
      whose scope set contains `x.com`), `claims.ts`
      (`identityClaimFromEvent` → `(pubkey, twitterId)`), `kind-5.ts`
      (NIP-09 validation: `e` targets, own-author `a` targets for held
      kinds), `ingest.ts` (`classifyEvent`: full validation → eligibility →
      normalized record with model columns, or a rejection with its NIP-01
      `OK` prefix).
- [x] Tests: ported kind-32009 / 32014 / 10011 / nip32009 / x-identity /
      trust-content suites; new `ingest.test.ts`.

### TG-3 `@dtp/trust-query` ✅

- [x] Ported with import rewrites only: `types.ts`, `bounds.ts`,
      `query.ts`, `score-read.ts`, `path-view.ts`, `adapter.ts`,
      `graph.ts` (neighborhood), `ratings/ArtifactRatingResolver.ts`,
      `incoming.ts`, `outgoing.ts`, `heap-test-harness.ts` (→ `testing.ts`,
      exported as `@dtp/trust-query/testing`), `shared/{trust-context,
      trust-score, rating-score, wot-follow-trust-threshold, wot-max-degree}`,
      and `subjectNodeId` / `parseNodeId` from `shared/graph-deeplink`.
      `trust-score.ts` re-exports the threshold helpers that moved into
      `@dtp/trust-graph` (one copy).
- [x] **Proof of a faithful copy:** the extension's `graph.test`,
      `index-resolver.test`, `path-resolve.test`,
      `follow-trust-threshold.test`, `bind-identity.test`, `ratings.test`,
      `incoming.test`, `outgoing.test` and the shared helper suites run
      against the packages with import rewrites only and **zero logic
      edits** (`packages/trust-query/test/heap/`). They live in trust-query
      because they drive the heap through the harness (`query.ts`), which
      trust-graph cannot depend on.
- [x] New `lookups.ts` (wot-model §8.1): `lookupPage` (incoming /
      outgoing), `lookupCounts`; filters (`kinds`, `context` +
      `contextMatch` chain / exact / any, `values`, `subjectTypes`, `labels`,
      activity, `since` / `until`), `selected` / `raw`, `mergeKeys` (the
      extension's `omitSameValueUserIdDuplicate` rule), `order` recent /
      author, keyset cursors bound to the filter, `withTotals`, the
      `maxLookupKeys` / `maxLookupPage` / `maxLookupRecords` guardrails.
- [x] New `frontier.ts`: `positiveAuthorFrontier` / `positiveChildren`
      ported from `GraphManager`, plus `depth` and `via` per author.
- [x] New `wire.ts`: P3 statement order, `statementLimit` and
      `maxPathNodes` result guardrails, `graph.neighborhood` center forms
      (heap index, wire id, `keys`), wire subject parsing.

### TG-4 Conformance corpus and runner (library step 4) ✅

- [x] `corpus/manifest.json`, `corpus/model/*.json` (12 files, 60+ cases,
      130+ queries), `corpus/protocol/*.json` (35 generated cases), format
      documented in [corpus/README.md](corpus/README.md); `@name`
      placeholders expand to `sha256(name)` hex.
- [x] `@dtp/conformance`: loader, TS model runner (heap + `@dtp/trust-query`),
      protocol runner (`classifyEvent`), canonical comparison (P3 order, set
      sorting, `1e-9`), partial-expectation matcher, corpus lint (gap tags
      ⇔ `expectModel` / `expectCurrent`, both binding modes on `bind`
      cases), telemetry schema validator and Prometheus metric checker for
      the session suite.
- [x] Seed set from the extension tests: walk, threshold, band, context,
      path, rating, bind (identity-binding.md §5 situations 1–13 in both
      modes; today's `bindIdentity` behaviour as `expectCurrent`), lookups
      (selected / raw, `mergeKeys`, contextMatch, values, time range, author
      order, paging, totals, counts, keys not resolved through binds),
      neighborhood, frontier, slot winners and Deletes, NIP-09 floors,
      protocol validation (32009 / 32014 / 10011 / 5).
- [x] Gap cases with `expectModel` / `expectCurrent`: G1, G2, G3, G4 (+G7),
      G5, G8 (bind situations), G10 (node budget).
- [x] Properties over every case: idempotence, older-discarded, order
      independence (outside gap and own-evidence setups), lookups ignore
      the observer, pages add up, counts = items, and a non-vacuity check.
- [ ] Differential fuzzing generators (`corpus/generators/`) — later.
- [x] Session suite v1: `corpus/sessions/basic-open.json` (29 steps: ingest
      prefixes, NIP-09, limited REQ, resolver / lookup / frontier / claims
      ops, error codes) and `runSession()`; the Personal Server runs it on
      every `npm test`.
- [x] Integration pass after the first Global Server run (105/106): the
      G4 case `context-neutral-occupies-its-bucket` is tagged `gap:G4`
      (`expectModel` / `expectCurrent`) with a model-correct companion;
      gap-case convention ("gap fixed" for model runners) documented; lookup
      post-selection filter cases; neighborhood one-arrow-per-author case;
      G10 record-budget case.
- [x] Sessions `ops-open.json` (27 steps: info, rating.batch,
      lookup.outgoing / batch, neighborhood with rating arrows and
      `valueFilter`, subscribe + push, NIP-09 `a` deletion, REQ authors +
      kinds, scores below 0.001) and `walk-budgets.json` (5 steps). Runner:
      numeric compare within `1e-9`, `$unordered`, `unordered` steps,
      stray pushes dropped, capability gating (`requires` / `otherwise`
      from `dtp.capabilities` / `dtp.gaps`).
- [ ] Auth flows under each access setting (`members` reads / writes, NIP-42)
      as sessions, and the nightly run against both servers side by side.

### TG-5 `@dtp/telemetry-ui` ✅

- [x] Static app (plain TS, no bundler, no CDN, strict CSP, 16 KB gzip)
      with every page of [telemetry.md](specs/telemetry.md): Overview,
      Graph, Ingest, Sources, Queries, Connections, Memory, Roots, Logs,
      Config; hash routing, light / dark theme, keyboard navigation, text
      tables, canvas sparklines; `null` sections render an explicit empty
      state.
- [x] Reads `/admin/api/telemetry`, `/admin/api/stream` (`event:
      snapshot`), `/admin/api/history`.
- [x] Shared contract: `src/schema.ts` + `schemas/telemetry.v1.json`,
      `SHARED_METRICS`, `sampleSnapshot()`; `@dtp/telemetry-ui/assets`
      exports the built directory for servers.

### TG-6 `@dtp/resolver-client` ✅

- [x] NIP-01 framing, pipelined `DTP` requests with coalescing of identical
      in-flight calls, timeouts and aborts with `DTP-CANCEL`, NIP-42 via a
      signer callback with one retry, `EVENT` / `OK`, limited `REQ`, push
      subscriptions, backoff reconnect (0.5 s → 30 s, jitter) restoring
      session defaults and topics, `instanceChanged`, idle close.
- [x] Interop proven against the Personal Server over a real socket
      (PersonalServer `test/resolver-client.test.ts`).

### TG-7 `@dtp/relay-sync` (library phase 2) ✅

- [x] `synchronizer`, `filters`, `live-supervisor`, `retry`, `types`, `graph`
      ported from AttentionX HEAD with import rewrites only; the extension's
      relay tests pass unchanged. Hosts implement the ports
      (`RelayQueryClient`, `RelaySubscribeClient`, `SyncCursorRepository`,
      `RelayEventRepository`, `GraphFrontierReader`); the Personal Server
      does (P2).

### TG-8 Extension shim (library steps 2–3) ⛔ D3 + AttentionX owner

- [ ] In AttentionX: `src/graph/trust/index.ts` → `export * from '@dtp/trust-graph'`,
      re-export shims, `npm run check` with zero test edits. Not done here:
      AttentionX is read-only for this work and the lock is not lifted.

### TG-9 Gap fixes (library step 5) ⛔ D3

In recommended order: G2 + G3, G10 (walk budgets), G9, G8 + G6 (binding
inside the walk, unbind), G1, G4 decision, G12 (level structure for
`graph.field`). Each needs owner approval and corpus cases. Until then the
corpus tags affected cases `gap:Gn` with `expectCurrent`.

### TG-10 Schemas and AsyncAPI ⏳

- [ ] JSON Schemas generated from `@dtp/trust-query` types, and
      `asyncapi/resolver.v1.yaml`. Only `schemas/telemetry.v1.json` exists
      (hand-written, mirrored by `schema.ts`).

## Decisions taken

| ID | Decision | Rationale |
| --- | --- | --- |
| D2 (working) | npm scope `@dtp/*`, all packages `0.1.0`, not published | Working name from the spec; no registry decision needed to build |
| TG-D1 | Copy from AttentionX **git HEAD**, not the working tree | Reproducible bytes (LF), recorded commit in `VENDORED.json` |
| TG-D2 | Keep extensionless imports; fix them in `dist/` after `tsc` | The locked files must stay byte-identical; `.js` suffixes would be an edit |
| TG-D3 | `EventRecord` import rewritten as an alias (`TrustEdgeRecord as EventRecord`) | Keeps the body of `types.ts` untouched; only the import line changes |
| TG-D4 | Package entry `main.ts` instead of editing the vendored `index.ts` | Exposes `constants` / `threshold` / `TrustEdgeRecord` without touching the barrel |
| TG-D5 | Ported heap tests live in `@dtp/trust-query/test/heap` | They drive the heap through the harness (`query.ts`); trust-graph must not depend on trust-query |
| TG-D6 | Lookup `selected` = one record per (author, subject, kind); first bucket of the chain, then P2 (`scopeRank` desc, `created_at` desc, `id` asc); `contextMatch: any` picks by P2 across all buckets; `values` / `labels` / `subjectTypes` / `since` / `until` apply **after** selection | §8.1 leaves `any` and filter order open; post-selection filtering keeps counts consistent with the selected statement |
| TG-D7 | `maxLookupRecords`: stop scanning, return the page from what was scanned with `truncated` + `edgeBudget`, omit totals | Spec rule; at Personal Server sizes the budget does not trigger |
| TG-D8 | Resolver statement lists are sorted in P3 order before `statementLimit` cuts them (servers only, `wire.ts`); `query.ts` keeps walk order | Deterministic cuts across TS and Rust; the extension path is unchanged |
| TG-D9 | NIP-09 slot floors live in `@dtp/trust-query` (`SlotFloors`, `applyWithFloors`, `deleteSlotAt`, `deleteWinner`) | Needed by servers and the corpus runner; outside the locked heap; one number per deleted slot, not an event list |
| TG-D10 | `graph.neighborhood` is built at the server cap, then cut in `eventId` order | A truncated neighborhood must not depend on heap insertion order (order-independence property) |
| TG-D11 | Corpus: one file may hold `{ cases: [...] }`; default `addressKey` `<kind>:<pubkey>:<subjectType>:<subject>:<context>`; lookups compare `items` in order, everything set-valued sorted | Readable grouped files; Rust gets a precise, documented format (corpus/README.md) |
| TG-D12 | Protocol cases are generated from fixed keys with expectations written by hand and `d` computed independently of the implementation | Signed events cannot be hand-written; independence keeps them a real check |
| TG-D13 | Telemetry snapshot contract defined in `telemetry-ui/src/schema.ts` + `schemas/telemetry.v1.json` | telemetry.md names the schema file but not its fields; both servers read it |

## Deviations from the specs

| Spec | Deviation | Where recorded |
| --- | --- | --- |
| library.md (trust-protocol contents) | `buildNip39ProofText` / `containsNip39Proof` not moved (X proof-post composer) | here, `kind-10011.ts` header |
| library.md (step 2–3) | The extension shim is not done (AttentionX is read-only here; D3) | TG-8 |
| resolver-api.md | Interim `dtp.unsupported` / `dtp.gaps`, `binding-unsupported` coverage reason, default score context per query type, several clarifications | resolver-api.md (commit "Specs: pin protocol details …") |
| telemetry.md | v1 SSE sends full snapshots | telemetry.md |

## What this session delivered

TG-0 … TG-7 above, in commits after the imported specs. The integration pass
after the first Global Server run added the G4 tag and companion, new
lookup / neighborhood / budget cases, two sessions, the runner features
above, and spec wording for budgets (§6.2), disconnected results and
`witnessDegree` (§6.1, identity-binding §8), neighborhood, `supported_nips`,
error codes, and number formatting (resolver-api.md). `npm run check`
(lint `--deny-warnings`, typecheck of every package and of all tests, Vitest,
build) is green: 35 test files, 462 tests (198 ported extension tests for the
heap / query / protocol layers and 26 for relay sync, all unchanged in logic;
110 corpus cases; property checks; new-module tests; 48 telemetry-UI and 46
resolver-client tests). Remaining: TG-8 (⛔), TG-9 (⛔ D3), TG-10, corpus
generators, and more sessions.

## Blockers (need the owner's decision)

| ID | Blocks |
| --- | --- |
| D3 | Every gap fix in `@dtp/trust-graph`; in particular **G10** (walk budgets: time / node / record, `completeDepth`) and **G12** (level structure → `graph.field`). Without them the Personal Server cannot offer `graph.field` or in-walk guardrails, so the session suite cannot pass on both servers. Also G8 (binding inside the walk): servers have no binding at all today |
| D1 | Final home of the library (this repo vs upstream `DigitalTrustProtocol/Trust`) |
| D4 | G4 disconnected-result rule. Options in wot-model.md §9; v1 uses option A (no statements) |
| D5 | Default binding mode per runtime. Options in wot-model.md §9; v1 uses `lenient` |
| D6 | Name of the witness-only context. Options in wot-model.md §9; `identity:attest` written, unused |

## Protocol error codes: Personal Server vs Global Server

Read-only comparison against resolver-api.md § Error codes (2026-09-30):
PersonalServer HEAD, GlobalServer HEAD `6c9257d` plus its uncommitted
working tree (in progress when read). Neither repo was edited; these are for
their owners.

| # | Behaviour | Personal Server | Global Server | Spec |
| --- | --- | --- | --- | --- |
| E1 | `reqId` already in flight | `DTP-ERR invalid` | HEAD: not checked (the second request replaces the first's cancel flag). Working tree: `DTP-ERR invalid` | `invalid` |
| E2 | `DTP-CANCEL` | `DTP-ERR cancelled` when the operation next yields | `DTP-ERR cancelled` immediately; the late result is dropped | Either, at most once, never with `DTP-OK` |
| E3 | `graph.field` | `DTP-ERR unsupported` (listed in `dtp.unsupported`, gap G12) | Implemented | Interim `unsupported` allowed |
| E4 | `hopContext` other than `identity` | `DTP-ERR unsupported` | Accepted | Interim `unsupported` allowed |
| E5 | `rate-limited` | Only as an `OK` prefix (heap edge limit); no `DTP-ERR rate-limited` | Only at HTTP upgrade (too many connections); no `DTP-ERR rate-limited` | `DTP-ERR` when `rateLimit` is exceeded; neither server implements `rateLimit` yet |
| E6 | Banned pubkey | `EVENT`: `OK false blocked: pubkey is banned` (even with open writes); `AUTH`: `restricted:` | No ban list (NIP-86 `banpubkey` not implemented); non-members get `restricted:` like PS | `restricted` (PS `EVENT` differs) |
| E7 | Kind `5` without a held target | `OK false blocked: no held event matches` | HEAD: `blocked:` only when it names no held kind; otherwise accepted. Working tree: `blocked: deletion matches no held event of its author` | `blocked:` when no held event or own `a` slot matches |
| E8 | Storage failure on `EVENT` | `OK false error:` | `OK false error:` (metrics count it as `invalid`) | `error` |
| E9 | NIP-86 | Implemented; `supported_nips` includes 86 | Returns `unsupported:`; `supported_nips` omits 86 | 86 only where implemented: both correct |
| E10 | `not-found` | In the code type, never emitted | Never emitted | Reserved |
