# Deskto

Deskto is an Electron desktop app that lets non-technical people hand folder-based work to local AI agents. A local Runtime in the Electron main process owns projects, tasks, and SQLite state; the React Surface talks to it only through a serializable protocol over IPC; Harness Adapters translate Claude Code and Codex into one provider-neutral contract.

You are an agent changing Deskto. "We" are the maintainers. The "person" is the non-technical user Deskto is built for.

## What we protect

1. **Built for non-developers.** The person using Deskto runs a sales pipeline, not a terminal. UI copy says "task" and "project", never Thread or Harness. Errors must say what to do next. A result is a previewable file, not a path in a transcript.

2. **A provider-neutral core.** Provider types stay inside their Harness Adapter. A feature shaped by providers needs a decision per adapter, even when the decision is "not supported here". The Runtime converts provider output into Harness SDK events before anything reaches a Client.

3. **Local first.** Everything runs on the person's machine with their existing Claude or Codex subscription. No account, no hosted service, no telemetry dependency. The Client/Runtime protocol stays serializable so a hosted Runtime can exist later without rewriting Clients.

4. **A calm interface.** Agent activity never reorders lists or steals focus; status travels on indicators, position changes only at lifecycle transitions. Inter carries everything a person reads, Geist Mono everything machine-shaped. Light and dark are mirrored, both first-class. The design tokens and the reasoning behind them live in `packages/ui/src/styles/globals.css`, in the comments.

## A note from Marcel

Small models win. Before adding machinery, check whether an existing rule in CONTEXT.md already decides the question; most of the time it does. The "Deliberately deferred" list there is a fence, not a backlog: those boundaries reserve room for future features and forbid placeholder services for them today. When a rule in this file fights the task in front of you, say so and get sign-off instead of quietly breaking it.

## Read before changing domain behavior

- `CONTEXT.md` is the single source for the glossary, core rules, and package boundaries. Capitalized terms (Thread, Turn, Harness, Pack, Artifact) are defined there and nowhere else.
- `docs/adr/` records accepted decisions. A change that contradicts an ADR argues with the ADR in a new one; it does not silently diverge. New behavior decisions get recorded the same way.
- `docs/agents/domain.md` describes how skills consume these docs.

## How it works

A Surface calls the Client, the Client calls the Runtime protocol over a transport (Electron IPC today), and Runtime use cases write current state to SQLite in transactions. There is no event sourcing: events are invalidation signals and sequenced thread deltas that keep an open view current, and any gap falls back to a full query. Harness Adapters run provider SDKs and emit Harness SDK events. `@deskto/mcp-server` runs in-process so a Harness can spawn and search background Threads without any user setup.

## Where code lives

- `packages/protocol`: serializable requests, events, domain records, and the guard predicates both sides share
- `packages/harness-sdk`: provider-neutral contracts and test helpers, zero heavy dependencies
- `packages/runtime`: use cases, SQLite, Harness Adapters
- `packages/client`: transport wrapper any Surface uses
- `packages/settings`: the registry of every user-configurable setting
- `packages/mcp-server`: thread orchestration and search over MCP
- `packages/ui`: DOM components and design tokens, no Electron, no Runtime
- `apps/desktop`: Electron main hosting the Runtime, a narrow preload bridge, the React Surface

The boundary rules for these packages are in CONTEXT.md. Treat a boundary break as a bug, even when the import happens to work.

## Ways to hurt the person

- The SQLite database and managed project folders under Electron's user data directory are real user state. Copy them for test data; never run experiments against them or clean them up.
- Many core rules end with "nothing on disk is touched": deleting a Workspace, unlinking a Pack. Deleting a Thread is the only destructive task action. Keep it that way.
- The Runtime persists user messages before starting a Harness. Any change that could lose a person's message on a crash breaks a promise the app makes.

## Walk every path

Changes here tend to fail by omission: the path you exercised works, and a sibling path silently doesn't. Before calling work done, check which of these apply:

- Harnesses. Claude Code and Codex each need the feature to work, or an explicit decision that it doesn't.
- Both themes. The palettes are mirrored ladders; a color that only works in dark mode is half a change.
- Reverse states. Snooze needs unsnooze, done needs restore, a way in needs a visible way out.
- Shared guards. Action validity lives in `packages/protocol` predicates used by Runtime and Client alike. Never hand-copy a guard into a component.
- Docs. New or changed terms go to CONTEXT.md; decisions go to `docs/adr/`.

## Working here

`pnpm install`, then `pnpm dev` for the desktop app. Verify with `pnpm typecheck`, `pnpm lint`, and `pnpm test`, or scope to a package with `pnpm --filter @deskto/desktop test`. Tests sit next to the code as `*.test.ts(x)`.

Lint includes custom anti-slop rules (`tools/oxlint/anti-slop`) that ban `unknown` laundering, runtime `typeof` tricks, and unexplained type assertions. When one fires, fix the types; the escape hatch is a `SAFETY:` comment that explains why the assertion holds.

Comments in this codebase state constraints the code cannot show, and nothing else. Match that.

## Commits, PRs, issues

- Conventional commit titles in plain language: `fix: detect project template copy races`.
- One concern per PR. UI changes carry before/after screenshots; motion carries a short video.
- The contribution policy is in `CONTRIBUTING.md`.
- Issues live on GitHub via the `gh` CLI; conventions in `docs/agents/issue-tracker.md`.
