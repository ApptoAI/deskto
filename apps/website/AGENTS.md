# Website

Static Astro site for Deskto: the front page and `/download`. No framework components, no server.

- Dev server: `astro dev --background`, managed with `astro dev stop|status|logs`. Preview a build with `astro preview`.
- `pnpm --filter @deskto/website build` must pass before a PR. `typecheck` runs `astro check`.
- Copy follows the root voice: the reader runs a sales pipeline. "task" and "project", never Thread or Harness. Every claim must be true of the product per the root `README.md` and `CONTEXT.md`. The hero lists only shipped agents.
- Download links work before any script runs and before the first release: static href to the download page or GitHub releases, upgraded client-side once a release carries that installer. Installer names come from `apps/desktop/electron-builder.config.ts` (listed in `docs/release.md`); `src/lib/releases.ts` matches by suffix.
- Prose: no em dashes, no emojis, sentence case headings, one idea per sentence.
- Tokens in `src/styles/site.css` mirror the desktop light palette from `packages/ui/src/styles/globals.css`. The site is light only by choice.

Astro docs: https://docs.astro.build
