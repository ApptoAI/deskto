import { useId, useState, type ReactNode } from "react"
import {
  computerUseSettings,
  isOverridden,
  maxBrowserViewportSide,
  minBrowserViewportSide,
  parseBrowserHostRules,
  settingValue,
  type BrowserViewport,
  type SettingDefinition,
  type SettingValue,
} from "@deskto/settings"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

import { describedErrorSchema } from "../../runtime/describe-error.js"
import { useSettings } from "../../settings/settings-context.js"

/**
 * Text fields commit when the person leaves them or presses Enter, so a
 * half-typed host list never reaches the Runtime. The schema in the
 * registry decides validity; this component only reports its message.
 */
export function BrowserSettingsSection({
  advanced = false,
}: {
  advanced?: boolean
}) {
  const { snapshot, update } = useSettings()
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function commit<T extends SettingValue>(
    definition: SettingDefinition<T>,
    value: T | null
  ): Promise<boolean> {
    const key = definition.key
    if (value !== null) {
      const parsed = definition.schema.safeParse(value)
      if (!parsed.success) {
        setErrors((current) => ({
          ...current,
          [key]:
            parsed.error.issues[0]?.message ??
            `The value for "${definition.label}" is not valid`,
        }))
        return false
      }
    }
    try {
      await update({ [key]: value })
      setErrors((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      return true
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [key]: describedErrorSchema.parse(error),
      }))
      return false
    }
  }

  const homeUrl = computerUseSettings.browserHomeUrl
  const userAgent = computerUseSettings.browserUserAgent
  const viewport = computerUseSettings.browserViewport
  const allowed = computerUseSettings.browserAllowedHosts
  const blocked = computerUseSettings.browserBlockedHosts
  const clearSession = computerUseSettings.browserClearSessionBetweenTasks
  const downloadFolder = computerUseSettings.browserDownloadFolder

  return (
    <ul className="divide-y divide-border">
      {!advanced ? (
        <TextSettingRow
          definition={homeUrl}
          value={settingValue(snapshot, homeUrl)}
          overridden={isOverridden(snapshot, homeUrl)}
          error={errors[homeUrl.key]}
          onCommit={(value) => commit(homeUrl, value)}
        />
      ) : null}
      {advanced ? (
        <>
          <ViewportSettingRow
            definition={viewport}
            value={settingValue(snapshot, viewport)}
            overridden={isOverridden(snapshot, viewport)}
            error={errors[viewport.key]}
            onCommit={(value) => commit(viewport, value)}
          />
          <HostListSettingRow
            definition={allowed}
            value={settingValue(snapshot, allowed)}
            overridden={isOverridden(snapshot, allowed)}
            error={errors[allowed.key]}
            onCommit={(value) => commit(allowed, value)}
          />
          <HostListSettingRow
            definition={blocked}
            value={settingValue(snapshot, blocked)}
            overridden={isOverridden(snapshot, blocked)}
            error={errors[blocked.key]}
            onCommit={(value) => commit(blocked, value)}
          />
        </>
      ) : null}
      {!advanced ? (
        <>
          <ToggleSettingRow
            definition={clearSession}
            value={settingValue(snapshot, clearSession)}
            error={errors[clearSession.key]}
            onCommit={(value) => commit(clearSession, value)}
          />
          <TextSettingRow
            definition={downloadFolder}
            value={settingValue(snapshot, downloadFolder)}
            overridden={isOverridden(snapshot, downloadFolder)}
            error={errors[downloadFolder.key]}
            onCommit={(value) => commit(downloadFolder, value)}
          />
        </>
      ) : null}
      {advanced ? (
        <TextSettingRow
          definition={userAgent}
          value={settingValue(snapshot, userAgent)}
          overridden={isOverridden(snapshot, userAgent)}
          error={errors[userAgent.key]}
          onCommit={(value) => commit(userAgent, value)}
        />
      ) : null}
    </ul>
  )
}

