import { useCallback, useMemo } from "react"
import type { RuntimeClient } from "@deskto/client"

import { useDebouncedCallback } from "../lib/use-debounced-callback.js"
import { useRuntimeQuery } from "../runtime/use-runtime-query.js"
import { useThreadChanged } from "../runtime/use-thread-changed.js"

/**
 * Loads the sidebar's task lists for whichever scope is on screen and keeps
 * them fresh on thread.changed. `revalidateThreads` refetches now;
 * `revalidateThreadsSoon` collapses the event bursts a running task emits
 * into one trailing refetch.
 */
export function useThreadQueries(
  client: RuntimeClient,
  {
    projectId,
    workspaceProjectIds,
    allProjects,
  }: {
    projectId: string | null
    workspaceProjectIds: string[]
    allProjects: boolean
  }
) {
  // Gated on the visible scope: in all-projects mode this query's result is
  // never rendered, and every thread.changed would refetch it for nothing.
  const loadThreads = useMemo(
    () =>
      projectId && !allProjects ? () => client.listThreads(projectId) : null,
    [client, projectId, allProjects]
  )
  const threads = useRuntimeQuery(loadThreads)

  // The all-projects view loads every project's threads together; the joined
  // key keeps the loader stable while the workspace's projects stay the same.
  const workspaceProjectIdsKey = workspaceProjectIds.join("\n")
  const loadWorkspaceThreads = useMemo(() => {
    if (!allProjects || workspaceProjectIdsKey === "") return null
    const ids = workspaceProjectIdsKey.split("\n")
    return async () => {
      const lists = await Promise.all(ids.map((id) => client.listThreads(id)))
      return Object.fromEntries(
        ids.map((id, index) => [id, lists[index]!] as const)
      )
    }
  }, [client, allProjects, workspaceProjectIdsKey])
  const workspaceThreads = useRuntimeQuery(loadWorkspaceThreads)

  // Only the active scope's query has a loader; the other revalidate is a
  // no-op, so this refreshes exactly the list on screen.
  const revalidateProjectThreads = threads.revalidate
  const revalidateWorkspaceThreads = workspaceThreads.revalidate
  const revalidateThreads = useCallback(() => {
    revalidateProjectThreads()
    revalidateWorkspaceThreads()
  }, [revalidateProjectThreads, revalidateWorkspaceThreads])

  const revalidateThreadsSoon = useDebouncedCallback(revalidateThreads, 100)
  useThreadChanged(revalidateThreadsSoon)

  return { threads, workspaceThreads, revalidateThreads, revalidateThreadsSoon }
}
