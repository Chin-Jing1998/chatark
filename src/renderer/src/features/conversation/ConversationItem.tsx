import { useState } from 'react'
import {
  Pin,
  Star,
  Archive,
  Pencil,
  ExternalLink,
  FolderOpen,
  Trash2,
  FolderInput,
  MessageSquareText
} from 'lucide-react'
import type { ConversationSummary } from '@shared/types'
import { cn } from '@renderer/lib/cn'
import { formatDateTime } from '@renderer/lib/format'
import { useConversationActions } from '@renderer/lib/useConversationActions'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { RenameDialog } from './RenameDialog'

interface Props {
  item: ConversationSummary
  categories: string[]
  active: boolean
  onOpen: () => void
  /** tree：单行紧凑树叶（浏览器）；list：两行卡片（搜索/收藏结果） */
  variant?: 'tree' | 'list'
  /** tree 变体的缩进层级 */
  depth?: number
  /** list 变体可选：搜索命中片段 */
  snippet?: string
  /** tree 变体：在标题下补一行浅色相对路径（搜索/收藏/标签视图用于区分同名对话） */
  showPath?: boolean
}

/** 从模型名派生短“类型徽章”（对标 Obsidian 右侧文件类型标） */
function modelTag(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('opus')) return 'OPUS'
  if (m.includes('sonnet')) return 'SONNET'
  if (m.includes('haiku')) return 'HAIKU'
  if (m.includes('gpt')) return 'GPT'
  if (m.includes('gemini')) return 'GEMINI'
  return ''
}

/**
 * 可复用的单对话条目：右键上下文菜单 + 悬停详情卡 + 重命名对话框。
 * 浏览器树用 tree 单行；搜索/收藏结果用 list 两行。
 */
export default function ConversationItem({
  item,
  categories,
  active,
  onOpen,
  variant = 'tree',
  depth = 0,
  snippet,
  showPath = false
}: Props): JSX.Element {
  const actions = useConversationActions()
  const [renameOpen, setRenameOpen] = useState(false)
  const incomplete = item.integrity.missingFiles.length > 0
  const tag = modelTag(item.model)

  const trigger =
    variant === 'tree' ? (
      <button
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
        style={{ paddingLeft: 8 + depth * 15 }}
        className={cn(
          'group flex w-full flex-col rounded-md py-[5px] pr-2 text-left text-[13px] transition-colors',
          active
            ? 'bg-brand/15 font-medium text-foreground'
            : 'text-sidebar-foreground hover:bg-accent hover:text-accent-foreground'
        )}
      >
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <MessageSquareText
            className={cn('size-3.5 shrink-0', active ? 'text-brand' : 'opacity-55')}
          />
          {item.org.pinned && <Pin className="size-3 shrink-0 text-brand" />}
          {item.org.favorite && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          {incomplete ? (
            <span className="shrink-0 rounded bg-destructive/15 px-1 text-[10px] font-medium text-destructive">
              缺
            </span>
          ) : (
            tag && (
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
                {tag}
              </span>
            )
          )}
        </span>
        {showPath && item.relPath && (
          <span className="w-full min-w-0 truncate pl-5 pt-0.5 text-[11px] font-normal text-muted-foreground/70">
            {item.relPath}
          </span>
        )}
      </button>
    ) : (
      <button
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'group w-full rounded-md px-2.5 py-2 text-left transition-colors',
          active ? 'bg-brand/15 ring-1 ring-brand/30' : 'hover:bg-accent'
        )}
      >
        <div className="flex items-center gap-1.5">
          {item.org.pinned && <Pin className="size-3 shrink-0 text-brand" />}
          {item.org.favorite && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
          <span className="truncate text-[13px] font-medium">{item.title}</span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {snippet ? (
            snippet
          ) : (
            <>
              {formatDateTime(item.startedAt)} · {item.messageCount} 条
              {incomplete && <span className="ml-1 text-destructive">不完整</span>}
            </>
          )}
        </div>
      </button>
    )

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>

        <ContextMenuContent className="w-48">
            <ContextMenuItem
              onSelect={() => void actions.toggleOrg(item.id, 'favorite', item.org.favorite)}
            >
              <Star className="size-4" /> {item.org.favorite ? '取消收藏' : '收藏'}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => void actions.toggleOrg(item.id, 'pinned', item.org.pinned)}
            >
              <Pin className="size-4" /> {item.org.pinned ? '取消置顶' : '置顶'}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => void actions.toggleOrg(item.id, 'archived', item.org.archived)}
            >
              <Archive className="size-4" /> {item.org.archived ? '取消归档' : '归档'}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => setRenameOpen(true)}>
              <Pencil className="size-4" /> 重命名
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FolderInput className="size-4" /> 改分类
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-40">
                {categories.map((c) => (
                  <ContextMenuItem
                    key={c}
                    disabled={c === item.category}
                    onSelect={() => void actions.move(item.id, c)}
                  >
                    <span className="flex-1 truncate">{c}</span>
                    {c === item.category && <ContextMenuShortcut>✓</ContextMenuShortcut>}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => actions.openExternal(item.id)}>
              <ExternalLink className="size-4" /> 浏览器打开
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => actions.reveal(item.id)}>
              <FolderOpen className="size-4" /> 访达显示
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => void actions.trash(item.id, item.title)}
            >
              <Trash2 className="size-4" /> 删除
            </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        initial={item.title}
        onSubmit={(t) => actions.rename(item.id, t)}
      />
    </>
  )
}
