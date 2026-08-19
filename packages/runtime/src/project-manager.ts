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
import { dirname, join, resolve, sep } from "node:path"

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

/**
 * The folder a managed project gets in Finder. The project name survives as
 * far as the filesystem allows — an opaque UUID here reads as a bug to the
 * person who clicks "Show folder".
 */
export function managedDirectoryName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- control characters are exactly what this strips
    .replace(/[\u0000-\u001f/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+/, "")
    .replace(/[. ]+$/, "")
  // The trailing strip runs again after the cut: slicing can expose a new
  // trailing dot, which Windows silently drops when creating the folder.
  const shortened = [...cleaned]
    .slice(0, 80)
    .join("")
    .replace(/[. ]+$/, "")
  return shortened === "" ? "Project" : shortened
}

export type CreateProjectInput = {
  workspaceId: string
  name: string
  description?: string
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
      // The claimed directory is never given up: template content is copied
      // into it instead of renamed over it. A rename would first release the
      // name, and POSIX rename onto an empty directory succeeds silently, so
      // a concurrent creator's claim could be eaten without a trace.
      const destination = await this.#claimDirectory(
        this.#managedRoot,
        input.name
      )
      try {
        if (template) {
          const staging = await mkdtemp(join(this.#managedRoot, ".create-"))
          try {
            await rmdir(staging)
            await this.packs.templates.materialize(template, staging)
            const copied = await copyDirectoryContentsNoClobber(
              staging,
              destination
            )
            await copied.finalize().catch(() => undefined)
          } catch (error) {
            await rm(staging, { recursive: true, force: true }).catch(
              () => undefined
            )
            throw error
          }
        }
        this.projects.add(destination, input.name, input.workspaceId, {
          id,
          locationKind: "managed",
          description: input.description,
          instructions,
          sourceTemplate,
        })
      } catch (error) {
        await rm(destination, { recursive: true, force: true }).catch(
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
        description: input.description,
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
          description: input.description,
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
      const picked = await resolvedEmptyOrExistingDirectory(
        selectedPath,
        false
      )
      if (picked === source || picked.startsWith(source + sep)) {
        throw new RuntimeError(
          "invalid-project-path",
          "Choose a folder outside the project's current folder"
        )
      }
      // An empty pick becomes the project folder itself; a folder that
      // already holds things gets a fresh subfolder named after the
      // project, so nobody has to prepare an empty directory first.
      const pickedIsEmpty = (await readdir(picked)).length === 0
      const destination = pickedIsEmpty
        ? picked
        : await this.#claimDirectory(picked, current.name, projectId)
      // The claimed branch already checked availability; re-checking here
      // could throw after the claim and leak the freshly made subfolder.
      if (pickedIsEmpty) this.projects.ensurePathAvailable(destination, projectId)
      let move: PendingProjectMove
      try {
        move = await moveProjectDirectory(source, destination)
      } catch (error) {
        if (!pickedIsEmpty) await rmdir(destination).catch(() => undefined)
        throw error
      }
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
        if (!pickedIsEmpty) await rmdir(destination).catch(() => undefined)
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

  /**
   * Reserves a readable folder name under the given parent. mkdir is the
   * claim: a name that exists — on disk or in Project storage — moves the
   * loop on to "Name 2", "Name 3", and a UUID ends the pathological case.
   */
  async #claimDirectory(
    parent: string,
    name: string,
    exceptProjectId?: string
  ): Promise<string> {
    const base = managedDirectoryName(name)
    const candidates = [
      base,
      ...Array.from({ length: 49 }, (_, index) => `${base} ${index + 2}`),
      randomUUID(),
    ]
    for (let index = 0; index < candidates.length; index += 1) {
      const destination = join(parent, candidates[index]!)
      try {
        this.projects.ensurePathAvailable(destination, exceptProjectId)
      } catch {
        continue
      }
      try {
        await mkdir(destination)
        return destination
      } catch (error) {
        // A name-derived candidate can fail for more than collisions —
        // Windows reserved names, byte-length limits — so any failure moves
        // the loop on. Only the UUID fallback failing is worth surfacing.
        if (index === candidates.length - 1) throw error
      }
    }
    throw new RuntimeError(
      "project-create-failed",
      "Deskto could not reserve a folder for the project"
    )
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
  destination: string,
  hooks: {
    afterCreate?(entry: {
      kind: "file" | "directory"
      path: string
    }): Promise<void>
  } = {}
): Promise<PendingProjectMove> {
  let createdEntries = 0
  const destinationRoot = await ownedDirectory(destination)

  async function copyDirectory(
    sourceDirectory: string,
    destinationDirectory: OwnedDirectory
  ): Promise<void> {
    for (const name of await readdir(sourceDirectory)) {
      await assertOwnedDirectory(destinationDirectory)
      const sourcePath = join(sourceDirectory, name)
      const destinationPath = join(destinationDirectory.path, name)
      const metadata = await lstat(sourcePath)
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
        await mkdir(destinationPath)
        createdEntries += 1
        const createdDirectory = await ownedDirectory(destinationPath)
        await hooks.afterCreate?.({
          kind: "directory",
          path: destinationPath,
        })
        await assertOwnedDirectory(createdDirectory)
        await copyDirectory(sourcePath, createdDirectory)
        await assertOwnedDirectory(createdDirectory)
        await assertOwnedDirectory(destinationDirectory)
        continue
      }
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new RuntimeError(
          "invalid-template",
          `Template staging contains an unsupported entry: ${name}`
        )
      }
      await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
      createdEntries += 1
      const createdFile = await ownedRegularFile(destinationPath)
      await hooks.afterCreate?.({ kind: "file", path: destinationPath })
      await assertOwnedRegularFile(createdFile)
      await assertOwnedDirectory(destinationDirectory)
    }
  }

  try {
    await copyDirectory(source, destinationRoot)
  } catch (error) {
    if (createdEntries > 0) {
      throw projectMoveRecoveryError(
        source,
        destination,
        runtimeErrorMessageSchema.parse(error)
      )
    }
    throw error
  }
  return {
    async rollback() {
      throw projectMoveRecoveryError(
        source,
        destination,
        "Template content was copied before Project storage failed; Deskto left it in place to avoid deleting concurrent changes"
      )
    },
    async finalize() {
      await rm(source, { recursive: true, force: true })
    },
  }
}

type OwnedEntry = {
  path: string
  dev: number
  ino: number
}

type OwnedDirectory = OwnedEntry
type OwnedRegularFile = OwnedEntry

async function ownedDirectory(path: string): Promise<OwnedDirectory> {
  const metadata = await lstat(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new RuntimeError(
      "project-move-recovery-failed",
      `Deskto no longer owns the expected directory: ${path}`
    )
  }
  return { path, dev: metadata.dev, ino: metadata.ino }
}

async function ownedRegularFile(path: string): Promise<OwnedRegularFile> {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new RuntimeError(
      "project-move-recovery-failed",
      `Deskto no longer owns the expected file: ${path}`
    )
  }
  return { path, dev: metadata.dev, ino: metadata.ino }
}

async function assertOwnedDirectory(entry: OwnedDirectory): Promise<void> {
  const current = await ownedDirectory(entry.path)
  if (current.dev !== entry.dev || current.ino !== entry.ino) {
    throw new RuntimeError(
      "project-move-recovery-failed",
      `Deskto no longer owns the expected directory: ${entry.path}`
    )
  }
}

async function assertOwnedRegularFile(entry: OwnedRegularFile): Promise<void> {
  const current = await ownedRegularFile(entry.path)
  if (current.dev !== entry.dev || current.ino !== entry.ino) {
    throw new RuntimeError(
      "project-move-recovery-failed",
      `Deskto no longer owns the expected file: ${entry.path}`
    )
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
