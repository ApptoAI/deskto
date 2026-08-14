# ADR 0007: Task inbox with pinned, later, and done sections

- Status: accepted
- Date: 2026-08-14

## Context

The sidebar lists tasks ordered by `updated_at`, so a task jumps to the top whenever the agent writes anything. Finished work, parked work, and work in flight share one flat list, and the only signal on a row is the current harness status. A task that completed while the user was elsewhere looks the same as one they already read. CONTEXT.md reserves an inbox but the MVP shipped without one.

Two timestamps the inbox needs do not exist on the thread record. `updated_at` moves on profile changes and provider session writes, so it can neither drive an inactivity rule nor mark unread completions.

## Decision

The task list becomes an inbox with four sections, in order: pinned tasks, active tasks, a collapsible "Later" shelf, and a collapsible "Done" shelf. The same component serves the single-project view and the all-projects view; the latter adds a project label per row.

Ordering is static. Agent activity never reorders the list: active tasks sort by creation time, newest first, and a row moves only when it changes section. Status is carried by the row's dot, not by position. Later sorts by wake time, soonest first, because the shelf answers "what comes back next". Done sorts by when the work ended.

The thread record gains explicit facts, stamped by the Runtime: `lastUserMessageAt` when a turn begins, `lastTurnCompletedAt` when a turn completes (not on cancel or failure), `failedAt` on the transition into the failed status (cleared on any other outcome), and `lastVisitedAt` when the user opens a task that has an indicator to clear. `failedAt` exists because `updatedAt` also moves on profile and session writes, so it cannot tell a fresh failure from an old one. Organization fields follow: `pinnedAt`, `snoozedUntil` plus `snoozedAt`, and `doneOverride` plus `doneAt`. Organization writes do not touch `updated_at`.

Section membership is computed client-side by pure functions over thread records, in priority order: snoozed, then pinned, then done, then active.

Done is a classification, not an archive. A task with a running turn or a pending approval never classifies as done, even when the user marked it done. Past that guard the explicit override wins in both directions: "done" closes the task, "active" keeps it in the inbox and disables the automatic rule. Without an override, a task closes itself after three quiet days, except a failed task, which stays visible until the user acts. An elapsed snooze wake counts as activity for that window: the user scheduled the task to come back, so a snooze longer than the window returns the task to the inbox instead of closing it on arrival. Restoring a done task sets the override to "active" so it does not immediately re-close. Real activity (a new turn) clears the override and the snooze on the Runtime side, so a stale override cannot hide new work and a task the user just prompted cannot sit hidden on the Later shelf. The three-day window is a constant in the client package until the settings registry grows a numeric editor.

Later is an overlay on the active state. A snoozed task hides from the inbox until its wake time, but wakes early when something outranks the snooze: a pending approval, a failure newer than the snooze, or a turn that completed after the snooze was set. No Runtime event fires at the wake time; the stale fields simply stop classifying the task as snoozed. Because a woken task returns to its original position, a "back" indicator on the row carries the signal until the next visit. A task waiting for an approval cannot be snoozed; a running one can, since snoozing only affects visibility.

Unread is a separate axis from status: `lastTurnCompletedAt` newer than `lastVisitedAt` marks the row, and opening the task clears it. The dot colors stay reserved: amber for "needs your answer", blue for "working", red for "stopped with an error", green only for an unread completion or a wake-up.

The Runtime validates every organization command (`thread.setDone`, `thread.snooze`, `thread.wake`, `thread.setPinned`, `thread.markVisited`) with guard predicates that live in the protocol package, and clients disable the same actions by calling the same functions — one source, no hand-kept twins. Marking done clears pin and snooze; pinning clears the done override; the migration backfills the new timestamps from existing turns and messages and sets `lastVisitedAt` to `updated_at` so old tasks do not all light up as unread.

## Consequences

- The sidebar stops jumping while agents work; a row's position changes only at lifecycle transitions, so muscle memory holds.
- Eight new nullable columns on `threads` and five new protocol methods; no new tables. The classifier lives in `@openappto/client` and is shared by any future Surface.
- Failed and blocked tasks cannot be hidden by any combination of done and snooze, so an agent waiting on the user is always visible.
- Manual ordering of pinned tasks, a settings entry for the auto-close window, and wake sources beyond the harness (calendar, linked artifacts) are deferred; the fields and guards above already leave room for them.
