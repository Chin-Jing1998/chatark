// 作者：Chin_Jing1998；修订日期：2026-10-31（北京时间）。
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await build({
  entryPoints: [resolve(root, 'src/main/project-export.ts')],
  outfile: resolve(root, 'out/project-export.cjs'),
  platform: 'node', format: 'cjs', target: 'node20', bundle: true,
  alias: { '@shared': resolve(root, 'src/shared') },
  plugins: [{
    name: 'html-template',
    setup(builder) {
      builder.onResolve({ filter: /\.html\?raw$/ }, (args) => ({
        path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')), namespace: 'html-template'
      }))
      builder.onLoad({ filter: /.*/, namespace: 'html-template' }, async (args) => ({
        contents: await readFile(args.path, 'utf8'), loader: 'text'
      }))
    }
  }]
})
console.log('已生成 out/project-export.cjs')
