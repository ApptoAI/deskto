import { useId, useState, type FormEvent, type ReactNode } from "react"
import ArrowUpIcon from "lucide-react/dist/esm/icons/arrow-up"
import SquareIcon from "lucide-react/dist/esm/icons/square"

import { Button } from "@workspace/ui/components/button"
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@workspace/ui/components/chat/prompt-input"

import { describeError } from "../runtime/describe-error.js"
import { InlineError } from "./inline-error.js"

export function Composer({
  label,
  placeholder,
  onSend,
  onCancel,
  running = false,
  blockedReason,
  toolbar,
  trailing,
  autoFocus = false,
}: {
  label: string
  placeholder: string
  onSend: (prompt: string) => Promise<void>
  onCancel?: () => Promise<void>
  running?: boolean
  blockedReason?: string
  toolbar?: ReactNode
  trailing?: ReactNode
  autoFocus?: boolean
}) {
  const [prompt, setPrompt] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hintId = useId()

  const blocked = blockedReason !== undefined
  const canSend = prompt.trim().length > 0 && !sending && !running && !blocked

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSend) return

    setSending(true)
    setError(null)
    try {
      await onSend(prompt.trim())
      setPrompt("")
    } catch (sendError) {
      setError(describeError(sendError))
    } finally {
      setSending(false)
    }
  }

  async function handleCancel() {
    if (!onCancel) return

    setError(null)
    try {
      await onCancel()
    } catch (cancelError) {
      setError(describeError(cancelError))
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? <InlineError message={error} /> : null}
      {blockedReason ? (
        <p className="px-1 text-sm text-muted-foreground">{blockedReason}</p>
      ) : null}

      <PromptInput onSubmit={handleSubmit}>
        <PromptInputTextarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={placeholder}
          aria-label={label}
          aria-describedby={hintId}
          disabled={blocked}
          autoFocus={autoFocus}
          rows={2}
        />
        <PromptInputToolbar>
          {toolbar}
          <div className="ml-auto flex items-center gap-2">
            {trailing}
            {running && onCancel ? (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={handleCancel}
                aria-label="Stop this task"
              >
                <SquareIcon className="size-3 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={!canSend}
                aria-label="Send"
              >
                <ArrowUpIcon />
              </Button>
            )}
          </div>
        </PromptInputToolbar>
      </PromptInput>

      <p id={hintId} className="px-1 text-xs text-muted-foreground">
        Press Enter to send. Shift and Enter start a new line.
      </p>
    </div>
  )
}
