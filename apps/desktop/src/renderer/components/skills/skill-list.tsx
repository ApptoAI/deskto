import { useMemo } from "react"
import BoxIcon from "lucide-react/dist/esm/icons/box"
import ChevronRightIcon from "lucide-react/dist/esm/icons/chevron-right"
import CircleAlertIcon from "lucide-react/dist/esm/icons/circle-alert"
import SearchXIcon from "lucide-react/dist/esm/icons/search-x"
import type { SkillInventory } from "@deskto/protocol"

import { cn } from "@workspace/ui/lib/utils"

import { shortHarnessLabel } from "../../lib/harness.js"
import {
  skillCatalogGroupLabels,
  sourceMatchesSkillsFilter,
  type SkillCatalogGroup,
  type SkillCatalogItem,
} from "./skill-catalog.js"
import type { SkillsFilter } from "./skills-filters.js"

export function SkillList({
  inventory,
  items,
  selectedKey,
  filter,
  query,
  onSelect,
}: {
  inventory: SkillInventory
  items: SkillCatalogItem[]
  selectedKey: string | null
  filter: SkillsFilter
  query: string
  onSelect: (item: SkillCatalogItem) => void
}) {
  const groups = useMemo(() => groupCatalogItems(items), [items])
  const sourcesWithIssues = inventory.sources.filter(
    (source) =>
      sourceMatchesSkillsFilter(source, filter) && source.diagnostics.length > 0
  )

  if (items.length === 0) {
    return (
      <div>
        <SourceIssues sources={sourcesWithIssues} />
        <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
          <SearchXIcon className="mb-3 size-5 text-muted-foreground" />
          <p className="text-sm font-medium">
            {query.trim() ? "No matching skills" : "No skills found"}
          </p>
          <p className="mt-1 max-w-64 text-xs leading-relaxed text-muted-foreground">
            {query.trim()
              ? "Try another search or change the filter."
              : "Create a skill, attach a Pack, or add one to an agent folder."}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-10">
      <SourceIssues sources={sourcesWithIssues} />

      {[...groups.entries()].map(([group, groupItems]) => (
        <section key={group} aria-labelledby={`skill-group-${group}`}>
          {/* Sticky so a long folder never scrolls away from the name of the
              folder it belongs to. */}
          <div className="sticky top-0 z-10 flex items-center gap-3 bg-background pt-6 pb-2">
            <h2
              id={`skill-group-${group}`}
              className="eyebrow text-muted-foreground"
            >
              {skillCatalogGroupLabels[group]}
            </h2>
            <span className="font-mono text-micro text-muted-foreground/70 tabular-nums">
              {groupItems.length}
            </span>
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
          </div>
          <ul>
            {groupItems.map((item) => (
              <SkillRow
                key={item.key}
                item={item}
                selected={item.key === selectedKey}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function SkillRow({
  item,
  selected,
  onSelect,
}: {
  item: SkillCatalogItem
  selected: boolean
  onSelect: (item: SkillCatalogItem) => void
}) {
  const harnesses = [
    ...new Set(
      item.occurrences.flatMap(({ source }) =>
        source.harnessIds.map(shortHarnessLabel)
      )
    ),
  ]
  const hasError = item.occurrences.some(({ occurrence }) =>
    occurrence.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  )
  // One quiet tag at the end of the row, because two rows can carry the same
  // name and differ only by the agent that found them — or by being the same
  // skill sitting in two folders.
  const tag =
    item.occurrences.length > 1
      ? `${item.occurrences.length} copies`
      : (harnesses[0] ?? "No agent")

  return (
    <li className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        className={cn(
          "group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected ? "bg-muted/60" : "hover:bg-muted/50 dark:hover:bg-muted/40"
        )}
        onClick={() => onSelect(item)}
        aria-current={selected ? "true" : undefined}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors duration-150 ease-out group-hover:text-foreground dark:bg-muted/70">
          <BoxIcon className="size-3.5" />
        </span>
        {/* Name and description share one line: at this width the description
            still has room to say something, and the row stays scannable. */}
        <span className="w-52 shrink-0 truncate text-sm font-medium">
          {item.name}
        </span>
        <span className="min-w-0 flex-1 truncate text-ui text-muted-foreground">
          {item.description ?? "Description could not be read."}
        </span>
        {/* Trouble sits on the right rail with the other row metadata, so the
            description column keeps one left edge down the whole list. */}
        {hasError ? (
          <span className="shrink-0 text-destructive">
            <CircleAlertIcon aria-hidden="true" className="size-3.5" />
            <span className="sr-only">Needs attention</span>
          </span>
        ) : null}
        <span className="shrink-0 font-mono text-tiny tracking-wide text-muted-foreground/70 uppercase">
          {tag}
        </span>
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground/40 transition-colors duration-150 ease-out group-hover:text-muted-foreground"
        />
      </button>
    </li>
  )
}

function SourceIssues({ sources }: { sources: SkillInventory["sources"] }) {
  if (sources.length === 0) return null

  return (
    <section
      aria-labelledby="skill-source-issues"
      className="mt-4 rounded-lg bg-destructive/5 px-3 py-2 text-xs ring-1 ring-destructive/15"
    >
      <h2
        id="skill-source-issues"
        className="flex items-center gap-2 font-medium text-destructive"
      >
        <CircleAlertIcon aria-hidden="true" className="size-3.5" />
        {sources.length === 1
          ? "One skill folder could not be checked"
          : `${sources.length} skill folders could not be checked`}
      </h2>
      <ul className="mt-1.5 space-y-1 text-muted-foreground">
        {sources.flatMap((source) =>
          source.diagnostics.map((diagnostic) => (
            <li key={`${source.id}:${diagnostic.code}:${diagnostic.path}`}>
              <span className="font-medium text-foreground">
                {source.label}:
              </span>{" "}
              {diagnostic.message}
              <span
                className="mt-0.5 block truncate font-mono text-micro"
                title={diagnostic.path}
              >
                {diagnostic.path}
              </span>
            </li>
          ))
        )}
      </ul>
    </section>
  )
}

function groupCatalogItems(
  items: SkillCatalogItem[]
): Map<SkillCatalogGroup, SkillCatalogItem[]> {
  const groups = new Map<SkillCatalogGroup, SkillCatalogItem[]>()
  for (const item of items) {
    const group = groups.get(item.group)
    if (group) group.push(item)
    else groups.set(item.group, [item])
  }
  return groups
}
