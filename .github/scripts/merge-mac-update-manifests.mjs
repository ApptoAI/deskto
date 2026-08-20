import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const TOP_LEVEL_FIELD = /^([A-Za-z][\w-]*):\s*(.*)$/
const FILE_URL = /^  - url:\s*(.+)$/
const FILE_FIELD = /^    (sha512|size):\s*(.+)$/

function scalarValue(raw) {
  const value = raw.trim()
  const quoted =
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  return quoted ? value.slice(1, -1) : value
}

export function parseUpdateManifest(source, label = "manifest") {
  const manifest = {
    version: null,
    releaseDate: null,
    files: [],
    extras: new Map(),
  }
  let currentFile = null
  let readingFiles = false

  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (line.trim() === "") continue

    if (line === "files:") {
      readingFiles = true
      currentFile = null
      continue
    }

    if (readingFiles) {
      const urlMatch = line.match(FILE_URL)
      if (urlMatch) {
        currentFile = { url: urlMatch[1], sha512: null, size: null }
        manifest.files.push(currentFile)
        continue
      }

      const fileFieldMatch = line.match(FILE_FIELD)
      if (fileFieldMatch && currentFile) {
        currentFile[fileFieldMatch[1]] = fileFieldMatch[2]
        continue
      }

      if (line.startsWith(" ")) {
        throw new Error(`${label}:${index + 1}: unsupported files entry`)
      }
      readingFiles = false
      currentFile = null
    }

    const fieldMatch = line.match(TOP_LEVEL_FIELD)
    if (!fieldMatch) {
      throw new Error(`${label}:${index + 1}: unsupported manifest syntax`)
    }

    const [, key, rawValue] = fieldMatch
    if (!rawValue) {
      throw new Error(`${label}:${index + 1}: ${key} must be a scalar value`)
    }
    if (key === "version") {
      manifest.version = rawValue
    } else if (key === "releaseDate") {
      manifest.releaseDate = rawValue
    } else if (key !== "path" && key !== "sha512") {
      manifest.extras.set(key, rawValue)
    }
  }

  if (!manifest.version) throw new Error(`${label}: missing version`)
  if (manifest.files.length === 0) throw new Error(`${label}: missing files`)
  for (const file of manifest.files) {
    if (!file.url || !file.sha512 || !file.size) {
      throw new Error(`${label}: every file needs url, sha512, and size`)
    }
    if (!Number.isSafeInteger(Number(scalarValue(file.size)))) {
      throw new Error(
        `${label}: invalid file size for ${scalarValue(file.url)}`
      )
    }
  }

  return manifest
}

function assertCompatible(primary, secondary) {
  if (scalarValue(primary.version) !== scalarValue(secondary.version)) {
    throw new Error("macOS update manifests have different versions")
  }
  if (primary.extras.size !== secondary.extras.size) {
    throw new Error("macOS update manifests have different metadata")
  }
  for (const [key, value] of primary.extras) {
    if (scalarValue(value) !== scalarValue(secondary.extras.get(key) ?? "")) {
      throw new Error(`macOS update manifests disagree on ${key}`)
    }
  }
}

function newestReleaseDate(primary, secondary) {
  if (!primary) return secondary
  if (!secondary) return primary
  return Date.parse(scalarValue(secondary)) > Date.parse(scalarValue(primary))
    ? secondary
    : primary
}

export function mergeUpdateManifests(primarySource, secondarySource) {
  const primary = parseUpdateManifest(primarySource, "primary manifest")
  const secondary = parseUpdateManifest(secondarySource, "secondary manifest")
  assertCompatible(primary, secondary)

  const files = [...primary.files, ...secondary.files]
  const urls = new Set(files.map((file) => scalarValue(file.url)))
  if (urls.size !== files.length) {
    throw new Error("macOS update manifests contain duplicate file URLs")
  }

  const lines = [`version: ${primary.version}`, "files:"]
  for (const file of files) {
    lines.push(
      `  - url: ${file.url}`,
      `    sha512: ${file.sha512}`,
      `    size: ${file.size}`
    )
  }
  for (const [key, value] of primary.extras) lines.push(`${key}: ${value}`)
  const releaseDate = newestReleaseDate(
    primary.releaseDate,
    secondary.releaseDate
  )
  if (releaseDate) lines.push(`releaseDate: ${releaseDate}`)
  return `${lines.join("\n")}\n`
}

async function main([primaryPath, secondaryPath, outputPath]) {
  if (!primaryPath || !secondaryPath || !outputPath) {
    throw new Error(
      "usage: merge-mac-update-manifests.mjs <primary> <secondary> <output>"
    )
  }
  const [primary, secondary] = await Promise.all([
    readFile(primaryPath, "utf8"),
    readFile(secondaryPath, "utf8"),
  ])
  await writeFile(outputPath, mergeUpdateManifests(primary, secondary))
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ""
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
