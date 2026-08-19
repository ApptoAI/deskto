import { randomUUID } from "node:crypto"
import { constants, mkdirSync, realpathSync } from "node:fs"
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  readdir,
  rename,
  rm,
  rmdir,
} from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import type {
  Project,
  ProjectDetails,
  ProjectTemplateFile,
} from "@deskto/protocol"
import { z } from "zod"

import { RuntimeError, runtimeErrorMessageSchema } from "./errors.js"
import type { PackManager } from "./packs/pack-manager.js"
import { pathIsDirectChild } from "./path-boundaries.js"
import type { ProjectActivityGate } from "./project-activity-gate.js"
import type { Projects } from "./storage/projects.js"

const crossDeviceErrorSchema = z.object({ code: z.literal("EXDEV") })

export type CreateProjectInput = {
  workspaceId: string
  name: string
  location: { kind: "managed" } | { kind: "linked"; path: string }
  templateId?: string
}

export class ProjectManager {
  readonly #managedRoot: string

  constructor(
    private readonly projects: Projects,
    private readonly packs: PackManager,
    managedRoot: string,
    private readonly projectActivity: ProjectActivityGate
  ) {
    mkdirSync(managedRoot, { recursive: true })
    this.#managedRoot = realpathSync(managedRoot)
  }

