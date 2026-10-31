import { defineConfig } from 'tsdown'

/**
 * Host face only. The client face is bundled by `scripts/build-client.mjs`,
 * because the harness loads client code through `window.__ModuleLoader__` and
 * that wrapper is easier to own directly than to coax out of a bundler plugin.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: true,
  clean: true,
  // package.json exports point at ./lib/index.js + ./lib/index.d.ts, so the
  // ESM build must not use tsdown's default .mjs/.d.mts extensions.
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  deps: { neverBundle: [/^@deepseek-ai\//, /^node:/] },
})
