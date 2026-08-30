import { cn } from "@workspace/ui/lib/utils"

/** Theme swatches use literal colours so each one keeps its own palette. */
export function ThemePreview({ value }: { value: string }) {
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

/*
 * Sampled from the running app rather than derived, because every surface in
 * the real thing is translucent glass over a wallpaper and there is no single
 * declared colour to quote. These are what that composite actually resolves
 * to: canvas is the window sheet, chrome is the sidebar recessed under it.
 * Re-sample if the glass or wallpaper tokens move.
 */
const palettes = {
  light: {
    canvas: "#eeeef4",
    chrome: "#e7e7ea",
    border: "#d7d7dd",
    ink: "#29292d",
    mute: "#b6b6bf",
  },
  dark: {
    canvas: "#161618",
    chrome: "#0b0b0d",
    border: "#2a2a2e",
    ink: "#e8e8ea",
    mute: "#45454b",
  },
} as const

export function PreviewPane({
  dark,
  className,
}: {
  dark?: boolean
  className?: string
}) {
  const palette = dark ? palettes.dark : palettes.light
  return (
    <span
      aria-hidden
      className={cn("flex h-20 w-full", className)}
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
