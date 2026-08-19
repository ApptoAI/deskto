# Deskto

Deskto is a local desktop app for giving folder-based work to Claude Code or Codex. It has projects, tasks, model-generated task titles, streamed Markdown, model and permission controls, visible tool activity, approvals, cancellation, resumable sessions, and reusable Packs of agent skills.

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

To work on the first-run wizard, `pnpm desktop:dev:onboarding` shows it on every launch with real agent detection; `pnpm desktop:dev:onboarding:fresh` additionally reports both agents as unavailable, whatever this machine has installed.

The app stores its SQLite database in Electron's user data directory. Each harness starts in the project folder selected by the user. When a harness asks for approval, Deskto shows that request in the task.

The Skills screen reads native project and computer skills from disk. Deskto can also install an app-owned Pack or link an existing Pack folder, then attach it to every project in a Workspace. A successful Pack configuration means Deskto passed its skill root to the selected harness. It does not mean the harness used a particular skill.

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

The domain glossary and package rules live in [`CONTEXT.md`](./CONTEXT.md). Accepted architecture decisions live in [`docs/adr`](./docs/adr). The Skills manager scope and acceptance checks live in [`docs/skills-manager-mvp.md`](./docs/skills-manager-mvp.md).
