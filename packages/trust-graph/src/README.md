# `src/graph/trust` — locked

This directory is the vendored Trust heap graph
(DigitalTrustProtocol/Trust).

**Do not modify these files without explicit permission.** If Graph,
IndexResolver, or `pathStrategyJson` cannot do what Attention needs, **ask**
and state the missing capability. Do not write compensation code or a second
resolver outside this folder.

`IndexResolver` is the trust walk. Attention `query.ts` maps `Score[]` to
DTOs only. Do not add another `IResolveStrategy` (do not grow
`identity-index-resolver.ts`).

Wrappers that may attach chrome/identity caches on the Graph instance and
compose GraphManager payloads:

- `src/graph/graph.ts`
- `src/graph/adapter.ts`
- `src/graph/query.ts`
- `src/graph/ratings/` (rating overlay; not a hop resolver)

Product rule: [docs/architecture.md § Trust graph heap](../../../docs/architecture.md#trust-graph-heap-runtime-source-of-truth).

The heap is the runtime source of truth. Do not build a parallel event list,
identity map, or chrome catalog beside `Graph`.
