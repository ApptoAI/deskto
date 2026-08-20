# Deskto

Deskto is a desktop agent orchestrator for work that isn't software engineering. It runs Claude Code and Codex on your machine, on your existing subscriptions, and wraps them in an interface built for GTM, growth, sales, ops, and research work.

> [!WARNING]
> Deskto is a work in progress under active development. Expect bugs, expect breaking changes, sometimes several times a day. Don't build on top of it yet.

## Is Deskto for you?

Probably not, if you're a software engineer looking for a GUI to write code with. Deskto is not a coding tool, and there are good projects built exactly for that use case:

- [t3code](https://github.com/pingdotgg/t3code)
- [orca](https://github.com/stablyai/orca)
- [conductor](https://www.conductor.build/)

Deskto is for the other kind of agent work: preparing an outbound campaign, digging through a folder of contracts, turning call notes into a report, keeping a research project moving over weeks. If you use Claude Cowork or Codex Work today, you'll feel at home here. We hold strong opinions about how AI should be used for this kind of work, and we're happy to argue about them in [Discussions](https://github.com/ApptoAI/deskto/discussions).

## What you get

**Your subscriptions, not another API bill.** Deskto drives the agent CLIs already installed on your computer. Claude Code and Codex are supported today; more providers are planned. Sign in to the CLI once and Deskto uses that account.

**An inbox, not a chat list.** Tasks live in an inbox with pinned, active, later, and done sections. Agent activity never reorders the list, so your muscle memory holds; status travels on a colored dot instead. Snooze a task and it comes back at the time you picked, or earlier if it fails or needs your answer. Quiet tasks close themselves after a few days, but a failed task stays visible until you deal with it. One inbox can also span every project in a workspace.

**Tasks that delegate.** An agent in a chat can spin up child tasks: sibling agents that run in the background, can use a different provider than their parent, and can search your prior work. They show up as real tasks, nested under their parent, each with its own conversation, approvals, and files.

**Projects with real folders.** Every project is a folder on disk, either managed by Deskto or linked to a folder you already have. Projects carry a description and shared instructions, and reusable Packs of agent skills can be attached across a whole workspace. Agents work inside the project folder, ask for approval when they need it, and their results show up as previewable files, not paths in a transcript.

## Install it

Installers for macOS, Windows and Linux are on the [releases page](https://github.com/ApptoAI/deskto/releases/latest). How a release is cut is in [`docs/release.md`](./docs/release.md).

## Run it locally

Requirements:

- Node.js 22.18 or newer
- pnpm 10.33.4
- Claude Code signed in, and/or Codex installed and signed in

```bash
pnpm install
pnpm dev
```

The app stores its SQLite database in Electron's user data directory. To work on the first-run wizard, `pnpm desktop:dev:onboarding` shows it on every launch with real agent detection; `pnpm desktop:dev:onboarding:fresh` additionally reports both agents as unavailable, whatever this machine has installed.

To create an unpacked desktop build:

```bash
pnpm --filter @deskto/desktop package:dir
```

## Contributing

We accept contributions, with one ask: for anything bigger than a small fix, open a [discussion](https://github.com/ApptoAI/deskto/discussions) or an issue before writing the PR. The project moves fast and its direction is opinionated, so agreeing on the shape first saves everyone a rewritten branch. Details live in [CONTRIBUTING.md](./CONTRIBUTING.md).

Before you start:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

The domain glossary and package rules live in [`CONTEXT.md`](./CONTEXT.md). Accepted architecture decisions live in [`docs/adr`](./docs/adr); they're short and they explain why the code looks the way it does.

## License

[MIT](./LICENSE)
