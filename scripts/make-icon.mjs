// 从 build/icon.icns 生成 Windows 多尺寸 build/icon.ico。
// 仅需在 macOS 上跑（用系统 sips 导出各尺寸 PNG，再用 png-to-ico 合成）。
// 生成的 icon.ico 已纳入版本控制，CI 打包直接复用，无需在 Windows 上重跑本脚本。
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pngToIco from 'png-to-ico'

// Windows 资源管理器各视图所需的标准图标尺寸
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const SRC = 'build/icon.icns'
const OUT = 'build/icon.ico'

const work = mkdtempSync(join(tmpdir(), 'chatark-ico-'))
try {
  const pngPaths = SIZES.map((size) => {
    const png = join(work, `icon-${size}.png`)
    execFileSync('sips', ['-s', 'format', 'png', SRC, '--resampleWidth', String(size), '--out', png], {
      stdio: 'ignore'
    })
    return png
  })
  const ico = await pngToIco(pngPaths)
  writeFileSync(OUT, ico)
  console.log(`已生成 ${OUT}（${SIZES.join('/')} 多尺寸，共 ${ico.length} 字节）`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
