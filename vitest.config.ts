import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const pkg = (name: string, entry = 'index.ts') =>
  resolve(import.meta.dirname, 'packages', name, 'src', entry)

// Tests run against package sources, so `npm test` needs no prior build.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@dtp\/trust-graph\/constants$/, replacement: pkg('trust-graph', 'constants.ts') },
      { find: /^@dtp\/trust-graph\/threshold$/, replacement: pkg('trust-graph', 'threshold.ts') },
      { find: /^@dtp\/trust-graph$/, replacement: pkg('trust-graph', 'main.ts') },
      { find: /^@dtp\/trust-protocol$/, replacement: pkg('trust-protocol') },
      { find: /^@dtp\/trust-query$/, replacement: pkg('trust-query') },
      { find: /^@dtp\/trust-query\/testing$/, replacement: pkg('trust-query', 'testing.ts') },
      { find: /^@dtp\/resolver-client$/, replacement: pkg('resolver-client') },
      { find: /^@dtp\/relay-sync$/, replacement: pkg('relay-sync') },
      { find: /^@dtp\/conformance$/, replacement: pkg('conformance') },
    ],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
})
