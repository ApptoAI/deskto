import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react"
import CheckIcon from "lucide-react/dist/esm/icons/check"
import {
  appSettings,
  defaultInterfaceFontSize,
  maxInterfaceFontSize,
  minInterfaceFontSize,
  settingValue,
  themeOptions,
  accentSourceOptions,
  workspaceLayoutOptions,
  type InterfaceFontSize,
  type SettingChoice,
  type SettingDefinition,
  type AccentSource,
  type ThemePreference,
  type WorkspaceLayout,
} from "@deskto/settings"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { describedErrorSchema } from "../../runtime/describe-error.js"
import { useSettings } from "../../settings/settings-context.js"
import { InlineError } from "../inline-error.js"
import { StatusPanel } from "../status-panel.js"
import { ThemePreview } from "../theme-preview.js"
import {
  workspaceAccent,
  workspaceSwatch,
} from "../workspace/workspace-theme.js"

// The previews borrow one real Workspace hue so what they show is what a
// Workspace of that colour lands as, in both palettes.
const previewWorkspaceColor = "blue"

export function AppearanceSettings() {
  const { snapshot, loadError, retry, update } = useSettings()
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [pendingTheme, setPendingTheme] = useState<ThemePreference | null>(null)
  const [pendingLayout, setPendingLayout] = useState<WorkspaceLayout | null>(
    null
  )
  const [pendingAccent, setPendingAccent] = useState<AccentSource | null>(null)
  const [pendingFontSize, setPendingFontSize] =
    useState<InterfaceFontSize | null>(null)
  const latestWrites = useRef<Record<string, number>>({})
  const lastRequestedFontSize = useRef<InterfaceFontSize>(
    defaultInterfaceFontSize
  )

  const persistedTheme = settingValue(snapshot, appSettings.theme)
  const persistedLayout = settingValue(snapshot, appSettings.workspaceLayout)
  const persistedAccent = settingValue(snapshot, appSettings.accentSource)
  const persistedFontSize = settingValue(
    snapshot,
    appSettings.interfaceFontSize
  )
  const theme = pendingTheme ?? persistedTheme
  const layout = pendingLayout ?? persistedLayout
  const accent = pendingAccent ?? persistedAccent
  const fontSize = pendingFontSize ?? persistedFontSize

  useEffect(() => {
    if (pendingFontSize === null) {
      lastRequestedFontSize.current = persistedFontSize
    }
  }, [pendingFontSize, persistedFontSize])

  const rangeStyle: CSSProperties & { "--range-progress": string } = {
    "--range-progress": `${
      ((fontSize - minInterfaceFontSize) /
        (maxInterfaceFontSize - minInterfaceFontSize)) *
      100
    }%`,
  }

  async function apply<T extends string | number>(
    definition: SettingDefinition<T>,
    value: T,
    setPending: Dispatch<SetStateAction<T | null>>
  ) {
    const key = definition.key
    const write = (latestWrites.current[key] ?? 0) + 1
    latestWrites.current[key] = write
    setPending(value)

    try {
      await update({ [key]: value })
      if (latestWrites.current[key] === write) {
        setActionErrors((current) => {
          const next = { ...current }
          delete next[key]
          return next
        })
      }
      return true
    } catch (error) {
      if (latestWrites.current[key] === write) {
        setActionErrors((current) => ({
          ...current,
          [key]: describedErrorSchema.parse(error),
        }))
      }
      return false
    } finally {
      if (latestWrites.current[key] === write) {
        setPending(null)
      }
    }
  }

  function commitFontSize(value: InterfaceFontSize) {
    if (value === lastRequestedFontSize.current) {
      if (value === persistedFontSize) setPendingFontSize(null)
      return
    }
    lastRequestedFontSize.current = value
    void apply(appSettings.interfaceFontSize, value, setPendingFontSize).then(
      (saved) => {
        if (!saved) lastRequestedFontSize.current = persistedFontSize
      }
    )
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
    <section aria-label="Appearance" className="space-y-4">
      {Object.entries(actionErrors).map(([key, message]) => (
        <InlineError key={key} message={message} />
      ))}

      <ChoiceCardGroup
        name="theme"
        legend="Theme"
        options={themeOptions}
        selected={theme}
        onSelect={(value) =>
          void apply(appSettings.theme, value, setPendingTheme)
        }
        renderPreview={(value) => <ThemePreview value={value} />}
      />

      <ChoiceCardGroup
        name="accent-source"
        legend="Accent"
        options={accentSourceOptions}
        selected={accent}
        onSelect={(value) =>
          void apply(appSettings.accentSource, value, setPendingAccent)
        }
        renderPreview={(value) => <AccentPreview value={value} />}
        optionClassName="w-48"
      />

      <ChoiceCardGroup
        name="workspace-layout"
        legend="Workspace layout"
        options={workspaceLayoutOptions}
        selected={layout}
        onSelect={(value) =>
          void apply(appSettings.workspaceLayout, value, setPendingLayout)
        }
        renderPreview={(value) => <LayoutPreview value={value} />}
        optionClassName="w-48"
      />

      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1 eyebrow text-muted-foreground">
          Text size
        </legend>
        <div className="pt-2">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Interface text</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Scales text without changing panel proportions.
              </p>
            </div>
            <output
              htmlFor="interface-font-size"
              className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs tabular-nums"
            >
              {fontSize}px
            </output>
          </div>
          <div className="mt-4 grid grid-cols-[0.75rem_minmax(0,1fr)_1.125rem] items-center gap-3">
            <span
              aria-hidden
              className="text-center text-xs text-muted-foreground"
            >
              A
            </span>
            <input
              id="interface-font-size"
              type="range"
              min={minInterfaceFontSize}
              max={maxInterfaceFontSize}
              step={1}
              value={fontSize}
              aria-label="Text size"
              aria-valuetext={`${fontSize} pixels`}
              className="settings-range min-w-0 w-full"
              style={rangeStyle}
              onChange={(event) =>
                setPendingFontSize(Number(event.currentTarget.value))
              }
              onPointerUp={(event) =>
                commitFontSize(Number(event.currentTarget.value))
              }
              onKeyUp={(event) =>
                commitFontSize(Number(event.currentTarget.value))
              }
              onBlur={(event) =>
                commitFontSize(Number(event.currentTarget.value))
              }
            />
            <span
              aria-hidden
              className="text-center text-lg text-muted-foreground"
            >
              A
            </span>
          </div>
          <div className="mt-1 grid grid-cols-[0.75rem_minmax(0,1fr)_1.125rem] gap-3 font-mono text-tiny text-muted-foreground">
            <span aria-hidden />
            <div className="relative h-4">
              <span className="absolute left-0">
                {minInterfaceFontSize}px
              </span>
              <span
                className="absolute -translate-x-1/2"
                style={{
                  left: `${
                    ((defaultInterfaceFontSize - minInterfaceFontSize) /
                      (maxInterfaceFontSize - minInterfaceFontSize)) *
                    100
                  }%`,
                }}
              >
                {defaultInterfaceFontSize}px
              </span>
              <span className="absolute right-0">{maxInterfaceFontSize}px</span>
            </div>
            <span aria-hidden />
          </div>
        </div>
      </fieldset>
    </section>
  )
}

