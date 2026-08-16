import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises"
import { basename, dirname, join, posix, resolve } from "node:path"
import type { Readable } from "node:stream"

import yauzl, { type Entry, type ZipFile } from "yauzl"

import { RuntimeError } from "../errors.js"
import { pathIsWithin } from "../path-boundaries.js"
import { readPackName, slugify, validatePackDirectory } from "./pack-files.js"
import {
  defaultPackContentLimits,
  digestPackDirectory,
  type PackContentLimits,
  type PackDigest,
} from "./pack-digest.js"

export type MaterializedPack = PackDigest & {
  name: string
  path: string
}

export type StagedManagedPack = MaterializedPack & {
  commit(): Promise<void>
  discard(): Promise<void>
}

export async function stagePackFolder(
  sourcePath: string,
  managedRootPath: string,
  limits: PackContentLimits = defaultPackContentLimits
): Promise<StagedManagedPack> {
  const managedRoot = await prepareManagedRoot(managedRootPath)
  const source = await validatePackDirectory(sourcePath)
  if (pathIsWithin(managedRoot, source))
    throw new RuntimeError(
      "invalid-pack",
      "A Pack already inside the managed Pack folder cannot be installed again"
    )

  const sourceDigest = await digestPackDirectory(source, limits)
  const name = await readPackName(source)
  const stagingRoot = await mkdtemp(join(managedRoot, ".install-"))
  const stagedPack = join(stagingRoot, "pack")
  try {
    await copyTree(source, stagedPack)
    await validatePackDirectory(stagedPack)
    const copiedDigest = await digestPackDirectory(stagedPack, limits)
    if (copiedDigest.contentDigest !== sourceDigest.contentDigest)
      throw new RuntimeError(
        "invalid-pack",
        "Pack changed while it was being installed"
      )

    const destination = join(managedRoot, managedDirectoryName(name))
    return stagedManagedPack(
      stagingRoot,
      stagedPack,
      destination,
      name,
      copiedDigest
    )
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(
      () => undefined
    )
    throw error
  }
}

export async function stagePackZip(
  archivePath: string,
  managedRootPath: string,
  limits: PackContentLimits = defaultPackContentLimits
): Promise<StagedManagedPack> {
  const managedRoot = await prepareManagedRoot(managedRootPath)
  const archive = await resolveZipArchive(archivePath)
  const inspected = await inspectZipArchive(archive, limits)
  const stagingRoot = await mkdtemp(join(managedRoot, ".install-"))
  const stagedPack = join(stagingRoot, "pack")
  try {
    await mkdir(stagedPack, { recursive: false })
    await extractZipArchive(archive, stagedPack, inspected, limits)
    await validatePackDirectory(stagedPack)
    const digest = await digestPackDirectory(stagedPack, limits)
    const name = await readPackName(stagedPack)
    const destination = join(managedRoot, managedDirectoryName(name))
    return stagedManagedPack(stagingRoot, stagedPack, destination, name, digest)
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(
      () => undefined
    )
    throw error
  }
}

export async function stageManagedPack(
  name: string,
  managedRootPath: string
): Promise<StagedManagedPack> {
  const managedRoot = await prepareManagedRoot(managedRootPath)
  const stagingRoot = await mkdtemp(join(managedRoot, ".create-"))
  const stagedPack = join(stagingRoot, "pack")
  try {
    await mkdir(join(stagedPack, "skills"), { recursive: true })
    await writeFile(
      join(stagedPack, "pack.json"),
      `${JSON.stringify({ name }, null, 2)}\n`,
      { flag: "wx" }
    )
    const digest = await digestPackDirectory(stagedPack)
    const destination = join(managedRoot, managedDirectoryName(name))
    return stagedManagedPack(stagingRoot, stagedPack, destination, name, digest)
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(
      () => undefined
    )
    throw error
  }
}

function stagedManagedPack(
  stagingRoot: string,
  stagedPath: string,
  destination: string,
  name: string,
  digest: PackDigest
): StagedManagedPack {
  let committed = false
  return {
    name,
    path: destination,
    ...digest,
    async commit() {
      await rename(stagedPath, destination)
      committed = true
      await rmdir(stagingRoot).catch(() => undefined)
    },
    async discard() {
      if (committed) return
      await rm(stagingRoot, { recursive: true, force: true })
    },
  }
}

async function prepareManagedRoot(path: string): Promise<string> {
  await mkdir(path, { recursive: true })
  return realpath(path)
}

function managedDirectoryName(name: string): string {
  const slug = slugify(name) || "pack"
  return `${slug}-${randomUUID()}`
}

async function copyTree(source: string, destination: string): Promise<void> {
  const sourceRoot = await realpath(source)
  await copyTreeWithin(source, destination, sourceRoot)
}

