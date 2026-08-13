# ADR 0002: Put the shared Harness contract in `harness-sdk`

- Status: accepted
- Date: 2026-08-13

## Context

Claude Code and Codex expose different session, streaming, cancellation, and approval protocols. More Harnesses may follow. Provider details in Runtime use cases would turn each new integration into a cross-cutting change.

## Decision

`packages/harness-sdk` defines `HarnessAdapterFactory`, `HarnessSession`, descriptors, inputs, and normalized events. Runtime adapters translate native protocols at the boundary. The shared contract contains only behavior that the Runtime uses.

A Thread stores the Harness identifier and an opaque provider session identifier. The Client sees the Harness descriptor but not its SDK types or wire messages.

## Consequences

- Adding a Harness requires a new adapter and registry entry.
- Provider-specific features can be lost during normalization. Add a shared concept only after a Runtime or UI use case needs it.
- Contract tests can run against scripted Harness sessions without launching external tools.
