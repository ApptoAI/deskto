# ADR 0026: Side chats fork Harness sessions

- Status: accepted
- Date: 2026-08-21

## Context

A person deep in a task may need to ask a related question without adding that
question and answer to the task's main conversation. A new task lacks the
current agent context, while a background task is durable delegated work that
belongs in task lists and search. Continuing the same provider session from two
conversations would let either branch silently change the other's context.

Claude Code and Codex both support session branching, but through different
native operations. Claude resumes with `forkSession`; Codex calls
`thread/fork`.

## Decision

The task panel has a stable `Side` surface, opened either by its tab or the
`/side` composer command. Opening it creates at most one Side chat for the task.
The Side chat uses the same Project, Harness, and Execution Profile as its
parent. Its first Turn asks the Harness Adapter to fork the parent's current
provider session; later Turns resume the new session normally.

The Harness SDK represents this as a provider-neutral request to fork the
supplied session identifier. Each adapter owns its native translation. A Side
chat can be created only after the parent has a provider session and while the
parent is not running.

Deskto stores the Side chat so closing and reopening the panel does not lose an
answer. It is temporary product state: it is excluded from task lists,
background-task trees, and search, and the panel offers a direct discard
action. Discarding deletes the Side chat records but does not revert or delete
files in the Project.

## Consequences

- Side questions inherit full agent context without derailing the main task.
- Claude and Codex expose the same Surface behavior through separate adapter
  implementations.
- A side agent still works in the same Project folder. Session branching does
  not isolate file changes.
- The branch waits for the main response to settle, avoiding an ambiguous or
  partially written fork point.
