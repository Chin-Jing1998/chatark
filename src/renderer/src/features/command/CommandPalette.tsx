import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Settings,
  Sun,
  Moon,
  Monitor,
  FolderInput,
  DownloadCloud,
  Star,
  ExternalLink,
  FolderOpen,
  Trash2,
  MessageSquare
} from 'lucide-react'
import type { SearchHit } from '@shared/types'
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem
} from '@renderer/components/ui/command'
import { useStore } from '@renderer/app/store'
import { useTheme } from '@renderer/lib/useTheme'
import { useConversationActions } from '@renderer/lib/useConversationActions'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSettings: (tab?: string) => void
}

export default function CommandPalette({ open, onOpenChange, onOpenSettings }: Props): JSX.Element {
  const { state, openConversation } = useStore()
  const { set } = useTheme()
  const actions = useConversationActions()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    const term = query.trim()
    if (!term) {
      setHits([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void window.api.search.query(term, 30).then((r) => {
        if (!cancelled) setHits(r)
      })
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const close = (): void => onOpenChange(false)
  const active = state.summaries.find((s) => s.id === state.activeId)
  const term = query.trim()
  const recents = state.recentIds
    .map((id) => state.summaries.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .slice(0, 8)

  const doImport = async (): Promise<void> => {
    close()
    try {
      const dirs = await window.api.backfill.pickImport()
      if (dirs.length === 0) return
      const results = await window.api.backfill.import(dirs)
      const imported = results.filter((x) => x.ok && x.data.status === 'imported').length
      toast.success(`导入完成：新增 ${imported} / 共 ${results.length}`)
    } catch (e) {
      toast.error(`导入失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden border-border/60 bg-popover/85 p-0 shadow-2xl backdrop-blur-2xl sm:max-w-xl">
        <DialogTitle className="sr-only">命令面板</DialogTitle>
        <Command shouldFilter={false} className="bg-transparent [&_[cmdk-group-heading]]:text-muted-foreground">
          <CommandInput placeholder="搜索对话标题与正文，或选择命令…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>无匹配</CommandEmpty>

            {!term && recents.length > 0 && (
              <CommandGroup heading="最近打开">
                {recents.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={`recent-${s.id}`}
                    onSelect={() => {
                      openConversation(s.id, s.title)
                      close()
                    }}
                  >
                    <MessageSquare className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{s.category}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {hits.length > 0 && (
              <CommandGroup heading="对话">
                {hits.map((h) => (
                  <CommandItem
                    key={h.id}
                    value={`conv-${h.id}`}
                    onSelect={() => {
                      openConversation(h.id, h.title)
                      close()
                    }}
                  >
                    <MessageSquare className="size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{h.title}</div>
                      {h.snippet && <div className="truncate text-xs text-muted-foreground">{h.snippet}</div>}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{h.category}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {term && hits.length === 0 && (
              <div className="px-3 py-3 text-center text-xs text-muted-foreground">无匹配对话</div>
            )}

            {active && (
              <CommandGroup heading="当前对话">
                <CommandItem
                  value="act-fav"
                  onSelect={() => {
                    void actions.toggleOrg(active.id, 'favorite', active.org.favorite)
                    close()
                  }}
                >
                  <Star className="size-4" /> {active.org.favorite ? '取消收藏' : '收藏'}
                </CommandItem>
                <CommandItem
                  value="act-open"
                  onSelect={() => {
                    actions.openExternal(active.id)
                    close()
                  }}
                >
                  <ExternalLink className="size-4" /> 浏览器打开
                </CommandItem>
                <CommandItem
                  value="act-reveal"
                  onSelect={() => {
                    actions.reveal(active.id)
                    close()
                  }}
                >
                  <FolderOpen className="size-4" /> 访达显示
                </CommandItem>
                <CommandItem
                  value="act-trash"
                  onSelect={() => {
                    close()
                    void actions.trash(active.id, active.title)
                  }}
                >
                  <Trash2 className="size-4" /> 删除
                </CommandItem>
              </CommandGroup>
            )}

            <CommandGroup heading="命令">
              <CommandItem
                value="cmd-settings"
                onSelect={() => {
                  close()
                  onOpenSettings('general')
                }}
              >
                <Settings className="size-4" /> 打开设置
              </CommandItem>
              <CommandItem
                value="cmd-import"
                onSelect={() => void doImport()}
              >
                <FolderInput className="size-4" /> 导入对话文件夹
              </CommandItem>
              <CommandItem
                value="cmd-backfill"
                onSelect={() => {
                  close()
                  onOpenSettings('backfill')
                }}
              >
                <DownloadCloud className="size-4" /> 补录未导出会话
              </CommandItem>
              <CommandItem value="cmd-light" onSelect={() => set('light')}>
                <Sun className="size-4" /> 主题：亮色
              </CommandItem>
              <CommandItem value="cmd-dark" onSelect={() => set('dark')}>
                <Moon className="size-4" /> 主题：暗色
              </CommandItem>
              <CommandItem value="cmd-system" onSelect={() => set('system')}>
                <Monitor className="size-4" /> 主题：跟随系统
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
