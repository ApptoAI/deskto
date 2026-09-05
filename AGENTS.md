# Deskto

Electron desktop app that lets non-technical people hand folder-based work to local AI agents. A local Runtime in the Electron main process owns projects, tasks, and SQLite state. The React Surface reaches it only through a serializable protocol over IPC. Harness Adapters translate Claude Code, Codex, and Pi into one provider-neutral contract.

## The person

Deskto's user runs a sales pipeline, not a terminal. UI copy says "task" and "project", never Thread or Harness. Errors say what to do next. Results are previewable files, not paths in a transcript. Everything runs on their machine with their existing Claude or Codex subscription. No account, no hosted service.

## Docs

`CONTEXT.md` is the glossary, core rules, and package boundaries. Capitalized terms (Thread, Turn, Harness, Pack, Artifact) are defined there only. Its "Deliberately deferred" list forbids placeholder services for future features. `docs/adr/` holds accepted decisions; contradicting one means writing a new one. Read these when the change touches vocabulary, boundaries, or a recorded decision.

## Architecture

Surface calls Client, Client calls the Runtime protocol over a transport, Runtime use cases write current state to SQLite in transactions. No event sourcing: events are invalidation signals and sequenced thread deltas, and any gap falls back to a full query. Provider types never leave their adapter. A feature touching provider behavior gets settled for every harness; skipping one is a written choice. `@deskto/mcp-server` runs in-process so a Harness can spawn and search background Threads without setup.

Packages: `protocol` (requests, events, records, shared guard predicates), `harness-sdk` (provider-neutral contracts, no heavy deps), `runtime` (use cases, SQLite, adapters), `client` (transport wrapper), `settings` (registry of user settings), `mcp-server`, `ui` (DOM components and tokens, no Electron or Runtime), `apps/desktop` (Electron main, narrow preload, React Surface). Boundary rules are in CONTEXT.md; a break is a bug even if the import works.

## Design

Calm while agents work: activity never reorders lists or steals focus, rows move only at lifecycle transitions. Inter for what people read, Geist Mono for what's machine-shaped. Light and dark are mirrored, both first-class. One shell with one opaque pane inset on it, monochrome, typography-first. The sidebar sits on the shell with no rule; the pane's hairline border is the only persistent edge, and inside it hairlines appear only where a relationship needs one. Blur is native under the shell or on popovers, never over content. Status is the shape of a glyph, not its colour. Hue is reserved for the provider mark, a Workspace swatch, and the one destructive action. Tokens and reasoning live in `packages/ui/src/styles/globals.css`. A new colour argues with `docs/adr/0028-flat-typography-first-surface.md`; a new edge, fill, or blur argues with `docs/adr/0029-shell-and-pane.md`.

## Real user data

The SQLite database and managed folders under Electron's user data dir are live state. Copy them for test data. Deleting a Thread is the only destructive task action; everything else leaves disk untouched. User messages persist before a Harness starts; never risk losing one on a crash.

## Finish the whole change

Before calling work done: every harness (or a recorded gap), light and dark, every state has a way out (snooze has wake, done has restore), validity rules live as shared predicates in `packages/protocol`, and CONTEXT.md or an ADR got updated if needed.

## Working here

`pnpm install`, `pnpm dev`. `pnpm typecheck`, `pnpm lint`, `pnpm test`, or `pnpm --filter @deskto/desktop test`. Tests sit next to code as `*.test.ts(x)`. Custom lint rules (`tools/oxlint/anti-slop`) ban `unknown` laundering, runtime `typeof` tricks, and unexplained assertions; fix the types, or explain with a `SAFETY:` comment. Comments state constraints the code can't show, nothing else.

## Commits, PRs, issues

Commit freely and push your own branch. Ask once before pushing to `main`, then keep going for the job. Titles use conventional prefixes and plain words. One change per PR. Visual changes get screenshots of both states; timing or motion gets a short recording. CodeRabbit auto review is off: comment `@coderabbitai review` on open and after every push. Policy in `CONTRIBUTING.md`, issues via `gh` (`docs/agents/issue-tracker.md`).

## Settings copy

Labels and controls only. No explanatory descriptions, page subtitles, or promotional filler. Keep actionable errors and current status.
