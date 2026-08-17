import { useMemo } from "react"
import BoxIcon from "lucide-react/dist/esm/icons/box"
import CircleAlertIcon from "lucide-react/dist/esm/icons/circle-alert"
import SearchXIcon from "lucide-react/dist/esm/icons/search-x"
import type { SkillInventory } from "@deskto/protocol"

import { cn } from "@workspace/ui/lib/utils"

import { knownHarnessLabel } from "../../lib/harness.js"
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
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <SearchXIcon className="mb-3 size-5 text-muted-foreground" />
          <p className="text-sm font-medium">
            {query.trim() ? "No matching skills" : "No skills found"}
          </p>
          <p className="mt-1 max-w-56 text-xs leading-relaxed text-muted-foreground">
            {query.trim()
              ? "Try another search or change the filter."
              : "Create a skill, attach a Pack, or add one to an agent folder."}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col pb-3">
      <SourceIssues sources={sourcesWithIssues} />

      {[...groups.entries()].map(([group, groupItems]) => (
        <section key={group} aria-labelledby={`skill-group-${group}`}>
          <div className="flex items-center justify-between px-4 pt-4 pb-1.5">
            <h2 id={`skill-group-${group}`} className="eyebrow">
              {skillCatalogGroupLabels[group]}
            </h2>
            <span className="font-mono text-[11px] text-muted-foreground">
              {groupItems.length}
            </span>
          </div>
          <ul className="space-y-0.5 px-2">
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
        source.harnessIds.map(knownHarnessLabel)
      )
    ),
  ]
  const hasError = item.occurrences.some(({ occurrence }) =>
    occurrence.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  )

  return (
    <li>
      <button
        type="button"
        className={cn(
          "group flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected ? "bg-accent text-accent-foreground" : "hover:bg-muted/70"
        )}
        onClick={() => onSelect(item)}
        aria-current={selected ? "true" : undefined}
      >
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
            selected ? "bg-background/70" : "bg-muted"
          )}
        >
          <BoxIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{item.name}</span>
            {hasError ? (
              <span className="shrink-0 text-destructive">
                <CircleAlertIcon aria-hidden="true" className="size-3.5" />
                <span className="sr-only">Needs attention</span>
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {item.description ?? "Description could not be read."}
          </span>
          <span className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">
              {harnesses.length > 0 ? harnesses.join(" · ") : "No agent"}
            </span>
            {item.occurrences.length > 1 ? (
              <span className="shrink-0 rounded-full bg-background/60 px-1.5 py-0.5">
                {item.occurrences.length} copies
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  )
}

function SourceIssues({ sources }: { sources: SkillInventory["sources"] }) {
  if (sources.length === 0) return null

  return (
    <section
      aria-labelledby="skill-source-issues"
      className="mx-3 mt-3 rounded-lg bg-destructive/5 px-3 py-2 text-xs ring-1 ring-destructive/15"
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
                className="mt-0.5 block truncate font-mono text-[11px]"
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
