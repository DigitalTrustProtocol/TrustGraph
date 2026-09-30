import { describe, expect, it } from 'vitest'
import {
  buildState,
  canonicalizeSets,
  defaultOps,
  gapTags,
  isProtocolCase,
  loadCorpus,
  matchPartial,
  runLookupPages,
  runModelCase,
  runQuery,
  type CorpusOp,
  type CorpusQuery,
  type ModelCase,
} from '@dtp/conformance'

const modelCases = loadCorpus()
  .map((e) => e.testCase)
  .filter((c): c is ModelCase => !isProtocolCase(c))

function outputs(testCase: ModelCase, ops: CorpusOp[]): unknown[] {
  const state = buildState(testCase, ops)
  return testCase.queries.map((q) => canonicalizeSets(q.type, runQuery(state, q)))
}

const plain = modelCases.filter((c) => gapTags(c).length === 0)

describe('matcher', () => {
  it('reports mismatches, missing items, and tolerates 1e-9', () => {
    expect(matchPartial({ a: 1, b: [1, 2] }, { a: 1 })).toEqual([])
    expect(matchPartial({ a: 1 }, { a: 2 })).toHaveLength(1)
    expect(matchPartial({ b: [1, 2] }, { b: [1] })).toHaveLength(1)
    expect(matchPartial({ x: 0.1 + 0.2 }, { x: 0.3 })).toEqual([])
    expect(matchPartial({ x: undefined }, { x: null })).toEqual([])
    expect(matchPartial({ x: 0 }, { x: null })).toHaveLength(1)
  })

  it('is not vacuous: flipping an expected `connected` fails the case', () => {
    let flipped = 0
    for (const testCase of plain) {
      const queries = testCase.queries.map((q): CorpusQuery => {
        const expectation = q.expect as Record<string, unknown> | undefined
        if (q.modes || q.type !== 'trust' || !expectation || typeof expectation.connected !== 'boolean') return q
        flipped += 1
        return { ...q, expect: { ...expectation, connected: !expectation.connected } }
      })
      const failures = runModelCase({ ...testCase, queries }).filter((o) => o.errors.length > 0)
      const changed = queries.filter((q, i) => q !== testCase.queries[i]).length
      expect(failures.length, testCase.id).toBe(changed)
    }
    expect(flipped).toBeGreaterThan(20)
  })
})

describe('properties (conformance.md § Properties)', () => {
  it('idempotence: applying every record twice changes nothing', () => {
    for (const testCase of plain) {
      const ops = defaultOps(testCase)
      const doubled = ops.flatMap((op) => (op.op === 'apply' ? [op, op] : [op]))
      expect(outputs(testCase, doubled), testCase.id).toEqual(outputs(testCase, ops))
    }
  })

  it('older discarded: an older record for an existing slot changes nothing, also after a Delete', () => {
    for (const testCase of plain) {
      const ops = defaultOps(testCase)
      // `remove` drops the slot itself, so there is no winner left to protect.
      if (ops.some((op) => op.op === 'remove')) continue
      const older: CorpusOp[] = ops.flatMap((op): CorpusOp[] => {
        if (op.op !== 'apply') return []
        const record = op.record
        const flipped = record.value === undefined ? 1 : record.kind === 32009 ? -record.value : 100 - record.value
        return [
          {
            op: 'apply',
            record: {
              ...record,
              addressKey: record.addressKey ?? `${record.kind}:${record.pubkey}:${record.subjectType}:${record.subject}:${record.context ?? ''}`,
              id: `${record.id}-older`,
              created_at: record.created_at - 1,
              value: flipped,
            },
          },
        ]
      })
      expect(outputs(testCase, [...ops, ...older]), testCase.id).toEqual(outputs(testCase, ops))
    }
  })

  it('order independence: reversed record order gives identical results (outside gap and bind setups)', () => {
    let checked = 0
    for (const testCase of plain) {
      if (testCase.ops || (testCase.ownEvidence ?? []).length > 0) continue
      const ops = defaultOps(testCase)
      const reversed = [...ops].reverse()
      expect(outputs(testCase, reversed), testCase.id).toEqual(outputs(testCase, ops))
      checked += 1
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('lookups ignore the observer: root, threshold, and binding mode change nothing', () => {
    for (const testCase of modelCases) {
      const state = buildState(testCase)
      for (const query of testCase.queries) {
        if (!query.type.startsWith('lookup') && query.type !== 'neighborhood') continue
        const base = runQuery(state, query)
        for (const extra of [{ rootPubkey: 'ab'.repeat(32) }, { followTrustThreshold: 1 }, { bindingMode: 'strict' }]) {
          expect(runQuery(state, query, { ...query.input, ...extra }), testCase.id).toEqual(base)
        }
      }
    }
  })

  it('pages add up: every page at limit 1 concatenates to the unpaged result with no duplicates', () => {
    for (const testCase of modelCases) {
      const state = buildState(testCase)
      for (const query of testCase.queries) {
        if (query.type !== 'lookup-incoming' && query.type !== 'lookup-outgoing') continue
        const direction = query.type === 'lookup-incoming' ? 'incoming' : 'outgoing'
        const unpaged = runQuery(state, query, { ...query.input, limit: 500 }) as { items: Array<{ eventId: string }> }
        const pages = runLookupPages(state, direction, query.input, 1)
        const ids = pages.flatMap((p) => (p.items as Array<{ eventId: string }>).map((i) => i.eventId))
        expect(ids, testCase.id).toEqual(unpaged.items.map((i) => i.eventId))
        expect(new Set(ids).size).toBe(ids.length)
      }
    }
  })

  it('counts = items: lookup.counts equals the per-value tally of the unpaged lookup', () => {
    let checked = 0
    for (const testCase of modelCases) {
      const state = buildState(testCase)
      for (const query of testCase.queries) {
        if (query.type !== 'lookup-counts') continue
        const { keys, direction, mergeKeys, ...filters } = query.input as {
          keys: string[]
          direction: string
          mergeKeys?: boolean
        }
        const counts = (runQuery(state, query) as { counts: Record<string, unknown> }).counts
        const type = direction === 'incoming' ? 'lookup-incoming' : 'lookup-outgoing'
        const groups: Array<[string, string[]]> = mergeKeys ? [['merged', keys]] : keys.map((k) => [k, [k]])
        for (const [label, groupKeys] of groups) {
          const page = runQuery(state, { type, input: {} } as CorpusQuery, {
            ...filters,
            keys: groupKeys,
            ...(mergeKeys ? { mergeKeys } : {}),
            limit: 500,
            withTotals: true,
          }) as { totals: unknown }
          expect(counts[label], `${testCase.id} ${label}`).toEqual(page.totals)
          checked += 1
        }
      }
    }
    expect(checked).toBeGreaterThan(3)
  })
})
