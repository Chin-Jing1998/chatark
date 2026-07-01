import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import { useStore } from '@renderer/app/store'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 关于弹窗：软件的开发思想、操作与声明。 */
export default function AboutDialog({ open, onOpenChange }: Props): JSX.Element {
  const { state } = useStore()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden border-border/60 bg-popover/90 p-0 backdrop-blur-2xl">
        <DialogTitle className="shrink-0 border-b border-border/60 px-6 py-3 text-base font-semibold">
          关于 ChatArk
        </DialogTitle>
        <div className="max-h-[72vh] space-y-5 overflow-y-auto px-6 py-5 text-[13px] leading-relaxed">
          <section>
            <h3 className="mb-1.5 text-sm font-semibold text-foreground">开发思想</h3>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>本地优先：对话与索引全部留在本机，隐私不出机、不上传任何数据。</li>
              <li>文件即数据、所见即磁盘：每个对话就是磁盘上的文件夹，应用只做只读呈现与组织，不改写正文。</li>
              <li>Obsidian 式浏览：图标栏 + 可折叠文件树 + 顶部标签页，快速在上百个历史对话间穿梭。</li>
              <li>主题一体化：外壳与对话正文随同一套预设配色联动，亮/暗双版。</li>
            </ul>
          </section>
          <section>
            <h3 className="mb-1.5 text-sm font-semibold text-foreground">操作</h3>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>浏览与打开：左侧「对话浏览器」按分类浏览，点击对话在标签页打开（最多同时 10 个，超出自动关最久未用）。</li>
              <li>检索与整理：「全文搜索」查正文，「收藏 / 置顶」「标签 / 分类」快速归集；右键对话可收藏、置顶、归档、改分类、重命名、删除、在访达中显示。</li>
              <li>排序：对话浏览器工具栏可按开始 / 导出 / 创建 / 打开时间、名称或大小排序，置顶项恒在最前。</li>
              <li>打开生成的文件：点击对话正文里的文件路径链接，即在应用内新标签渲染该文件（Markdown / 代码高亮 / 网页 / 图片），顶部显示绝对路径，点击可在文件夹中定位。</li>
              <li>外观：顶栏右侧按钮切换 跟随系统 / 亮色 / 暗色，设置中可选多款主题风格。</li>
            </ul>
          </section>
          <section>
            <h3 className="mb-1.5 text-sm font-semibold text-foreground">声明</h3>
            <p className="text-muted-foreground">
              ChatArk 为第三方独立工具，与 Anthropic 官方无从属或背书关系。应用仅在本地读取并展示由 Claude Code
              导出的对话文件，不联网上传数据；删除对话将移入系统回收站，可恢复。
            </p>
          </section>
          <div className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
            共 <b>{state.total}</b> 个对话 · 库路径：<span className="break-all">{state.root}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
