import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type {
  HarnessAdapterFactory,
  NativeSkillRoot,
} from "@deskto/harness-sdk"
import { ScriptedHarness } from "@deskto/harness-sdk/testing"
import { skillInventorySchema } from "@deskto/protocol"
import { afterEach, describe, expect, it } from "vitest"

import { createRuntime } from "../runtime.js"
import { projectSkillRootPaths } from "./project-skill-roots.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe("skill inventory", () => {
  it("keeps project, computer, and attached Pack occurrences losslessly", async () => {
    const root = await temporaryDirectory()
    const projectPath = join(root, "project")
    const projectSkills = join(root, "project-skills")
    const userSkills = join(root, "user-skills")
    await Promise.all([
      mkdir(projectPath),
      mkdir(projectSkills),
      mkdir(userSkills),
    ])
    await writeSkill(projectSkills, "project-copy", "duplicate", "Project")
    await writeSkill(userSkills, "user-copy", "duplicate", "User")
    await mkdir(join(projectSkills, "broken"))

    const runtime = createRuntime({
      databasePath: join(root, "runtime.sqlite"),
      packsPath: join(root, "packs"),
      harnesses: [
        inventoryHarness("test", [
          {
            path: projectSkills,
            scope: "project",
            label: "Project skills",
          },
          { path: userSkills, scope: "user", label: "Personal skills" },
        ]),
      ],
    })
    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: {
          path: projectPath,
          name: "Project",
          workspaceId: "personal",
        },
      })
    )
    const pack = unwrap(
      await runtime.request({ method: "pack.create", params: { name: "Pack" } })
    )
    await writeSkill(
      join(pack.path, "skills"),
      "pack-copy",
      "duplicate",
      "Pack"
    )
    unwrap(
      await runtime.request({
        method: "workspace.setPack",
        params: {
          workspaceId: "personal",
          packId: pack.id,
          attached: true,
        },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: "test" },
      })
    )
    unwrap(
      await runtime.request({
        method: "turn.start",
        params: {
          threadId: thread.id,
          input: { text: "Use the Pack", references: [] },
        },
      })
    )

    const inventory = unwrap(
      await runtime.request({
        method: "skill.listForProject",
        params: { projectId: project.id },
      })
    )

    expect(skillInventorySchema.safeParse(inventory).success).toBe(true)
    expect(
      inventory.sources.flatMap(({ scopes }) => scopes).sort()
    ).toEqual(["project", "user", "workspace"])
    expect(
      inventory.occurrences.filter(({ name }) => name === "duplicate")
    ).toHaveLength(3)
    expect(
      inventory.occurrences.find(
        ({ directoryName }) => directoryName === "broken"
      )?.diagnostics[0]?.code
    ).toBe("skill-file-missing")
    expect(
      inventory.sources.find(({ packId }) => packId === pack.id)?.provisioning
    ).toMatchObject([
      {
        rootId: pack.id,
        harnessId: "test",
        status: "configured",
        method: "extra-root",
      },
    ])
    await runtime.close()
  })

  it("limits computer reads and skill details to their inventory context", async () => {
    const root = await temporaryDirectory()
    const projectPath = join(root, "project")
    const projectSkills = join(root, "project-skills")
    const userSkills = join(root, "user-skills")
    await Promise.all([
      mkdir(projectPath),
      mkdir(projectSkills),
      mkdir(userSkills),
    ])
    await writeSkill(projectSkills, "local", "local", "Project only")
    await writeSkill(userSkills, "personal", "personal", "Computer")
    const runtime = createRuntime({
      databasePath: join(root, "runtime.sqlite"),
      harnesses: [
        inventoryHarness("test", [
          {
            path: projectSkills,
            scope: "project",
            label: "Project skills",
          },
          { path: userSkills, scope: "user", label: "Personal skills" },
        ]),
      ],
    })
    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: {
          path: projectPath,
          name: "Project",
          workspaceId: "personal",
        },
      })
    )
    const projectInventory = unwrap(
      await runtime.request({
        method: "skill.listForProject",
        params: { projectId: project.id },
      })
    )
    const computerInventory = unwrap(
      await runtime.request({ method: "skill.listOnComputer", params: {} })
    )

    expect(computerInventory.occurrences.map(({ name }) => name)).toEqual([
      "personal",
    ])
    const personal = computerInventory.occurrences[0]!
    const details = unwrap(
      await runtime.request({
        method: "skill.get",
        params: { occurrenceId: personal.id },
      })
    )
    expect(details.content).toContain("Instructions")

    const local = projectInventory.occurrences.find(
      ({ name }) => name === "local"
    )!
    const outsideContext = await runtime.request({
      method: "skill.get",
      params: { occurrenceId: local.id },
    })
    expect(outsideContext.ok).toBe(false)
    if (!outsideContext.ok)
      expect(outsideContext.error.code).toBe("skill-not-found")
    await runtime.close()
  })

  it("returns project roots from the working directory through the Git root", async () => {
    const root = await temporaryDirectory()
    const nested = join(root, "packages", "app")
    await Promise.all([
      mkdir(join(root, ".git")),
      mkdir(nested, { recursive: true }),
    ])

    await expect(
      projectSkillRootPaths(nested, join(".agents", "skills"))
    ).resolves.toEqual([
      join(nested, ".agents", "skills"),
      join(root, "packages", ".agents", "skills"),
      join(root, ".agents", "skills"),
    ])
  })

  it("merges Harness exposure for the same physical skill source", async () => {
    const root = await temporaryDirectory()
    const projectPath = join(root, "project")
    const userSkills = join(root, "shared-skills")
    await Promise.all([mkdir(projectPath), mkdir(userSkills)])
    await writeSkill(userSkills, "review", "review", "Review changes")
    const userRoot: NativeSkillRoot = {
      path: userSkills,
      scope: "user",
      label: "Personal skills",
    }
    const runtime = createRuntime({
      databasePath: join(root, "runtime.sqlite"),
      harnesses: [
        inventoryHarness("first", [userRoot]),
        inventoryHarness("second", [
          { ...userRoot, scope: "project", label: "Project skills" },
        ]),
      ],
    })
    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: {
          path: projectPath,
          name: "Project",
          workspaceId: "personal",
        },
      })
    )

    const inventory = unwrap(
      await runtime.request({
        method: "skill.listForProject",
        params: { projectId: project.id },
      })
    )

    expect(inventory.sources).toHaveLength(1)
    expect(inventory.sources[0]?.harnessIds).toEqual(["first", "second"])
    expect(inventory.sources[0]?.scopes).toEqual(["project", "user"])
    expect(inventory.occurrences).toHaveLength(1)
    await runtime.close()
  })
})

