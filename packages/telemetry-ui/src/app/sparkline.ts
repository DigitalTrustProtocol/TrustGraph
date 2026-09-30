import { h } from './dom'
import { NA } from './format'
import type { Point } from './series'

const pending = new WeakMap<HTMLCanvasElement, readonly Point[]>()

const WIDTH = 240
const HEIGHT = 48

/**
 * Sparkline figure: a canvas (decorative) plus the current / min / max values
 * as text, so the chart is never the only way to read the number.
 */
export function sparkline(label: string, points: readonly Point[], format: (value: number) => string): HTMLElement {
  const values = points.map((point) => point[1])
  const current = values.length > 0 ? format(values[values.length - 1]) : NA
  const min = values.length > 0 ? format(Math.min(...values)) : NA
  const max = values.length > 0 ? format(Math.max(...values)) : NA
  const canvas = h('canvas', { width: String(WIDTH), height: String(HEIGHT), 'aria-hidden': 'true' })
  pending.set(canvas, points)
  return h(
    'figure',
    { class: 'spark' },
    h('figcaption', null, label),
    canvas,
    h(
      'dl',
      null,
      h('dt', null, 'Now'),
      h('dd', null, current),
      h('dt', null, 'Min'),
      h('dd', null, min),
      h('dt', null, 'Max'),
      h('dd', null, max),
      h('dt', null, 'Points'),
      h('dd', null, String(points.length)),
    ),
  )
}

/** Paint every sparkline canvas under `root` (call after it is attached). */
export function drawSparklines(root: ParentNode): void {
  for (const canvas of Array.from(root.querySelectorAll('canvas'))) {
    const points = pending.get(canvas)
    if (points) drawSparkline(canvas, points)
  }
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    const context = canvas.getContext('2d')
    return context && typeof context.beginPath === 'function' ? context : null
  } catch {
    return null
  }
}

function drawSparkline(canvas: HTMLCanvasElement, points: readonly Point[]): void {
  const context = context2d(canvas)
  if (!context) return
  const ratio = globalThis.devicePixelRatio || 1
  canvas.width = WIDTH * ratio
  canvas.height = HEIGHT * ratio
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, WIDTH, HEIGHT)
  if (points.length < 2) return

  const t0 = points[0][0]
  const t1 = points[points.length - 1][0]
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const [, value] of points) {
    if (value < lo) lo = value
    if (value > hi) hi = value
  }
  if (hi === lo) {
    hi += 1
    lo -= lo === 0 ? 0 : 1
  }
  const pad = 3
  const x = (t: number) => (t1 === t0 ? WIDTH : ((t - t0) / (t1 - t0)) * WIDTH)
  const y = (value: number) => HEIGHT - pad - ((value - lo) / (hi - lo)) * (HEIGHT - pad * 2)

  const color = getComputedStyle(canvas).color || '#3b82f6'
  context.strokeStyle = color
  context.lineWidth = 1.5
  context.lineJoin = 'round'
  context.beginPath()
  points.forEach(([t, value], index) => {
    if (index === 0) context.moveTo(x(t), y(value))
    else context.lineTo(x(t), y(value))
  })
  context.stroke()
}
