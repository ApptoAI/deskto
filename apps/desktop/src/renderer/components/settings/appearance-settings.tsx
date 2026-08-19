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
  workspaceLayoutOptions,
  type InterfaceFontSize,
  type SettingChoice,
  type SettingDefinition,
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

export function AppearanceSettings() {
  const { snapshot, loadError, retry, update } = useSettings()
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [pendingTheme, setPendingTheme] = useState<ThemePreference | null>(null)
  const [pendingLayout, setPendingLayout] = useState<WorkspaceLayout | null>(
    null
  )
  const [pendingFontSize, setPendingFontSize] =
    useState<InterfaceFontSize | null>(null)
  const latestWrites = useRef<Record<string, number>>({})
  const lastRequestedFontSize = useRef<InterfaceFontSize>(
    defaultInterfaceFontSize
  )

  const persistedTheme = settingValue(snapshot, appSettings.theme)
  const persistedLayout = settingValue(snapshot, appSettings.workspaceLayout)
  const persistedFontSize = settingValue(
    snapshot,
    appSettings.interfaceFontSize
  )
  const theme = pendingTheme ?? persistedTheme
  const layout = pendingLayout ?? persistedLayout
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
          <div className="mt-4 flex items-center gap-3">
            <span aria-hidden className="text-xs text-muted-foreground">
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
              className="settings-range min-w-0 flex-1"
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
            <span aria-hidden className="text-lg text-muted-foreground">
              A
            </span>
          </div>
          <div className="mt-1 flex justify-between px-6 font-mono text-tiny text-muted-foreground">
            <span>{minInterfaceFontSize}px</span>
            <span>{defaultInterfaceFontSize}px</span>
            <span>{maxInterfaceFontSize}px</span>
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

function LayoutPreview({ value }: { value: WorkspaceLayout }) {
  return (
    <span aria-hidden className="flex h-20 bg-background">
      {value === "slack" ? (
        <span className="flex w-7 shrink-0 flex-col items-center gap-1.5 border-r border-border bg-sidebar p-1.5">
          <span className="size-3 rounded bg-violet-500" />
          <span className="size-3 rounded bg-blue-500 opacity-60" />
          <span className="size-3 rounded bg-emerald-500 opacity-60" />
        </span>
      ) : null}
      <span
        className={cn(
          "flex shrink-0 flex-col gap-1.5 border-r border-border bg-sidebar p-2",
          value === "slack" ? "w-[42%]" : "w-[38%]"
        )}
      >
        <span className="mb-1 flex items-center gap-1">
          <span className="size-2.5 rounded bg-violet-500" />
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
