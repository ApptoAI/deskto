# ADR 0030: Composer drafts survive navigation; a parked task says so where the person types

- Status: accepted
- Date: 2026-09-02

## Context

The task view is remounted every time the person opens another task, and
the composer kept its text in component state. A message left half-written
was gone by the time they came back. The same view also had no idea that a
task had been snoozed or marked done: the only sign, and the only way back,
was the row in the sidebar that parked it, which may be scrolled away or in
another section.

## Decision

Unsent composer text and its prompt references are kept for the app session,
keyed by the task they were written in (and by the project for a task that
does not exist yet, and separately for a side chat). The text comes back when
the same composer is mounted again and is dropped once the message is sent.
Images are not kept: their bytes belong to the composer they were attached
to, and a picture that has to be attached again costs less than one that
reappears unasked. Nothing is written to disk; a restart starts clean.

A task that is snoozed or done shows one quiet line above its composer,
classified by the same `@deskto/client` predicates the task list uses, with
the way out beside it: "Wake now" or "Restore". The list stays the place that
parks a task; the view only offers the way back.

A send that will not go says why on the button itself, and a message typed
while the agent works says it will wait rather than vanishing into an Enter
that does nothing.

## Consequences

- Switching tasks mid-sentence costs nothing.
- The view and the list can never disagree about whether a task is parked.
- Drafts are per session by design; persisting them across restarts would be
  a separate decision about what lives in Runtime storage.
