import assert from "node:assert/strict"
import test from "node:test"

import {
  mergeUpdateManifests,
  parseUpdateManifest,
} from "./merge-mac-update-manifests.mjs"

const arm64Manifest = `version: 0.1.42
files:
  - url: Deskto-0.1.42-arm64.zip
    sha512: arm-zip
    size: 101
  - url: Deskto-0.1.42-arm64.dmg
    sha512: arm-dmg
    size: 102
path: Deskto-0.1.42-arm64.zip
sha512: arm-zip
minimumSystemVersion: '10.15'
releaseDate: '2026-08-20T10:00:00.000Z'
`

const x64Manifest = `version: 0.1.42
files:
  - url: Deskto-0.1.42-x64.zip
    sha512: intel-zip
    size: 201
  - url: Deskto-0.1.42-x64.dmg
    sha512: intel-dmg
    size: 202
path: Deskto-0.1.42-x64.zip
sha512: intel-zip
minimumSystemVersion: '10.15'
releaseDate: '2026-08-20T10:01:00.000Z'
`

test("merges both architectures into one updater manifest", () => {
  const merged = mergeUpdateManifests(arm64Manifest, x64Manifest)
  const parsed = parseUpdateManifest(merged)

  assert.deepEqual(
    parsed.files.map((file) => file.url),
    [
      "Deskto-0.1.42-arm64.zip",
      "Deskto-0.1.42-arm64.dmg",
      "Deskto-0.1.42-x64.zip",
      "Deskto-0.1.42-x64.dmg",
    ]
  )
  assert.equal(parsed.releaseDate, "'2026-08-20T10:01:00.000Z'")
  assert.equal(parsed.extras.get("minimumSystemVersion"), "'10.15'")
  assert.doesNotMatch(merged, /^path:/m)
  assert.doesNotMatch(merged, /^sha512:/m)
})

test("rejects manifests for different releases", () => {
  assert.throws(
    () =>
      mergeUpdateManifests(
        arm64Manifest,
        x64Manifest.replaceAll("0.1.42", "0.1.43")
      ),
    /different versions/
  )
})

test("rejects incomplete file metadata", () => {
  assert.throws(
    () => parseUpdateManifest(arm64Manifest.replace("    size: 101\n", "")),
    /every file needs/
  )
})
