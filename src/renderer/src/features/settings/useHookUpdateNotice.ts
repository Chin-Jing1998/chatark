/**
 * 启动时检测自动导出钩子是否为旧版形态，并提供一键更新。
 *
 * 必要性：旧版钩子（Electron 图形模式 + timeout 20 + async）每场会话都会闪出程序坞图标，
 * 且长起名会被中途杀掉导致漏导出。用户不会主动打开设置面板，故在启动时主动提示一次。
 */
import { useEffect } from 'react'
import { toast } from 'sonner'
import type { HookStatus } from '@shared/types'

/** 模块级去重：HMR 重挂载或多处调用都只提示一次，不重复打扰。 */
let shown = false

/** 提示停留时长：需留出读完并决定的时间，故显著长于默认 toast。 */
const NOTICE_DURATION_MS = 15_000

/** 更新即重新安装：installHook 会整体替换我方旧条目，幂等。 */
async function install(status: HookStatus): Promise<void> {
  const r = await window.api.hook.install(status.pythonHookPresent)
  if (r.ok) toast.success('钩子已更新')
  else toast.error(r.message)
}

export function useHookUpdateNotice(): void {
  useEffect(() => {
    if (shown) return
    shown = true
    void window.api.hook
      .status()
      .then((status) => {
        if (!status.needsUpdate) return
        toast('自动导出钩子为旧版', {
          description: '命令或超时设置已变化，更新后会话结束时不再弹出程序坞图标。',
          duration: NOTICE_DURATION_MS,
          action: { label: '更新', onClick: () => void install(status) }
        })
      })
      .catch(() => {
        /* 启动期非关键路径：查询失败仅表示本次不提示，设置面板仍可查看与更新 */
      })
  }, [])
}
