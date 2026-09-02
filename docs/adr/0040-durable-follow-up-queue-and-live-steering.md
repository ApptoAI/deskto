# ADR 0040: Follow-ups are durable before live steering

- Status: accepted
- Date: 2026-09-02

## Context

A person could compose another message while a task was running, but the
Surface held it until the Harness stopped. The Harness SDK exposed events,
cancellation, and approvals only, even though the built-in Harnesses have
different ways to accept more input during a session. Sending directly to a
provider would improve responsiveness but would break the Runtime's promise
that a user Message exists in SQLite before a Harness receives it. It would
also leave providers without native steering unable to offer the same product
behavior.

The provider capabilities are not identical. Claude Code accepts a long-lived
stream of user messages and exposes interruption, but Agent SDK 0.3.231 does
not correlate interrupt receipts one-to-one with result frames. Suppressing a
result on the assumption that each interrupt creates an extra boundary can
discard the revised request's only terminal result. Codex app server exposes
`turn/steer` but no separate native follow-up queue. Pi RPC exposes both
`steer` and `follow_up`; Pi's steering is still a boundary operation rather
than token-stream interruption.

## Decision

**The Runtime owns one durable FIFO follow-up queue.** `turn.followUp` accepts
the same serializable input as `turn.start`. Before calling a live session, the
Runtime stores the user Message, its attachment bytes, the original semantic
references, and the already resolved Harness prompt and references in one
transaction. A queued Message has no Turn until it is promoted. It becomes the
user Message of a provisional new Turn only after the preceding Harness has
stopped, its output sweep has finished, and the Project activity lease has
been released. Its queue row remains durably marked `promoted` until
`harness.start` succeeds. A start rejection returns the same Message to
`queued`; startup does the same for any stranded promotion and removes its
interrupted provisional Turn. Queue retries use bounded backoff, and a Harness
availability transition retries immediately. Queued Messages therefore
survive process restart and are promoted in insertion order.

When the current session advertises steering, is actively running rather than
waiting for approval, and has no earlier follow-up, the Runtime marks the
durable Message as `steering` and calls `session.steer`. Acceptance attaches
the Message to the current Turn as `steered`; later assistant output opens a
new message segment below it. Rejection or a completion race returns the
Message to `queued`. On startup, any `steering` Message still in the queue is
also returned to `queued`, so a crash cannot drop it. A crash between provider
acceptance and the SQLite acknowledgement of either steering or a promoted
start can cause a retry; delivery is therefore at least once in those narrow
windows, not exactly once. The stable Message id is passed to providers that
accept a client correlation or idempotency key.

The Harness SDK descriptor advertises native `queue` and `steer` capabilities,
and every live session implements both methods. An unsupported method rejects.
The Runtime uses native steering for the interactive fast path but does not
delegate its durable queue to a provider: provider-native queues do not replace
SQLite, cannot preserve a Message across an application crash, and would blur
the boundary between the completed Turn and the next one.

The built-in Adapter capabilities are:

- **Claude Code — queue: yes, steer: no.** A session keeps the Agent SDK input
  iterable open, and `queue` writes a user message with priority `later`.
  Deskto does not use live Claude steering until the SDK provides robust
  correlation between interrupts and terminal result frames; the Runtime FIFO
  starts a new Turn instead.
- **Codex — queue: no, steer: yes.** `steer` calls app-server `turn/steer` with
  the current thread and expected Turn ids plus the Deskto Message id. Deskto's
  Runtime queue is the fallback whenever that request cannot be accepted.
- **Pi — queue: yes, steer: yes.** The Adapter maps the methods to RPC
  `follow_up` and `steer`. Pi consumes steering at its next agent-loop/model
  boundary after the current assistant or tool operation; it does not
  interrupt an in-flight model token stream. `agent_settled` remains the
  terminal edge and arrives only after Pi has consumed queued continuations.

## Consequences

- The running-task composer keeps both Stop and Send available. A submitted
  follow-up immediately appears as Steering or Queued until its disposition is
  settled.
- A successful steer from a capable Harness amends the current Turn. A queued
  follow-up starts a new Turn and retains the original Message identity and
  attachments through start failures and process restarts.
- All Surfaces get the same queue behavior through the Runtime protocol,
  independent of provider support.
- Native capability flags describe provider mechanics, not whether the Deskto
  product can accept a follow-up; the Runtime queue makes that product
  capability universal.
