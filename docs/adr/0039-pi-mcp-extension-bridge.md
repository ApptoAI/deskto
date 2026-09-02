# ADR 0039: Bridge Runtime MCP servers into Pi with an extension

- Status: accepted
- Date: 2026-09-02

## Context

Deskto's Runtime leases private Streamable HTTP MCP servers to each Harness
Turn. They provide background tasks, the Task Browser, and screen control
without setup by the person. Claude Code and Codex accept those servers in
their native configuration. Pi deliberately has no native MCP client, so ADR
0037 deferred them and left Pi without capabilities available to the other
Harnesses.

Pi supports selected extensions that register custom tools. Deskto already
uses one for approvals while disabling discovered extensions in RPC mode.

## Decision

The Pi adapter writes a Deskto-owned `deskto-mcp.mjs` extension beside its
approval extension and loads it explicitly with `--extension`. It keeps
`--no-extensions`, so repository and user extensions are not enabled as a
side effect.

The Runtime-provided server records are serialized only into the Pi child
process environment. The extension removes that value after reading it,
performs the Streamable HTTP initialize handshake for each server, paginates
`tools/list`, and registers every remote tool with `pi.registerTool`. Tool
names and input schemas stay unchanged, matching what the app-owned servers
advertise; duplicate names across leased servers fail startup rather than
silently replacing a tool. Calls proxy to `tools/call`, pass Pi's abort signal
to the HTTP request, preserve MCP text and image content, and surface MCP tool
errors as Pi tool errors. Pi's `session_shutdown` closes stateful MCP sessions.

The bridge implements the small Streamable HTTP surface it uses rather than
importing the MCP client package. Pi loads the extension in a separate Node
process from a user-data directory, where dependencies bundled inside
Electron's ASAR are not resolvable. A self-contained extension therefore
keeps packaged and development behavior the same.

Provider extension objects and events remain inside the Pi adapter. The
Runtime still supplies only the provider-neutral `SessionMcpServer` records
defined by `@deskto/harness-sdk`.

## Consequences

- Pi receives Deskto's background-task, Browser, and screen-control tools
  with the same zero-setup lease lifecycle as Claude Code and Codex.
- Bearer tokens do not appear in command-line arguments or extension files.
- A server that cannot initialize or list tools prevents the Pi Turn from
  starting instead of silently removing promised capabilities.
- Pi's context includes every leased MCP tool description, the tradeoff Pi
  cites for omitting native MCP. Deskto accepts that cost for its bounded,
  app-owned capabilities rather than enabling arbitrary user MCP servers.
