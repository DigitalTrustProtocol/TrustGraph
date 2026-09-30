#!/usr/bin/env node
// Checks packages/trust-graph/DIVERGENCE.json against the AttentionX origin
// commit it names (decision D3). Read-only in both repos: it never writes a
// file, so it cannot overwrite the gap fixes.
//
// - Re-derives each origin file from `git show <originCommit>:src/graph/trust/<file>`
//   in ../AttentionX, applies the recorded import rewrites, and checks the
//   recorded origin hash.
// - Files not listed under `diverged` must equal those origin bytes.
// - Files listed under `diverged` must differ and name at least one gap id.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const here = resolve(import.meta.dirname, '..')
const attention = resolve(here, '..', 'AttentionX')
const pkg = resolve(here, 'packages', 'trust-graph')
const record = JSON.parse(readFileSync(resolve(pkg, 'DIVERGENCE.json'), 'utf8'))

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

function origin(file) {
  let text = execFileSync('git', ['show', `${record.originCommit}:src/graph/trust/${file}`], {
    cwd: attention,
    encoding: 'utf8',
  })
  for (const { file: name, from, to } of record.rewrites) {
    if (name !== file) continue
    if (!text.includes(from)) throw new Error(`${file}: expected import not found: ${from}`)
    text = text.replace(from, to)
  }
  return text
}

let problems = 0
const report = (message) => {
  console.error(message)
  problems += 1
}
for (const [file, hash] of Object.entries(record.originSha256)) {
  const expected = origin(file)
  if (sha256(expected) !== hash) report(`record: origin hash of ${file} does not match ${record.originCommit}`)
  const actual = readFileSync(resolve(pkg, 'src', file), 'utf8')
  const gaps = record.diverged[file]
  if (gaps) {
    if (actual === expected) report(`${file} is listed as diverged (${gaps.join(', ')}) but equals the origin`)
  } else if (actual !== expected) {
    report(`${file} differs from the origin but is not listed under diverged`)
  }
}
if (problems > 0) process.exit(1)
const diverged = Object.entries(record.diverged)
console.log(
  `trust-graph: ${Object.keys(record.originSha256).length - diverged.filter(([f]) => f in record.originSha256).length} files equal AttentionX ${record.originCommit.slice(0, 7)}; diverged: ${
    diverged.map(([f, g]) => `${f} (${g.join(', ')})`).join(', ') || 'none'
  }`,
)
