# Appto

Appto is a local desktop app for giving folder-based work to Claude Code or Codex. The MVP has projects, tasks, streamed Markdown, model and permission controls, visible tool activity, approvals, cancellation, and resumable sessions.

## Requirements

- Node.js 22.12 or newer
- pnpm 10.33.4
- A Claude account already available to Claude Code
- Codex installed and signed in if you want to use the Codex harness

## Run locally

```bash
pnpm install
pnpm dev
```

The app stores its SQLite database in Electron's user data directory. Each harness starts in the project folder selected by the user. When a harness asks for approval, Appto shows that request in the task.

## Check the project

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @openappto/desktop build
```

Create an unpacked desktop build with:

```bash
pnpm --filter @openappto/desktop package:dir
```

The domain glossary and package rules live in [`CONTEXT.md`](./CONTEXT.md). Accepted architecture decisions live in [`docs/adr`](./docs/adr).
