import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const pkg = join(import.meta.dirname, '..')

function totalBytes(dir: string): number {
  let total = 0
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    total += statSync(path).isDirectory() ? totalBytes(path) : statSync(path).size
  }
  return total
}

describe('telemetry UI budget', () => {
  it('keeps app sources and static files under 100 KB (proxy for the gzip budget)', () => {
    const bytes = totalBytes(join(pkg, 'src', 'app')) + totalBytes(join(pkg, 'static'))
    expect(bytes).toBeLessThan(100_000)
  })

  it('loads no external resources and no inline script or style', () => {
    const html = readFileSync(join(pkg, 'static', 'index.html'), 'utf8')
    expect(html).toContain("script-src 'self'")
    expect(html).not.toMatch(/(src|href)="(https?:)?\/\//)
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
    expect(html).not.toMatch(/<style|\sstyle=/)
    const css = readFileSync(join(pkg, 'static', 'styles.css'), 'utf8')
    expect(css).not.toMatch(/@import|url\(/)
  })

  it('never uses innerHTML or eval in the app', () => {
    for (const name of readdirSync(join(pkg, 'src', 'app'))) {
      const source = readFileSync(join(pkg, 'src', 'app', name), 'utf8')
      expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|\beval\(|new Function/)
    }
  })
})
