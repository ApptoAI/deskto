# @deskto/website

The marketing site for Deskto, built with Astro. Static output, no server.

Run it from the repo root:

```
pnpm website:dev
pnpm --filter @deskto/website build
pnpm --filter @deskto/website typecheck
```

Copy lives in the components under `src/components`: the headline and subline in `Hero.astro`, the feature cards in the `features` array in `Features.astro`, the Appto cells in `ApptoStrip.astro`, and the meta title and description in `src/layouts/Layout.astro`. Design tokens mirror the desktop app's light palette and sit in `src/styles/site.css`. The product voice rules are in the root `AGENTS.md`.
