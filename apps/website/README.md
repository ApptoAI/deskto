# @deskto/website

The marketing site for Deskto, built with Astro. Static output, no server. Two pages: the front page and `/download`.

Run it from the repo root:

```sh
pnpm website:dev
pnpm --filter @deskto/website build
pnpm --filter @deskto/website typecheck
```

Copy lives in the components under `src/components`: the headline and subline in `Hero.astro`, the feature cards in the `features` array in `Features.astro`, the Appto cells in `ApptoStrip.astro`, the first-open notes in `src/pages/download.astro`, and the meta title and description in `src/layouts/Layout.astro`.

Links to the repository live in `src/lib/links.ts`. Download buttons read the latest GitHub release in the browser (`src/lib/releases.ts`). Until that lookup finds the visitor's installer, the buttons link to `/download`; the installer cards on `/download` link to the GitHub releases page; the installer names they match are fixed by `artifactName` in `apps/desktop/electron-builder.config.ts` and described in `docs/release.md`. Design tokens mirror the desktop app's light palette and sit in `src/styles/site.css`. The product voice rules are in the root `AGENTS.md`.
