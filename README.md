# Deskto

Deskto is a local desktop app for giving folder-based work to Claude Code or Codex. The MVP has projects, tasks, model-generated task titles, streamed Markdown, model and permission controls, visible tool activity, approvals, cancellation, and resumable sessions.

## Requirements

- Node.js 22.18 or newer
- pnpm 10.33.4
- A Claude account already available to Claude Code
- Codex installed and signed in if you want to use the Codex harness

## Run locally

```bash
pnpm install
pnpm dev
```

The app stores its SQLite database in Electron's user data directory. Each harness starts in the project folder selected by the user. When a harness asks for approval, Deskto shows that request in the task.

After the first message, Deskto generates a short task title in a separate model call. It uses the task's agent and model by default; choose a dedicated model under Settings → Generated text.

## Check the project

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @deskto/desktop build
```

Create an unpacked desktop build with:

```bash
pnpm --filter @deskto/desktop package:dir
```

The domain glossary and package rules live in [`CONTEXT.md`](./CONTEXT.md). Accepted architecture decisions live in [`docs/adr`](./docs/adr).
