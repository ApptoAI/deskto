# Managed projects and templates MVP

## Outcome

A person can create a Project before choosing a folder, give every Harness the
same Project instructions, and reuse a safe starter template for later
Projects.

## Product rules

- Every Project has one real folder.
- A managed Project lives below Deskto's application data directory. A linked
  Project stays at a folder selected by the person.
- Creating a Project defaults to a managed location and a blank template.
- A managed Project can move to an empty person-selected folder on the same
  storage volume. The move keeps its identity, Threads, and history.
- Shared Project instructions are Runtime-owned. Harness Adapters translate
  them to their native developer or system instruction mechanism.
- Native `AGENTS.md` and `CLAUDE.md` files remain untouched and continue to be
  discovered by their Harnesses.
- A Project Template belongs to a Pack. It contains a manifest, optional
  shared instructions, and starter files.
- Creating from a template copies a snapshot. Updating or removing the
  template never changes existing Projects.
- Saving a template requires an explicit file selection. Deskto never offers
  known secret files, dot directories, dependencies, build output, or caches.
- Template discovery and copying never execute Pack content.
- Pinning changes Project list order only.

## Pack layout

```text
pack.json
skills/
templates/
  client-project/
    template.json
    instructions.md
    files/
```

`template.json` has schema version 1, a name, and an optional description.
Template identity combines the Pack id and template directory name.

## Runtime operations

- List the templates attached to a Workspace.
- Create a blank or templated Project at a managed or linked location.
- Read and update Project settings.
- Pin or unpin a Project.
- Move a managed Project to an empty linked folder on the same storage volume.
- List safe Project files that may enter a template.
- Save selected files and optional instructions as a template in an editable
  managed Pack.

## Acceptance checks

1. Creating a managed Project creates `projects/<project-id>` beside the
   Runtime database and returns that folder as the Project path.
2. Creating a linked Project keeps the selected folder in place.
3. Creating from a template copies its starter files and instructions without
   changing the template.
4. A template update does not change a Project previously created from it.
5. Shared instructions reach Claude and Codex through adapter-native
   instruction fields.
6. Existing native instruction files remain unchanged.
7. Saving a template copies only the paths explicitly selected by the person.
8. Secret and working files do not appear in the template file picker.
9. Moving a managed Project on the same storage volume preserves its id and
   Threads and changes its path only after the filesystem move succeeds.
10. Pinned Projects sort before unpinned Projects.
11. Typecheck, Oxlint, ESLint, focused tests, and the desktop build pass.

## Deferred

- Live inheritance from a template
- Template variables beyond the Project name
- Git-backed and Hub template delivery
- Project-specific Pack attachment
- Pack-wide Workspace instructions
- Scheduled tasks and Project References
- Cross-volume Project moves with durable crash recovery
