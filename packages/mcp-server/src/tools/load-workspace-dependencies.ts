import { z } from "zod"

import { artifactRuntimeDependenciesSchema } from "../types.js"
import { defineTool } from "./definition.js"
import { textResult } from "./format.js"

export const loadWorkspaceDependenciesTool = defineTool({
  name: "load_workspace_dependencies",
  config: {
    title: "Load workspace dependencies",
    description:
      "Return the preinstalled executables and dependency paths for creating, editing, rendering, and verifying spreadsheets, documents, presentations, and PDFs. Call this before using @oai/artifact-tool or bundled Office and PDF libraries. Use only the returned paths and do not modify the dependency directories.",
    inputSchema: z.object({}),
    outputSchema: artifactRuntimeDependenciesSchema,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  handler: async (_input, { artifactRuntime }) => {
    if (!artifactRuntime) {
      throw new Error("The preinstalled artifact runtime is unavailable")
    }
    return textResult(artifactRuntime)
  },
})
