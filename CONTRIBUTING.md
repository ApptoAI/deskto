# Contributing

## Read this first

Deskto is early and moves fast. We keep tight control over scope and direction, which means we accept less from outside than a mature project would. You can open a PR, but be aware we may close it, ask you to shrink it, or sit on it for a long time.

Feature requests and proposals go to [Discussions](https://github.com/ApptoAI/deskto/discussions). Issues are for bug reports.

## What has a good chance of getting merged

- Small, focused bug fixes.
- Small reliability or performance fixes.
- Maintenance work with a clear, narrow scope.

## What will probably get closed

- Large PRs.
- New features nobody discussed with us first.
- Rewrites of parts you find ugly.
- Anything that grows the product's scope on your initiative.

A thousand-line PR full of new features gets closed fast. The code can be excellent and it changes nothing, because we never agreed on the direction.

## Talk before you build

For anything beyond a small fix, start a discussion before writing code. We might say no, and hearing that before you spend a weekend on a branch is the whole point.

## If you open a PR

- Keep it small and single-purpose. Don't bundle unrelated fixes.
- Say what changed and why the change should exist.
- UI change? Include before and after screenshots.
- Motion, timing, or interaction change? Include a short video.

If we have to reverse-engineer your diff to understand it, the review will wait.

Before pushing, run:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

For pull requests from forks, CI and automated code review stay paused until a maintainer marks the change as ready for review. This is expected; you do not need to close and reopen the pull request.

The domain glossary lives in [`CONTEXT.md`](./CONTEXT.md) and past design decisions in [`docs/adr`](./docs/adr). PRs that contradict an accepted ADR need to argue with the ADR, not ignore it.

## No promises

An open PR doesn't obligate us to anything. We may close it, ignore it, or later build the same idea our own way. If you're fine with that, welcome.
