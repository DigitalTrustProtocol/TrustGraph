import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
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
const record = JSON.parse(readFileSync(resolve(pkg, 'DIVERGENCE.json'), 'utf8')) as {
  originCommit: string
  rewrites: Array<{ file: string; from: string; to: string }>
  originSha256: Record<string, string>
  diverged: Record<string, string[]>
  packageLocal: Record<string, string>
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(resolve(pkg, 'src', file), 'utf8'), 'utf8').digest('hex')
}

describe('@dtp/trust-graph divergence record (decision D3)', () => {
  it('names the AttentionX origin commit', () => {
    expect(record.originCommit).toMatch(/^[0-9a-f]{40}$/)
  })

  it('keeps every file that is not listed as diverged byte-identical to the origin', () => {
    for (const [file, hash] of Object.entries(record.originSha256)) {
      if (record.diverged[file]) continue
      expect(sha256(file), file).toBe(hash)
    }
  })

  it('lists each diverged file with the gap ids that forced the edit, and only files that really differ', () => {
    for (const [file, gaps] of Object.entries(record.diverged)) {
      expect(gaps.length, file).toBeGreaterThan(0)
      for (const gap of gaps) expect(gap, file).toMatch(/^G\d+$/)
      const origin = record.originSha256[file]
      if (origin !== undefined) expect(sha256(file), file).not.toBe(origin)
      else expect(record.packageLocal[file], `${file}: new files are listed as package-local too`).toBeDefined()
    }
  })

  it('accounts for every source file', () => {
    const known = new Set([...Object.keys(record.originSha256), ...Object.keys(record.packageLocal)])
    for (const file of readdirSync(resolve(pkg, 'src'))) expect(known.has(file), file).toBe(true)
  })

  it('records only the five external imports and the EventRecord type import as origin rewrites', () => {
    expect(record.rewrites).toHaveLength(10)
    for (const rewrite of record.rewrites) {
      expect(rewrite.from).toMatch(/^import (type )?\{ \w+ \} from '\.\.\/\.\.\//)
      expect(rewrite.to).toMatch(/from '\.\/(constants|threshold|record)'$/)
    }
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
