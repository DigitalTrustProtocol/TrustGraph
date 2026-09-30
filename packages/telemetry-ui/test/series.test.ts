import { describe, expect, it } from 'vitest'
import { parseHistory, SeriesStore, seriesValue } from '../src/app/series'
import { sampleSnapshot } from '../src/fixture'

describe('SeriesStore', () => {
  it('derives the charted values from a snapshot', () => {
    const snapshot = sampleSnapshot()
    expect(seriesValue('ops', snapshot)).toBeCloseTo(5.6)
    expect(seriesValue('ingest', snapshot)).toBeCloseTo(3.1)
    expect(seriesValue('rss', snapshot)).toBe(188_743_680)
    expect(seriesValue('edges', snapshot)).toBe(57_351)
  })

  it('keeps a bounded window and replaces same-time points', () => {
    const store = new SeriesStore(3)
    for (let t = 0; t < 5; t++) store.push(sampleSnapshot({ generatedAt: t }))
    store.push(sampleSnapshot({ generatedAt: 4, memory: { rssBytes: 1 } }))
    expect(store.get('rss').map((point) => point[0])).toEqual([2, 3, 4])
    expect(store.get('rss')[2][1]).toBe(1)
  })

  it('merges only history older than the live window', () => {
    const store = new SeriesStore()
    store.push(sampleSnapshot({ generatedAt: 100 }))
    store.mergeHistory('edges', [[80, 1], [90, 2], [100, 3], [110, 4]])
    expect(store.get('edges').map((point) => point[0])).toEqual([80, 90, 100])
  })

  it('parses history bodies defensively', () => {
    expect(parseHistory({ series: 'ops', points: [[1, 2], ['x', 3], [4]] }, 'ops')).toEqual([[1, 2]])
    expect(parseHistory({ series: 'rss', points: [] }, 'ops')).toBeNull()
    expect(parseHistory(null, 'ops')).toBeNull()
    expect(parseHistory({ series: 'ops' }, 'ops')).toBeNull()
  })
})
