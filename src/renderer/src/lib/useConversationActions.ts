import { useCallback } from 'react'
import { toast } from 'sonner'
import type { OrgMeta } from '@shared/types'
import { useStore } from '@renderer/app/store'

/**
 * 单对话操作集合（右键菜单与命令面板共用）。
 * 统一：调用 window.api → toast 反馈 → 刷新列表；重命名同步标签标题；删除后关闭标签。
 */
export function useConversationActions(): {
  toggleOrg: (id: string, field: keyof OrgMeta, current: boolean) => Promise<void>
  rename: (id: string, newTitle: string) => Promise<boolean>
  move: (id: string, toCategory: string) => Promise<void>
  trash: (id: string, title: string) => Promise<void>
  reveal: (id: string) => void
  openExternal: (id: string) => void
} {
  const { reload, renameTab, updateTab, closeTab } = useStore()

  const toggleOrg = useCallback(
    async (id: string, field: keyof OrgMeta, current: boolean): Promise<void> => {
      const r = await window.api.conv.setOrg(id, { [field]: !current } as Partial<OrgMeta>)
      if (!r.ok) {
        toast.error(`操作失败：${r.message}`)
        return
      }
      await reload()
    },
    [reload]
  )

  const rename = useCallback(
    async (id: string, newTitle: string): Promise<boolean> => {
      const title = newTitle.trim()
      if (!title) return false
      const r = await window.api.conv.rename(id, title)
      if (!r.ok) {
        toast.error(`重命名失败：${r.message}`)
        return false
      }
      // 缺 sessionId 的对话改目录会使 id 变化 → 同步更新标签 id，否则标签陈旧、命令面板失联
      if (r.data.id !== id) updateTab(id, r.data.id, r.data.title)
      else renameTab(id, r.data.title)
      await reload()
      toast.success('已重命名')
      return true
    },
    [reload, renameTab, updateTab]
  )

  const move = useCallback(
    async (id: string, toCategory: string): Promise<void> => {
      const r = await window.api.conv.move(id, toCategory)
      if (!r.ok) {
        toast.error(`移动失败：${r.message}`)
        return
      }
      if (r.data.id !== id) updateTab(id, r.data.id, r.data.title)
      await reload()
      toast.success(`已移到「${toCategory}」`)
    },
    [reload, updateTab]
  )

  const trash = useCallback(
    async (id: string, title: string): Promise<void> => {
      const okToDelete = await window.api.ui.confirm({
        message: `确认删除「${title}」？`,
        detail: '将移入系统回收站，可恢复。',
        confirmLabel: '删除',
        danger: true
      })
      if (!okToDelete) return
      const r = await window.api.conv.trash(id)
      if (!r.ok) {
        toast.error(`删除失败：${r.message}`)
        return
      }
      closeTab(id)
      await reload()
      toast.success('已移入回收站')
    },
    [reload, closeTab]
  )

  const reveal = useCallback((id: string): void => {
    void window.api.conv.reveal(id)
  }, [])

  const openExternal = useCallback((id: string): void => {
    void window.api.conv.openExternal(id)
  }, [])

  return { toggleOrg, rename, move, trash, reveal, openExternal }
}
