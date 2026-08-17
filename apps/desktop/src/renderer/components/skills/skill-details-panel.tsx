import { useState } from "react"
import BoxIcon from "lucide-react/dist/esm/icons/box"
import CircleAlertIcon from "lucide-react/dist/esm/icons/circle-alert"
import FolderOpenIcon from "lucide-react/dist/esm/icons/folder-open"
import PencilIcon from "lucide-react/dist/esm/icons/pencil"
import type { ManagedSkillDraft, SkillDetails } from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"
import { Markdown } from "@workspace/ui/components/chat/markdown"
import { cn } from "@workspace/ui/lib/utils"

import { InlineError } from "../inline-error.js"
import { openFolder } from "../../lib/desktop.js"
import { knownHarnessLabel } from "../../lib/harness.js"
import type { QueryState } from "../../runtime/use-runtime-query.js"
import type { CatalogOccurrence, SkillCatalogItem } from "./skill-catalog.js"
import {
  emptySkillDraft,
  isCompleteSkillDraft,
  SkillDraftFields,
} from "./skill-draft-fields.js"

export function SkillDetailsPanel({
  item,
  selected,
  state,
  onSelectOccurrence,
  onRetry,
  onUpdateManaged,
}: {
  item: SkillCatalogItem
  selected: CatalogOccurrence
  state: QueryState<SkillDetails>
  onSelectOccurrence: (occurrence: CatalogOccurrence) => void
  onRetry: () => void
  onUpdateManaged: (
    packId: string,
    directoryName: string,
    draft: ManagedSkillDraft
  ) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [draft, setDraft] = useState(emptySkillDraft)
  const details = state.status === "ready" ? state.data : null
  const occurrence = selected.occurrence
  const source = selected.source
  const harnesses = source.harnessIds.map(knownHarnessLabel)
  const status = sourceStatus(source)
  const provisioning = provisioningEntries(source)
  const diagnostics = item.occurrences.flatMap((entry) =>
    entry.occurrence.diagnostics.map((diagnostic) => ({
      occurrence: entry.occurrence,
      diagnostic,
    }))
  )

  function beginEditing() {
    setSaveError(null)
    setDraft({
      name: occurrence.name ?? "",
      description: occurrence.description ?? "",
      instructions: instructionsFromSkillContent(details?.content ?? ""),
    })
    setEditing(true)
  }

  async function save() {
    if (!source.packId) return
    setSaving(true)
    setSaveError(null)
    try {
      await onUpdateManaged(source.packId, occurrence.directoryName, draft)
      setEditing(false)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-6 lg:px-8">
      <header className="flex items-start gap-4 border-b border-border pb-6">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted">
          <BoxIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-heading text-xl font-medium tracking-tight">
                {item.name}
              </h1>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {occurrence.description ??
                  item.description ??
                  "Description could not be read."}
              </p>
            </div>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium",
                status.tone === "destructive"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {status.label}
            </span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {harnesses.length > 0
              ? `${harnesses.join(" · ")} · ${availabilityText(source)}`
              : availabilityText(source)}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-border py-4">
        {source.editable && state.status === "ready" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={editing}
            onClick={beginEditing}
          >
            <PencilIcon data-icon="inline-start" />
            Edit skill
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void openFolder(occurrence.directoryPath)}
        >
          <FolderOpenIcon data-icon="inline-start" />
          Open folder
        </Button>
      </div>

      {editing ? (
        <section className="mt-5 space-y-3 rounded-xl border border-border p-4">
          <SkillDraftFields
            idPrefix="edit-skill"
            draft={draft}
            onChange={setDraft}
          />
          {saveError ? <InlineError message={saveError} /> : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving || !isCompleteSkillDraft(draft)}
              onClick={() => void save()}
            >
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </section>
      ) : null}

      <dl className="mt-5 grid gap-3 rounded-xl bg-muted/40 p-4 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="mt-1 font-medium">{source.label}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Scope</dt>
          <dd className="mt-1 font-medium">
            {source.scopes.map(scopeLabel).join(", ")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Contents</dt>
          <dd className="mt-1 font-medium">{contentsLabel(occurrence)}</dd>
        </div>
      </dl>

      {source.kind === "pack" ? (
        <section className="mt-6" aria-labelledby="skill-provisioning-heading">
          <h2 id="skill-provisioning-heading" className="text-sm font-medium">
            Latest agent configuration
          </h2>
          {provisioning.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No agent configuration has been recorded for this Pack in the
              current context.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {provisioning.map(({ harnessId, report }) => (
                <li
                  key={harnessId}
                  className={cn(
                    "rounded-lg border p-3 text-sm",
                    report?.status === "failed"
                      ? "border-destructive/20 bg-destructive/5"
                      : "border-border"
                  )}
                >
                  <p className="font-medium">
                    {report
                      ? provisioningLabel(report.harnessId, report.status)
                      : `${knownHarnessLabel(harnessId)} has not received this Pack yet`}
                  </p>
                  {report?.message ? (
                    <p className="mt-1 text-muted-foreground">
                      {report.message}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {item.occurrences.length > 1 ? (
        <section className="mt-6" aria-labelledby="skill-locations-heading">
          <div className="flex items-center gap-2">
            <h2 id="skill-locations-heading" className="text-sm font-medium">
              Copies found
            </h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {item.occurrences.length}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            These folders contain matching copies of this skill. Select a copy
            to inspect its instructions and availability.
          </p>
          <ul className="mt-3 space-y-2">
            {item.occurrences.map((entry) => {
              const active = entry.occurrence.id === occurrence.id
              return (
                <li
                  key={entry.occurrence.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border px-3 py-2.5",
                    active ? "border-ring bg-muted/50" : "border-border"
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onSelectOccurrence(entry)}
                  >
                    <span className="block text-xs font-medium">
                      {entry.source.label}
                    </span>
                    <span
                      className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground"
                      title={entry.occurrence.directoryPath}
                    >
                      {entry.occurrence.directoryPath}
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {copyAvailabilityText(entry)}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      void openFolder(entry.occurrence.directoryPath)
                    }
                  >
                    Open
                  </Button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : (
        <section className="mt-6" aria-labelledby="skill-location-heading">
          <h2 id="skill-location-heading" className="text-sm font-medium">
            Location
          </h2>
          <p
            className="mt-2 truncate rounded-lg border border-border px-3 py-2.5 font-mono text-xs text-muted-foreground"
            title={occurrence.directoryPath}
          >
            {occurrence.directoryPath}
          </p>
        </section>
      )}

      {diagnostics.length > 0 ? (
        <section className="mt-6" aria-labelledby="skill-diagnostics-heading">
          <h2
            id="skill-diagnostics-heading"
            className="flex items-center gap-2 text-sm font-medium text-destructive"
          >
            <CircleAlertIcon className="size-4" />
            Needs attention
          </h2>
          <ul className="mt-2 space-y-2">
            {diagnostics.map(({ occurrence: itemOccurrence, diagnostic }) => (
              <li
                key={`${itemOccurrence.id}:${diagnostic.code}:${diagnostic.path}`}
                className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm"
              >
                {diagnostic.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-7" aria-labelledby="skill-instructions-heading">
        <h2 id="skill-instructions-heading" className="eyebrow">
          Instructions
        </h2>
        {state.status === "error" ? (
          <div className="mt-3 space-y-3">
            <InlineError message={state.message} />
            <Button type="button" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : state.status === "loading" || state.status === "idle" ? (
          <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Reading instructions...
          </p>
        ) : details?.content ? (
          <Markdown className="mt-3 rounded-xl border border-border p-5">
            {instructionsFromSkillContent(details.content)}
          </Markdown>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Instructions could not be read.
          </p>
        )}
      </section>
    </article>
  )
}

function availabilityText(source: CatalogOccurrence["source"]): string {
  if (source.kind === "pack") return "attached to this workspace"
  if (source.scopes.includes("project")) return "available in this project"
  return "available in every project"
}

type SourceStatus = {
  label: string
  tone: "default" | "destructive"
}

function sourceStatus(source: CatalogOccurrence["source"]): SourceStatus {
  if (source.kind === "native") {
    return { label: "Detected", tone: "default" }
  }
  if (source.provisioning.length === 0) {
    return { label: "Not provided yet", tone: "default" }
  }
  if (source.provisioning.some(({ status }) => status === "failed")) {
    return { label: "Delivery failed", tone: "destructive" }
  }
  const reportedHarnesses = new Set(
    source.provisioning.map(({ harnessId }) => harnessId)
  )
  if (
    source.harnessIds.some((harnessId) => !reportedHarnesses.has(harnessId))
  ) {
    return { label: "Partially configured", tone: "default" }
  }
  if (source.provisioning.every(({ status }) => status === "configured")) {
    return { label: "Configured", tone: "default" }
  }
  if (source.provisioning.every(({ status }) => status === "unsupported")) {
    return { label: "Unsupported", tone: "default" }
  }
  return { label: "Partially configured", tone: "default" }
}

function provisioningEntries(source: CatalogOccurrence["source"]): Array<{
  harnessId: string
  report: CatalogOccurrence["source"]["provisioning"][number] | undefined
}> {
  const harnessIds = [
    ...new Set([
      ...source.harnessIds,
      ...source.provisioning.map(({ harnessId }) => harnessId),
    ]),
  ]
  return harnessIds.map((harnessId) => ({
    harnessId,
    report: source.provisioning.find(
      (candidate) => candidate.harnessId === harnessId
    ),
  }))
}

function provisioningLabel(
  harnessId: string,
  status: "configured" | "unsupported" | "failed"
): string {
  const harness = knownHarnessLabel(harnessId)
  if (status === "configured") return `Configured for ${harness}`
  if (status === "unsupported") return `${harness} version is unsupported`
  return `Could not provide this Pack to ${harness}`
}

function copyAvailabilityText(entry: CatalogOccurrence): string {
  const harnesses = entry.source.harnessIds.map(knownHarnessLabel)
  const harnessText = harnesses.length > 0 ? harnesses.join(" · ") : "No agent"
  return `${harnessText} · ${availabilityText(entry.source)}`
}

function scopeLabel(scope: CatalogOccurrence["source"]["scopes"][number]) {
  if (scope === "project") return "Project"
  if (scope === "workspace") return "Workspace"
  if (scope === "admin") return "Administrator"
  return "Personal"
}

function contentsLabel(occurrence: CatalogOccurrence["occurrence"]): string {
  const extras = [
    occurrence.hasScripts ? "scripts" : null,
    occurrence.hasReferences ? "references" : null,
    occurrence.hasAssets ? "assets" : null,
  ].filter((value): value is string => value !== null)
  return extras.length > 0
    ? `Instructions, ${extras.join(", ")}`
    : "Instructions"
}

export function instructionsFromSkillContent(content: string): string {
  return content
    .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\r?\n?/, "")
    .trim()
}
