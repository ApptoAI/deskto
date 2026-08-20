import { latestReleaseApiUrl } from "./links"

// One entry per installer the Release workflow publishes. The suffixes
// follow artifactName in apps/desktop/electron-builder.config.ts; the two
// have to move together. Linux ships as "Deskto.AppImage" without a version,
// so the updater can replace it in place.
export interface Installer {
  id: "macos-arm64" | "macos-x64" | "windows-x64" | "linux-x64"
  os: "macOS" | "Windows" | "Linux"
  title: string
  format: string
  suffix: string
}

export const installers: readonly Installer[] = [
  {
    id: "macos-arm64",
    os: "macOS",
    title: "Apple Silicon",
    format: ".dmg",
    suffix: "-arm64.dmg",
  },
  {
    id: "macos-x64",
    os: "macOS",
    title: "Intel",
    format: ".dmg",
    suffix: "-x64.dmg",
  },
  {
    id: "windows-x64",
    os: "Windows",
    title: "Windows 10 and 11",
    format: ".exe",
    suffix: "-x64.exe",
  },
  {
    id: "linux-x64",
    os: "Linux",
    title: "x86_64",
    format: "AppImage",
    suffix: ".AppImage",
  },
]

export interface Release {
  version: string
  notesUrl: string
  downloads: { installer: Installer["id"]; url: string }[]
}

// The fields read from GitHub's release object:
// https://docs.github.com/rest/releases/releases#get-the-latest-release
interface GitHubRelease {
  tag_name: string
  html_url: string
  assets: { name: string; browser_download_url: string }[]
}

const cacheKey = "deskto-latest-release"

// GitHub allows 60 unauthenticated requests an hour per address. One visit
// asks once; both pages read the same cached answer.
function readCache(): Release | null {
  const cached = sessionStorage.getItem(cacheKey)
  if (!cached) return null
  const release: Release = JSON.parse(cached)
  return release
}

function toRelease(payload: GitHubRelease): Release {
  const downloads: Release["downloads"] = []
  for (const installer of installers) {
    const asset = payload.assets.find((asset) =>
      asset.name.endsWith(installer.suffix)
    )
    if (asset) {
      downloads.push({
        installer: installer.id,
        url: asset.browser_download_url,
      })
    }
  }
  return { version: payload.tag_name, notesUrl: payload.html_url, downloads }
}

// Resolves to null while the repository has no published release. Throws on
// network and rate-limit failures, so callers keep their static links.
export async function fetchLatestRelease(): Promise<Release | null> {
  const cached = readCache()
  if (cached) return cached
  const response = await fetch(latestReleaseApiUrl, {
    headers: { Accept: "application/vnd.github+json" },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub responded ${response.status}`)
  const payload: GitHubRelease = await response.json()
  if (!Array.isArray(payload.assets)) {
    throw new Error("GitHub release payload has no assets list")
  }
  const release = toRelease(payload)
  sessionStorage.setItem(cacheKey, JSON.stringify(release))
  return release
}

export function downloadUrl(
  release: Release,
  installer: Installer["id"]
): string | null {
  return release.downloads.find((d) => d.installer === installer)?.url ?? null
}

// Client hints carry the CPU architecture in Chromium; no other browser
// exposes it, and Safari reports every Mac as Intel in its user agent.
interface NavigatorUAData {
  getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }>
}
declare global {
  interface Navigator {
    userAgentData?: NavigatorUAData
  }
}

export async function detectInstaller(): Promise<Installer | null> {
  const ua = navigator.userAgent
  const byId = (id: Installer["id"]) =>
    installers.find((installer) => installer.id === id) ?? null
  if (/iPhone|iPad|iPod|Android/.test(ua)) return null
  if (/Windows/.test(ua)) return byId("windows-x64")
  if (/Macintosh/.test(ua)) {
    // iPadOS asks for desktop pages as a Mac, and tells itself apart only by
    // touch.
    if (navigator.maxTouchPoints > 1) return null
    try {
      const hints = await navigator.userAgentData?.getHighEntropyValues([
        "architecture",
      ])
      if (hints?.architecture === "arm") return byId("macos-arm64")
      if (hints?.architecture === "x86") return byId("macos-x64")
    } catch {
      // Older Chromium rejects the hint; treat it as unknown.
    }
    // Without the hint the architecture is unknown (Safari says Intel on
    // every Mac), so the button keeps pointing at the page with both builds.
    return null
  }
  if (/Linux/.test(ua)) {
    // Only an x86_64 AppImage ships; anything else, or a user agent that
    // does not say, gets the page instead.
    if (!/x86_64|amd64/i.test(ua)) return null
    return byId("linux-x64")
  }
  return null
}
