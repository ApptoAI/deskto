# Releasing the desktop app

A release is a manual run of the `Release` workflow (`.github/workflows/release.yml`): open Actions, pick Release, choose `Run workflow` on `main`. Nothing is scheduled and no tag push triggers it, because the signed macOS builds run on paid runners.

The run:

1. Sets the version to `0.1.<run number>` and tags that commit `v0.1.<run number>`. Nobody edits `version` in `apps/desktop/package.json` by hand; `.github/scripts/set-desktop-version.mjs` writes it during the build.
2. Runs lint, typecheck and tests on the release commit.
3. Builds Linux, then Windows, then macOS (both architectures in one job), so a cheap failure stops the run before a macOS runner starts. macOS is signed and notarized, Windows is signed with Microsoft Artifact Signing, and a build without a valid signature fails the run.
4. Publishes a draft GitHub release named `Deskto v0.1.<run number>` with generated notes, then publishes it and marks it latest once every asset is there. Installed copies pick it up through the update feeds (ADR 0021).

The website (`apps/website`) asks the GitHub API for `releases/latest` from the visitor's browser, so its download buttons point at the new files as soon as the release is public.

## What gets published

`artifactName` in `apps/desktop/electron-builder.config.ts` fixes the file names. The website matches downloads by these names (`apps/website/src/lib/releases.ts`), so a change there is a change in both places.

| File                         | Platform            |
| ---------------------------- | ------------------- |
| `Deskto-<version>-arm64.dmg` | macOS Apple Silicon |
| `Deskto-<version>-x64.dmg`   | macOS Intel         |
| `Deskto-<version>-x64.exe`   | Windows 10 and 11   |
| `Deskto.AppImage`            | Linux x86_64        |

The Linux file carries no version on purpose: the updater replaces it in place, and a versioned name would leave desktop shortcuts pointing at a deleted file. Its blockmap is embedded in the AppImage. The macOS zips, the Windows and macOS blockmaps, and the `latest*.yml` update feeds go up with the same release for the in-app updater.

## Trying a build locally

`pnpm --filter @deskto/desktop package` builds the installer for the machine it runs on into `apps/desktop/release/`, unsigned, with the version from `package.json`.
