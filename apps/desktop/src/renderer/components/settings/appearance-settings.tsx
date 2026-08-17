import { useRef, useState } from "react"
import CheckIcon from "lucide-react/dist/esm/icons/check"
import {
  appSettings,
  settingValue,
  themeOptions,
  type SettingChoice,
} from "@deskto/settings"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { describedErrorSchema } from "../../runtime/describe-error.js"
import { useSettings } from "../../settings/settings-context.js"
import { InlineError } from "../inline-error.js"
import { StatusPanel } from "../status-panel.js"

export function AppearanceSettings() {
  const { snapshot, loadError, retry, update } = useSettings()
  const [actionError, setActionError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const group = useRef<HTMLFieldSetElement>(null)
  const latestWrite = useRef(0)
  const persisted = settingValue(snapshot, appSettings.theme)
  /* `update` is an IPC round trip that only reports back by replacing the
     snapshot, so the persisted value still names the old theme for as long as
     a write is in flight. Holding the choice locally lets a second arrow press
     move on from the option the user just picked rather than from the stale
     one, which is what makes a held-down arrow key walk the group. */
  const selected = pending ?? persisted

  async function apply(value: string) {
    setActionError(null)
    const write = (latestWrite.current += 1)
    setPending(value)
    try {
      await update({ [appSettings.theme.key]: value })
    } catch (error) {
      setActionError(describedErrorSchema.parse(error))
      /* A rejected write leaves the old theme checked, so focus has to travel
         back with it rather than sit on a radio nothing else believes in. */
      if (write === latestWrite.current) focusOption(persisted, group.current)
    } finally {
      /* Only the newest write may retire the local choice; an earlier one
         settling late would otherwise drag the selection backwards. */
      if (write === latestWrite.current) setPending(null)
    }
  }

  if (loadError) {
    return (
      <StatusPanel
        title="Deskto cannot read your settings"
        description={loadError}
        tone="danger"
      >
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      </StatusPanel>
    )
  }

  return (
    <section aria-label="Appearance" className="space-y-3">
      {actionError ? <InlineError message={actionError} /> : null}

      {/* Roving focus: the group takes one tab stop and the arrows move
          inside it, which is what a radio group is expected to do. The role
          rides on the fieldset so the visible legend names it and no second
          wrapper announces the same word twice. */}
      <fieldset
        ref={group}
        role="radiogroup"
        className="rounded-lg border border-border p-4"
        onKeyDown={(event) => {
          /* A held modifier means the chord was aimed past us — Cmd+Arrow is
             the window's — so it has to pass through untouched. */
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
            return
          const next = optionForKey(event.key, selected)
          if (!next) return
          event.preventDefault()
          void apply(next.value)
          focusOption(next.value, group.current)
        }}
      >
        <legend className="px-1 eyebrow text-muted-foreground">Theme</legend>
        <div className="flex flex-wrap gap-3 pt-2">
          {themeOptions.map((option) => (
            <ThemeOption
              key={option.value}
              option={option}
              selected={option.value === selected}
              onSelect={() => apply(option.value)}
            />
          ))}
        </div>
      </fieldset>
    </section>
  )
}

function themeOptionId(value: string): string {
  return `theme-option-${value}`
}

function themeDescriptionId(value: string): string {
  return `theme-option-${value}-description`
}

/** Which option a key lands on, or null when the key was never ours. Wrapping
    is the point of a radio group: the arrows are not supposed to dead-end. */
function optionForKey(key: string, selected: string): SettingChoice | null {
  if (key === "Home") return themeOptions[0] ?? null
  if (key === "End") return themeOptions[themeOptions.length - 1] ?? null
  const step =
    key === "ArrowRight" || key === "ArrowDown"
      ? 1
      : key === "ArrowLeft" || key === "ArrowUp"
        ? -1
        : 0
  if (step === 0) return null
  const index = themeOptions.findIndex((option) => option.value === selected)
  return (
    themeOptions[(index + step + themeOptions.length) % themeOptions.length] ??
    null
  )
}

/** Only reaches for focus while it is still inside the group, so a write that
    settles after the user has walked away cannot yank them back. */
function focusOption(value: string, group: HTMLElement | null): void {
  if (!group?.contains(document.activeElement)) return
  document.getElementById(themeOptionId(value))?.focus()
}

function ThemeOption({
  option,
  selected,
  onSelect,
}: {
  option: SettingChoice
  selected: boolean
  onSelect: () => void
}) {
  return (
    <div className="flex w-36 shrink-0 flex-col gap-2">
      <button
        id={themeOptionId(option.value)}
        type="button"
        role="radio"
        aria-checked={selected}
        /* The description sits outside the button so it reads as detail after
           the name rather than being glued onto it, which is what turned the
           announcement into "System Follow the operating system., radio". */
        aria-describedby={
          option.description ? themeDescriptionId(option.value) : undefined
        }
        tabIndex={selected ? 0 : -1}
        onClick={onSelect}
        className="group/theme flex flex-col gap-2 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn(
            "block overflow-hidden rounded-lg border transition-colors duration-150 ease-out",
            selected
              ? "border-foreground"
              : "border-border group-hover/theme:border-muted-foreground/60"
          )}
        >
          <ThemePreview value={option.value} />
        </span>
        <span className="flex items-center gap-1.5 px-0.5">
          <span
            className={cn(
              "text-sm",
              selected ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {option.label}
          </span>
          {selected ? (
            <CheckIcon aria-hidden className="size-3.5 shrink-0" />
          ) : null}
        </span>
      </button>
      {option.description ? (
        <span
          id={themeDescriptionId(option.value)}
          className="px-0.5 text-xs leading-snug text-muted-foreground"
        >
          {option.description}
        </span>
      ) : null}
    </div>
  )
}

/**
 * A miniature of the window in the palette on offer. The colours are literal
 * rather than tokens on purpose: every swatch has to show its own theme while
 * the app is wearing another one, which is exactly what tokens cannot do.
 *
 * System shows both, split down the middle by a clip rather than by two boxes,
 * so it reads as one window lit two ways.
 */
function ThemePreview({ value }: { value: string }) {
  if (value !== "system") {
    return (
      <span className="block">
        <PreviewPane dark={value === "dark"} />
      </span>
    )
  }

  return (
    <span className="relative block">
      <PreviewPane dark={false} />
      <span
        aria-hidden
        className="absolute inset-0"
        style={{ clipPath: "inset(0 0 0 50%)" }}
      >
        <PreviewPane dark />
      </span>
    </span>
  )
}

const palettes = {
  light: {
    canvas: "#ffffff",
    chrome: "#f4f4f7",
    border: "#d9dbe1",
    ink: "#33363b",
    mute: "#c0c3ca",
  },
  dark: {
    canvas: "#0a0a0a",
    chrome: "#131316",
    border: "#26282d",
    ink: "#dadbdf",
    mute: "#3a3d43",
  },
} as const

function PreviewPane({ dark }: { dark?: boolean }) {
  const palette = dark ? palettes.dark : palettes.light
  return (
    <span
      aria-hidden
      className="flex h-20 w-full"
      style={{ backgroundColor: palette.canvas }}
    >
      <span
        className="flex h-full w-1/3 shrink-0 flex-col gap-1.5 p-2"
        style={{
          backgroundColor: palette.chrome,
          borderRight: `1px solid ${palette.border}`,
        }}
      >
        <Bar color={palette.ink} width="70%" />
        <Bar color={palette.mute} width="90%" />
        <Bar color={palette.mute} width="55%" />
      </span>
      <span className="flex h-full min-w-0 flex-1 flex-col gap-1.5 p-2">
        <Bar color={palette.ink} width="60%" />
        <Bar color={palette.mute} width="100%" />
        <Bar color={palette.mute} width="85%" />
        <Bar color={palette.mute} width="45%" />
      </span>
    </span>
  )
}

function Bar({ color, width }: { color: string; width: string }) {
  return (
    <span
      className="block h-1 shrink-0 rounded-full"
      style={{ backgroundColor: color, width }}
    />
  )
}
