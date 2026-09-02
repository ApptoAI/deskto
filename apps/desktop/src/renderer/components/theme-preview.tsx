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

/* Literal previews of the two palettes: the shell, and the pane inset on it. */
const palettes = {
  light: {
    canvas: "#ffffff",
    chrome: "#f2f1ee",
    border: "#dcdbd8",
    ink: "#202022",
    mute: "#aaa9a5",
  },
  dark: {
    canvas: "#0b0b0c",
    chrome: "#151516",
    border: "#252527",
    ink: "#ececee",
    mute: "#67676c",
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
      style={{ backgroundColor: palette.chrome }}
    >
      <span className="flex h-full w-1/3 shrink-0 flex-col gap-1.5 p-2">
        <Bar color={palette.ink} width="70%" />
        <Bar color={palette.mute} width="90%" />
        <Bar color={palette.mute} width="55%" />
      </span>
      <span
        className="mt-1.5 mr-1.5 mb-1.5 flex h-auto min-w-0 flex-1 flex-col gap-1.5 rounded-[4px] p-2"
        style={{
          backgroundColor: palette.canvas,
          border: `1px solid ${palette.border}`,
        }}
      >
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
