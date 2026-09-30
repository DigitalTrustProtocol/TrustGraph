import { describe, expect, it } from 'vitest'
import { matchFrame, requirementMet, runSession, type SessionCase } from '@dtp/conformance'

type Listener = (event: { data: unknown }) => void

/** Answers each sent frame with the frames `reply` returns. */
function fakeSocket(reply: (frame: unknown[]) => unknown[][]) {
  const sent: unknown[][] = []
  class FakeSocket {
    readonly listeners = new Map<string, Listener[]>()
    constructor() {
      setTimeout(() => this.emit('open'), 0)
    }
    addEventListener(type: string, listener: Listener) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
    }
    emit(type: string, event: { data: unknown } = { data: undefined }) {
      for (const listener of this.listeners.get(type) ?? []) listener(event)
    }
    send(data: string) {
      const frame = JSON.parse(data) as unknown[]
      sent.push(frame)
      setTimeout(() => {
        for (const answer of reply(frame)) this.emit('message', { data: JSON.stringify(answer) })
      }, 0)
    }
    close() {}
  }
  return { sent, WebSocket: FakeSocket }
}

describe('matchFrame', () => {
  it('matches $prefix / $type / $any', () => {
    expect(matchFrame(['OK', 'x', false, 'invalid: bad'], ['OK', 'x', false, { $prefix: 'invalid:' }])).toEqual([])
    expect(matchFrame(['OK', 'x', false, 'blocked: no'], ['OK', 'x', false, { $prefix: 'invalid:' }])).toHaveLength(1)
    expect(matchFrame({ n: 3, extra: true }, { n: { $type: 'number' } })).toEqual([])
    expect(matchFrame([1, 2], [{ $any: true }])).toHaveLength(1)
  })

  it('compares numbers by value within 1e-9, whatever their JSON text', () => {
    expect(matchFrame(JSON.parse('1.5e-6'), JSON.parse('0.0000015'))).toEqual([])
    expect(matchFrame((0.000001 + 0.000002) / 2, 0.0000015)).toEqual([])
    expect(matchFrame(0.000002, 0.0000015)).toHaveLength(1)
    expect(matchFrame('0.0000015', 0.0000015)).toHaveLength(1)
  })

  it('matches $unordered arrays as multisets of partial patterns', () => {
    const edges = [{ eventId: 'b', value: -1 }, { eventId: 'a', value: 1 }]
    expect(matchFrame(edges, { $unordered: [{ eventId: 'a' }, { eventId: 'b', value: -1 }] })).toEqual([])
    expect(matchFrame(edges, { $unordered: [{ eventId: 'a' }, { eventId: 'a' }] })).toHaveLength(1)
    expect(matchFrame(edges, { $unordered: [{ eventId: 'a' }] })).toHaveLength(1)
    // A loose pattern must not steal the only item a strict pattern fits.
    expect(matchFrame([...edges].reverse(), { $unordered: [{ value: { $type: 'number' } }, { eventId: 'a' }] })).toEqual([])
  })
})

describe('requirementMet', () => {
  const features = { capabilities: ['trust.query', 'graph.field'], gaps: ['G10'] }
  it('checks operations against capabilities and fixed:Gn against gaps', () => {
    expect(requirementMet('graph.field', features)).toBe(true)
    expect(requirementMet('rating.batch', features)).toBe(false)
    expect(requirementMet('fixed:G10', features)).toBe(false)
    expect(requirementMet('fixed:G4', features)).toBe(true)
    expect(requirementMet('fixed:G10', { capabilities: [] })).toBe(true)
  })
})

describe('runSession', () => {
  const gated: SessionCase = {
    id: 'gated',
    api: 'v1',
    config: {},
    steps: [
      {
        send: ['DTP', 'g', 'graph.field', {}],
        requires: ['graph.field'],
        expect: [['DTP-OK', 'g', { levels: { $type: 'array' } }]],
        otherwise: [['DTP-ERR', 'g', 'unsupported', { $type: 'string' }]],
      },
      { send: ['DTP', 'b', 'trust.query', {}], requires: ['fixed:G10'], expect: [['DTP-OK', 'b', {}]] },
      { send: ['DTP', 'q', 'trust.query', {}], expect: [['DTP-OK', 'q', { degree: 1 }]] },
    ],
  }

  it('asks info for features, asserts otherwise, and skips unmet steps', async () => {
    const { sent, WebSocket } = fakeSocket((frame) => {
      if (frame[2] === 'info') return [['DTP-OK', frame[1], { capabilities: ['trust.query'], gaps: ['G10'] }]]
      if (frame[2] === 'graph.field') return [['DTP-ERR', frame[1], 'unsupported', 'needs D3']]
      return [['DTP-PUSH', 'graph', { graphVersion: 2 }], ['DTP-OK', frame[1], { degree: 1 }]]
    })
    const outcomes = await runSession('ws://fake', gated, { WebSocket, timeoutMs: 500 })
    expect(outcomes).toEqual([
      { step: 0, errors: [] },
      { step: 1, skipped: true, errors: [] },
      { step: 2, errors: [] },
    ])
    expect(sent.map((frame) => frame[2])).toEqual(['info', 'graph.field', 'trust.query'])
  })

  it('uses given features without asking, and matches unordered steps with a push', async () => {
    const session: SessionCase = {
      ...gated,
      steps: [
        gated.steps[0]!,
        {
          send: ['EVENT', { id: 'e1' }],
          unordered: true,
          expect: [['OK', 'e1', true, ''], ['DTP-PUSH', 'graph', { graphVersion: { $type: 'number' } }]],
        },
      ],
    }
    const { sent, WebSocket } = fakeSocket((frame) =>
      frame[0] === 'EVENT'
        ? [['DTP-PUSH', 'graph', { graphVersion: 3 }], ['OK', 'e1', true, '']]
        : [['DTP-OK', frame[1], { levels: [] }]],
    )
    const outcomes = await runSession('ws://fake', session, {
      WebSocket,
      timeoutMs: 500,
      features: { capabilities: ['graph.field'] },
    })
    expect(outcomes.map((o) => o.errors)).toEqual([[], []])
    expect(sent.map((frame) => frame[0])).toEqual(['DTP', 'EVENT'])
  })
})
