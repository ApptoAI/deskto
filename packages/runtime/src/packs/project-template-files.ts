import { lstat, mkdir, open, realpath } from "node:fs/promises"
import { dirname, join, relative, sep } from "node:path"

import type { ProjectTemplateFile } from "@deskto/protocol"

import { RuntimeError } from "../errors.js"
import { pathIsWithin } from "../path-boundaries.js"
import {
  openRegularFileWithinRoot,
  readDirectoryWithinRoot,
} from "../safe-file-open.js"

const ignoredDirectoryNames = new Set([
  ".cache",
  ".git",
  ".next",
  ".tmp",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "temp",
  "tmp",
  "vendor",
])
const secretFileNames = new Set([
  ".dockercfg",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "service-account.json",
  "service_account.json",
  "secrets.json",
])
const secretExtensions = new Set([".key", ".p12", ".pem", ".pfx"])
const maximumTemplateFiles = 200
const maximumTemplateEntries = 2_000
const maximumTemplateFileBytes = 5 * 1024 * 1024
const maximumTemplateBytes = 20 * 1024 * 1024
const maximumTemplateDepth = 32

type TemplateLocation = { path: string; packRoot: string }
type CopyBudget = { entries: number; files: number; bytes: number }

export async function materializeTemplateFiles(
  template: TemplateLocation,
  destination: string
): Promise<void> {
  await mkdir(destination, { recursive: false })
  const templateMetadata = await lstat(template.path).catch(() => null)
  if (!templateMetadata?.isDirectory() || templateMetadata.isSymbolicLink()) {
    throw new RuntimeError(
      "invalid-template",
      "Template must remain a regular directory inside its Pack"
    )
  }
  const templateRoot = await realpath(template.path)
  if (!pathIsWithin(template.packRoot, templateRoot)) {
    throw new RuntimeError(
      "invalid-template",
      "Template resolves outside its Pack"
    )
  }
  const filesRoot = join(templateRoot, "files")
  const metadata = await lstat(filesRoot).catch(() => null)
  if (!metadata) return
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new RuntimeError(
      "invalid-template",
      "Template files must be a regular directory"
    )
  }
  const root = await realpath(filesRoot)
  const resolvedMetadata = await lstat(root)
  if (
    !pathIsWithin(templateRoot, root) ||
    !resolvedMetadata.isDirectory() ||
    resolvedMetadata.isSymbolicLink() ||
    resolvedMetadata.dev !== metadata.dev ||
    resolvedMetadata.ino !== metadata.ino
  ) {
    throw new RuntimeError(
      "invalid-template",
      "Template files changed or resolve outside the template directory"
    )
  }
  await copyDirectory(
    root,
    root,
    destination,
    { entries: 0, files: 0, bytes: 0 },
    0
  )
}

export async function listSafeProjectTemplateFiles(
  projectPath: string
): Promise<ProjectTemplateFile[]> {
  const root = await realpath(projectPath)
  const files: ProjectTemplateFile[] = []
  let totalBytes = 0
  let inspectedEntries = 0
  const pending = [root]
  scan: while (pending.length > 0 && files.length < maximumTemplateFiles) {
    const directory = pending.pop()
    if (!directory) break
    const entries = await readDirectoryWithinRoot(directory, root)
    entries.sort((left, right) => right.name.localeCompare(left.name))
    for (const entry of entries) {
      inspectedEntries += 1
      if (inspectedEntries > maximumTemplateEntries) break scan
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) continue
      if (metadata.isDirectory()) {
        if (shouldIgnoreDirectory(entry.name)) continue
        pending.push(path)
        continue
      }
      if (!metadata.isFile() || shouldIgnoreFile(entry.name)) continue
      if (metadata.size > maximumTemplateFileBytes) continue
      if (totalBytes + metadata.size > maximumTemplateBytes) continue
      const opened = await openRegularFileWithinRoot(path, root).catch(
        () => null
      )
      if (!opened) continue
      await opened.handle.close()
      files.push({
        path: portableRelativePath(root, path),
        sizeBytes: metadata.size,
      })
      totalBytes += metadata.size
      if (files.length === maximumTemplateFiles) break
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path))
  return files
}

