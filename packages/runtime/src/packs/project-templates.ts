import { randomUUID } from "node:crypto"
import { lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import {
  projectNameMaxLength,
  projectTemplateDescriptionMaxLength,
  type ProjectTemplate,
  type ProjectTemplateFile,
} from "@deskto/protocol"
import { z } from "zod"

import { RuntimeError } from "../errors.js"
import { pathIsDirectChild, pathIsWithin } from "../path-boundaries.js"
import {
  openRegularFileWithinRoot,
  readDirectoryWithinRoot,
} from "../safe-file-open.js"
import type { Packs } from "../storage/packs.js"
import type { PackRow } from "../storage/records.js"
import { canEditManagedTemplates } from "./pack-capabilities.js"
import { slugify } from "./pack-files.js"
import {
  copyProjectTemplateFiles,
  listSafeProjectTemplateFiles,
  materializeTemplateFiles,
} from "./project-template-files.js"
import { refreshPackDigest } from "./refresh-pack-digest.js"

const templateManifestSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(projectNameMaxLength),
  description: z
    .string()
    .trim()
    .max(projectTemplateDescriptionMaxLength)
    .default(""),
})
const maximumTemplateTextBytes = 64 * 1024

type ResolvedTemplate = {
  template: ProjectTemplate
  path: string
  packRoot: string
  instructions: string
}

export type SaveProjectTemplateInput = {
  name: string
  description: string
  includeInstructions: boolean
  paths: string[]
}

export class ProjectTemplates {
  readonly #managedPackRoot: string

  constructor(
    private readonly packs: Packs,
    managedPackRoot: string
  ) {
    this.#managedPackRoot = resolve(managedPackRoot)
  }

  async listForWorkspace(workspaceId: string): Promise<ProjectTemplate[]> {
    const packs = this.packs.attachedToWorkspace(workspaceId)
    const templates = await Promise.all(
      packs.map((pack) => this.#readPackTemplates(pack))
    )
    const flattened = templates.flat().map(({ template }) => template)
    flattened.sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    )
    return flattened
  }

  async resolveForWorkspace(
    workspaceId: string,
    templateId: string
  ): Promise<ResolvedTemplate> {
    const packs = this.packs.attachedToWorkspace(workspaceId)
    for (const pack of packs) {
      const match = (await this.#readPackTemplates(pack)).find(
        ({ template }) => template.id === templateId
      )
      if (match) return match
    }
    throw new RuntimeError(
      "template-not-found",
      "That template is not available in this workspace"
    )
  }

  async materialize(
    template: Pick<ResolvedTemplate, "path" | "packRoot">,
    destination: string
  ): Promise<void> {
    await materializeTemplateFiles(template, destination)
  }

  async listProjectFiles(projectPath: string): Promise<ProjectTemplateFile[]> {
    return listSafeProjectTemplateFiles(projectPath)
  }

