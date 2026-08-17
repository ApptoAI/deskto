# ADR 0016: Share one Task Browser with every Harness

- Status: accepted
- Date: 2026-08-17

## Context

The Task panel reserved Browser in ADR 0015, but the application had no web
runtime and Harnesses could not operate a page visible to the user. Claude
Code and Codex both support MCP, through different native configuration.
Deskto also runs Codex App Server with the person's existing Codex settings,
which may include the official Computer Use plugin.

Browser and Computer Use solve different problems. Browser controls an
isolated web tab owned by Deskto. Computer Use can operate other desktop apps
and requires operating-system permissions. Treating both as one shared
Harness capability would either leak Codex plugin details into the Runtime or
require Deskto to build a second desktop-control implementation for Claude.

## Decision

Each Task owns one Browser tab. Electron main creates its `WebContentsView`,
keeps the browser profile in a dedicated persistent partition, and owns all
navigation and input. The sandboxed renderer receives only a narrow desktop
bridge for positioning the view and operating its toolbar.

The Runtime can open app-owned Session Tool leases for a Turn. A lease returns
provider-neutral Streamable HTTP MCP server records and closes when the Turn
settles, fails, or is cancelled. The Browser server listens only on loopback
and gives every Turn a random, one-time bearer token. Initialization consumes
that token and returns an opaque MCP session id. Both credentials resolve to
one Task, and tool arguments cannot name another Task.

Harness Adapters translate the shared MCP record at their boundary:

- Claude Code receives an HTTP `mcpServers` entry through the Agent SDK.
- Codex receives App Server config overrides and the bearer token through a
  process environment variable. Its shell environment policy replaces the
  token with an empty value in agent-run commands.
- A future Harness must translate the same record or explicitly report that it
  cannot use MCP. Electron and the Task panel do not change for it.

Browser exposes bounded tools for status, navigation, semantic snapshots,
element refs, text entry, keyboard input, history, reload, and screenshots.
Tool descriptions direct agents to use Browser for websites and local web
apps. The first browser action asks the renderer to open the Browser surface,
so the user and agent see the same page.

Computer Use remains Codex-only. Deskto lets Codex App Server load the person's
installed plugins and configuration. It does not install, copy, disable, or
translate the official Computer Use plugin, and it does not advertise that
capability to another Harness.

## Consequences

- Browser behavior and UI remain independent from Claude Code, Codex, and any
  later Harness.
- MCP credentials live only for one Turn and never enter Runtime storage or a
  shell command environment.
- Browser cookies and logins persist across Tasks in Deskto's browser profile.
  Refs do not: a new snapshot replaces the previous ref map.
- Browser blocks non-HTTP navigation, popups, downloads, and page permission
  requests in this first implementation.
- Pages inside closed shadow roots and cross-origin frames may expose less
  semantic detail. Screenshot and keyboard tools remain available, but adding
  richer frame-aware selectors is separate work.
- Computer Use availability depends on the person's Codex installation and
  plugin settings. Claude sessions never receive it.
