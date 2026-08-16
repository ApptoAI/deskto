# ADR 0011: Skill inventory and Pack ownership

- Status: accepted
- Date: 2026-08-16

## Context

Deskto can attach Pack directories to a Workspace and pass their skill roots
to a Harness. It does not show project or user skills that a Harness finds on
its own. It also treats a Pack selected from disk as an import even though it
only saves the original path. Removing that Pack deletes the database record
and leaves the directory untouched.

ADR 0006 asked Harness Adapters to skip unsupported Pack delivery without
reporting it. That kept a Turn running, but it also made the Skills UI unable
to distinguish a configured Pack from one that the installed Harness ignored.

Project folders and user configuration remain the source of truth for native
skills. Deskto needs an inventory without copying those files into SQLite or
claiming ownership of them.

## Decision

Deskto models a Skill Occurrence as one skill directory found at one physical
location. The inventory keeps every occurrence, including duplicate names and
invalid `SKILL.md` files. A Skill Exposure records which Harness can discover
or receive that occurrence. Deskto does not choose one occurrence merely
because several skills share a name.

Skill state has separate stages. Discovery means Deskto found the occurrence
on disk. Configuration means a Harness Adapter accepted the app-supplied skill
root for a Turn. Usage means the Harness reported that it invoked the skill.
The first release records discovery and configuration. It does not infer
usage from a successful configuration request.

Harness Adapters declare their native skill locations and precedence rules.
The Runtime owns filesystem traversal, validation, content digests, and the
provider-neutral inventory. Native project and user skills stay read-only in
Deskto. Their content is read from disk on demand and is not persisted in
SQLite.

A Pack has explicit ownership:

- A managed Pack lives under Deskto's application data directory. Deskto may
  edit it and move it to the operating system trash when the user uninstalls
  it.
- A linked Pack lives at a user-selected external path. Unlinking it removes
  only Deskto's database record and Workspace assignments.

Installing a Pack copies validated content into a staging directory, records
a content digest and installation receipt, then moves the directory into the
managed Pack root. Installation never executes Pack content. Workspace
attachment remains many-to-many and applies to every Project in that
Workspace.

Harness Adapters return a configuration result for each app-supplied root.
The result is `configured`, `unsupported`, or `failed` and names the delivery
method. A failed or unsupported Pack does not stop the Turn. Deskto stores the
result and shows it instead of hiding it.

This decision replaces the silent degradation requirement in ADR 0006.

## Consequences

- The Skills screen can answer what is on disk and what Deskto passed to each
  Harness without claiming that an agent used a skill.
- Duplicate and malformed skills remain visible, so the user can diagnose
  name collisions and broken files.
- Disk remains the source of truth for project, user, system, and linked Pack
  content. SQLite stores ownership, Workspace attachment, managed Pack
  receipts, digests, and configuration results.
- Runtime code stays provider-neutral. Native paths and Pack delivery methods
  remain inside Harness Adapters.
- Uninstall and unlink have different labels and different effects on disk.
- Marketplace distribution, team access, version selection, Git updates,
  project-specific Pack assignments, and verified skill usage remain separate
  decisions.
