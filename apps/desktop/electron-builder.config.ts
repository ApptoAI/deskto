import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import type { AfterPackContext, Configuration } from "electron-builder"

const require = createRequire(import.meta.url)
// Packaging must prove pnpm's shared runtime dependencies survived app.asar collection before signing starts.
const packagedRuntimeModules = [
  "@hono/node-server",
  "ajv",
  "ajv-formats",
  "cors",
  "cross-spawn",
  "debug",
  "eventsource",
  "express",
  "express-rate-limit",
  "raw-body",
]

function installedElectronPath() {
  const packageDirectory = dirname(require.resolve("electron/package.json"))
  const relativePath = readFileSync(
    join(packageDirectory, "path.txt"),
    "utf8"
  ).trim()
  return join(packageDirectory, "dist", relativePath)
}

function verifyPackagedRuntime(context: AfterPackContext) {
  const resourcesDirectory =
    context.electronPlatformName === "darwin"
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources"
        )
      : join(context.appOutDir, "resources")
  const appArchive = join(resourcesDirectory, "app.asar")
  const verification = spawnSync(
    installedElectronPath(),
    [
      "-e",
      `const root = process.argv[1] + "/node_modules/"; require(root + "electron-updater"); for (const name of ${JSON.stringify(packagedRuntimeModules)}) require.resolve(root + name)`,
      appArchive,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    }
  )

  if (verification.status !== 0) {
    const reason =
      verification.error?.message || verification.stderr || verification.stdout
    throw new Error(`Packaged runtime dependency check failed.\n${reason}`)
  }
}

function windowsSigningOptions() {
  const tenantId = process.env.AZURE_TENANT_ID
  const clientId = process.env.AZURE_CLIENT_ID
  const clientSecret = process.env.AZURE_CLIENT_SECRET
  const endpoint = process.env.WINDOWS_SIGNING_ENDPOINT
  const codeSigningAccountName = process.env.WINDOWS_SIGNING_ACCOUNT_NAME
  const certificateProfileName =
    process.env.WINDOWS_SIGNING_CERTIFICATE_PROFILE_NAME
  const publisherName = process.env.WINDOWS_SIGNING_PUBLISHER_NAME

  if (
    !tenantId &&
    !clientId &&
    !clientSecret &&
    !endpoint &&
    !codeSigningAccountName &&
    !certificateProfileName &&
    !publisherName
  ) {
    return undefined
  }

  if (
    !tenantId ||
    !clientId ||
    !clientSecret ||
    !endpoint ||
    !codeSigningAccountName ||
    !certificateProfileName ||
    !publisherName
  ) {
    throw new Error(
      "Windows signing values must be either all configured or all absent."
    )
  }

  return {
    endpoint,
    codeSigningAccountName,
    certificateProfileName,
    publisherName,
  }
}

export default {
  appId: "to.deskto.desktop",
  productName: "Deskto",
  asar: true,
  asarUnpack: [
    "node_modules/@anthropic-ai/claude-agent-sdk-darwin-*/claude",
    "node_modules/@anthropic-ai/claude-agent-sdk-linux-*/claude",
    "node_modules/@anthropic-ai/claude-agent-sdk-win32-*/claude.exe",
  ],
  directories: {
    // Not the default "build" — the repo's .gitignore drops that name, and the
    // icons need to be committed.
    buildResources: "resources",
    output: "release",
  },
  afterPack: verifyPackagedRuntime,
  files: ["out/**/*", "package.json"],
  publish: {
    provider: "github",
    owner: "ApptoAI",
    repo: "deskto",
    releaseType: "release",
  },
  // Release assets are matched by this suffix: the website looks for
  // "-arm64.dmg", "-x64.dmg" and "-x64.exe" in the latest release. Linux
  // overrides it below. Changing the pattern changes what the site finds.
  artifactName: "${productName}-${version}-${arch}.${ext}",
  mac: {
    target: ["dmg", "zip"],
    icon: "resources/icon.icns",
  },
  win: {
    target: ["nsis"],
    icon: "resources/icon.ico",
    azureSignOptions: windowsSigningOptions(),
  },
  linux: {
    target: ["AppImage"],
    icon: "resources/icon.png",
    executableName: "deskto",
    // AppImageUpdater replaces this path in place. A versioned filename would
    // leave desktop shortcuts pointing at the deleted previous version.
    artifactName: "Deskto.${ext}",
  },
} satisfies Configuration
