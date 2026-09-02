# ADR 0037: Pi as a third Harness

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
the Turn settles. Pi 0.80.4 is the floor: that release added the
`agent_settled` RPC event the adapter settles on, and an older Pi is reported
as unavailable with an update instruction rather than left running forever.

**Sessions.** The adapter reads `get_state` after launch. A fresh or forked
`sessionId` remains provisional until the first assistant message has been
persisted and a following `get_state` confirms its session file; only then is
it stored as the provider session. An existing resumed session can be stored
immediately. Later Turns pass `--session <id>`; a Side chat passes `--fork <id>`.

**Events.** `text_delta` becomes `message.delta`; `thinking_*` and
`toolcall_start` become progress; `tool_execution_start` and
`tool_execution_end` become one Activity each, with `bash` (or Pi's
`powershell`) as a command, `write` and `edit` as a file change, `grep`,
`find`, and `ls` as a search. The assistant message's `usage.totalTokens` and
the model's `contextWindow` from `get_state` feed `usage.updated`. `agent_end`
records the latest assistant outcome; only `agent_settled` settles the Turn,
after Pi's retries, compaction, and queued continuations finish. An assistant
`stopReason` of `error` fails it with Pi's `errorMessage`, which the shared
failure classifier maps to a usage limit when it reads like one.

**Permissions.** Approval-required mode loads a Deskto-written extension
(`deskto-approvals.mjs`, written under the app's user data) that hooks
`tool_call` and asks through `ctx.ui.confirm`. In RPC mode that surfaces as an
`extension_ui_request`; the adapter turns it into `approval.requested` and
answers with `extension_ui_response`. Read-only tools (`read`, `grep`,
`find`, `ls`) never ask. Cancelling a Turn dismisses any open dialog before
asking Pi to abort, because Pi's abort waits for the agent to go idle and a
blocked confirm never does. Full-access mode loads no extension. The `auto`
mode is not offered: Pi has no reviewer of its own to stand in for the person.

**Project trust.** RPC mode cannot show Pi's trust prompt, and Pi's default
`defaultProjectTrust: "ask"` then silently skips the project's own `.pi`
settings and skills. Trusting a folder also lets Pi install the packages a
checked-in `.pi/settings.json` names, lifecycle scripts included, before the
first prompt runs; `--no-extensions` does not stop that. Trust therefore
follows the permission mode the person chose for the task, which is the only
trust decision Deskto has from them. Full-access mode passes `--approve`: the
person let the agent run anything in that folder, and the folder's own Pi
configuration is part of that. Approval-required mode passes `--no-approve`
so nothing the repository controls runs before the person's first approval,
and hands the project's `.pi/skills` folder to Pi with `--skill` when it
exists, because a skill is text the model reads rather than code Pi runs,
and the inventory advertises it. Deskto never writes Pi's own `trust.json`;
a decision made in Deskto stays in Deskto.

**Discovery.** Availability is `pi --version` on the augmented PATH. Models
come from the `get_available_models` RPC command of a short-lived
`pi --mode rpc --no-session --no-extensions` process, since `--list-models`
prints no thinking levels. They are filtered to the `enabledModels` in Pi's
own `settings.json` when the person set any, matched the way Pi matches them
(exact reference, minimatch glob on the full or bare id, substring with
alias preference, optional `:thinking` suffix); a filter that would empty the
list is ignored so the menu never goes blank. The default is the model that
same process reports from `get_state`: launched without `--model`, Pi has
already applied its saved default, its `enabledModels` scope, and the
per-provider fallback table of the installed release, and those defaults
change between releases, so Deskto reads Pi's choice rather than keeping a
copy of one release's table. Thinking levels are Pi's `--thinking`
vocabulary minus what a model's `thinkingLevelMap` hides; `xhigh` and `max`
appear only when the map names them, because Pi clamps rather than rejects.
The default level is Pi's own choice for that model: its `modelThinkingLevels`
entry, then `defaultThinkingLevel`, then `medium`, clamped the way Pi clamps
(nearest supported level above, then below). An `enabledModels` entry that is
a bare model id matches the way Pi matches it, exactly when one provider
offers it, before any substring fallback.

**Customization.** Pack and host skill roots pass as `--skill <path>`;
shared Project instructions are written to a file under the app's user data
and passed as `--append-system-prompt <file>`, because Pi reads that flag as
a file whenever its value names an existing path and Windows caps a command
line well below the 64,000 characters instructions may hold. Prompt
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
- **Shared native skill roots.** The inventory lists Pi's own
  `~/.pi/agent/skills` and `.pi/skills`. Pi also reads `~/.agents/skills` and
  project `.agents/skills`, which the inventory already attributes to Codex.
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
- `PI_CODING_AGENT_DIR` is honoured when reading Pi's settings, read the way
  Pi reads it: `~` expands, a Git Bash or MSYS drive path becomes a Windows
  one, and a leading byte order mark in `settings.json` is ignored. A
  relative value is resolved once against Deskto's working directory and
  handed to every Pi process as an absolute path, because Pi would resolve
  it against each process's own folder and read a different directory for
  discovery than for a task.
- A model whose Pi snapshot lists only `text` input fails a Turn that carries
  an image attachment before the prompt is sent, with the model named and the
  two ways out.