function ChoiceCardGroup<T extends string>({
  name,
  legend,
  options,
  selected,
  onSelect,
  renderPreview,
  optionClassName,
}: {
  name: string
  legend: string
  options: readonly SettingChoice<T>[]
  selected: T
  onSelect: (value: T) => void
  renderPreview: (value: T) => ReactNode
  optionClassName?: string
}) {
  return (
    <fieldset className="rounded-lg border border-border p-4">
      <legend className="px-1 eyebrow text-muted-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-3 pt-2">
        {options.map((option) => {
          const checked = option.value === selected
          return (
            <label
              key={option.value}
              className={cn(
                "group/choice flex w-36 shrink-0 cursor-pointer flex-col gap-2 rounded-lg outline-none",
                optionClassName
              )}
            >
              <input
                className="appearance-choice-input peer sr-only"
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onSelect(option.value)}
              />
              <span
                className={cn(
                  "appearance-choice-preview block overflow-hidden rounded-lg border transition-colors duration-150 ease-out peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                  checked
                    ? "border-foreground"
                    : "border-border group-hover/choice:border-muted-foreground/60"
                )}
              >
                {renderPreview(option.value)}
              </span>
              <span className="flex items-center gap-1.5 px-0.5">
                <span
                  className={cn(
                    "text-sm",
                    checked ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {option.label}
                </span>
                {checked ? (
                  <CheckIcon aria-hidden className="size-3.5 shrink-0" />
                ) : null}
              </span>
              {option.description ? (
                <span className="px-0.5 text-xs leading-snug text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** Filled controls, shown as they land with and without a Workspace colour. */
function AccentPreview({ value }: { value: AccentSource }) {
  const filled =
    value === "workspace"
      ? { background: workspaceAccent(previewWorkspaceColor) ?? undefined }
      : undefined
  return (
    <span aria-hidden className="flex h-20 flex-col justify-center gap-2 p-3">
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "h-5 w-12 rounded-full",
            value === "workspace" ? "" : "bg-primary"
          )}
          style={filled}
        />
        <span className="h-1 w-10 rounded-full bg-foreground/25" />
      </span>
      <span className="h-1 w-3/4 rounded-full bg-foreground/15" />
      <span className="h-1 w-1/2 rounded-full bg-foreground/10" />
    </span>
  )
}

function LayoutPreview({ value }: { value: WorkspaceLayout }) {
  return (
    <span aria-hidden className="flex h-20 bg-background">
      {value === "slack" ? (
        <span className="flex w-7 shrink-0 flex-col items-center gap-1.5 border-r border-border bg-sidebar p-1.5">
          <span
            className={cn("size-3 rounded", workspaceSwatch("violet"))}
          />
          <span
            className={cn("size-3 rounded opacity-60", workspaceSwatch("blue"))}
          />
          <span
            className={cn(
              "size-3 rounded opacity-60",
              workspaceSwatch("emerald")
            )}
          />
        </span>
      ) : null}
      <span
        className={cn(
          "flex shrink-0 flex-col gap-1.5 border-r border-border bg-sidebar p-2",
          value === "slack" ? "w-[42%]" : "w-[38%]"
        )}
      >
        <span className="mb-1 flex items-center gap-1">
          <span
            className={cn("size-2.5 rounded", workspaceSwatch("violet"))}
          />
          <span className="h-1 w-1/2 rounded-full bg-foreground/70" />
        </span>
        <span className="h-1 w-full rounded-full bg-muted-foreground/45" />
        <span className="h-1 w-4/5 rounded-full bg-muted-foreground/35" />
        <span className="h-1 w-3/5 rounded-full bg-muted-foreground/35" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 p-2.5">
        <span className="h-1 w-3/5 rounded-full bg-foreground/60" />
        <span className="h-1 w-full rounded-full bg-muted-foreground/30" />
        <span className="h-1 w-4/5 rounded-full bg-muted-foreground/30" />
      </span>
    </span>
  )
}