function inventoryHarness(
  id: string,
  roots: NativeSkillRoot[]
): HarnessAdapterFactory {
  const scripted = new ScriptedHarness({ id, name: id })
  return {
    descriptor: scripted.descriptor,
    checkAvailability: () => scripted.checkAvailability(),
    listModels: () => scripted.listModels(),
    discoverSkillRoots: ({ projectPath }) =>
      Promise.resolve(
        roots.filter((root) => root.scope !== "project" || projectPath !== null)
      ),
    start: async (input, signal) => {
      const session = await scripted.start(input, signal)
      return {
        ...session,
        skillProvisioning: input.customization.skillRoots.map((root) => ({
          rootId: root.id ?? root.path,
          rootPath: root.path,
          status: "configured" as const,
          method: "extra-root" as const,
        })),
      }
    },
  }
}

async function writeSkill(
  root: string,
  directoryName: string,
  name: string,
  description: string
): Promise<void> {
  const directory = join(root, directoryName)
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\nInstructions\n`
  )
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "deskto-skill-inventory-"))
  directories.push(directory)
  return directory
}

function unwrap<T>(
  response: { ok: true; data: T } | { ok: false; error: unknown }
): T {
  if (!response.ok) throw new Error(JSON.stringify(response.error))
  return response.data
}
