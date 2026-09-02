import CircleAlertIcon from "lucide-react/dist/esm/icons/circle-alert"
import GaugeIcon from "lucide-react/dist/esm/icons/gauge"
import type { HarnessFailure } from "@deskto/protocol"

function formatReset(resetAt: string): string | undefined {
  const date = new Date(resetAt)
  if (Number.isNaN(date.valueOf())) return undefined
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }
  if (!sameDay) {
    options.weekday = "short"
    options.month = "short"
    options.day = "numeric"
    if (date.getFullYear() !== now.getFullYear()) options.year = "numeric"
  }
  return new Intl.DateTimeFormat(undefined, options).format(date)
}

export function TurnFailureNotice({ failure }: { failure: HarnessFailure }) {
  if (failure.kind !== "usage-limit") {
    return (
      <p role="alert" className="flex gap-2 text-sm text-destructive">
        {/* The mark says "stopped" on its own; the colour only agrees with it. */}
        <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 break-words">{failure.message}</span>
      </p>
    )
  }

  const reset = failure.resetAt ? formatReset(failure.resetAt) : undefined
  const messageMentionsReset = /\breset/i.test(failure.message)

  return (
    <div
      role="alert"
      className="flex gap-3 rounded-card border border-edge-strong bg-fill-card px-3.5 py-3 text-foreground"
    >
      <GaugeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">Usage limit reached</p>
        <p className="text-sm text-current/75">{failure.message}</p>
        {reset && !messageMentionsReset ? (
          <p className="text-xs text-current/65">
            Available again at{" "}
            <span className="font-mono tracking-normal tabular-nums">{reset}</span>
          </p>
        ) : null}
      </div>
    </div>
  )
}
