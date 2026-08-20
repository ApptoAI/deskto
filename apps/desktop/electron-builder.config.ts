import type { Configuration } from "electron-builder"

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
    !tenantId ||
    !clientId ||
    !clientSecret ||
    !endpoint ||
    !codeSigningAccountName ||
    !certificateProfileName ||
    !publisherName
  ) {
    return undefined
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
  files: ["out/**/*", "package.json"],
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
  },
} satisfies Configuration
