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

### TG-4 Conformance corpus and runner (library step 4) ⏳ → see status below

- [ ] `corpus/manifest.json`, `corpus/protocol/*.json`, `corpus/model/*.json`
      in the format of [conformance.md](specs/conformance.md), `@name`
      placeholders expanded to `sha256(name)` hex.
- [ ] `@dtp/conformance` runner (Vitest) executing every case against the
      TS packages; canonical comparison; gap cases assert `expectCurrent`.
- [ ] Seed set ported from the extension tests: walk, threshold, path,
      rating, bind (current `bindIdentity` behaviour), lookups (paging,
      counts, `mergeKeys`), frontier, protocol validation, NIP-09 floors.
- [ ] Properties: idempotence, older-discarded, order independence (outside
      gap setups), lookups ignore the observer, pages add up, counts = items.

### TG-5 `@dtp/telemetry-ui` ⏳

- [ ] Static app (plain TS, no bundler, no CDN, < 100 KB gzip) with the
      pages of [telemetry.md](specs/telemetry.md), reading
      `/admin/api/telemetry`, `/admin/api/stream`, `/admin/api/history`.
- [x] Shared snapshot contract: `packages/telemetry-ui/src/schema.ts` and
      `schemas/telemetry.v1.json`; `SHARED_METRICS` list.

### TG-6 `@dtp/resolver-client` ⏳

- [ ] NIP-01 framing, NIP-42 via signer callback, pipelining, cancel,
      coalescing, reconnect with backoff, subscriptions.

### TG-7 `@dtp/relay-sync` (library phase 2) ⏳

- [ ] Port `relay/synchronizer.ts`, `filters.ts`, `live-supervisor.ts`
      behind their existing ports. Not started this session.

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

## Deviations from the specs

| Spec | Deviation | Where recorded |
| --- | --- | --- |
| library.md (trust-protocol contents) | `buildNip39ProofText` / `containsNip39Proof` not moved (X proof-post composer) | here, `kind-10011.ts` header |

## Blockers (need the owner's decision)

| ID | Blocks |
| --- | --- |
| D3 | Every gap fix in `@dtp/trust-graph`; in particular **G10** (walk budgets: time / node / record, `completeDepth`) and **G12** (level structure → `graph.field`). Without them the Personal Server cannot offer `graph.field` or in-walk guardrails, so the session suite cannot pass on both servers. Also G8 (binding inside the walk): servers have no binding at all today |
| D1 | Final home of the library (this repo vs upstream `DigitalTrustProtocol/Trust`) |
| D4 | G4 disconnected-result rule |
| D5 | Default binding mode per runtime |
| D6 | Name of the witness-only context (`identity:attest` proposed) |