async function copyTreeWithin(
  source: string,
  destination: string,
  sourceRoot: string
): Promise<void> {
  const initialMetadata = await lstat(source)
  if (!initialMetadata.isDirectory() || initialMetadata.isSymbolicLink())
    throw new RuntimeError(
      "invalid-pack",
      `Pack directory changed while copying: ${source}`
    )
  const resolvedSource = await realpath(source)
  if (!pathIsWithin(sourceRoot, resolvedSource))
    throw new RuntimeError(
      "invalid-pack",
      `Pack directory resolves outside its root: ${source}`
    )
  const confirmedMetadata = await lstat(resolvedSource)
  if (!confirmedMetadata.isDirectory() || confirmedMetadata.isSymbolicLink())
    throw new RuntimeError(
      "invalid-pack",
      `Pack directory changed while copying: ${source}`
    )

  await mkdir(destination, { recursive: false })
  const entries = await readdir(resolvedSource, { withFileTypes: true })
  entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  )
  for (const entry of entries) {
    const sourceEntry = join(resolvedSource, entry.name)
    const destinationEntry = join(destination, entry.name)
    const metadata = await lstat(sourceEntry)
    if (metadata.isSymbolicLink())
      throw new RuntimeError(
        "invalid-pack",
        `Pack contains a symbolic link: ${entry.name}`
      )
    if (metadata.isDirectory()) {
      await copyTreeWithin(sourceEntry, destinationEntry, sourceRoot)
      continue
    }
    if (!metadata.isFile())
      throw new RuntimeError(
        "invalid-pack",
        `Pack contains a special file: ${entry.name}`
      )
    await copyFileWithoutFollowing(sourceEntry, destinationEntry, entry.name)
  }
}

async function copyFileWithoutFollowing(
  source: string,
  destination: string,
  label: string
): Promise<void> {
  const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW
  let sourceFile
  try {
    sourceFile = await open(source, constants.O_RDONLY | noFollow)
  } catch {
    throw new RuntimeError(
      "invalid-pack",
      `Pack file changed while copying: ${label}`
    )
  }
  try {
    const metadata = await sourceFile.stat()
    if (!metadata.isFile())
      throw new RuntimeError(
        "invalid-pack",
        `Pack entry changed while copying: ${label}`
      )
    const destinationFile = await open(destination, "wx")
    try {
      for await (const chunk of sourceFile.createReadStream({
        autoClose: false,
      })) {
        await destinationFile.writeFile(chunk)
      }
    } finally {
      await destinationFile.close()
    }
  } finally {
    await sourceFile.close()
  }
}

type InspectedZipEntry = {
  archivePath: string
  compressedSize: number
  directory: boolean
  outputPath: string
  uncompressedSize: number
}

type InspectedZipArchive = {
  entries: InspectedZipEntry[]
  wrapper: string | null
}

async function resolveZipArchive(path: string): Promise<string> {
  let resolved: string
  try {
    resolved = await realpath(path)
  } catch {
    throw invalidZip("Pack ZIP does not exist")
  }
  if (!(await lstat(resolved)).isFile())
    throw invalidZip("Pack ZIP path is not a file")
  return resolved
}

async function inspectZipArchive(
  archivePath: string,
  limits: PackContentLimits
): Promise<InspectedZipArchive> {
  const entries: Omit<InspectedZipEntry, "outputPath">[] = []
  const archivePaths = new Set<string>()
  await walkZipEntries(archivePath, async (entry) => {
    if (entries.length > limits.maxEntries)
      throw invalidZip(
        `Pack ZIP contains more than ${limits.maxEntries} entries`
      )
    const inspected = inspectEntry(entry)
    if (archivePaths.has(inspected.archivePath))
      throw invalidZip(
        `Pack ZIP contains a duplicate path: ${inspected.archivePath}`
      )
    archivePaths.add(inspected.archivePath)
    entries.push(inspected)
  })

  if (entries.length === 0) throw invalidZip("Pack ZIP is empty")
  const wrapper = findWrapper(entries)
  const outputEntries = entries
    .map((entry) => ({
      ...entry,
      outputPath: stripWrapper(entry.archivePath, wrapper),
    }))
    .filter((entry) => entry.outputPath !== "")
  validateOutputTree(outputEntries, limits)
  return { entries: outputEntries, wrapper }
}

