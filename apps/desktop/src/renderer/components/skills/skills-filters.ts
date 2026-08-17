export const skillsFilters = {
  all: {
    label: "All skills",
    description: "Every skill available in the current context.",
  },
  project: {
    label: "This project",
    description: "Skills stored in this project.",
  },
  workspace: {
    label: "This workspace",
    description: "Skills supplied by Packs attached to this workspace.",
  },
  computer: {
    label: "On this computer",
    description: "Personal and administrator skills found by your agents.",
  },
} as const

export type SkillsFilter = keyof typeof skillsFilters

export const skillsFilterOrder: SkillsFilter[] = [
  "all",
  "project",
  "workspace",
  "computer",
]

export const firstSkillsFilter: SkillsFilter = "all"

export function isSkillsFilter(value: string): value is SkillsFilter {
  return Object.hasOwn(skillsFilters, value)
}
