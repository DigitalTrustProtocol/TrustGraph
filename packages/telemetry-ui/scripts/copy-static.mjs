#!/usr/bin/env node
// Post-build step: assemble dist/www (static pages + compiled app modules).
// The app imports ../schema.js at runtime, so schema.js ships next to app/.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(pkg, 'dist')
const www = join(dist, 'www')
const appOut = join(www, 'app')

if (!existsSync(join(dist, 'app'))) {
  console.error('copy-static: dist/app is missing; run tsc first')
  process.exit(1)
}

rmSync(www, { recursive: true, force: true })
mkdirSync(appOut, { recursive: true })

for (const name of ['index.html', 'styles.css']) copyFileSync(join(pkg, 'static', name), join(www, name))

const copyModule = (from, to) => {
  const source = readFileSync(from, 'utf8').replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n')
  writeFileSync(to, source)
}

for (const name of readdirSync(join(dist, 'app'))) {
  if (name.endsWith('.js')) copyModule(join(dist, 'app', name), join(appOut, name))
}
copyModule(join(dist, 'schema.js'), join(www, 'schema.js'))
