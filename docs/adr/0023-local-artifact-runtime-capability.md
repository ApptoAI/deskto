# ADR 0023: Local artifact runtime capability

- Status: accepted
- Date: 2026-08-20

## Context

OpenAI's document, spreadsheet, presentation, and PDF skills can require a
preinstalled artifact runtime. Those skills direct the Harness to call
`load_workspace_dependencies` and to stop when that loader is absent. Codex
can discover an installed skill through its plugin configuration even when a
third-party host did not provide the matching loader. In that partial state,
the agent advertises file creation but refuses the task after reading the
skill.

Deskto already gives every Harness Turn a private, authenticated MCP
connection. Asking the agent to infer dependency locations would make the
result depend on model persistence and would contradict the installed skills'
safety rules.

## Decision

The Electron main process discovers the local OpenAI artifact runtime before
starting Deskto's MCP server. Discovery checks, in order, an explicit
`DESKTO_ARTIFACT_RUNTIME_ROOT`, the `openai-primary-runtime` marketplace source
in the active Codex home, and the standard Codex runtime cache. A candidate is
accepted only when it matches the current platform and architecture. Its
manifest, executable Node and Python files, binary directories, artifact
skills, required PDF and Office commands, and matching `@oai/artifact-tool`
package must also be accessible. A bounded probe starts Python and imports the
artifact package's declared root export with the runtime's own Node executable.

When discovery succeeds, `packages/mcp-server` registers the read-only
`load_workspace_dependencies` tool. It returns the validated Node, Python,
module, binary, and version paths. It does not install packages, modify the
runtime, or let the Harness choose an arbitrary dependency directory. Both
Claude Code and Codex receive the same Turn-scoped MCP capability through
their existing adapter configuration. Deskto passes the installed skill roots
to Codex as extra roots and to Claude Code through its existing local plugin
shims.

When discovery fails, the tool is not advertised. A broken or partial runtime
therefore cannot masquerade as a working file-generation capability.

## Consequences

- Installed OpenAI artifact skills can create and verify XLSX, DOCX, PPTX, and
  PDF outputs with either supported Harness inside Deskto, without a manual
  path or dependency setup.
- CSV creation no longer inherits a false missing-module blocker when the
  spreadsheet skill is installed with its runtime.
- Dependency directories remain read-only. Builders and final files stay in
  the Project or temporary directory according to the skill instructions.
- Deskto does not yet distribute OpenAI's artifact runtime. Machines without a
  complete local runtime do not receive this tool and need a separately
  available file-generation skill or runtime.