function inspectEntry(entry: Entry): Omit<InspectedZipEntry, "outputPath"> {
  const archivePath = normalizeArchivePath(entry.fileName)
  const directory = entryIsDirectory(entry)
  const unixType = unixFileType(entry)

  if (entry.isEncrypted())
    throw invalidZip(`Pack ZIP contains an encrypted entry: ${archivePath}`)
  if (unixType === 0o120000)
    throw invalidZip(`Pack ZIP contains a symbolic link: ${archivePath}`)
  if (unixType !== 0 && unixType !== 0o040000 && unixType !== 0o100000)
    throw invalidZip(`Pack ZIP contains a special entry: ${archivePath}`)
  if (directory && unixType === 0o100000)
    throw invalidZip(`Pack ZIP entry has conflicting file type: ${archivePath}`)
  if (!directory && unixType === 0o040000)
    throw invalidZip(`Pack ZIP entry has conflicting file type: ${archivePath}`)
  if (
    !directory &&
    entry.compressionMethod !== 0 &&
    entry.compressionMethod !== 8
  )
    throw invalidZip(
      `Pack ZIP uses an unsupported compression method: ${archivePath}`
    )

  return {
    archivePath,
    compressedSize: entry.compressedSize,
    directory,
    uncompressedSize: entry.uncompressedSize,
  }
}

function normalizeArchivePath(fileName: string): string {
  if (fileName.includes("\0"))
    throw invalidZip("Pack ZIP contains a NUL byte in a path")
  if (fileName.includes("\\"))
    throw invalidZip(`Pack ZIP contains a backslash path: ${fileName}`)
  if (fileName.startsWith("/") || /^[a-zA-Z]:/.test(fileName))
    throw invalidZip(`Pack ZIP contains an absolute path: ${fileName}`)

  const rawSegments = fileName.split("/")
  if (rawSegments.includes(".."))
    throw invalidZip(`Pack ZIP path escapes its root: ${fileName}`)
  const normalized = posix.normalize(fileName).replace(/\/$/, "")
  if (normalized === "" || normalized === ".")
    throw invalidZip(`Pack ZIP contains an empty path: ${fileName}`)
  if (normalized.startsWith("../") || normalized === "..")
    throw invalidZip(`Pack ZIP path escapes its root: ${fileName}`)
  return normalized
}

function findWrapper(
  entries: Omit<InspectedZipEntry, "outputPath">[]
): string | null {
  if (hasSkillsDirectory(entries.map((entry) => entry.archivePath))) return null

  const firstPath = entries[0]?.archivePath
  const wrapper = firstPath?.split("/")[0]
  if (!wrapper) throw invalidZip("Pack ZIP does not contain a Pack")
  if (
    !entries.every(
      (entry) =>
        entry.archivePath === wrapper ||
        entry.archivePath.startsWith(`${wrapper}/`)
    )
  )
    throw invalidZip(
      "Pack ZIP must contain a Pack at its root or in one wrapper folder"
    )
  const strippedPaths = entries
    .map((entry) => stripWrapper(entry.archivePath, wrapper))
    .filter(Boolean)
  if (!hasSkillsDirectory(strippedPaths))
    throw invalidZip("Pack ZIP does not contain a skills directory")
  return wrapper
}

function hasSkillsDirectory(paths: string[]): boolean {
  return paths.some((path) => path === "skills" || path.startsWith("skills/"))
}

function stripWrapper(path: string, wrapper: string | null): string {
  if (!wrapper) return path
  if (path === wrapper) return ""
  return path.slice(wrapper.length + 1)
}

function validateOutputTree(
  entries: InspectedZipEntry[],
  limits: PackContentLimits
): void {
  const archivePaths = new Set<string>()
  const logicalPaths = new Map<string, "directory" | "file">()
  let totalBytes = 0

  for (const entry of entries) {
    if (archivePaths.has(entry.outputPath))
      throw invalidZip(
        `Pack ZIP contains a duplicate path after removing its wrapper: ${entry.outputPath}`
      )
    archivePaths.add(entry.outputPath)

    const segments = entry.outputPath.split("/")
    const depth = entry.directory ? segments.length : segments.length - 1
    if (depth > limits.maxDepth)
      throw invalidZip(
        `Pack ZIP nesting exceeds ${limits.maxDepth} directories`
      )
    if (!entry.directory && entry.uncompressedSize > limits.maxFileBytes)
      throw invalidZip(
        `Pack ZIP file exceeds ${limits.maxFileBytes} bytes: ${entry.outputPath}`
      )
    if (!entry.directory) {
      totalBytes += entry.uncompressedSize
      if (totalBytes > limits.maxTotalBytes)
        throw invalidZip(
          `Pack ZIP expands beyond ${limits.maxTotalBytes} bytes`
        )
    }

    for (let index = 1; index < segments.length; index += 1)
      registerLogicalPath(
        logicalPaths,
        segments.slice(0, index).join("/"),
        "directory",
        limits
      )
    registerLogicalPath(
      logicalPaths,
      entry.outputPath,
      entry.directory ? "directory" : "file",
      limits
    )
  }
}

