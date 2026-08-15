# ADR 0009: Keep prompt references semantic and provider-neutral

- Status: accepted
- Date: 2026-08-15

## Context

People need to reference Project files with `@`, choose Workspace Skills with
`$`, and invoke application or Harness commands with `/`. A plain prompt
string cannot distinguish a deliberately selected Skill from incidental text,
and Claude Code and Codex do not share one native representation for those
inputs.

## Decision

The visible prompt text remains the portable canonical draft. Selected Project
entries and Skills travel beside it as Prompt References and are persisted with
the user message. The Runtime validates references against the Turn's Project
and Workspace before starting work, then resolves them into provider-neutral
Harness references. Harness Adapters alone translate those references to native
input items or syntax.

The Client owns one caret-aware grammar for `@`, `$`, and `/`. Runtime queries
provide bounded Project-entry search and the Skills effective for a Workspace;
they do not know about trigger characters. Application commands are executed by
the Surface and never sent to a Harness. Discovered Harness commands remain a
separate candidate kind so collisions have an explicit owner.

Rich editor chips are projections of canonical text, not another persisted
document model. A textarea with an accessible suggestion list is sufficient
for the first delivery.

## Consequences

- A selected Skill has stable identity even when two Packs use the same name.
- Project paths are relative at the Client boundary and revalidated before a
  Turn is persisted.
- Codex can receive native mention and Skill input items while Claude can use
  its own plugin and command conventions without leaking them into Runtime.
- Prompt References add nullable JSON columns to Turns and Messages; existing
  rows and string-only clients remain valid.
- Pack prompt templates and provider-native command discovery remain separate
  follow-up use cases rather than being inferred from `/`.
