import path from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@openappto/protocol", "@openappto/runtime"],
        include: ["@anthropic-ai/claude-agent-sdk"],
      }),
    ],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@": path.resolve("src/renderer"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
})
