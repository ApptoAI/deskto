# ADR 0019: Keep Project folders real and distribute templates in Packs

- Status: accepted
- Date: 2026-08-19

## Context

Opening a folder before creating a Project makes lightweight and repeated work
needlessly awkward. Client work also repeats starter files and instructions.
Making `Project.path` nullable would spread a folderless state through Threads,
Harness sessions, file references, Artifacts, and output capture, all of which
need a real working directory.

Claude Code and Codex use different native instruction mechanisms. Mirroring
shared text into both `CLAUDE.md` and `AGENTS.md` would introduce competing
sources of truth and overwrite files the person may already manage.

ADR 0006 chose Pack as the provider-neutral distribution unit and reserved
templates as later Pack content.

## Decision

Every Project keeps one required path. A Project location is `managed` when
its folder is a direct child of the Runtime's managed Project root and
`linked` when the person selected an external folder. The default Runtime root
is `projects` beside its SQLite database. A managed folder takes the Project's
name, filesystem-sanitized, with a "Name 2"-style suffix on collision, an
atomic `mkdir` claim, and a UUID fallback. It is not named after the Project
id.

Moving a managed Project to a linked folder accepts any picked folder. An
empty pick becomes the project folder; a non-empty pick receives a fresh
subfolder named after the Project. Tasks, the description, and shared
instructions stay in Runtime storage and are unaffected. The move keeps the
active-task guard, uses an atomic directory rename, and is limited to a
destination on the same storage volume. Cross-volume moves need a durable
relocation journal so a crash cannot leave SQLite pointing at a missing folder;
that recovery protocol is deferred rather than approximated with an unsafe
copy-and-delete sequence.

Shared Project instructions live in Runtime storage. Session customization
carries them beside skill roots and MCP servers. Claude and Codex Adapters map
the same text to native instruction fields. Native Project instruction files
remain on disk and additive.

Per-Project settings — name, description, shared instructions, and folder
location — live in a collapsible panel on the new-task screen, not a modal
dialog. A workspace-level Projects view lists every Project in a grid with
search and sort, reached from the sidebar footer.

A Project Template is content inside an installed or linked Pack. Applying it
copies starter files and instructions once. The Project records template
provenance for display, but no live relationship controls its later contents.
An app-created managed Pack may receive templates through the UI. The Runtime
copies only explicitly selected safe regular files and refreshes the Pack
digest afterward.

## Consequences

- The existing Project, Thread, Artifact, and Harness invariants do not gain a
  folderless branch.
- A person can start in app-managed storage and move the Project later.
- A move to another storage volume is rejected without changing either folder.
- Shared instructions work across Harnesses without writing provider files.
- Packs can ship skills and templates through one installation path and future
  Catalog.
- Template safety uses the same containment and no-execution posture as Pack
  installation.
- Template changes do not propagate. Shared behavior that must update belongs
  in an attached Pack, not a template snapshot.
