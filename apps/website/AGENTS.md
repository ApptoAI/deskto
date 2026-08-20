# Website

Static Astro site for Deskto. Two pages (the front page and `/download`), no framework components, no server.

## Working here

- Start the dev server in background mode so it does not block the terminal: `astro dev --background`. Manage it with `astro dev stop`, `astro dev status`, and `astro dev logs`. Preview a build with `astro preview` from `dist/`.
- `pnpm --filter @deskto/website build` must pass before a PR. `pnpm --filter @deskto/website typecheck` runs `astro check`.
- Copy follows the root `AGENTS.md` voice: the reader runs a sales pipeline, not a terminal. Say "task" and "project", never Thread or Harness. Every claim on the page must be true of the product as documented in the root `README.md` and `CONTEXT.md`.
- The hero lists only shipped agents. A logo on the page is a promise the first run has to keep.
- Download links work before any script runs and before the first release: the static href is the download page or the GitHub releases page, and the browser upgrades it to the direct file only once the latest release carries that installer. Installer names come from `apps/desktop/electron-builder.config.ts` and are listed in `docs/release.md`; `src/lib/releases.ts` matches them by suffix.
- Prose rules: no em dashes, no decorative emojis, sentence case headings, plain words, one idea per sentence.
- Design tokens in `src/styles/site.css` mirror the desktop app's light palette from `packages/ui/src/styles/globals.css`. The site is light only by choice; the app is not.

Astro docs: https://docs.astro.build
