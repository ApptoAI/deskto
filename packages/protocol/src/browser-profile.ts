import { z } from "zod"

/**
 * One Workspace owns one browser profile: the cookies, storage and logins
 * the built-in task browser accumulates. The partition name is the only
 * link between the two, so both sides derive it here and nowhere else.
 */
const browserProfilePartitionPrefix = "persist:workspace-"

export function browserProfilePartition(workspaceId: string): string {
  return `${browserProfilePartitionPrefix}${workspaceId}`
}

export function isBrowserProfilePartition(value: string): boolean {
  return (
    value.startsWith(browserProfilePartitionPrefix) &&
    value.length > browserProfilePartitionPrefix.length
  )
}

export function workspaceIdFromBrowserProfilePartition(
  partition: string
): string | undefined {
  if (!isBrowserProfilePartition(partition)) return undefined
  return partition.slice(browserProfilePartitionPrefix.length)
}

export const browserProfileSchema = z.object({
  workspaceId: z.string().min(1),
  workspaceName: z.string(),
  /** Bytes the profile occupies on disk; zero before the browser first
      opens in this Workspace. */
  sizeBytes: z.number().int().nonnegative(),
  /** Newest write inside the profile, or null when nothing exists yet. */
  lastUsedAt: z.string().nullable(),
})

export type BrowserProfile = z.infer<typeof browserProfileSchema>

export const browserProfileClearResultSchema = z.object({
  workspaceId: z.string().min(1),
  clearedBytes: z.number().int().nonnegative(),
})

export type BrowserProfileClearResult = z.infer<
  typeof browserProfileClearResultSchema
>

/** A profile folder exists only once the browser has opened in that
    Workspace; before that there is nothing to open or to clear. */
export function hasBrowserProfileData(profile: BrowserProfile): boolean {
  return profile.sizeBytes > 0
}
