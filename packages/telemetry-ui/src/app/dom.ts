/**
 * DOM builders. Text goes through `textContent` only, so snapshot strings are
 * never parsed as HTML (XSS- and CSP-safe).
 */

import { formatBytes, formatNumber } from './format'

export type Child = Node | string | number | null | undefined | false | Child[]
export type Attrs = Record<string, string | undefined>

export const NOT_USED = 'Not used by this server'

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value !== undefined) element.setAttribute(name, value)
    }
  }
  append(element, children)
  return element
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    if (Array.isArray(child)) append(parent, child)
    else parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)))
  }
}

export function section(title: string, ...children: Child[]): HTMLElement {
  return h('section', { class: 'card' }, h('h2', null, title), ...children)
}

export function subsection(title: string, ...children: Child[]): HTMLElement {
  return h('div', { class: 'sub' }, h('h3', null, title), ...children)
}

export function emptyState(text = NOT_USED): HTMLElement {
  return h('p', { class: 'empty' }, text)
}

/** Table with column headers; `rowHeader` makes the first cell `<th scope="row">`. */
export function table(
  caption: string,
  headers: string[],
  rows: Child[][],
  options: { rowHeader?: boolean; numericFrom?: number } = {},
): HTMLTableElement {
  const { rowHeader = true, numericFrom = 1 } = options
  const head = h('tr', null)
  headers.forEach((label, index) => {
    head.appendChild(h('th', { scope: 'col', class: index >= numericFrom ? 'num' : undefined }, label))
  })
  const body = h('tbody', null)
  for (const row of rows) {
    const tr = h('tr', null)
    row.forEach((cell, index) => {
      const cls = index >= numericFrom ? 'num' : undefined
      tr.appendChild(
        index === 0 && rowHeader ? h('th', { scope: 'row', class: cls }, cell) : h('td', { class: cls }, cell),
      )
    })
    body.appendChild(tr)
  }
  return h('table', null, h('caption', null, caption), h('thead', null, head), body)
}

/** Two-column label / value table. */
export function kvTable(caption: string, pairs: Array<[string, Child]>): HTMLTableElement {
  const body = h('tbody', null)
  for (const [label, value] of pairs) {
    body.appendChild(h('tr', null, h('th', { scope: 'row' }, label), h('td', { class: 'num' }, value)))
  }
  return h('table', { class: 'kv' }, h('caption', null, caption), body)
}

export function implSection(impl: Record<string, number | string | null> | null | undefined): HTMLElement {
  const entries = Object.entries(impl ?? {})
  return subsection(
    'Implementation',
    entries.length === 0
      ? emptyState('No implementation details reported')
      : kvTable(
          'Implementation-specific values (not part of the shared contract)',
          entries.map(([key, value]) => [key, formatImplValue(key, value)]),
        ),
  )
}

function formatImplValue(key: string, value: number | string | null): string {
  if (typeof value === 'string') return value
  return /bytes$/i.test(key) ? formatBytes(value) : formatNumber(value)
}
