import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ScriptedHarness } from "@deskto/harness-sdk/testing"
import { afterEach, describe, expect, it } from "vitest"

import { managedDirectoryName } from "./project-manager.js"
import { createRuntime, type Runtime } from "./runtime.js"

const directories: string[] = []
const runtimes: Runtime[] = []

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe("managed projects and templates", () => {
  it("does not split Unicode code points when shortening folder names", () => {
    const name = `${"a".repeat(79)}😀suffix`

    expect(managedDirectoryName(name)).toBe(`${"a".repeat(79)}😀`)
  })

  it("creates a real managed folder beside the Runtime database", async () => {
    const { directory, runtime } = await testRuntime()

    const details = unwrap(
      await runtime.request({
        method: "project.create",
        params: {
          workspaceId: "personal",
          name: "  Client North  ",
          location: { kind: "managed" },
        },
      })
    )

    expect(details).toMatchObject({
      project: {
        name: "Client North",
        locationKind: "managed",
        pinnedAt: null,
      },
      instructions: "",
      sourceTemplate: null,
    })
    expect(details.project.path).toBe(
      join(await realpath(directory), "projects", "Client North")
    )
    await expect(mkdir(details.project.path)).rejects.toMatchObject({
      code: "EEXIST",
    })
  })

  it("names managed folders after the project and suffixes collisions", async () => {
    const { directory, runtime } = await testRuntime()
    const create = (name: string) =>
      runtime.request({
        method: "project.create",
        params: {
          workspaceId: "personal",
          name,
          location: { kind: "managed" },
        },
      })

    const first = unwrap(await create("Client North"))
    const second = unwrap(await create("Client North"))
    const hostile = unwrap(await create("  ../../etc: passwd?  "))

    const root = join(await realpath(directory), "projects")
    expect(first.project.path).toBe(join(root, "Client North"))
    expect(second.project.path).toBe(join(root, "Client North 2"))
    expect(hostile.project.path).toBe(join(root, "etc passwd"))
  })

  it("passes shared Project instructions to the Harness", async () => {
    const harness = new ScriptedHarness()
    const { runtime } = await testRuntime(harness)
    const project = unwrap(
      await runtime.request({
        method: "project.create",
        params: {
          workspaceId: "personal",
          name: "Instructions",
          location: { kind: "managed" },
        },
      })
    ).project
    unwrap(
      await runtime.request({
        method: "project.update",
        params: {
          projectId: project.id,
          instructions: "Use the client's approved terminology.",
        },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: harness.descriptor.id },
      })
    )

    unwrap(
      await runtime.request({
        method: "turn.start",
        params: {
          threadId: thread.id,
          input: { text: "Prepare a draft", references: [], attachments: [] },
        },
      })
    )

    expect(harness.runs[0]?.input.customization.instructions).toBe(
      "Use the client's approved terminology."
    )
  })

  it("saves selected safe files and creates an independent template snapshot", async () => {
    const { directory, runtime } = await testRuntime()
    const pack = unwrap(
      await runtime.request({
        method: "pack.create",
        params: { name: "My Templates" },
      })
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
    const source = unwrap(
      await runtime.request({
        method: "project.create",
        params: {
          workspaceId: "personal",
          name: "Template source",
          location: { kind: "managed" },
        },
      })
    ).project
    await mkdir(join(source.path, "briefs"))
    await writeFile(join(source.path, "briefs", "README.md"), "Starter\n")
    await writeFile(join(source.path, ".env"), "SECRET=value\n")
    await writeFile(
      join(source.path, ".npmrc"),
      "//registry:_authToken=value\n"
    )
    unwrap(
      await runtime.request({
        method: "project.update",
        params: {
          projectId: source.id,
          instructions: "Ask for approval before publishing.",
        },
      })
    )

    const offered = unwrap(
      await runtime.request({
        method: "project.listTemplateFiles",
        params: { projectId: source.id },
      })
    )
    expect(offered).toEqual([{ path: "briefs/README.md", sizeBytes: 8 }])

    const template = unwrap(
      await runtime.request({
        method: "template.saveFromProject",
        params: {
          projectId: source.id,
          name: "Client project",
          description: "Reusable client workspace",
          includeInstructions: true,
          paths: ["briefs/README.md"],
        },
      })
    )
    const created = unwrap(
      await runtime.request({
        method: "project.create",
        params: {
          workspaceId: "personal",
          name: "Client East",
          location: { kind: "managed" },
          templateId: template.id,
        },
      })
    )

    expect(created.instructions).toBe("Ask for approval before publishing.\n")
    expect(created.sourceTemplate).toEqual({
      id: template.id,
      name: template.name,
      packName: pack.name,
    })
    expect(
      await readFile(join(created.project.path, "briefs", "README.md"), "utf8")
    ).toBe("Starter\n")
    await writeFile(
      join(created.project.path, "briefs", "README.md"),
      "Changed"
    )
    expect(
      await readFile(join(source.path, "briefs", "README.md"), "utf8")
    ).toBe("Starter\n")

    const linkedPath = join(directory, "linked-from-template")
    await mkdir(linkedPath)
    const linkedBefore = await lstat(linkedPath)
    const linked = unwrap(
      await runtime.request({
        method: "project.create",
        params: {
          workspaceId: "personal",
          name: "Client South",
          location: { kind: "linked", path: linkedPath },
          templateId: template.id,
        },
      })
    )
    const linkedAfter = await lstat(linkedPath)
    expect(linked.project.path).toBe(await realpath(linkedPath))
    expect({
      dev: linkedAfter.dev,
      ino: linkedAfter.ino,
      mode: linkedAfter.mode,
    }).toEqual({
      dev: linkedBefore.dev,
      ino: linkedBefore.ino,
      mode: linkedBefore.mode,
    })
    await expect(
      readFile(join(linkedPath, "briefs", "README.md"), "utf8")
    ).resolves.toBe("Starter\n")
  })

  it("rejects blank names on the new write routes", async () => {
    const { runtime } = await testRuntime()
    const projectResponse = await runtime.request({
      method: "project.create",
      params: {
        workspaceId: "personal",
        name: "   ",
        location: { kind: "managed" },
      },
    })
    expect(projectResponse).toMatchObject({
      ok: false,
      error: { code: "invalid-name" },
    })

    const project = unwrap(
      await runtime.request({
        method: "project.create",
        params: {
          workspaceId: "personal",
          name: "Template source",
          location: { kind: "managed" },
        },
      })
    ).project
    const templateResponse = await runtime.request({
      method: "template.saveFromProject",
      params: {
        projectId: project.id,
        name: "   ",
        description: "",
        includeInstructions: false,
        paths: [],
      },
    })
    expect(templateResponse).toMatchObject({
      ok: false,
      error: { code: "invalid-name" },
    })
  })

  it("moves managed Projects and sorts pinned Projects first", async () => {
    const { directory, runtime } = await testRuntime()
    const first = unwrap(
      await runtime.request({
        method: "project.create",
        params: {
          workspaceId: "personal",
          name: "First",
          location: { kind: "managed" },
        },
      })
    ).project
    const second = unwrap(
      await runtime.request({
        method: "project.create",
        params: {
          workspaceId: "personal",
          name: "Second",
          location: { kind: "managed" },
        },
      })
    ).project
    const firstUpdatedAt = first.updatedAt
    unwrap(
      await runtime.request({
        method: "project.setPinned",
        params: { projectId: first.id, pinned: true },
      })
    )
    expect(
      unwrap(await runtime.request({ method: "project.list", params: {} }))[0]
        ?.id
    ).toBe(first.id)
    expect(
      unwrap(
        await runtime.request({
          method: "project.get",
          params: {
            projectId: first.id,
          },
        })
      ).project.updatedAt
    ).toBe(firstUpdatedAt)

    const destination = join(directory, "linked-project")
    await mkdir(destination)
    const moved = unwrap(
      await runtime.request({
        method: "project.relocate",
        params: { projectId: second.id, path: destination },
      })
    )
    expect(moved).toMatchObject({
      id: second.id,
      path: await realpath(destination),
      locationKind: "linked",
    })
  })

  it("moves into a named subfolder when the picked folder is not empty", async () => {
    const { directory, runtime } = await testRuntime()
    const created = unwrap(
      await runtime.request({
        method: "project.create",
        params: {
          workspaceId: "personal",
          name: "Notes",
          location: { kind: "managed" },
        },
      })
    ).project
    unwrap(
      await runtime.request({
        method: "project.update",
        params: { projectId: created.id, instructions: "Keep it short." },
      })
    )
    await writeFile(join(created.path, "note.md"), "Draft\n")

    const picked = join(directory, "documents")
    await mkdir(picked)
    await writeFile(join(picked, "existing.txt"), "keep\n")

    const moved = unwrap(
      await runtime.request({
        method: "project.relocate",
        params: { projectId: created.id, path: picked },
      })
    )

    expect(moved).toMatchObject({
      id: created.id,
      path: join(await realpath(picked), "Notes"),
      locationKind: "linked",
    })
    expect(await readFile(join(moved.path, "note.md"), "utf8")).toBe("Draft\n")
    expect(await readFile(join(picked, "existing.txt"), "utf8")).toBe("keep\n")
    expect(
      unwrap(
        await runtime.request({
          method: "project.get",
          params: { projectId: created.id },
        })
      ).instructions
    ).toBe("Keep it short.")
  })

  it("rejects a linked Project path that is a symbolic link", async () => {
    const { directory, runtime } = await testRuntime()
    const target = join(directory, "target")
    const link = join(directory, "linked-target")
    await mkdir(target)
    await symlink(target, link, "dir")

    const response = await runtime.request({
      method: "project.create",
      params: {
        workspaceId: "personal",
        name: "Linked through symlink",
        location: { kind: "linked", path: link },
      },
    })

    expect(response).toMatchObject({
      ok: false,
      error: { code: "invalid-project-path" },
    })
  })

  it("does not move a Project while a task is starting or running", async () => {
    const harness = new ScriptedHarness()
    const { directory, runtime } = await testRuntime(harness)
    const project = unwrap(
      await runtime.request({
        method: "project.create",
        params: {
          workspaceId: "personal",
          name: "Busy project",
          location: { kind: "managed" },
        },
      })
    ).project
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: harness.descriptor.id },
      })
    )
    unwrap(
      await runtime.request({
        method: "turn.start",
        params: {
          threadId: thread.id,
          input: { text: "Keep working", references: [], attachments: [] },
        },
      })
    )
    const destination = join(directory, "busy-destination")
    await mkdir(destination)

    const response = await runtime.request({
      method: "project.relocate",
      params: { projectId: project.id, path: destination },
    })

    expect(response).toMatchObject({
      ok: false,
      error: { code: "project-active" },
    })
    await expect(realpath(project.path)).resolves.toBe(project.path)
  })
})

async function testRuntime(harness = new ScriptedHarness()) {
  const directory = await mkdtemp(join(tmpdir(), "deskto-projects-"))
  directories.push(directory)
  const runtime = createRuntime({
    databasePath: join(directory, "runtime.sqlite"),
    harnesses: [harness],
    harnessRefreshMs: 0,
  })
  runtimes.push(runtime)
  return { directory, runtime }
}

function unwrap<T>(
  response: { ok: true; data: T } | { ok: false; error: unknown }
): T {
  if (!response.ok) throw new Error(JSON.stringify(response.error))
  return response.data
}
