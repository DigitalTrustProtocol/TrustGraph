#!/usr/bin/env node
// Post-build step: tsc keeps extensionless relative specifiers (the vendored
// heap sources use them and must stay byte-identical). Node ESM needs explicit
// file extensions, so rewrite `./x` → `./x.js` (or `./x/index.js`) in dist.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'dist')
const SPECIFIER =
  /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bexport\s+\*\s+from\s*)(['"])(\.{1,2}\/[^'"]*)\2/g

function fixSpecifier(file, spec) {
  if (/\.(m?js|json|d\.ts)$/.test(spec)) return spec
  const base = resolve(dirname(file), spec)
  if (existsSync(`${base}.js`)) return `${spec}.js`
  if (existsSync(join(base, 'index.js'))) return `${spec}/index.js`
  if (existsSync(`${base}.d.ts`)) return `${spec}.js`
  if (existsSync(join(base, 'index.d.ts'))) return `${spec}/index.js`
  return spec
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      walk(path)
      continue
    }
    if (!/\.(js|d\.ts)$/.test(name)) continue
    const source = readFileSync(path, 'utf8')
    const next = source.replace(SPECIFIER, (_match, lead, quote, spec) => {
      return `${lead}${quote}${fixSpecifier(path, spec)}${quote}`
    })
    if (next !== source) writeFileSync(path, next)
  }
}

if (!existsSync(root)) {
  console.error(`fix-esm-extensions: ${root} does not exist`)
  process.exit(1)
}
walk(root)
