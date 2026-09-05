import { useMemo } from "react"
import BoxIcon from "lucide-react/dist/esm/icons/box"
import ChevronRightIcon from "lucide-react/dist/esm/icons/chevron-right"
import CircleAlertIcon from "lucide-react/dist/esm/icons/circle-alert"
import SearchXIcon from "lucide-react/dist/esm/icons/search-x"
import type { SkillInventory } from "@deskto/protocol"

import { cn } from "@workspace/ui/lib/utils"

import { knownHarnessLabel } from "../../lib/harness.js"
import { HarnessLogo, harnessAccentByHarnessId } from "../brand-logos.js"
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
          <div className="flex items-baseline gap-2 px-2 pt-7 pb-2">
            <h2
              id={`skill-group-${group}`}
              className="text-xs font-medium text-muted-foreground"
            >
              {skillCatalogGroupLabels[group]}
            </h2>
            <span
              className="text-tiny text-muted-foreground tabular-nums"
              aria-label={`${groupItems.length} skills`}
            >
              {groupItems.length}
            </span>
            <span
              aria-hidden="true"
              className="h-px flex-1 self-center bg-border"
            />
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
  const harnessIds = [
    ...new Set(item.occurrences.flatMap(({ source }) => source.harnessIds)),
  ]
  const hasError = item.occurrences.some(({ occurrence }) =>
    occurrence.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  )
  return (
    <li className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        className={cn(
          "group flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected ? "bg-muted/60" : "hover:bg-muted/50 dark:hover:bg-muted/40"
        )}
        onClick={() => onSelect(item)}
        aria-current={selected ? "true" : undefined}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-fill-chip text-muted-foreground transition-colors duration-150 ease-out group-hover:text-foreground">
          <BoxIcon className="size-3.5" />
        </span>
        <span
          className="w-36 shrink-0 truncate text-sm font-medium xl:w-52"
          title={item.name}
        >
          {item.name}
        </span>
        <span
          className="line-clamp-2 min-w-0 flex-1 text-ui leading-5 text-muted-foreground"
          title={item.description ?? "Description could not be read."}
        >
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
        {item.occurrences.every(
          ({ occurrence }) => occurrence.enabled === false
        ) ? (
          <span className="shrink-0 text-tiny text-muted-foreground">
            Disabled
          </span>
        ) : null}
        {item.occurrences.length > 1 ? (
          <span className="shrink-0 text-tiny text-muted-foreground">
            {item.occurrences.length} copies
          </span>
        ) : null}
        {harnessIds.length > 0 ? (
          <span className="flex shrink-0 items-center gap-1.5">
            {harnessIds.map((harnessId) => {
              const label = knownHarnessLabel(harnessId)
              return (
                <span
                  key={harnessId}
                  role="img"
                  aria-label={label}
                  title={label}
                  className={cn(
                    "flex size-5 items-center justify-center",
                    harnessAccentByHarnessId.get(harnessId) ??
                      "text-muted-foreground"
                  )}
                >
                  <HarnessLogo
                    harnessId={harnessId}
                    className="size-3.5"
                    fallback={
                      <span
                        aria-hidden
                        className="flex size-4 items-center justify-center rounded-full border border-current text-[9px] font-semibold uppercase"
                      >
                        {label.slice(0, 1)}
                      </span>
                    }
                  />
                </span>
              )
            })}
          </span>
        ) : (
          <span className="shrink-0 text-tiny text-muted-foreground">
            No agent
          </span>
        )}
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 self-center text-muted-foreground transition-colors duration-150 ease-out group-hover:text-foreground"
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
                className="mt-0.5 block truncate text-micro"
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
