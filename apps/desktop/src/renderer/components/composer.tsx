import {
  useEffect,
  useCallback,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import ArrowUpIcon from "lucide-react/dist/esm/icons/arrow-up"
import BoxIcon from "lucide-react/dist/esm/icons/box"
import BotIcon from "lucide-react/dist/esm/icons/bot"
import FileIcon from "lucide-react/dist/esm/icons/file"
import FolderIcon from "lucide-react/dist/esm/icons/folder"
import PaperclipIcon from "lucide-react/dist/esm/icons/paperclip"
import SquareIcon from "lucide-react/dist/esm/icons/square"
import {
  detectComposerTrigger,
  filterSkills,
  formatProjectReference,
  formatSkillReference,
  reconcilePromptReferences,
  replaceComposerTrigger,
  shortlistSkills,
  skillsForHarness,
  type ComposerCandidate,
  type ComposerTrigger,
} from "@deskto/client"
import type {
  BrowserElementContext,
  PromptReference,
  PromptSkill,
  TurnInput,
} from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@workspace/ui/components/chat/prompt-input"
import {
  PromptSuggestions,
  type PromptSuggestionOption,
} from "@workspace/ui/components/chat/prompt-suggestions"

import { describedErrorSchema } from "../runtime/describe-error.js"
import { imageFileInputAccept } from "../lib/image-attachments.js"
import { useImageAttachments } from "../lib/use-image-attachments.js"
import { useRuntimeClient } from "../runtime/runtime-client-context.js"
import { usePackChanged } from "../runtime/use-pack-changed.js"
import { InlineError } from "./inline-error.js"
import { BrowserContextAttachments } from "./browser-context-attachments.js"
import { ComposerAttachments } from "./composer-attachments.js"

const noBrowserContexts: readonly BrowserElementContext[] = []

const appCommands: Extract<ComposerCandidate, { kind: "app-command" }>[] = [
  {
    id: "command:model",
    kind: "app-command",
    command: "model",
    label: "/model",
    description: "Choose the model for this task",
  },
]

type SkillCache = {
  /** The `$` this list was read for, not just the project it came from. */
  session: string
  skills: PromptSkill[]
}

type SkillRequest = {
  session: string
}

type SuggestionResult = {
  key: string
  candidates: ComposerCandidate[]
  hidden: number
  failed: boolean
}

export function Composer({
  projectId,
  harnessId = null,
  label,
  placeholder,
  onSend,
  onCancel,
  onOpenModelPicker,
  running = false,
  blockedReason,
  toolbar,
  trailing,
  autoFocus = false,
  browserContexts = noBrowserContexts,
  onRemoveBrowserContext,
  onClearBrowserContexts,
}: {
  projectId: string
  harnessId?: string | null
  label: string
  placeholder: string
  onSend: (input: TurnInput) => Promise<void>
  onCancel?: () => Promise<void>
  onOpenModelPicker?: () => void
  running?: boolean
  blockedReason?: string
  toolbar?: ReactNode
  trailing?: ReactNode
  autoFocus?: boolean
  browserContexts?: readonly BrowserElementContext[]
  onRemoveBrowserContext?: (id: string) => void
  onClearBrowserContexts?: (submittedIds: readonly string[]) => void
}) {
  const client = useRuntimeClient()
  const [prompt, setPrompt] = useState("")
  const [references, setReferences] = useState<PromptReference[]>([])
  const [trigger, setTrigger] = useState<ComposerTrigger | null>(null)
  const [suggestionResult, setSuggestionResult] = useState<SuggestionResult>({
    key: "",
    candidates: [],
    hidden: 0,
    failed: false,
  })
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const [skillCache, setSkillCache] = useState<SkillCache | null>(null)
  const [sending, setSending] = useState(false)
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const {
    attachments,
    preparingCount,
    addFiles,
    removeAttachment,
    discardAttachments,
  } = useImageAttachments({ disabled: sending, onError: setError })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const requestSequence = useRef(0)
  const skillRequest = useRef<SkillRequest | null>(null)
  const hintId = useId()
  const suggestionsId = `${useId().replaceAll(":", "")}-suggestions`

  const blocked = blockedReason !== undefined
  const hasContent =
    prompt.trim().length > 0 ||
    attachments.length > 0 ||
    browserContexts.length > 0
  const canSend =
    hasContent && preparingCount === 0 && !sending && !running && !blocked
  const triggerKey = trigger
    ? `${trigger.kind}:${trigger.rangeStart}:${trigger.query}`
    : null
  const triggerKind = trigger?.kind ?? null
  const triggerQuery = trigger?.query ?? ""
  const menuOpen = trigger !== null && dismissedKey !== triggerKey && !blocked
  // One `$` is one session: skills live in folders a person edits between
  // messages, so a list read once per project would go stale for the rest of
  // the session, and one read per keystroke would walk the disk while typing.
  const skillSession =
    trigger?.kind === "skill" ? `${projectId}:${trigger.rangeStart}` : null
  const cachedSkills =
    skillSession && skillCache?.session === skillSession
      ? skillCache.skills
      : null
  // Filtering and shortlisting happen here rather than in the Runtime: the
  // list is fetched once per session, so every later keystroke is a sort over
  // an array in memory and a render of at most four rows.
  const shortlist =
    trigger?.kind === "skill" && cachedSkills
      ? shortlistSkills(
          filterSkills(skillsForHarness(cachedSkills, harnessId), trigger.query)
        )
      : null
  const candidates =
    trigger?.kind === "command"
      ? (onOpenModelPicker ? appCommands : []).filter(
          (candidate) =>
            candidate.command.includes(trigger.query.toLocaleLowerCase()) ||
            candidate.description
              .toLocaleLowerCase()
              .includes(trigger.query.toLocaleLowerCase())
        )
      : trigger?.kind === "project-entry" && !trigger.query.trim()
        ? []
        : shortlist
          ? toSkillCandidates(shortlist.visible)
          : suggestionResult.key === triggerKey
            ? suggestionResult.candidates
            : []
  const hiddenCandidates = shortlist?.hidden ?? 0
  const suggestionsLoading =
    trigger !== null &&
    trigger.kind !== "command" &&
    !(trigger.kind === "project-entry" && !trigger.query.trim()) &&
    cachedSkills === null &&
    suggestionResult.key !== triggerKey
  const suggestionsError =
    suggestionResult.key === triggerKey && suggestionResult.failed
  const activeId = candidates.some(
    (candidate) => candidate.id === highlightedId
  )
    ? highlightedId
    : (candidates[0]?.id ?? null)

  usePackChanged(
    useCallback(() => {
      skillRequest.current = null
      setSkillCache(null)
    }, [])
  )

  useEffect(() => {
    const sequence = ++requestSequence.current
    if (!triggerKind || blocked || triggerKind === "command") return

    if (triggerKind === "skill") {
      // The read is per session, and one is enough while it is in flight:
      // without this every keystroke after `$` starts another walk of the
      // same folders, all but the last discarded.
      if (!skillSession) return
      if (skillCache?.session === skillSession) return
      if (skillRequest.current?.session === skillSession) return
      const request = { session: skillSession }
      skillRequest.current = request
      void client.listSkillsForPrompt(projectId).then(
        (skills) => {
          if (skillRequest.current !== request) return
          skillRequest.current = null
          setSkillCache({ session: skillSession, skills })
        },
        () => {
          if (skillRequest.current !== request) return
          skillRequest.current = null
          // The next `$` tries again: a failed read is about this moment, not
          // about this project.
          setSuggestionResult({
            key: triggerKey!,
            candidates: [],
            hidden: 0,
            failed: true,
          })
        }
      )
      return
    }

    if (!triggerQuery.trim()) return
    const timer = window.setTimeout(() => {
      void client.searchProjectEntries(projectId, triggerQuery).then(
        (entries) => {
          if (requestSequence.current !== sequence) return
          setSuggestionResult({
            key: triggerKey!,
            candidates: entries.map((entry) => ({
              id: `project-entry:${entry.kind}:${encodeURIComponent(entry.path)}`,
              kind: "project-entry" as const,
              entry,
            })),
            hidden: 0,
            failed: false,
          })
        },
        () => {
          if (requestSequence.current !== sequence) return
          setSuggestionResult({
            key: triggerKey!,
            candidates: [],
            hidden: 0,
            failed: true,
          })
        }
      )
    }, 120)
    return () => window.clearTimeout(timer)
  }, [
    blocked,
    client,
    projectId,
    skillCache,
    skillSession,
    triggerKey,
    triggerKind,
    triggerQuery,
  ])

  useEffect(() => {
    if (!draggingFiles) return
    const resetDragState = () => setDraggingFiles(false)
    const resetOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") resetDragState()
    }
    window.addEventListener("dragend", resetDragState)
    window.addEventListener("drop", resetDragState)
    window.addEventListener("keydown", resetOnEscape)
    return () => {
      window.removeEventListener("dragend", resetDragState)
      window.removeEventListener("drop", resetDragState)
      window.removeEventListener("keydown", resetOnEscape)
    }
  }, [draggingFiles])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSend) return

    const text = prompt.trim()
    const currentReferences = reconcilePromptReferences(text, references)
    if (attachments.length === 0 && /^\/model(?:\s|$)/.test(text)) {
      setError(null)
      if (onOpenModelPicker) {
        setPrompt("")
        setReferences([])
        setTrigger(null)
        onOpenModelPicker()
      } else {
        setError("No model options are available for this task.")
      }
      return
    }
    const submittedAttachmentIds = new Set(
      attachments.map((attachment) => attachment.id)
    )
    const submittedBrowserContexts = [...browserContexts]
    setSending(true)
    setError(null)
    try {
      await onSend({
        text,
        references: currentReferences,
        attachments,
        browserContexts: submittedBrowserContexts,
      })
      setPrompt("")
      setReferences([])
      discardAttachments(submittedAttachmentIds)
      onClearBrowserContexts?.(
        submittedBrowserContexts.map((context) => context.id)
      )
      setTrigger(null)
    } catch (sendError) {
      setError(describedErrorSchema.parse(sendError))
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
      setError(describedErrorSchema.parse(cancelError))
    }
  }

  function updatePrompt(nextPrompt: string, cursor: number) {
    setPrompt(nextPrompt)
    setReferences((current) => reconcilePromptReferences(nextPrompt, current))
    setTrigger(detectComposerTrigger(nextPrompt, cursor))
    setHighlightedId(null)
    setDismissedKey(null)
  }

  function removeImage(id: string) {
    removeAttachment(id)
    textareaRef.current?.focus()
  }

  function selectCandidate(candidate: ComposerCandidate) {
    const textarea = textareaRef.current
    const currentTrigger = detectComposerTrigger(
      prompt,
      textarea?.selectionStart ?? prompt.length
    )
    if (!currentTrigger) return

    if (candidate.kind === "app-command") {
      const next = replaceComposerTrigger(prompt, currentTrigger, "")
      updatePrompt(next.text, next.cursor)
      setTrigger(null)
      onOpenModelPicker?.()
      return
    }

    const replacement =
      candidate.kind === "project-entry"
        ? `${formatProjectReference(candidate.entry.path)} `
        : `${formatSkillReference(candidate.skill.name)} `
    const next = replaceComposerTrigger(prompt, currentTrigger, replacement)
    const reference: PromptReference =
      candidate.kind === "project-entry"
        ? {
            kind: "project-entry",
            path: candidate.entry.path,
            entryKind: candidate.entry.kind,
          }
        : {
            kind: "skill",
            skillId: candidate.skill.id,
            name: candidate.skill.name,
          }
    setPrompt(next.text)
    setReferences((current) => addReference(current, reference))
    setTrigger(null)
    setDismissedKey(null)
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(next.cursor, next.cursor)
    })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!menuOpen) return
    if (event.key === "Escape") {
      event.preventDefault()
      setDismissedKey(triggerKey)
      return
    }
    if (candidates.length === 0) return
    const activeIndex = Math.max(
      0,
      candidates.findIndex((candidate) => candidate.id === activeId)
    )
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const direction = event.key === "ArrowDown" ? 1 : -1
      const index =
        (activeIndex + direction + candidates.length) % candidates.length
      setHighlightedId(candidates[index]!.id)
      return
    }
    if (
      (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      const candidate = candidates.find((item) => item.id === activeId)
      if (candidate) selectCandidate(candidate)
    }
  }

  const suggestionOptions = candidates.map(toSuggestionOption)
  const activeOptionId = activeId ? `${suggestionsId}-${activeId}` : undefined

  return (
    <div className="flex flex-col gap-2">
      {error ? <InlineError message={error} /> : null}
      {blockedReason ? (
        <p className="px-1 text-sm text-muted-foreground">{blockedReason}</p>
      ) : null}

      <div className="relative">
        {menuOpen ? (
          <div className="absolute right-0 bottom-full left-0 z-30 mb-2">
            <PromptSuggestions
              id={suggestionsId}
              options={suggestionOptions}
              activeId={activeId}
              loading={suggestionsLoading}
              emptyText={suggestionEmptyText(trigger, suggestionsError)}
              footerText={
                hiddenCandidates > 0
                  ? `${hiddenCandidates} more — keep typing to narrow`
                  : undefined
              }
              onActiveChange={setHighlightedId}
              onSelect={(id) => {
                const candidate = candidates.find((item) => item.id === id)
                if (candidate) selectCandidate(candidate)
              }}
            />
          </div>
        ) : null}

        <PromptInput
          onSubmit={handleSubmit}
          className={draggingFiles ? "ring-2 ring-primary" : undefined}
          onDragEnter={(event) => {
            if (!sending && event.dataTransfer.types.includes("Files"))
              setDraggingFiles(true)
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return
            event.preventDefault()
            if (sending) return
            event.dataTransfer.dropEffect = "copy"
          }}
          onDragLeave={(event) => {
            const nextTarget = event.relatedTarget
            if (
              nextTarget instanceof Node &&
              event.currentTarget.contains(nextTarget)
            )
              return
            setDraggingFiles(false)
          }}
          onDrop={(event) => {
            setDraggingFiles(false)
            if (!event.dataTransfer.types.includes("Files")) return
            event.preventDefault()
            if (sending || event.dataTransfer.files.length === 0) return
            void addFiles(Array.from(event.dataTransfer.files))
          }}
        >
          <BrowserContextAttachments
            contexts={browserContexts}
            onRemove={(id) => onRemoveBrowserContext?.(id)}
          />
          <ComposerAttachments
            attachments={attachments}
            preparingCount={preparingCount}
            onRemove={removeImage}
          />
          <PromptInputTextarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) =>
              updatePrompt(event.target.value, event.target.selectionStart)
            }
            onSelect={(event) =>
              setTrigger(
                detectComposerTrigger(
                  event.currentTarget.value,
                  event.currentTarget.selectionStart
                )
              )
            }
            onKeyDown={handleKeyDown}
            onPaste={(event) => {
              if (sending) return
              const images = Array.from(event.clipboardData.files).filter(
                (file) => file.type.startsWith("image/")
              )
              if (images.length === 0) return
              event.preventDefault()
              void addFiles(images)
            }}
            placeholder={placeholder}
            aria-label={label}
            aria-describedby={hintId}
            aria-controls={menuOpen ? suggestionsId : undefined}
            aria-activedescendant={menuOpen ? activeOptionId : undefined}
            aria-autocomplete="list"
            disabled={blocked}
            autoFocus={autoFocus}
            rows={2}
          />
          <PromptInputToolbar>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept={imageFileInputAccept}
              multiple
              disabled={sending}
              tabIndex={-1}
              onChange={(event) => {
                void addFiles(Array.from(event.currentTarget.files ?? []))
                event.currentTarget.value = ""
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={blocked || sending}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach images"
              title="Attach images, or paste with Ctrl/Cmd+V"
            >
              <PaperclipIcon />
            </Button>
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
      </div>

      <p id={hintId} className="sr-only">
        Press Enter to send. Shift and Enter start a new line. Paste or attach
        images. Type at, slash, or dollar for suggestions.
      </p>
    </div>
  )
}

