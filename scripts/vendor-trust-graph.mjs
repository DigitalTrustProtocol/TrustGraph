#!/usr/bin/env node
// Re-vendors AttentionX/src/graph/trust into packages/trust-graph/src from the
// AttentionX git HEAD (LF bytes) and applies ONLY the allowed import rewrites
// (library.md § Extraction plan, step 1). `--check` fails if the package
// sources differ from what this script would produce.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const here = resolve(import.meta.dirname, '..')
const attention = resolve(here, '..', 'AttentionX')
const target = resolve(here, 'packages', 'trust-graph', 'src')
const FILES = [
  'Edge.ts',
  'Graph.ts',
  'IResolveStrategy.ts',
  'IndexResolver.ts',
  'Node.ts',
  'Score.ts',
  'index.ts',
  'pathStrategyJson.ts',
  'types.ts',
  'README.md',
]

/** The complete list of permitted edits: [file, from, to]. */
const REWRITES = [
  ['Graph.ts', "import { TRUST_STATEMENT_KIND } from '../../lib/nostr/kind-32009'", "import { TRUST_STATEMENT_KIND } from './constants'"],
  ['Graph.ts', "import { RATING_STATEMENT_KIND } from '../../lib/nostr/kind-32014'", "import { RATING_STATEMENT_KIND } from './constants'"],
  ['IndexResolver.ts', "import { TRUST_STATEMENT_KIND } from '../../lib/nostr/kind-32009'", "import { TRUST_STATEMENT_KIND } from './constants'"],
  ['IndexResolver.ts', "import { meetsFollowTrustGreen } from '../../shared/trust-score'", "import { meetsFollowTrustGreen } from './threshold'"],
  ['IndexResolver.ts', "import { FOLLOW_TRUST_GREEN_DEFAULT } from '../../shared/wot-follow-trust-threshold'", "import { FOLLOW_TRUST_GREEN_DEFAULT } from './constants'"],
  ['IndexResolver.ts', "import { WOT_MAX_DEGREE_HARD_CAP } from '../../shared/wot-max-degree'", "import { WOT_MAX_DEGREE_HARD_CAP } from './constants'"],
  ['Score.ts', "import { RATING_STATEMENT_KIND } from '../../lib/nostr/kind-32014'", "import { RATING_STATEMENT_KIND } from './constants'"],
  ['Score.ts', "import { TRUST_STATEMENT_KIND } from '../../lib/nostr/kind-32009'", "import { TRUST_STATEMENT_KIND } from './constants'"],
  ['pathStrategyJson.ts', "import { TRUST_STATEMENT_KIND } from '../../lib/nostr/kind-32009'", "import { TRUST_STATEMENT_KIND } from './constants'"],
  ['types.ts', "import type { EventRecord } from '../../storage/types'", "import type { TrustEdgeRecord as EventRecord } from './record'"],
]

function vendored(file) {
  let text = execFileSync('git', ['show', `HEAD:src/graph/trust/${file}`], {
    cwd: attention,
    encoding: 'utf8',
  })
  for (const [name, from, to] of REWRITES) {
    if (name !== file) continue
    if (!text.includes(from)) throw new Error(`${file}: expected import not found: ${from}`)
    text = text.replace(from, to)
  }
  if (/from '\.\.\//.test(text)) throw new Error(`${file}: external import left after rewrite`)
  return text
}

const check = process.argv.includes('--check')
let drift = 0
const hashes = {}
for (const file of FILES) {
  const expected = vendored(file)
  hashes[file] = createHash('sha256').update(expected, 'utf8').digest('hex')
  const path = resolve(target, file)
  if (check) {
    const actual = readFileSync(path, 'utf8')
    if (actual !== expected) {
      console.error(`drift: packages/trust-graph/src/${file}`)
      drift += 1
    }
  } else {
    writeFileSync(path, expected)
  }
}
if (!check) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: attention, encoding: 'utf8' }).trim()
  const manifest = {
    source: 'AttentionX/src/graph/trust',
    sourceCommit: commit,
    rewrites: REWRITES.map(([file, from, to]) => ({ file, from, to })),
    sha256: hashes,
  }
  writeFileSync(
    resolve(here, 'packages', 'trust-graph', 'VENDORED.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
}
if (drift > 0) process.exit(1)
console.log(check ? 'trust-graph matches AttentionX HEAD (+ allowed imports)' : 'vendored')