function SettingRow({
  id,
  label,
  error,
  overridden,
  onReset,
  children,
  stacked,
}: {
  id: string
  label: string
  error?: string
  overridden?: boolean
  onReset?: () => void
  children: ReactNode
  /** Wide editors sit under the label rather than beside it. */
  stacked?: boolean
}) {
  const errorId = `${id}-error`
  return (
    <li className="py-3 first:pt-1 last:pb-1">
      <div
        className={cn(
          "flex gap-3",
          stacked ? "flex-col" : "items-center justify-between"
        )}
      >
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
          <div className="min-w-0">
            <label htmlFor={id} className="text-sm font-medium">
              {label}
            </label>
          </div>
          {stacked && overridden && onReset ? (
            <Button variant="ghost" size="sm" onClick={onReset}>
              Reset
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {!stacked && overridden && onReset ? (
            <Button variant="ghost" size="sm" onClick={onReset}>
              Reset
            </Button>
          ) : null}
          {children}
        </div>
      </div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="pt-1.5 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
    </li>
  )
}

function TextSettingRow({
  definition,
  value,
  overridden,
  error,
  onCommit,
}: {
  definition: SettingDefinition<string>
  value: string
  overridden: boolean
  error?: string
  /** Null clears the override back to the default. */
  onCommit: (value: string | null) => Promise<boolean>
}) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  // A save elsewhere (reset, another window) replaces the draft with the
  // persisted value; the person's own typing does not.
  const [synced, setSynced] = useState(value)
  if (synced !== value) {
    setSynced(value)
    setDraft(value)
  }
  const input = definition.input
  const placeholder = input.kind === "text" ? input.placeholder : undefined
  const monospace = input.kind === "text" && input.monospace

  return (
    <SettingRow
      id={id}
      label={definition.label}
      error={error}
      overridden={overridden}
      onReset={() => void onCommit(null)}
      stacked
    >
      <Input
        id={id}
        value={draft}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn("w-full", monospace && "font-mono text-xs")}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => {
          if (draft.trim() !== value) void onCommit(draft.trim())
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
          if (event.key === "Escape") setDraft(value)
        }}
      />
    </SettingRow>
  )
}

function HostListSettingRow({
  definition,
  value,
  overridden,
  error,
  onCommit,
}: {
  definition: SettingDefinition<string[]>
  value: string[]
  overridden: boolean
  error?: string
  onCommit: (value: string[] | null) => Promise<boolean>
}) {
  const id = useId()
  const text = value.join("\n")
  const [draft, setDraft] = useState(text)
  const [synced, setSynced] = useState(text)
  if (synced !== text) {
    setSynced(text)
    setDraft(text)
  }

  return (
    <SettingRow
      id={id}
      label={definition.label}
      error={error}
      overridden={overridden}
      onReset={() => void onCommit(null)}
      stacked
    >
      <Textarea
        id={id}
        value={draft}
        placeholder="example.com&#10;*.example.org"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="min-h-12 w-full font-mono text-xs"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => {
          const rules = parseBrowserHostRules(draft)
          if (rules.join("\n") !== text) void onCommit(rules)
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setDraft(text)
        }}
      />
    </SettingRow>
  )
}

export function ToggleSettingRow({
  definition,
  value,
  error,
  onCommit,
}: {
  definition: SettingDefinition<boolean>
  value: boolean
  error?: string
  onCommit: (value: boolean) => Promise<boolean>
}) {
  const id = useId()
  return (
    <SettingRow
      id={id}
      label={definition.label}
      error={error}
    >
      <Switch
        id={id}
        checked={value}
        onCheckedChange={(checked) => void onCommit(checked)}
      />
    </SettingRow>
  )
}

function ViewportSettingRow({
  definition,
  value,
  overridden,
  error,
  onCommit,
}: {
  definition: SettingDefinition<BrowserViewport>
  value: BrowserViewport
  overridden: boolean
  error?: string
  onCommit: (value: BrowserViewport | null) => Promise<boolean>
}) {
  const id = useId()
  const [width, setWidth] = useState(String(value.width))
  const [height, setHeight] = useState(String(value.height))
  const [synced, setSynced] = useState(value)
  if (synced.width !== value.width || synced.height !== value.height) {
    setSynced(value)
    setWidth(String(value.width))
    setHeight(String(value.height))
  }

  function commitDraft() {
    const next = { width: Number(width), height: Number(height) }
    if (next.width === value.width && next.height === value.height) return
    void onCommit(next)
  }
  const sideProps = {
    type: "number",
    min: minBrowserViewportSide,
    max: maxBrowserViewportSide,
    step: 1,
    inputMode: "numeric",
    className: "w-24 font-mono text-xs tabular-nums",
    onBlur: commitDraft,
    onKeyDown: (event: { key: string; currentTarget: HTMLInputElement }) => {
      if (event.key === "Enter") event.currentTarget.blur()
    },
  } as const

  return (
    <SettingRow
      id={id}
      label={definition.label}
      error={error}
      overridden={overridden}
      onReset={() => void onCommit(null)}
    >
      <Input
        {...sideProps}
        id={id}
        aria-label="Page width"
        value={width}
        onChange={(event) => setWidth(event.currentTarget.value)}
      />
      <span aria-hidden className="text-xs text-muted-foreground">
        ×
      </span>
      <Input
        {...sideProps}
        aria-label="Page height"
        value={height}
        onChange={(event) => setHeight(event.currentTarget.value)}
      />
    </SettingRow>
  )
}
