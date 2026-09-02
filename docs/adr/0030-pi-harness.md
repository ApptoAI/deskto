# ADR 0030: Pi as a third Harness

- Status: accepted
- Date: 2026-09-02

## Context

Deskto runs tasks through Claude Code and Codex. Pi, the open-source coding
agent by Mario Zechner (`@earendil-works/pi-coding-agent`, CLI `pi`), lets a
person bring any provider they already pay for: Anthropic, OpenAI, Google,
OpenRouter, a local llama.cpp, and more. Its `--mode rpc` speaks LF-delimited
JSON over stdin and stdout, streams text and tool events, persists sessions
under `~/.pi/agent/sessions` keyed by working directory, and can resume or
fork a session by id. It has no permission prompt of its own: every tool runs
unless an extension blocks it.

## Decision

Pi joins the Harness registry with id `pi`. The adapter lives in
`packages/runtime/src/harnesses/pi` and mirrors the Codex adapter: one
`pi --mode rpc` process per Turn, launched in the Project folder, closed when
the Turn settles.

**Sessions.** The adapter reads `get_state` after launch and stores Pi's
`sessionId` as the provider session. Later Turns pass `--session <id>`; a
Side chat passes `--fork <id>`.

**Events.** `text_delta` becomes `message.delta`; `thinking_*` and
`toolcall_start` become progress; `tool_execution_start` and
`tool_execution_end` become one Activity each, with `bash` as a command,
`write` and `edit` as a file change, `grep`, `find`, and `ls` as a search. The
assistant message's `usage.totalTokens` and the model's `contextWindow` from
`get_state` feed `usage.updated`. `agent_end` settles the Turn: an assistant
`stopReason` of `error` fails it with Pi's `errorMessage`, which the shared
failure classifier maps to a usage limit when it reads like one.

**Permissions.** Approval-required mode loads a Deskto-written extension
(`deskto-approvals.mjs`, written under the app's user data) that hooks
`tool_call` and asks through `ctx.ui.confirm`. In RPC mode that surfaces as an
`extension_ui_request`; the adapter turns it into `approval.requested` and
answers with `extension_ui_response`. Read-only tools (`read`, `grep`,
`find`, `ls`) never ask. Full-access mode loads no extension. The `auto` mode
is not offered: Pi has no reviewer of its own to stand in for the person.

**Discovery.** Availability is `pi --version` on the augmented PATH. Models
come from `pi --list-models`, filtered to the `enabledModels` in Pi's own
`settings.json` when the person set any, with Pi's `defaultProvider` and
`defaultModel` marked default. Thinking levels are Pi's `--thinking`
vocabulary for models that report reasoning support.

**Customization.** Pack and host skill roots pass as `--skill <path>`;
shared Project instructions pass as `--append-system-prompt`. Prompt
references become plain lines in the prompt. Discovered Pi extensions are
turned off with `--no-extensions` because an interactive extension would ask
questions nobody can answer over RPC.

## Deliberately deferred

- **MCP servers.** Pi has no native MCP client; the Runtime's Browser and
  Task orchestration servers are not offered to Pi sessions. A Pi extension
  bridging Streamable HTTP MCP to Pi tools would close this gap.
- **Account readiness.** ADR 0024 asks for a provider account check before
  reporting Ready. Pi supports many providers and `pi auth check` needs one
  named, so the adapter reports Ready on a working `pi --version` and a
  missing key surfaces as the first Turn's failure with Pi's own message.
- **Native skill roots.** Pi discovers skills from `~/.pi/agent/skills` and
  `.pi/skills`; the inventory does not list them yet.
- **Plans and subagents.** Pi's plan-mode and subagent packages are
  extensions, disabled by `--no-extensions`; no plan or subagent Activities
  are emitted.
- **Rate-limit reset times.** Pi reports none; usage-limit failures carry no
  `resetAt`.

## Consequences

- A person with Pi installed sees it beside Claude Code and Codex in the agent
  menu, onboarding, and settings, with a monochrome mark.
- The Codex `jsonl-client` lends Pi its process-tree termination; both
  adapters close a wrapper's descendants on Windows the same way.
- `PI_CODING_AGENT_DIR` is honoured when reading Pi's settings, matching Pi's
  own override.
