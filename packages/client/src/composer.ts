import type { PackSkill, PromptReference, ProjectEntry } from "@deskto/protocol"

export type ComposerTriggerKind = "project-entry" | "skill" | "command"

export type ComposerTrigger = {
  kind: ComposerTriggerKind
  query: string
  rangeStart: number
  rangeEnd: number
}

type ComposerReplacement = {
  text: string
  cursor: number
}

export type ComposerCandidate =
  | { id: string; kind: "project-entry"; entry: ProjectEntry }
  | { id: string; kind: "skill"; skill: PackSkill }
  | {
      id: string
      kind: "app-command"
      command: "model"
      label: string
      description: string
    }

function clampCursor(text: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return text.length
  return Math.max(0, Math.min(text.length, Math.floor(cursor)))
}

function tokenStart(text: string, cursor: number): number {
  for (let index = cursor - 1; index >= 0; index -= 1) {
    const character = text[index] ?? ""
    if (
      (character === "@" || character === "$" || character === "/") &&
      (index === 0 || isTriggerBoundary(character, text[index - 1] ?? ""))
    ) {
      return index
    }
    if (/\s/.test(character)) break
  }
  return cursor
}

function isTriggerBoundary(marker: string, character: string): boolean {
  return marker === "/"
    ? /\s/.test(character)
    : /[\s()[\]{},;:!?'"]/.test(character)
}

/** Detects the active @, $ or / token at the actual caret position. */
export function detectComposerTrigger(
  text: string,
  cursorInput: number
): ComposerTrigger | null {
  const cursor = clampCursor(text, cursorInput)
  const start = tokenStart(text, cursor)
  const token = text.slice(start, cursor)
  const marker = token[0]
  const kind =
    marker === "@"
      ? "project-entry"
      : marker === "$"
        ? "skill"
        : marker === "/"
          ? "command"
          : null
  if (!kind || token.slice(1).includes(marker!)) return null
  return {
    kind,
    query: token.slice(1),
    rangeStart: start,
    rangeEnd: cursor,
  }
}

export function replaceComposerTrigger(
  text: string,
  trigger: ComposerTrigger,
  replacement: string
): ComposerReplacement {
  const next = `${text.slice(0, trigger.rangeStart)}${replacement}${text.slice(trigger.rangeEnd)}`
  return { text: next, cursor: trigger.rangeStart + replacement.length }
}

export function formatProjectReference(path: string): string {
  const normalized = path.replaceAll("\\", "/")
  return /[\s@"]/.test(normalized)
    ? `@"${normalized.replaceAll('"', '\\"')}"`
    : `@${normalized}`
}

export function formatSkillReference(name: string): string {
  return `$${name.replace(/^\$/, "")}`
}

function tokenForReference(reference: PromptReference): string {
  return reference.kind === "project-entry"
    ? formatProjectReference(reference.path)
    : formatSkillReference(reference.name)
}

function includesStandaloneToken(text: string, token: string): boolean {
  let offset = 0
  while (offset <= text.length - token.length) {
    const index = text.indexOf(token, offset)
    if (index < 0) return false
    const before = index === 0 ? "" : (text[index - 1] ?? "")
    const afterIndex = index + token.length
    const after = afterIndex === text.length ? "" : (text[afterIndex] ?? "")
    if (isTokenBoundary(before) && isTokenBoundary(after)) {
      return true
    }
    offset = index + 1
  }
  return false
}

function isTokenBoundary(character: string): boolean {
  return !character || !/[\p{L}\p{N}_./\\@$-]/u.test(character)
}

/** Text is canonical; sidecars disappear as soon as their token is removed. */
export function reconcilePromptReferences(
  text: string,
  references: PromptReference[]
): PromptReference[] {
  const byToken = new Map<string, PromptReference>()
  for (const reference of references) {
    const token = tokenForReference(reference)
    if (includesStandaloneToken(text, token)) byToken.set(token, reference)
  }
  return [...byToken.values()]
}

export function filterSkills(skills: PackSkill[], query: string): PackSkill[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return skills
  return skills
    .map((skill) => ({
      skill,
      score: skillScore(skill, normalized),
    }))
    .filter((entry) => entry.score !== null)
    .sort(
      (left, right) =>
        left.score! - right.score! ||
        left.skill.name.localeCompare(right.skill.name)
    )
    .map((entry) => entry.skill)
}

function skillScore(skill: PackSkill, query: string): number | null {
  const name = skill.name.toLocaleLowerCase()
  const description = skill.description.toLocaleLowerCase()
  if (name === query) return 0
  if (name.startsWith(query)) return 1
  if (name.includes(query)) return 2
  if (description.includes(query)) return 3
  return fuzzyIncludes(name, query) ? 4 : null
}

function fuzzyIncludes(value: string, query: string): boolean {
  let queryIndex = 0
  for (const character of value) {
    if (character === query[queryIndex]) queryIndex += 1
    if (queryIndex === query.length) return true
  }
  return query.length === 0
}
