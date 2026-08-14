# @openappto/harness-sdk

The provider-neutral contract between the Appto Runtime and the agent products that do the work. A Harness is an agent product such as Claude Code or Codex. This package defines what every Harness looks like to the Runtime: how it describes itself, how a session runs, which events it emits, and how approvals flow. It has zero runtime dependencies and no provider, Electron, database, or UI imports.

## Why it exists

Provider SDKs disagree about everything: message formats, permission models, session handles. If those types leaked into the Runtime or the UI, adding a second provider would mean touching both. Instead, each provider gets a Harness Adapter in the runtime package that translates its native protocol into the types defined here. The contract deliberately covers only what the Runtime uses; provider features without a UI or Runtime use case stay out (see `docs/adr/0002-provider-neutral-harness-sdk.md`).

## The contract

An adapter implements `HarnessAdapterFactory`:

- `descriptor`, the stable `{ id, name }` identity
- `checkAvailability()`, returning `available` (with an optional version) or `unavailable` with a reason
- `listModels()`, returning `HarnessModelOption` entries with supported reasoning efforts and permission modes, used to build the model picker
- `start(input, signal)`, which begins a turn and returns a `HarnessSession`
- optional `generateText(input, signal)`, a stateless call for small app-owned text that must not join a Thread's resumable provider session

`HarnessRunInput` carries the thread, turn, project path, prompt, execution profile, a `customization` value, and an optional `providerSessionId`, the opaque token that lets a provider resume an earlier session. The customization holds `skillRoots`: labeled directories of SKILL.md skill folders (`{ path, name }`) the adapter should make available to the session. Adapters translate it into native mechanisms and silently skip what the installed harness version cannot honor.

A `HarnessSession` exposes `events` (an `AsyncIterable<HarnessEvent>`), `cancel()`, and `respondToApproval(approvalId, decision)`. The event union has eight members: `session.started`, `message.delta`, `usage.updated`, `activity.started`, `activity.completed`, `approval.requested`, `turn.completed`, and `turn.failed`. A session emits at most one unresolved approval request at a time, and `usage.updated` reports how full the provider's context window is (`ContextUsage`).

`AsyncQueue` is the one value export: a small async iterable queue adapters use to push translated provider events to the Runtime as they arrive.

## Testing helpers

`@openappto/harness-sdk/testing` provides `ScriptedHarness`, a fake adapter for Runtime tests. Each `start()` call records a `ScriptedHarnessRun`, and the test drives the session by calling `emit(event)` and `finish()`, then asserts on `cancelled` and the recorded approval decisions. Runtime behavior gets tested without any provider installed.

## Adding a harness

Write an adapter class in `packages/runtime/src/harnesses/` that implements `HarnessAdapterFactory`, translate the provider's output into `HarnessEvent`s, and register it in the harness registry. Nothing in this package changes.
