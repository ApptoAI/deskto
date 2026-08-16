export const skillsTabs = {
  project: {
    label: "For this project",
    description: "Skills found in this project and its workspace packs.",
  },
  computer: {
    label: "On this computer",
    description: "Skills found in the folders used by your installed agents.",
  },
  packs: {
    label: "Packs",
    description: "Skill folders shared by every project in this workspace.",
  },
} as const

export type SkillsTab = keyof typeof skillsTabs

export const skillsTabOrder: SkillsTab[] = ["project", "computer", "packs"]
export const firstSkillsTab: SkillsTab = "project"
