# ADR 0024: Local agent readiness checks

- Status: accepted
- Date: 2026-08-21

## Context

Finding an agent executable does not prove that it can accept a task. A CLI
can be signed out, too old for the control request used by its adapter, or
invisible to an Electron process whose inherited PATH differs from the
person's terminal. Reporting any of those states as ready leaves a task on a
working indicator without an actionable explanation.

ADR 0020 deliberately treated an inconclusive Claude account request as
available to avoid blocking older working installations. Reports from fresh
installs showed that this fallback instead hid missing setup. ADR 0018 bounded
silent Codex requests, but did not cover a Claude query that never emits its
first SDK message.

## Decision

Deskto treats readiness as a successful provider-specific account check, not
just executable discovery.

The Claude adapter reports signed out only when `accountInfo()` succeeds with
no usable identity. A failed account request reports that the account could
not be verified and tells the person to run `claude` in Terminal. This
supersedes ADR 0020's benefit-of-the-doubt fallback. A new Claude session must
emit its first SDK message within 30 seconds. An empty or silent stream emits
one terminal failure and closes the Harness event queue even if the provider
iterator does not stop promptly. This extends ADR 0018's silent-request rule
to Claude startup.

The Codex adapter uses one short-lived app-server process for both
initialization and `account/read`. Initialization supplies the version, and a
successful account response supplies readiness. Only an explicit
`requiresOpenaiAuth` response without an account is classified as signed out.
A missing executable gets installation guidance; other probe failures get
update and retry guidance. The whole probe is limited to eight seconds, below
the Harness registry deadline, and the process tree is closed on every path.

Before checking either agent, the desktop augments its inherited CLI PATH
without running shell profiles. On Windows it merges persisted user and
machine PATH values with common package-manager locations, can invoke the
system PowerShell by absolute path, and launches command shims through the
Windows-compatible process path. Closing a Windows command shim terminates its
descendant process tree as well as the wrapper.

## Consequences

- Settings no longer shows Ready when the adapter cannot verify that the
  local agent is usable.
- Missing, signed-out, and incompatible Codex installations have different
  next steps.
- A working but incompatible local CLI is unavailable until it is updated,
  instead of failing after a task has already started.
- Availability checks remain local and provider-specific; no hosted account
  or service is introduced.
