# ADR 0020: First-run onboarding wizard

- Status: accepted
- Date: 2026-08-19

## Context

A fresh install could land in a workbench with no usable agent: the composer
disabled, one muted sentence explaining why, and no path from there to a
working setup. The gap was invisible in development because the Claude
adapter's health check hardcoded `available` — the bundled SDK always exists,
so "installed" was never the question. Whether the CLI is signed in was, and
nothing asked it.

## Decision

Deskto shows a seven-step welcome wizard (Welcome, The inbox, Projects,
Orchestration, Appearance, Connect an agent, Create your first project) on
every boot until one persisted flag,
`onboarding.completed`, is set by finishing or skipping. The flag is a
registry setting with the new non-rendering `hidden` input kind, mirrored
into localStorage the same way the theme is, so the gate answers before the
settings snapshot loads.

The wizard is a Workbench-level early return, more modal than Settings: it
replaces the sidebars, error strips, and keyboard shortcuts until dismissed.
It stays inside Workbench rather than above it because the project step
reuses the workspace selection and the create-project dialog that already
live there.

The Claude adapter now asks the SDK's `accountInfo()` control request whether
anyone is signed in. Third-party providers count as signed in — their auth is
external — and a CLI that cannot answer the request keeps today's
`available`, because a false negative would brick working installs while a
false positive only delays the answer to `listModels`.

`pnpm desktop:dev:onboarding` sets `DESKTO_FORCE_ONBOARDING=1`, which the
renderer reads through the preload to ignore the persisted flag while real
detection keeps running — a machine with agents walks the happy path. The
`:fresh` variant adds `DESKTO_SIMULATE_NO_AGENTS=1`, which the main process
reads to wrap both harnesses in a delegating always-unavailable stub. The
stub keeps the real descriptors and the production reason strings, so the
forced wizard is pixel-identical to what a fresh machine shows. The flags are
separate because a single switch made the connect step look broken on a
developer machine: the stubs can never turn green.

## Consequences

- Existing users see the wizard once after upgrading; with agents already
  detected it pre-confirms and takes two clicks.
- Every availability probe now spawns a short-lived Claude CLI, bounded by
  the registry's existing 10s timeout and 30s freshness window.
- The connect step force-refreshes harnesses every 15 seconds while nothing
  is available, so a sign-in completed in a terminal appears without a
  restart.
