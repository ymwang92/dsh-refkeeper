// Bundles the client face into the harness loader envelope:
//   window.__ModuleLoader__.load({ id: <package name>, factory: (require) => ... })
// The envelope is verified against two installed plugins that use it
// (dsh-zotero, dsh-ops); `id` is the package name, not the patch-row id.
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

const result = await build({
  entryPoints: [fileURLToPath(new URL('src/client.tsx', root))],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  legalComments: 'none',
  logLevel: 'warning',
})

const code = result.outputFiles?.[0]?.text
if (code === undefined) throw new Error('esbuild produced no output for the client face')

const wrapped = [
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {`,
  'var module = { exports: {} }; var exports = module.exports;',
  code,
  'return module.exports;',
  '} });',
  '',
].join('\n')

await mkdir(new URL('lib/', root), { recursive: true })
await writeFile(new URL('lib/client.js', root), wrapped, 'utf8')
console.info(`dsh-refkeeper: client bundle written (${wrapped.length} bytes)`)
