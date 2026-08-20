# ADR 0021: Desktop updates from GitHub Releases

- Status: accepted
- Date: 2026-08-20

## Context

Deskto releases installers for macOS, Windows, and Linux through one GitHub
Actions workflow. macOS and Windows packages are signed. People should not need
to watch the repository, download each new installer, or compare version
numbers themselves. Updates also cannot become a Runtime concern because they
replace the desktop application that hosts the local Runtime.

## Decision

Packaged desktop builds use `electron-updater` with the public Deskto GitHub
Releases repository as their update provider. Electron Builder produces the
platform update metadata and blockmaps beside each installer. The release
workflow publishes those files only after every platform build succeeds.

The Electron main process owns update checks, downloads, and installation. It
exposes only serializable state plus check and install commands through the
desktop preload bridge. The Runtime protocol, Client, and settings registry do
not know about application updates.

Deskto checks once shortly after launch and every four hours while it remains
open. It downloads an available stable release in the background and installs
it on normal quit. Once the download finishes, the project sidebar and the
About settings page offer an explicit restart. Development builds report that
updates require an installed copy instead of contacting GitHub.

CI assigns pre-1.0 versions as `0.1.<workflow run number>`. The version is
written into the desktop package before each platform build, and the running
application reads that packaged value through Electron.

## Consequences

- Public GitHub Releases provide installers and update feeds without another
  hosted service.
- A release remains invisible to installed applications until every platform
  package and its metadata reach the same GitHub Release.
- macOS updates require signing and notarization. Windows releases also require
  a configured signing identity, and the workflow rejects an unsigned build.
- Private repository releases are not a supported update source. The feature
  becomes operational when the repository and its releases are public.
- Changing the release host or adding prerelease channels requires another
  explicit distribution decision.
