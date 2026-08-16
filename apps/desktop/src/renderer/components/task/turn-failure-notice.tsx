import GaugeIcon from "lucide-react/dist/esm/icons/gauge"
import type { HarnessFailure } from "@openappto/protocol"

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
      <p role="alert" className="text-sm text-destructive">
        {failure.message}
      </p>
    )
  }

  const reset = failure.resetAt ? formatReset(failure.resetAt) : undefined
  const messageMentionsReset = /\breset/i.test(failure.message)

  return (
    <div
      role="alert"
      className="flex gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-3 text-amber-950 dark:text-amber-100"
    >
      <GaugeIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">Usage limit reached</p>
        <p className="text-sm text-current/75">{failure.message}</p>
        {reset && !messageMentionsReset ? (
          <p className="text-xs text-current/65 tabular-nums">
            Available again at {reset}
          </p>
        ) : null}
      </div>
    </div>
  )
}
