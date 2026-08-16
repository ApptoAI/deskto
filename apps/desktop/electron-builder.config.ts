import type { Configuration } from "electron-builder"

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
  },
  linux: {
    target: ["AppImage"],
    icon: "resources/icon.png",
  },
} satisfies Configuration