  async createProject(input: CreateProjectInput): Promise<ProjectDetails> {
    const id = randomUUID()
    const template = input.templateId
      ? await this.packs.templates.resolveForWorkspace(
          input.workspaceId,
          input.templateId
        )
      : null
    const instructions = template?.instructions ?? ""
    const sourceTemplate = template
      ? {
          id: template.template.id,
          name: template.template.name,
          packName: template.template.packName,
        }
      : undefined

    if (input.location.kind === "managed") {
      const staging = await mkdtemp(join(this.#managedRoot, ".create-"))
      const destination = join(this.#managedRoot, id)
      try {
        if (template) {
          await rmdir(staging)
          await this.packs.templates.materialize(template, staging)
        }
        await rename(staging, destination)
        try {
          this.projects.add(destination, input.name, input.workspaceId, {
            id,
            locationKind: "managed",
            instructions,
            sourceTemplate,
          })
        } catch (error) {
          await rm(destination, { recursive: true, force: true }).catch(
            () => undefined
          )
          throw error
        }
      } catch (error) {
        await rm(staging, { recursive: true, force: true }).catch(
          () => undefined
        )
        throw error
      }
      return this.projects.details(id)
    }

    const path = await resolvedEmptyOrExistingDirectory(
      input.location.path,
      template !== null
    )
    this.projects.ensurePathAvailable(path)
    if (!template) {
      const project = this.projects.add(path, input.name, input.workspaceId, {
        id,
        locationKind: "linked",
      })
      return this.projects.details(project.id)
    }

    const parent = await realpath(dirname(path))
    const staging = await mkdtemp(join(parent, ".deskto-template-"))
    let materialized: PendingProjectMove | null = null
    try {
      await rmdir(staging)
      await this.packs.templates.materialize(template, staging)
      materialized = await copyDirectoryContentsNoClobber(staging, path)
      try {
        this.projects.add(path, input.name, input.workspaceId, {
          id,
          locationKind: "linked",
          instructions,
          sourceTemplate,
        })
      } catch (error) {
        await materialized.rollback()
        throw error
      }
      await materialized.finalize().catch(() => undefined)
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
    return this.projects.details(id)
  }

  async relocate(projectId: string, selectedPath: string): Promise<Project> {
    const releaseRelocation = this.projectActivity.beginRelocation(projectId)
    try {
      const current = this.projects.get(projectId)
      if (current.locationKind !== "managed") {
        throw new RuntimeError(
          "invalid-project-operation",
          "Only a Deskto-managed project can move to a linked folder"
        )
      }
      this.projects.ensureIdle(projectId)
      const source = await realpath(current.path)
      if (!pathIsDirectChild(this.#managedRoot, source)) {
        throw new RuntimeError(
          "invalid-project-path",
          "Managed project path is outside the Deskto projects directory"
        )
      }
      const destination = await resolvedEmptyOrExistingDirectory(
        selectedPath,
        true
      )
      this.projects.ensurePathAvailable(destination, projectId)
      const move = await moveProjectDirectory(source, destination)
      try {
        const project = this.projects.changeLocation(
          projectId,
          destination,
          "linked"
        )
        await move.finalize().catch(() => undefined)
        return project
      } catch (error) {
        await move.rollback()
        throw error
      }
    } finally {
      releaseRelocation()
    }
  }

  listTemplateFiles(projectId: string): Promise<ProjectTemplateFile[]> {
    const project = this.projects.get(projectId)
    return this.packs.templates.listProjectFiles(project.path)
  }
}

async function resolvedEmptyOrExistingDirectory(
  path: string,
  requireEmpty: boolean
): Promise<string> {
  const selectedPath = resolve(path)
  const selectedMetadata = await lstat(selectedPath).catch(() => null)
  if (!selectedMetadata?.isDirectory() || selectedMetadata.isSymbolicLink()) {
    throw new RuntimeError(
      "invalid-project-path",
      "Project path is not a regular folder"
    )
  }
  let resolved: string
  try {
    resolved = await realpath(selectedPath)
  } catch {
    throw new RuntimeError(
      "invalid-project-path",
      "Project folder does not exist"
    )
  }
  const metadata = await lstat(resolved)
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.dev !== selectedMetadata.dev ||
    metadata.ino !== selectedMetadata.ino
  ) {
    throw new RuntimeError(
      "invalid-project-path",
      "Project path is not a regular folder"
    )
  }
  if (requireEmpty && (await readdir(resolved)).length > 0) {
    throw new RuntimeError(
      "project-folder-not-empty",
      "Choose an empty folder when creating from a template or moving a project"
    )
  }
  return resolved
}

type PendingProjectMove = {
  rollback(): Promise<void>
  finalize(): Promise<void>
}

type ProjectRename = (source: string, destination: string) => Promise<void>

export async function moveProjectDirectory(
  source: string,
  destination: string,
  renamePath: ProjectRename = rename
): Promise<PendingProjectMove> {
  const sourceMode = (await lstat(source)).mode
  const destinationMode = (await lstat(destination)).mode
  const displacedDestination = join(
    dirname(destination),
    `.deskto-move-${randomUUID()}`
  )
  let displaced = false
  let moved = false

  async function restore(): Promise<void> {
    if (moved) {
      await renamePath(destination, source)
      moved = false
      await chmod(source, sourceMode)
    }
    if (displaced) {
      await renamePath(displacedDestination, destination)
      displaced = false
    }
  }

  try {
    await renamePath(destination, displacedDestination)
    displaced = true
    if ((await readdir(displacedDestination)).length > 0) {
      throw new RuntimeError(
        "project-folder-not-empty",
        "The selected folder changed while Deskto was preparing the move"
      )
    }
    await renamePath(source, destination)
    moved = true
    await chmod(destination, destinationMode)
    return {
      async rollback() {
        try {
          await restore()
        } catch (error) {
          throw projectMoveRecoveryError(
            source,
            destination,
            runtimeErrorMessageSchema.parse(error)
          )
        }
      },
      async finalize() {
        await rmdir(displacedDestination)
        displaced = false
      },
    }
  } catch (error) {
    try {
      await restore()
    } catch (recoveryError) {
      throw projectMoveRecoveryError(
        source,
        destination,
        runtimeErrorMessageSchema.parse(recoveryError)
      )
    }
    if (error instanceof RuntimeError) throw error
    if (crossDeviceErrorSchema.safeParse(error).success) {
      throw new RuntimeError(
        "project-move-cross-device",
        "Choose a folder on the same storage volume as the managed project"
      )
    }
    throw new RuntimeError(
      "project-move-failed",
      error instanceof Error ? error.message : "Project folder could not move"
    )
  }
}

export async function copyDirectoryContentsNoClobber(
  source: string,
  destination: string
): Promise<PendingProjectMove> {
  const createdFiles: string[] = []
  const createdDirectories: string[] = []

  async function rollback(): Promise<void> {
    for (let index = createdFiles.length - 1; index >= 0; index -= 1) {
      const path = createdFiles[index]
      if (path) await rm(path, { force: true })
    }
    for (let index = createdDirectories.length - 1; index >= 0; index -= 1) {
      const path = createdDirectories[index]
      if (path) await rmdir(path)
    }
  }

  async function copyDirectory(
    sourceDirectory: string,
    destinationDirectory: string
  ): Promise<void> {
    for (const name of await readdir(sourceDirectory)) {
      const sourcePath = join(sourceDirectory, name)
      const destinationPath = join(destinationDirectory, name)
      const metadata = await lstat(sourcePath)
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
        await mkdir(destinationPath)
        createdDirectories.push(destinationPath)
        await copyDirectory(sourcePath, destinationPath)
        continue
      }
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new RuntimeError(
          "invalid-template",
          `Template staging contains an unsupported entry: ${name}`
        )
      }
      await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
      createdFiles.push(destinationPath)
    }
  }

  try {
    await copyDirectory(source, destination)
  } catch (error) {
    await rollback()
    throw error
  }
  return {
    rollback,
    async finalize() {
      await rm(source, { recursive: true, force: true })
    },
  }
}

function projectMoveRecoveryError(
  source: string,
  destination: string,
  cause: string
): RuntimeError {
  return new RuntimeError(
    "project-move-recovery-failed",
    `Deskto could not restore the Project from ${destination} to ${source}: ${cause}`
  )
}
