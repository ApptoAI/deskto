import type { Configuration } from "electron-builder"

export default {
  appId: "to.appto.desktop",
  productName: "Appto",
  asar: true,
  asarUnpack: [
    "node_modules/@anthropic-ai/claude-agent-sdk-darwin-*/claude",
    "node_modules/@anthropic-ai/claude-agent-sdk-linux-*/claude",
    "node_modules/@anthropic-ai/claude-agent-sdk-win32-*/claude.exe",
  ],
  directories: {
    output: "release",
  },
  files: ["out/**/*", "package.json"],
  mac: {
    target: ["dmg", "zip"],
  },
  win: {
    target: ["nsis"],
  },
  linux: {
    target: ["AppImage"],
  },
} satisfies Configuration
