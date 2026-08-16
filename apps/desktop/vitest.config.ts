import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

// The renderer builds through electron-vite, whose config describes three
// bundles at once and none of them a test run, so the tests get their own.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.ts"],
  },
})