export async function copyProjectTemplateFiles(
  projectPath: string,
  destinationRoot: string,
  selectedPaths: string[]
): Promise<void> {
  const projectRoot = await realpath(projectPath)
  let copiedBytes = 0
  for (const path of selectedPaths) {
    copiedBytes += await copySelectedFile(
      join(projectRoot, ...path.split("/")),
      projectRoot,
      join(destinationRoot, ...path.split("/")),
      maximumTemplateBytes - copiedBytes
    )
  }
}

async function copyDirectory(
  sourceRoot: string,
  source: string,
  destination: string,
  budget: CopyBudget,
  depth: number
): Promise<void> {
  if (depth > maximumTemplateDepth) {
    throw new RuntimeError(
      "invalid-template",
      `Template nesting exceeds ${maximumTemplateDepth} directories`
    )
  }
  const entries = await readDirectoryWithinRoot(source, sourceRoot)
  entries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    budget.entries += 1
    if (budget.entries > maximumTemplateEntries) {
      throw new RuntimeError(
        "invalid-template",
        `Template contains more than ${maximumTemplateEntries} entries`
      )
    }
    const sourcePath = join(source, entry.name)
    const destinationPath = join(destination, entry.name)
    const metadata = await lstat(sourcePath)
    if (metadata.isSymbolicLink()) {
      throw new RuntimeError(
        "invalid-template",
        `Template contains a symbolic link: ${entry.name}`
      )
    }
    if (metadata.isDirectory()) {
      await mkdir(destinationPath)
      await copyDirectory(
        sourceRoot,
        sourcePath,
        destinationPath,
        budget,
        depth + 1
      )
      continue
    }
    if (!metadata.isFile()) {
      throw new RuntimeError(
        "invalid-template",
        `Template contains a special file: ${entry.name}`
      )
    }
    if (budget.files >= maximumTemplateFiles) {
      throw new RuntimeError(
        "invalid-template",
        `Template contains more than ${maximumTemplateFiles} files`
      )
    }
    budget.bytes += await copySelectedFile(
      sourcePath,
      sourceRoot,
      destinationPath,
      maximumTemplateBytes - budget.bytes
    )
    budget.files += 1
  }
}

async function copySelectedFile(
  source: string,
  sourceRoot: string,
  destination: string,
  remainingTemplateBytes: number
): Promise<number> {
  const openedSource = await openRegularFileWithinRoot(source, sourceRoot)
  if (
    openedSource.metadata.size > maximumTemplateFileBytes ||
    openedSource.metadata.size > remainingTemplateBytes
  ) {
    await openedSource.handle.close()
    throw templateSizeError(sourceRoot, source)
  }
  await mkdir(dirname(destination), { recursive: true })
  let copiedBytes = 0
  try {
    const destinationFile = await open(destination, "wx")
    try {
      for await (const chunk of openedSource.handle.createReadStream({
        autoClose: false,
      })) {
        copiedBytes += chunk.length
        if (
          copiedBytes > maximumTemplateFileBytes ||
          copiedBytes > remainingTemplateBytes
        ) {
          throw templateSizeError(sourceRoot, source)
        }
        await destinationFile.writeFile(chunk)
      }
    } finally {
      await destinationFile.close()
    }
  } finally {
    await openedSource.handle.close()
  }
  return copiedBytes
}

function templateSizeError(root: string, path: string): RuntimeError {
  return new RuntimeError(
    "invalid-template-file",
    `Template exceeds its file or total size limit: ${portableRelativePath(root, path)}`
  )
}

function shouldIgnoreDirectory(name: string): boolean {
  return name.startsWith(".") || ignoredDirectoryNames.has(name.toLowerCase())
}

function shouldIgnoreFile(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower === ".env" || lower.startsWith(".env.")) return true
  if (secretFileNames.has(lower)) return true
  if (
    lower.includes("service-account") ||
    lower.includes("service_account") ||
    lower.startsWith("credentials.") ||
    lower.startsWith("secrets.")
  ) {
    return true
  }
  for (const extension of secretExtensions) {
    if (lower.endsWith(extension)) return true
  }
  return false
}

function portableRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/")
}
