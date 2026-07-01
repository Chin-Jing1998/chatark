import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: string
  onSubmit: (title: string) => Promise<boolean>
}

export function RenameDialog({ open, onOpenChange, initial, onSubmit }: Props): JSX.Element {
  const [value, setValue] = useState(initial)

  useEffect(() => {
    if (open) setValue(initial)
  }, [open, initial])

  const submit = async (): Promise<void> => {
    const ok = await onSubmit(value)
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>重命名对话</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          aria-label="对话标题"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void submit()}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
