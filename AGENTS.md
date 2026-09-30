# Agent guide (TrustGraph)

Shared Web-of-Trust model for the Digital Trust Protocol: specs, TypeScript
packages, the conformance corpus, the resolver client, and the telemetry UI.
Read [README.md](README.md) and [PLAN.md](PLAN.md) first.

## Stack

- npm workspaces (`packages/*`), TypeScript strict, ESM, target ES2022.
- Build: `tsc` per package to `dist/` (JS + `.d.ts`), then
  `scripts/fix-esm-extensions.mjs` adds `.js` to relative specifiers (the
  vendored heap keeps extensionless imports byte-for-byte).
- Tests: Vitest from the root (`vitest.config.ts` aliases `@dtp/*` to package
  sources, so tests need no build). Lint: oxlint.

## Commands

| Command | Does |
| --- | --- |
| `npm install` | Install all workspaces |
| `npm run check` | lint + typecheck + test + build (must be green before every commit) |
| `npm test` | Vitest, all packages and the corpus runner |
| `npm run build` | Build every package in workspace order |
| `npm run vendor:check` | Compare `packages/trust-graph/src` with `AttentionX` HEAD (needs the sibling repo) |

## Rules

- **`@dtp/trust-graph` is locked.** Its sources are a verbatim copy of
  `AttentionX/src/graph/trust`; only the five external imports and the
  `EventRecord` type import were redirected (see `packages/trust-graph/VENDORED.json`,
  enforced by `packages/trust-graph/test/vendored.test.ts`). Any change needs
  explicit owner approval (decision D3) and corpus cases. Gap fixes G1–G12
  are not implemented here until approved.
- There is one trust walk (`IndexResolver`). Wrappers in `@dtp/trust-query`
  map results; they never walk more than one degree themselves.
- The heap is runtime truth: no event lists or identity maps beside `Graph`.
- Results are subjective evidence for one root, never a global score.
- `corpus/` and `specs/` paths are read by the Global Server and Website
  agents: keep file names and the case format stable; add, don't rename.
- Nothing not built may pretend to work: unimplemented operations return an
  explicit `unsupported` error and are listed in PLAN.md.
- Deviations from a spec are fixed in the spec in the same commit and recorded
  in PLAN.md.

## Specs

[wot-model](specs/wot-model.md) ·
[identity-binding](specs/identity-binding.md) ·
[conformance](specs/conformance.md) ·
[library](specs/library.md) ·
[resolver-api](specs/resolver-api.md) ·
[telemetry](specs/telemetry.md)
