# ADR 0031: Screen control of the Task Browser over MCP

- Status: accepted
- Date: 2026-09-02

## Context

ADR 0016 gave every Harness one shared Task Browser through a private MCP
server with semantic tools: snapshot, refs, click by ref, type by ref. Those
tools stop short on pages that only respond to real pointer and keyboard
input: canvas apps, drag handles, custom widgets, keyboard shortcuts. The
same ADR kept Computer Use a Codex plugin capability because it operates the
whole desktop and needs operating-system permissions Deskto does not want to
own.

Anthropic's computer-use tool shape (screenshot, click, drag, scroll, type,
key) is what both Claude Code and Codex have been trained on. The Task
Browser's `WebContents` can already capture its page and take raw input, so
pixel-level control of that one page needs no operating-system access.

## Decision

`packages/runtime/src/computer-use` adds a second app-owned Session Tool
provider, `ComputerUseMcpServer`, using the MCP v2 server packages already
adopted for `@deskto/mcp-server`. It exposes `computer_screenshot`,
`computer_left_click`, `computer_right_click`, `computer_double_click`,
`computer_mouse_move`, `computer_left_click_drag`, `computer_scroll`,
`computer_type`, `computer_key`, `computer_wait`, `computer_cursor_position`,
and `computer_display_info`. Coordinates are pixel positions on the latest
screenshot, which is resized to the view's own size so HiDPI displays do not
double them. Key names follow xdotool, as the Anthropic tool documents.

The display is the Task's Browser page and nothing else. Electron implements
`ComputerUseHost` on the same `BrowserManager` that serves the Browser
tools, so screen actions take the same agent-input lease, open the Browser
panel on first use, and cannot run while the person is picking an element.
Tool arguments cannot name another Task; each Turn receives a one-time bearer
token that its lease revokes.

The Runtime translates each provider's input events, not the Harness
Adapters: the same `SessionMcpServer` record reaches Claude Code and Codex
through the translation ADR 0016 already established, so neither adapter
changes. `SessionToolInput` now carries the settings snapshot the Turn
started with; the provider returns no lease when
`computerUse.screen-control.enabled` is off. The setting is on by default
and lives in the Computer use settings tab (ADR 0030) as "Screen control".

## Consequences

- Both Harnesses get screen-level control of the Task Browser with no
  configuration, alongside the semantic Browser tools. Tool descriptions
  steer agents to the semantic tools first and to screen control when a page
  needs real input.
- Deskto still does not control other applications or the desktop. Computer
  Use of the operating system remains a Codex plugin capability outside
  Deskto, exactly as ADR 0016 decided.
- There is no per-click confirmation. Deskto has no confirmation mechanism
  for MCP tool calls, and inventing one only for this server would be a
  placeholder; a person who wants agents kept off the page turns Screen
  control off.
- Turning the setting off applies to Turns started afterwards. A running
  Turn keeps the lease it opened.
- The cursor position is what the last screen action set, kept per Task in
  the server; Electron does not report a page-local pointer.
