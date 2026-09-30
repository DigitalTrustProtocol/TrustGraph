import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FOLLOW_TRUST_GREEN_DEFAULT,
  RATING_STATEMENT_KIND,
  TRUST_STATEMENT_KIND,
  WOT_MAX_DEGREE_HARD_CAP,
  meetsFollowTrustGreen,
} from '@dtp/trust-graph'

const pkg = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(pkg, 'VENDORED.json'), 'utf8')) as {
  sourceCommit: string
  sha256: Record<string, string>
  rewrites: Array<{ file: string; from: string; to: string }>
}

describe('@dtp/trust-graph is the locked heap', () => {
  it('matches the vendored bytes recorded from AttentionX', () => {
    for (const [file, hash] of Object.entries(manifest.sha256)) {
      const bytes = readFileSync(resolve(pkg, 'src', file), 'utf8')
      expect(createHash('sha256').update(bytes, 'utf8').digest('hex'), file).toBe(hash)
    }
  })

  it('rewrites only the five external imports and the EventRecord type import', () => {
    expect(manifest.rewrites).toHaveLength(10)
    for (const rewrite of manifest.rewrites) {
      expect(rewrite.from).toMatch(/^import (type )?\{ \w+ \} from '\.\.\/\.\.\//)
      expect(rewrite.to).toMatch(/from '\.\/(constants|threshold|record)'$/)
    }
    const imported = new Set(
      manifest.rewrites.map((r) => /\{ (\w+) \}/.exec(r.from)?.[1]),
    )
    expect([...imported].sort()).toEqual([
      'EventRecord',
      'FOLLOW_TRUST_GREEN_DEFAULT',
      'RATING_STATEMENT_KIND',
      'TRUST_STATEMENT_KIND',
      'WOT_MAX_DEGREE_HARD_CAP',
      'meetsFollowTrustGreen',
    ])
  })

  it('keeps the moved constants and threshold identical to AttentionX', () => {
    expect(TRUST_STATEMENT_KIND).toBe(32009)
    expect(RATING_STATEMENT_KIND).toBe(32014)
    expect(FOLLOW_TRUST_GREEN_DEFAULT).toBe(75)
    expect(WOT_MAX_DEGREE_HARD_CAP).toBe(7)
    expect(meetsFollowTrustGreen(3, 1, 75)).toBe(true)
    expect(meetsFollowTrustGreen(2, 1, 75)).toBe(false)
    expect(meetsFollowTrustGreen(0, 0, 0)).toBe(false)
  })
})