  async saveFromProject(
    packId: string,
    project: { path: string; instructions: string },
    input: SaveProjectTemplateInput
  ): Promise<ProjectTemplate> {
    const pack = await this.#editablePack(packId)
    const offeredFiles = await this.listProjectFiles(project.path)
    const offeredPaths = new Map(
      offeredFiles.map((file) => [file.path, file] as const)
    )
    const selectedPaths = [...new Set(input.paths)]
    for (const path of selectedPaths) {
      if (!offeredPaths.has(path)) {
        throw new RuntimeError(
          "invalid-template-file",
          `Project file is not safe to copy: ${path}`
        )
      }
    }

    const templatesRoot = join(pack.path, "templates")
    await mkdir(templatesRoot, { recursive: true })
    const rootMetadata = await lstat(templatesRoot)
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
      throw new RuntimeError(
        "invalid-pack-path",
        "The Pack templates directory is not safe to edit"
      )
    }
    const directoryName = `${slugify(input.name) || "template"}-${randomUUID().slice(0, 8)}`
    const staging = join(templatesRoot, `.create-${randomUUID()}`)
    const destination = join(templatesRoot, directoryName)
    try {
      await mkdir(join(staging, "files"), { recursive: true })
      await writeFile(
        join(staging, "template.json"),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            name: input.name.trim(),
            description: input.description.trim(),
          },
          null,
          2
        )}\n`,
        { flag: "wx" }
      )
      if (input.includeInstructions && project.instructions.trim()) {
        await writeFile(
          join(staging, "instructions.md"),
          `${project.instructions.trim()}\n`,
          { flag: "wx" }
        )
      }
      await copyProjectTemplateFiles(
        project.path,
        join(staging, "files"),
        selectedPaths
      )
      await rename(staging, destination)
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
    await refreshPackDigest(this.packs, pack)
    return toProjectTemplate(pack, directoryName, {
      schemaVersion: 1,
      name: input.name.trim(),
      description: input.description.trim(),
    })
  }

  async #readPackTemplates(pack: PackRow): Promise<ResolvedTemplate[]> {
    const root = join(pack.path, "templates")
    const rootMetadata = await lstat(root).catch(() => null)
    if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink()) return []
    const resolvedRoot = await realpath(root).catch(() => null)
    if (!resolvedRoot || !pathIsWithin(pack.path, resolvedRoot)) return []
    const entries = await readDirectoryWithinRoot(
      resolvedRoot,
      pack.path
    ).catch(() => [])
    const templates = await Promise.all(
      entries.map(async (entry): Promise<ResolvedTemplate | null> => {
        if (!entry.isDirectory() || entry.isSymbolicLink()) return null
        const directory = join(resolvedRoot, entry.name)
        const manifest = await readTemplateManifest(directory, pack.path)
        if (!manifest) return null
        const instructions = await readTemplateInstructions(
          directory,
          pack.path
        )
        return {
          template: toProjectTemplate(pack, entry.name, manifest),
          path: directory,
          packRoot: pack.path,
          instructions,
        }
      })
    )
    return templates.filter(
      (template): template is ResolvedTemplate => template !== null
    )
  }

  async #editablePack(packId: string): Promise<PackRow> {
    const pack = this.packs.get(packId)
    if (
      !canEditManagedTemplates(pack) ||
      !pathIsDirectChild(this.#managedPackRoot, pack.path)
    ) {
      throw new RuntimeError(
        "invalid-pack-operation",
        "Templates can be saved only in an app-created managed Pack"
      )
    }
    const metadata = await lstat(pack.path).catch(() => null)
    if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
      throw new RuntimeError(
        "invalid-pack-path",
        "The managed Pack directory is not safe to edit"
      )
    }
    return pack
  }
}

function projectTemplateId(packId: string, directoryName: string): string {
  return `${packId}/${encodeURIComponent(directoryName)}`
}

function toProjectTemplate(
  pack: PackRow,
  directoryName: string,
  manifest: z.infer<typeof templateManifestSchema>
): ProjectTemplate {
  return {
    id: projectTemplateId(pack.id, directoryName),
    packId: pack.id,
    packName: pack.name,
    directoryName,
    name: manifest.name,
    description: manifest.description,
  }
}

async function readTemplateManifest(
  directory: string,
  packRoot: string
): Promise<z.infer<typeof templateManifestSchema> | null> {
  const path = join(directory, "template.json")
  const opened = await openRegularFileWithinRoot(path, packRoot).catch(
    () => null
  )
  if (!opened) return null
  try {
    if (opened.metadata.size > maximumTemplateTextBytes) return null
    return templateManifestSchema.parse(
      JSON.parse(await opened.handle.readFile("utf8"))
    )
  } catch {
    return null
  } finally {
    await opened.handle.close()
  }
}

async function readTemplateInstructions(
  directory: string,
  packRoot: string
): Promise<string> {
  const path = join(directory, "instructions.md")
  const opened = await openRegularFileWithinRoot(path, packRoot).catch(
    () => null
  )
  if (!opened) return ""
  try {
    if (opened.metadata.size > maximumTemplateTextBytes) return ""
    return await opened.handle.readFile("utf8")
  } finally {
    await opened.handle.close()
  }
}
