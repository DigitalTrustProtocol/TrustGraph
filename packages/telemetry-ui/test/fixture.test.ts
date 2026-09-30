import { describe, expect, it } from 'vitest'
import { sampleSnapshot, TELEMETRY_SCHEMA, TELEMETRY_SECTIONS } from '../src/index'

describe('sampleSnapshot', () => {
  it('has every section listed in TELEMETRY_SECTIONS', () => {
    const snapshot = sampleSnapshot()
    for (const key of TELEMETRY_SECTIONS) expect(snapshot).toHaveProperty(key)
    expect(snapshot.schema).toBe(TELEMETRY_SCHEMA)
  })

  it('is the personal-server flavour', () => {
    const snapshot = sampleSnapshot()
    expect(snapshot.server.kind).toBe('personal')
    expect(Array.isArray(snapshot.sources.relays)).toBe(true)
    expect(snapshot.queries.fieldCache).toBeNull()
    expect(snapshot.config.membership).toBeNull()
  })

  it('merges overrides deeply; null and arrays replace', () => {
    const snapshot = sampleSnapshot({
      server: { kind: 'global' },
      sources: { relays: null },
      queries: { fieldCache: { hits: 1, misses: 1, bytes: 10 } },
      logs: [],
    })
    expect(snapshot.server.kind).toBe('global')
    expect(snapshot.server.version).toBe('0.1.0')
    expect(snapshot.sources.relays).toBeNull()
    expect(snapshot.sources.wantsOpen).toBe(2)
    expect(snapshot.queries.fieldCache).toEqual({ hits: 1, misses: 1, bytes: 10 })
    expect(snapshot.logs).toEqual([])
  })

  it('returns a fresh object each call', () => {
    const a = sampleSnapshot()
    a.graph.nodes = 1
    expect(sampleSnapshot().graph.nodes).not.toBe(1)
  })
})
