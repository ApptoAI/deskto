# ADR 0005: Keep execution settings provider-neutral

- Status: accepted
- Date: 2026-08-13

## Context

People need to choose a model, thinking level, and permission mode without learning the native Claude Code or Codex protocols. The available models and thinking levels vary by Harness version and account. Both Harnesses also report tool work in different shapes.

## Decision

A Thread owns an Execution Profile containing a model identifier, optional thinking level, and one of three permission modes: approval required, automatic review, or full access. The Runtime validates the entire profile against the selected Harness before saving it. A Turn snapshots the profile at start so later changes do not rewrite history.

Harness Adapters discover their model catalogs dynamically and map the shared permission modes to native settings. They also normalize tool lifecycle events into bounded activity summaries. The Runtime persists those summaries with their Turn and marks unfinished activity as failed after interruption or recovery.

## Consequences

- The Client can offer one provider-neutral control set without importing provider types, while hiding permission modes a selected model cannot honor.
- New model and thinking options appear without an application release when a Harness exposes them.
- Full access remains an explicit, visible choice and is never selected by default.
- Provider-specific permission profiles and live tool output remain deferred until they have a product use case.
- Activity summaries support progress in chat but are not a security audit trail.
