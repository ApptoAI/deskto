import { useMemo } from "react"
import ChevronRightIcon from "lucide-react/dist/esm/icons/chevron-right"
import CircleAlertIcon from "lucide-react/dist/esm/icons/circle-alert"
import type {
  SkillInventory,
  SkillOccurrence,
  SkillSource,
} from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

export function skillNameCounts(
  occurrences: SkillOccurrence[]
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const occurrence of occurrences) {
    if (!occurrence.name) continue
    counts.set(occurrence.name, (counts.get(occurrence.name) ?? 0) + 1)
  }
  return counts
}

export function SkillList({
  inventory,
  onSelect,
}: {
  inventory: SkillInventory
  onSelect: (occurrence: SkillOccurrence) => void
}) {
  const sources = useMemo(
    () => new Map(inventory.sources.map((source) => [source.id, source])),
    [inventory.sources]
  )
  const nameCounts = useMemo(
    () => skillNameCounts(inventory.occurrences),
    [inventory.occurrences]
  )
  const sourceDiagnostics = inventory.sources.flatMap((source) =>
    source.diagnostics.map((diagnostic) => ({ source, diagnostic }))
  )

  return (
    <div className="space-y-4">
      {sourceDiagnostics.length > 0 ? (
        <section
          aria-labelledby="skill-source-issues"
          className="rounded-xl border border-destructive/20 bg-destructive/5 p-4"
        >
          <h2
            id="skill-source-issues"
            className="flex items-center gap-2 text-sm font-medium text-destructive"
          >
            <CircleAlertIcon className="size-4" />
            Some skill folders could not be checked
          </h2>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {sourceDiagnostics.map(({ source, diagnostic }) => (
              <li key={`${source.id}:${diagnostic.code}:${diagnostic.path}`}>
                {source.label}: {diagnostic.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {inventory.occurrences.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <h2 className="font-heading text-base font-medium">
            No skills found
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a skill folder or attach a Pack, then refresh this list.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {inventory.occurrences.map((occurrence) => {
            const source = sources.get(occurrence.sourceId)
            const duplicateCount = occurrence.name
              ? (nameCounts.get(occurrence.name) ?? 1)
              : 1
            return (
              <SkillRow
                key={occurrence.id}
                occurrence={occurrence}
                source={source}
                duplicateCount={duplicateCount}
                onSelect={onSelect}
              />
            )
          })}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Checked {new Date(inventory.scannedAt).toLocaleString()}.
      </p>
    </div>
  )
}

function SkillRow({
  occurrence,
  source,
  duplicateCount,
  onSelect,
}: {
  occurrence: SkillOccurrence
  source: SkillSource | undefined
  duplicateCount: number
  onSelect: (occurrence: SkillOccurrence) => void
}) {
  const hasError = occurrence.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error"
  )
  const hasWarning = occurrence.diagnostics.some(
    (diagnostic) => diagnostic.severity === "warning"
  )
  const name = occurrence.name ?? occurrence.directoryName

  return (
    <li>
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-start rounded-none px-4 py-3 text-left font-normal"
        onClick={() => onSelect(occurrence)}
        aria-label={`View ${name}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-foreground">{name}</span>
            <SkillStatus hasError={hasError} hasWarning={hasWarning} />
            {duplicateCount > 1 ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {duplicateCount} copies found
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {occurrence.description ?? "Description could not be read."}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{source?.label ?? "Unknown source"}</span>
            {source && source.harnessIds.length > 0 ? (
              <span>{source.harnessIds.map(harnessLabel).join(", ")}</span>
            ) : null}
            {source?.kind === "pack" && source.provisioning.length === 0 ? (
              <span>Not provided in this project yet</span>
            ) : null}
            {source?.provisioning.map((report) => (
              <span key={`${report.harnessId}:${report.turnId}`}>
                {provisioningLabel(report.harnessId, report.status)}
              </span>
            ))}
            {occurrence.hasScripts ? <span>Scripts</span> : null}
            {occurrence.hasReferences ? <span>References</span> : null}
            {occurrence.hasAssets ? <span>Assets</span> : null}
          </div>
        </div>
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </Button>
    </li>
  )
}

function SkillStatus({
  hasError,
  hasWarning,
}: {
  hasError: boolean
  hasWarning: boolean
}) {
  const label = hasError
    ? "Needs attention"
    : hasWarning
      ? "Check details"
      : "Found"
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px]",
        hasError
          ? "bg-destructive/10 text-destructive"
          : hasWarning
            ? "bg-muted text-foreground"
            : "bg-muted text-muted-foreground"
      )}
    >
      {label}
    </span>
  )
}

function harnessLabel(id: string): string {
  if (id === "codex") return "Codex"
  if (id === "claude") return "Claude Code"
  return id
}

function provisioningLabel(
  harnessId: string,
  status: "configured" | "unsupported" | "failed"
): string {
  const harness = harnessLabel(harnessId)
  if (status === "configured") return `Provided to ${harness}`
  if (status === "unsupported") return `${harness} version not supported`
  return `Could not provide to ${harness}`
}
