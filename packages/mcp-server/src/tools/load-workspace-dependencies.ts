import { z } from "zod"

import { defineTool } from "./definition.js"
import { textResult } from "./format.js"

const dependenciesSchema = z.object({
  rootPath: z.string(),
  nodeExecutable: z.string(),
  nodeModulesPath: z.string(),
  pythonExecutable: z.string(),
  binaryPaths: z.array(z.string()),
  versions: z.object({
    bundle: z.string(),
    artifactTool: z.string(),
    node: z.string(),
    python: z.string(),
  }),
})

export const loadWorkspaceDependenciesTool = defineTool({
  name: "load_workspace_dependencies",
  config: {
    title: "Load workspace dependencies",
    description:
      "Return the preinstalled executables and dependency paths for creating, editing, rendering, and verifying spreadsheets, documents, presentations, and PDFs. Call this before using @oai/artifact-tool or bundled Office and PDF libraries. Use only the returned paths and do not modify the dependency directories.",
    inputSchema: z.object({}),
    outputSchema: dependenciesSchema,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  handler: async (_input, { artifactRuntime }) => {
    if (!artifactRuntime) {
      throw new Error("The preinstalled artifact runtime is unavailable")
    }
    return textResult(artifactRuntime)
  },
})
