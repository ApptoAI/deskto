# Deskto

Deskto is an Electron desktop app that lets non-technical people hand folder-based work to local AI agents. A local Runtime in the Electron main process owns projects, tasks, and SQLite state; the React Surface reaches it only through a serializable protocol over IPC; Harness Adapters translate Claude Code and Codex into one provider-neutral contract.

## The person we build for

Deskto's user, "the person" in this file and in CONTEXT.md, runs a sales pipeline, not a terminal. UI copy says "task" and "project", never Thread or Harness. An error tells them what to do next. A result is a previewable file, not a path in a transcript.

Everything runs on their machine with their existing Claude or Codex subscription. No account, no hosted service, no telemetry dependency. The Client/Runtime protocol stays serializable so a hosted Runtime can exist later without rewriting Clients.

## Start with CONTEXT.md

- `CONTEXT.md` is the single source for the glossary, core rules, and package boundaries. Capitalized terms (Thread, Turn, Harness, Pack, Artifact) are defined there and nowhere else. Its "Deliberately deferred" list forbids placeholder services and UI for future features.
- `docs/adr/` records accepted decisions. A change that contradicts an ADR argues with the ADR in a new one; it does not silently diverge. New behavior decisions get recorded the same way.
- `docs/agents/domain.md` describes how skills consume these docs.

## Architecture

A Surface calls the Client, the Client calls the Runtime protocol over a transport (Electron IPC today), and Runtime use cases write current state to SQLite in transactions. There is no event sourcing: events are invalidation signals and sequenced thread deltas that keep an open view current, and any gap falls back to a full query.

Harness Adapters run provider SDKs and emit Harness SDK events; provider types never leave their adapter. A feature that touches provider behavior gets settled separately for Claude Code and for Codex, and skipping one of them is a written choice, never an accident. `@deskto/mcp-server` runs in-process so a Harness can spawn and search background Threads without any user setup.

## Package map

- `packages/protocol`: serializable requests, events, domain records, and the guard predicates both sides share
- `packages/harness-sdk`: provider-neutral contracts and test helpers, zero heavy dependencies
- `packages/runtime`: use cases, SQLite, Harness Adapters
- `packages/client`: transport wrapper any Surface uses
- `packages/settings`: the registry of every user-configurable setting
- `packages/mcp-server`: thread orchestration and search over MCP
- `packages/ui`: DOM components and design tokens, no Electron, no Runtime
- `apps/desktop`: Electron main hosting the Runtime, a narrow preload bridge, the React Surface

The boundary rules for these packages are in CONTEXT.md. Treat a boundary break as a bug, even when the import happens to work.

## Design

The interface stays calm while agents work. Activity never reorders lists or steals focus; status travels on indicators, and a row moves only at a lifecycle transition. Inter carries everything a person reads, Geist Mono everything machine-shaped. Light and dark are mirrored palettes, both first-class. The design tokens and the reasoning behind them live in `packages/ui/src/styles/globals.css`, in the comments.

## Real user data

- The SQLite database and managed project folders under Electron's user data directory are live user state. Copy them when you need realistic test data; experiments and cleanup happen on the copy.
- Many core rules end with "nothing on disk is touched": deleting a Workspace, unlinking a Pack. Deleting a Thread is the only destructive task action. Keep it that way.
- The Runtime persists user messages before starting a Harness. Any change that could lose a person's message on a crash breaks a promise the app makes.

## Finish the whole change

Half-done changes are the house defect: the path you exercised works while a sibling stays broken. Before calling work done, answer these:

- Does it behave under both harnesses, or is the gap a recorded decision?
- Does it hold in light and in dark?
- Can the person leave every state they can now enter, and see the way out? Snooze has wake, done has restore.
- Is the validity rule a shared predicate in `packages/protocol`, or did a copy sneak into a component?
- Did CONTEXT.md or `docs/adr/` need an update?

## Working here

`pnpm install`, then `pnpm dev` for the desktop app. Verify with `pnpm typecheck`, `pnpm lint`, and `pnpm test`, or scope to a package with `pnpm --filter @deskto/desktop test`. Tests sit next to the code as `*.test.ts(x)`.

Lint includes custom anti-slop rules (`tools/oxlint/anti-slop`) that ban `unknown` laundering, runtime `typeof` tricks, and unexplained type assertions. When one fires, fix the types; the escape hatch is a `SAFETY:` comment that explains why the assertion holds.

Comments in this codebase state constraints the code cannot show, and nothing else. Match that.

## Commits, PRs, issues

- Commit titles use conventional prefixes and plain words: `fix: detect project template copy races`.
- A PR carries one change. Anything visual gets screenshots of both states; anything about timing or motion gets a short recording.
- The contribution policy is in `CONTRIBUTING.md`.
- Issues live on GitHub via the `gh` CLI; conventions in `docs/agents/issue-tracker.md`.
