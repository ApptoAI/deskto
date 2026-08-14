import path from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import type { Plugin } from "vite"

import { packagedMetaContentSecurityPolicy } from "./src/main/csp.js"

// The packaged renderer loads over file://, where responses carry no HTTP
// headers, so its Content-Security-Policy has to live in the document itself.
// The directives are shared with the header policies in src/main/csp.ts.
function injectContentSecurityPolicy(): Plugin {
  return {
    name: "inject-content-security-policy",
    apply: "build",
    transformIndexHtml: (html) => ({
      html,
      tags: [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: packagedMetaContentSecurityPolicy(),
          },
          injectTo: "head-prepend",
        },
      ],
    }),
  }
}

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
    plugins: [react(), tailwindcss(), injectContentSecurityPolicy()],
  },
})
