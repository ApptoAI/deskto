import { randomUUID } from "node:crypto"
import { mkdirSync, realpathSync } from "node:fs"
import {
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

import { RuntimeError } from "./errors.js"
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
    let destinationReplaced = false
    try {
      await rmdir(staging)
      await this.packs.templates.materialize(template, staging)
      await rmdir(path)
      destinationReplaced = true
      await rename(staging, path)
      try {
        this.projects.add(path, input.name, input.workspaceId, {
          id,
          locationKind: "linked",
          instructions,
          sourceTemplate,
        })
      } catch (error) {
        await rm(path, { recursive: true, force: true }).catch(() => undefined)
        await mkdir(path).catch(() => undefined)
        throw error
      }
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
      if (destinationReplaced) await mkdir(path).catch(() => undefined)
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
        await move.rollback().catch(() => undefined)
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
  try {
    await renamePath(source, destination)
    return {
      async rollback() {
        await renamePath(destination, source)
        await mkdir(destination)
      },
      finalize: () => Promise.resolve(),
    }
  } catch (error) {
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