function registerLogicalPath(
  paths: Map<string, "directory" | "file">,
  path: string,
  kind: "directory" | "file",
  limits: PackContentLimits
): void {
  const existingKind = paths.get(path)
  if (existingKind && existingKind !== kind)
    throw invalidZip(`Pack ZIP contains a file and directory at: ${path}`)
  if (!existingKind) paths.set(path, kind)
  if (paths.size > limits.maxEntries)
    throw invalidZip(`Pack ZIP contains more than ${limits.maxEntries} entries`)
}

async function extractZipArchive(
  archivePath: string,
  destination: string,
  inspected: InspectedZipArchive,
  limits: PackContentLimits
): Promise<void> {
  let expectedIndex = 0
  let totalBytes = 0
  await walkZipEntries(archivePath, async (entry, zipFile) => {
    const raw = inspectEntry(entry)
    const outputPath = stripWrapper(raw.archivePath, inspected.wrapper)
    if (outputPath === "") return

    const expected = inspected.entries[expectedIndex]
    expectedIndex += 1
    if (
      !expected ||
      expected.archivePath !== raw.archivePath ||
      expected.outputPath !== outputPath ||
      expected.directory !== raw.directory ||
      expected.compressedSize !== raw.compressedSize ||
      expected.uncompressedSize !== raw.uncompressedSize
    )
      throw invalidZip("Pack ZIP changed while it was being installed")

    const target = resolve(destination, ...outputPath.split("/"))
    if (!pathIsWithin(destination, target))
      throw invalidZip(`Pack ZIP path escapes its root: ${raw.archivePath}`)
    if (raw.directory) {
      await mkdir(target, { recursive: true })
      return
    }

    await mkdir(dirname(target), { recursive: true })
    const stream = await openEntryStream(zipFile, entry)
    const file = await open(target, "wx")
    let fileBytes = 0
    try {
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        fileBytes += bytes.length
        totalBytes += bytes.length
        if (fileBytes > limits.maxFileBytes)
          throw invalidZip(
            `Pack ZIP file exceeds ${limits.maxFileBytes} bytes: ${outputPath}`
          )
        if (totalBytes > limits.maxTotalBytes)
          throw invalidZip(
            `Pack ZIP expands beyond ${limits.maxTotalBytes} bytes`
          )
        await file.writeFile(bytes)
      }
    } finally {
      stream.destroy()
      await file.close()
    }
    if (fileBytes !== raw.uncompressedSize)
      throw invalidZip(
        `Pack ZIP entry size changed while reading: ${outputPath}`
      )
  })
  if (expectedIndex !== inspected.entries.length)
    throw invalidZip("Pack ZIP changed while it was being installed")
}

async function walkZipEntries(
  archivePath: string,
  visit: (entry: Entry, zipFile: ZipFile) => Promise<void>
): Promise<void> {
  let zipFile: ZipFile | undefined
  try {
    const openedZipFile = await openZipFile(archivePath)
    zipFile = openedZipFile
    await new Promise<void>((resolveWalk, rejectWalk) => {
      let settled = false
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        rejectWalk(error)
      }
      zipFile?.once("error", fail)
      zipFile?.once("end", () => {
        if (settled) return
        settled = true
        resolveWalk()
      })
      zipFile?.on("entry", (entry: Entry) => {
        void visit(entry, openedZipFile).then(
          () => openedZipFile.readEntry(),
          fail
        )
      })
      openedZipFile.readEntry()
    })
  } catch (error) {
    if (error instanceof RuntimeError) throw error
    const message = error instanceof Error ? error.message : "Unknown ZIP error"
    throw invalidZip(`Cannot read Pack ZIP: ${message}`)
  } finally {
    zipFile?.close()
  }
}

function openZipFile(path: string): Promise<ZipFile> {
  return new Promise((resolveOpen, rejectOpen) => {
    yauzl.open(
      path,
      {
        autoClose: false,
        decodeStrings: true,
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (error, zipFile) => {
        if (error) rejectOpen(error)
        else resolveOpen(zipFile)
      }
    )
  })
}

function openEntryStream(zipFile: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolveStream, rejectStream) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) rejectStream(error)
      else resolveStream(stream)
    })
  })
}

function entryIsDirectory(entry: Entry): boolean {
  return entry.fileName.endsWith("/") || unixFileType(entry) === 0o040000
}

function unixFileType(entry: Entry): number {
  const platform = entry.versionMadeBy >>> 8
  if (platform !== 3) return 0
  return (entry.externalFileAttributes >>> 16) & 0o170000
}

function invalidZip(message: string): RuntimeError {
  return new RuntimeError("invalid-pack", message)
}

export function sourceLabel(path: string): string {
  return basename(path)
}
