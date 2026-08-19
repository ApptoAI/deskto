import { useCallback, useEffect, useMemo, useRef } from "react"
import type { RuntimeClient } from "@deskto/client"
import { mySkillsPackName, type ManagedSkillDraft } from "@deskto/protocol"

import type { PackActions } from "../components/skills/packs-panel.js"
import { pickPackArchive, pickPackFolder } from "../lib/desktop.js"
import { usePackChanged } from "../runtime/use-pack-changed.js"
import { useRuntimeQuery } from "../runtime/use-runtime-query.js"

export type WorkbenchPackActions = PackActions & {
  onCreateSkill: (draft: ManagedSkillDraft) => Promise<void>
}

/**
 * Loads the Pack list while Skills is open and bundles the Pack mutations.
 * A Pack created, installed, or linked here is meant for the active Workspace,
 * so it attaches right away.
 */
export function usePackActions(
  client: RuntimeClient,
  {
    skillsOpen,
    activeWorkspaceId,
    tryAction,
  }: {
    skillsOpen: boolean
    activeWorkspaceId: string | null
    tryAction: <T>(action: () => Promise<T>) => Promise<T>
  }
) {
  // Pack scans stand down outside Skills. The library needs them for its
  // source manager and for creating skills in the managed My Skills Pack.
  const loadPacks = useMemo(
    () => (skillsOpen ? () => client.listPacks() : null),
    [client, skillsOpen]
  )
  const packsQuery = useRuntimeQuery(loadPacks)

  // Mutation responses stay slim; this event is the one refetch trigger.
  const revalidatePacks = packsQuery.revalidate
  usePackChanged(useCallback(() => revalidatePacks(), [revalidatePacks]))

  // onCreateSkill reads the newest scan through this ref, so the actions
  // object keeps one identity while pack loads come and go.
  const packsState = useRef(packsQuery.state)
  useEffect(() => {
    packsState.current = packsQuery.state
  })

  const packActions: WorkbenchPackActions = useMemo(() => {
    // The create/install/link handlers share one shape: acquire a Pack, then
    // attach it. `acquire` resolves null when the user cancels a picker.
    const acquireAndAttach = (acquire: () => Promise<{ id: string } | null>) =>
      tryAction(async () => {
        if (!activeWorkspaceId) return
        const pack = await acquire()
        if (!pack) return
        await client.setWorkspacePack(activeWorkspaceId, pack.id, true)
      })

    return {
      onToggle: (packId, attached) =>
        tryAction(async () => {
          if (!activeWorkspaceId) return
          await client.setWorkspacePack(activeWorkspaceId, packId, attached)
        }),
      onCreate: (name) => acquireAndAttach(() => client.createPack(name)),
      onInstallFolder: () =>
        acquireAndAttach(async () => {
          const picked = await pickPackFolder()
          return picked ? client.installPackFromFolder(picked.path) : null
        }),
      onInstallZip: () =>
        acquireAndAttach(async () => {
          const picked = await pickPackArchive()
          return picked ? client.installPackFromZip(picked.path) : null
        }),
      onLink: () =>
        acquireAndAttach(async () => {
          const picked = await pickPackFolder()
          return picked ? client.linkPack(picked.path) : null
        }),
      onUnlink: (packId) =>
        tryAction(async () => {
          await client.unlinkPack(packId)
        }),
      onUninstall: (packId) =>
        tryAction(async () => {
          await client.uninstallPack(packId)
        }),
      onCreateSkill: (draft) =>
        tryAction(async () => {
          if (!activeWorkspaceId) return
          const scanned = packsState.current
          const currentPacks =
            scanned.status === "ready" ? scanned.data : await client.listPacks()
          const mySkills =
            currentPacks.find(
              (pack) => pack.canEditSkills && pack.name === mySkillsPackName
            ) ?? (await client.createPack(mySkillsPackName))
          await client.setWorkspacePack(activeWorkspaceId, mySkills.id, true)
          await client.createManagedSkill(mySkills.id, draft)
        }),
    }
  }, [client, activeWorkspaceId, tryAction])

  return { packsQuery, packActions }
}
