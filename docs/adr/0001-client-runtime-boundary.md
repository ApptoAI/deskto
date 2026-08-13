# ADR 0001: Separate Clients from the Runtime

- Status: accepted
- Date: 2026-08-13

## Context

The MVP runs in Electron, but later versions may add web and mobile clients or connect to a hosted Runtime. Importing Electron or Node services from React would tie product behavior to the first Surface.

## Decision

Clients call a serializable Runtime protocol through a small transport interface. Electron IPC is the first transport. The Electron main process hosts the local Runtime.

The Client package owns task-oriented calls and subscriptions. React depends on the Client, never on IPC channel names. Runtime events update open views, while queries return complete current state after startup or reconnect.

## Consequences

- A future HTTP and WebSocket transport can implement the same Client contract.
- Runtime use cases do not depend on Electron.
- Desktop-only capabilities such as choosing a folder stay in the desktop bridge.
- The protocol needs explicit validation and versioning before untrusted remote connections are added.