function toSkillCandidates(skills: PromptSkill[]): ComposerCandidate[] {
  return skills.map((skill) => ({
    id: `skill:${skill.id}`,
    kind: "skill",
    skill,
  }))
}

function toSuggestionOption(
  candidate: ComposerCandidate
): PromptSuggestionOption {
  if (candidate.kind === "app-command") {
    return {
      id: candidate.id,
      label: candidate.label,
      description: candidate.description,
      meta: "OpenAPTO",
      icon: <BotIcon className="size-4" />,
    }
  }
  if (candidate.kind === "skill") {
    return {
      id: candidate.id,
      label: `$${candidate.skill.name}`,
      description: candidate.skill.description || "Use this skill",
      meta: candidate.skill.sourceLabel,
      icon: <BoxIcon className="size-4" />,
    }
  }
  const separator = candidate.entry.path.lastIndexOf("/")
  return {
    id: candidate.id,
    label:
      separator < 0
        ? candidate.entry.path
        : candidate.entry.path.slice(separator + 1),
    description:
      separator < 0 ? undefined : candidate.entry.path.slice(0, separator),
    meta: candidate.entry.kind === "directory" ? "Folder" : "File",
    icon:
      candidate.entry.kind === "directory" ? (
        <FolderIcon className="size-4" />
      ) : (
        <FileIcon className="size-4" />
      ),
  }
}

function addReference(
  references: PromptReference[],
  reference: PromptReference
): PromptReference[] {
  const key = referenceKey(reference)
  return [
    ...references.filter((candidate) => referenceKey(candidate) !== key),
    reference,
  ]
}

function referenceKey(reference: PromptReference): string {
  return reference.kind === "skill"
    ? `skill-token:${reference.name}`
    : `project-entry:${reference.path}`
}

function suggestionEmptyText(
  trigger: ComposerTrigger,
  failed: boolean
): string {
  if (failed) return "Suggestions could not be loaded."
  if (trigger.kind === "project-entry") {
    return trigger.query.trim()
      ? "No matching files or folders."
      : "Type to search project files."
  }
  if (trigger.kind === "skill") {
    return trigger.query.trim()
      ? "No matching skills for this agent."
      : "No skills found for this agent."
  }
  return "No matching command."
}
