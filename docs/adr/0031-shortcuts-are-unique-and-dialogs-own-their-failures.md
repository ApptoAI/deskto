# ADR 0031: Shortcuts are unique, and a dialog owns its own failure

- Status: accepted
- Date: 2026-09-02

## Context

The shortcut recorder accepted any combination the registry's schema
allowed, so two commands could hold the same keys and both fire on one
press. Global shortcuts also listened on the window without regard to what
had focus, so a keydown inside a modal changed the screen behind it.

Several dialogs relied on the workbench's inline error strip to report a
failed save. That strip renders in the pane, under the dialog's scrim, so a
failure looked like nothing happened while the dialog stayed open.

## Decision

**A binding belongs to one command.** `@deskto/settings` exposes
`findKeybindingConflict`, which compares parsed bindings rather than their
spelling. A Surface refuses a recorded combination that another shortcut
holds and names that shortcut and the way to free it. The registry schema
stays as it is: uniqueness is a rule about the set, so it lives beside the
set and not in one setting's schema.

**A shortcut does not fire from inside a dialog.** `useKeybinding` ignores a
keydown whose target sits under `role="dialog"` or `role="alertdialog"`.
A dialog holds focus, so this is the same as asking whether one is open.

**A dialog reports its own failure.** Any dialog that runs a mutation shows
the error inside itself, keeps what was typed, and cannot be closed while the
mutation is in flight. The workbench strip may repeat the error; it is never
the only place it appears.

## Consequences

- Recording a taken combination is a refused action with copy, not a silent
  overwrite.
- A menu or shortcut that should work inside a dialog must be wired by that
  dialog, not by the global listener.
- New dialogs follow the workspace, skill, and pack dialogs: local error,
  busy gate, close button hidden while busy.
