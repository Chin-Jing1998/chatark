import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

/**
 * 生产构建时给渲染层注入 CSP（开发模式不注入，否则 Vite HMR 的 eval 与 ws 连接会被拦）。
 *
 * 打包后页面走 file://，其 origin 为 opaque、`'self'` 匹配不到同目录资源，故显式带上 `file:`。
 * 真正的价值在于把外发能力钉死：default-src/connect-src 不含 http(s)，
 * 万一渲染层出现注入也无法把对话内容传出去。frame-src 只放行 convo:（对话查看器 iframe）。
 */
function rendererCsp(): Plugin {
  const policy = (scriptHashes: string[]): string =>
    [
      "default-src 'none'",
      `script-src 'self' file: ${scriptHashes.join(' ')}`.trim(),
      "style-src 'self' file: 'unsafe-inline'",
      "img-src 'self' file: data: blob:",
      "font-src 'self' file: data:",
      "connect-src 'self' file:",
      'frame-src convo:',
      "base-uri 'none'",
      "form-action 'none'",
      "object-src 'none'"
    ].join('; ')

  return {
    name: 'chatark-renderer-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // 首屏零闪烁脚本是内联的：按 sha256 精确放行，而不是开 'unsafe-inline' 把整条防线让掉
        const hashes: string[] = []
        for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
          hashes.push(`'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`)
        }
        return {
          html,
          tags: [
            {
              tag: 'meta',
              attrs: { 'http-equiv': 'Content-Security-Policy', content: policy(hashes) },
              injectTo: 'head-prepend' as const
            }
          ]
        }
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [react(), tailwindcss(), rendererCsp()]
  }
})
