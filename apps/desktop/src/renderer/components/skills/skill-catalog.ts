import type {
  SkillInventory,
  SkillOccurrence,
  SkillSource,
} from "@deskto/protocol"

import type { SkillsFilter } from "./skills-filters.js"

export type CatalogOccurrence = {
  occurrence: SkillOccurrence
  source: SkillSource
}

export type SkillCatalogGroup = "personal" | "workspace" | "detected"

export type SkillCatalogItem = {
  key: string
  name: string
  description: string | null
  occurrences: CatalogOccurrence[]
  primary: CatalogOccurrence
  group: SkillCatalogGroup
}

export type SkillCatalogSelection = {
  itemKey: string
  occurrenceId: string
}

const groupOrder: SkillCatalogGroup[] = ["personal", "workspace", "detected"]

export const skillCatalogGroupLabels = {
  personal: "My skills",
  workspace: "From this workspace",
  detected: "Detected on this computer",
} satisfies Record<SkillCatalogGroup, string>

export function buildSkillCatalog(
  inventory: SkillInventory,
  filter: SkillsFilter,
  query: string
): SkillCatalogItem[] {
  const sources = new Map(
    inventory.sources.map((source) => [source.id, source])
  )
  const grouped = new Map<string, CatalogOccurrence[]>()

  for (const occurrence of inventory.occurrences) {
    const source = sources.get(occurrence.sourceId)
    if (!source || !sourceMatchesSkillsFilter(source, filter)) continue

    const displayName = occurrence.name ?? occurrence.directoryName
    const normalizedName = displayName.trim().toLocaleLowerCase()
    const key = occurrence.contentDigest
      ? `copy:${normalizedName}:${occurrence.contentDigest}`
      : `occurrence:${occurrence.id}`
    const existing = grouped.get(key)
    const entry = { occurrence, source }
    if (existing) existing.push(entry)
    else grouped.set(key, [entry])
  }

  const normalizedQuery = query.trim().toLocaleLowerCase()
  return [...grouped.entries()]
    .map(([key, occurrences]) => createCatalogItem(key, occurrences))
    .filter((item) => matchesQuery(item, normalizedQuery))
    .sort(compareCatalogItems)
}

export function resolveSkillCatalogItem(
  items: SkillCatalogItem[],
  selection: SkillCatalogSelection | null
): SkillCatalogItem | null {
  return (
    items.find((item) =>
      item.occurrences.some(
        ({ occurrence }) => occurrence.id === selection?.occurrenceId
      )
    ) ??
    items.find((item) => item.key === selection?.itemKey) ??
    items[0] ??
    null
  )
}

function createCatalogItem(
  key: string,
  occurrences: CatalogOccurrence[]
): SkillCatalogItem {
  const sorted = [...occurrences].sort(compareOccurrences)
  const primary = sorted[0]!
  return {
    key,
    name: primary.occurrence.name ?? primary.occurrence.directoryName,
    description:
      sorted.find(({ occurrence }) => occurrence.description)?.occurrence
        .description ?? null,
    occurrences: sorted,
    primary,
    group: groupForSource(primary.source),
  }
}

export function sourceMatchesSkillsFilter(
  source: SkillSource,
  filter: SkillsFilter
): boolean {
  if (filter === "all") return true
  if (filter === "project") return source.scopes.includes("project")
  if (filter === "workspace") return source.scopes.includes("workspace")
  return (
    source.kind === "native" &&
    source.scopes.some((scope) => scope === "user" || scope === "admin")
  )
}

function matchesQuery(item: SkillCatalogItem, query: string): boolean {
  if (!query) return true
  const searchable = [
    item.name,
    item.description,
    ...item.occurrences.flatMap(({ occurrence, source }) => [
      occurrence.description,
      occurrence.directoryName,
      source.label,
      ...source.harnessIds,
    ]),
  ]
  return searchable.some((value) => value?.toLocaleLowerCase().includes(query))
}

function compareCatalogItems(
  left: SkillCatalogItem,
  right: SkillCatalogItem
): number {
  return (
    groupOrder.indexOf(left.group) - groupOrder.indexOf(right.group) ||
    left.name.localeCompare(right.name)
  )
}

function compareOccurrences(
  left: CatalogOccurrence,
  right: CatalogOccurrence
): number {
  return (
    occurrenceRank(left.occurrence) - occurrenceRank(right.occurrence) ||
    Number(right.source.editable) - Number(left.source.editable) ||
    sourceRank(left.source) - sourceRank(right.source) ||
    left.occurrence.directoryPath.localeCompare(right.occurrence.directoryPath)
  )
}

function occurrenceRank(occurrence: SkillOccurrence): number {
  if (!occurrence.name || !occurrence.description) return 2
  if (
    occurrence.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
    return 1
  }
  return 0
}

function sourceRank(source: SkillSource): number {
  if (source.kind === "pack") return 0
  if (source.scopes.includes("project")) return 1
  if (source.scopes.includes("user")) return 2
  return 3
}

function groupForSource(source: SkillSource): SkillCatalogGroup {
  if (source.editable) return "personal"
  if (source.kind === "pack") return "workspace"
  return "detected"
}
