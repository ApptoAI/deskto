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
    <article className="min-h-0 w-full flex-1 overflow-y-auto overscroll-contain px-6 py-6">
      <header>
        <div className="flex items-start gap-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
            <BoxIcon className="size-[1.125rem]" />
          </span>
          {/* Right padding clears the sheet's close button, which sits over
              this row. */}
          <div className="min-w-0 flex-1 pt-0.5 pr-9">
            <div className="flex min-w-0 items-center gap-2.5">
              <h1 className="truncate font-heading text-lg leading-6 font-medium tracking-tight">
                {item.name}
              </h1>
              <StatusChip status={status} />
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {harnesses.length > 0
                ? `${harnesses.join(" · ")} · ${availabilityText(source)}`
                : availabilityText(source)}
            </p>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-body">
          {occurrence.description ??
            item.description ??
            "Description could not be read."}
        </p>
      </header>

      <div className="flex flex-wrap gap-2 pt-5 pb-6">
        {source.editable && source.packId && state.status === "ready" ? (
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
        <section
          className="mb-6 space-y-3 rounded-xl border border-border p-4"
          aria-label="Edit skill"
        >
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

      {/* One hairline table rather than a grey well plus a boxed path: the
          reader is scanning label-to-value, and rules carry that better than
          a fill does. */}
      <dl className="border-t border-border">
        <MetaRow label="Source" value={source.label} />
        <MetaRow
          label="Scope"
          value={source.scopes.map(scopeLabel).join(", ")}
        />
        <MetaRow label="Contents" value={contentsLabel(occurrence)} />
        {item.occurrences.length === 1 ? (
          <MetaRow
            label="Location"
            value={occurrence.directoryPath}
            title={occurrence.directoryPath}
            mono
          />
        ) : null}
      </dl>

      {source.kind === "pack" ? (
        <section className="mt-7" aria-labelledby="skill-provisioning-heading">
          <h2 id="skill-provisioning-heading" className="text-sm font-medium">
            Latest agent configuration
          </h2>
          {provisioning.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No agent configuration has been recorded for this Pack in the
              current context.
            </p>
          ) : (
            <ul className="mt-3 overflow-hidden rounded-lg border border-border">
              {provisioning.map(({ harnessId, report }) => (
                <li
                  key={harnessId}
                  className={cn(
                    "flex gap-2.5 border-b border-border px-3 py-2.5 text-ui last:border-b-0",
                    report?.status === "failed" ? "bg-destructive/5" : null
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-[0.4rem] size-1.5 shrink-0 rounded-full",
                      report?.status === "failed"
                        ? "bg-destructive"
                        : report?.status === "configured"
                          ? "bg-foreground"
                          : "bg-muted-foreground/40"
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {report
                        ? provisioningLabel(report.harnessId, report.status)
                        : `${knownHarnessLabel(harnessId)} has not received this Pack yet`}
                    </span>
                    {report?.message ? (
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {report.message}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {item.occurrences.length > 1 ? (
        <section className="mt-7" aria-labelledby="skill-locations-heading">
          <div className="flex items-center gap-2">
            <h2 id="skill-locations-heading" className="text-sm font-medium">
              Copies found
            </h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-micro text-muted-foreground">
              {item.occurrences.length}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            These folders contain matching copies of this skill. Select a copy
            to inspect its instructions and availability.
          </p>
          <ul className="mt-3 overflow-hidden rounded-lg border border-border">
            {item.occurrences.map((entry) => {
              const active = entry.occurrence.id === occurrence.id
              return (
                <li
                  key={entry.occurrence.id}
                  className={cn(
                    "flex items-center gap-3 border-b border-border px-3 py-2.5 transition-colors duration-150 ease-out last:border-b-0",
                    active ? "bg-muted/60" : "hover:bg-muted/30"
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onSelectOccurrence(entry)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-xs font-medium">
                        {entry.source.label}
                      </span>
                      {active ? (
                        <span className="shrink-0 text-tiny font-medium tracking-wide text-muted-foreground uppercase">
                          Shown
                        </span>
                      ) : null}
                    </span>
                    <span
                      className="mt-0.5 block truncate font-mono text-micro text-muted-foreground"
                      title={entry.occurrence.directoryPath}
                    >
                      {entry.occurrence.directoryPath}
                    </span>
                    <span className="mt-1 block truncate text-micro text-muted-foreground">
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
      ) : null}

      {diagnostics.length > 0 ? (
        <section className="mt-7" aria-labelledby="skill-diagnostics-heading">
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

      {/* The instructions are the longest thing on the page, so they are set
          as the document they are — named by an eyebrow and a rule, then read
          flush, rather than boxed inside a card the reader scrolls through. */}
      <section className="mt-9" aria-labelledby="skill-instructions-heading">
        <h2
          id="skill-instructions-heading"
          className="border-b border-border pb-2 eyebrow text-muted-foreground"
        >
          SKILL.md
        </h2>
        {state.status === "error" ? (
          <div className="mt-4 space-y-3">
            <InlineError message={state.message} />
            <Button type="button" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : state.status === "loading" || state.status === "idle" ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Reading instructions...
          </p>
        ) : details?.content ? (
          <Markdown className="pt-5">
            {instructionsFromSkillContent(details.content)}
          </Markdown>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Instructions could not be read.
          </p>
        )}
      </section>
    </article>
  )
}

/** Label left, value right, one hairline under each — the whole metadata block. */
function MetaRow({
  label,
  value,
  title,
  mono = false,
}: {
  label: string
  value: string
  title?: string
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline gap-4 border-b border-border py-2.5">
      <dt className="w-24 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 flex-1 truncate",
          mono ? "font-mono text-xs text-body" : "text-ui"
        )}
        title={title}
      >
        {value}
      </dd>
    </div>
  )
}

/** A dot carries the state; the pill stays quiet so the name keeps the weight. */
function StatusChip({ status }: { status: SourceStatus }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-micro leading-none",
        status.tone === "destructive"
          ? "border-destructive/25 bg-destructive/5 text-destructive"
          : "border-border text-muted-foreground"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          status.tone === "destructive"
            ? "bg-destructive"
            : status.tone === "positive"
              ? "bg-foreground"
              : "bg-muted-foreground/40"
        )}
      />
      {status.label}
    </span>
  )
}

function availabilityText(source: CatalogOccurrence["source"]): string {
  if (source.kind === "pack") return "attached to this workspace"
  if (source.scopes.includes("project")) return "available in this project"
  return "available in every project"
}

type SourceStatus = {
  label: string
  tone: "positive" | "neutral" | "destructive"
}

function sourceStatus(source: CatalogOccurrence["source"]): SourceStatus {
  if (source.kind === "native") {
    return { label: "Detected", tone: "positive" }
  }
  if (source.provisioning.length === 0) {
    return { label: "Not provided yet", tone: "neutral" }
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
    return { label: "Partially configured", tone: "neutral" }
  }
  if (source.provisioning.every(({ status }) => status === "configured")) {
    return { label: "Configured", tone: "positive" }
  }
  if (source.provisioning.every(({ status }) => status === "unsupported")) {
    return { label: "Unsupported", tone: "neutral" }
  }
  return { label: "Partially configured", tone: "neutral" }
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
