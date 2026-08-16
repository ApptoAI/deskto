# Skills manager MVP

## Outcome

A person can see the skills available around the current Project, understand
where each one comes from, manage reusable Packs, and check whether Deskto
configured an attached Pack for Claude Code or Codex.

## Product rules

- `For this project` is the default view. It combines native Project skills,
  native user and system skills, and Packs attached to the Project's
  Workspace.
- `On this computer` lists native user and system skills by Harness.
- `Packs` manages reusable Pack directories and Workspace attachment.
- Native Project and computer skills are read-only. Deskto may open their
  folders but does not edit or delete them.
- `Link local folder` registers an external Pack in place.
- `Install` copies a Pack into Deskto's application data directory.
- `Unlink` never deletes files. `Uninstall` moves a managed Pack to trash.
- Duplicate names and invalid skills stay visible.
- A skill-directory symlink that resolves outside its declared source stays
  visible as an error, but Deskto does not read or preview its target.
- `Configured` means the Harness Adapter accepted the skill root. It does not
  mean the agent used the skill.

## Domain records

`SkillOccurrence` describes a physical skill directory, its parsed manifest,
validation result, ownership, scope, and a digest of the complete directory.

`SkillExposure` connects an occurrence to a Harness and records native
discovery or the latest Pack configuration result.

`Pack` records whether Deskto manages or links the directory. Managed Packs
also keep a content digest and installation receipt.

External Skill Occurrences are query results. SQLite does not mirror their
manifest or contents.

## Runtime operations

- List the complete inventory for one Project.
- List native user and system skills on the computer.
- Read one skill on demand for preview.
- Create an empty managed Pack.
- Install a managed Pack from a directory or supported archive.
- Link an external Pack directory.
- Attach or detach a Pack from a Workspace.
- Uninstall a managed Pack or unlink an external Pack.
- Create and edit skills inside the managed `My Skills` Pack.

## Safety limits

- Resolve source real paths before checking containment during discovery,
  linking, and installation.
- Before uninstalling, require the registered managed path to be a direct
  child of the managed Pack root and inspect the entry with `lstat`. Never
  follow a symlink and then send its target to trash.
- Reject path traversal, absolute archive entries, escaping symlinks, and
  unsupported special files.
- Bound archive file count, expanded size, and per-file size.
- Extract into staging and move only after full validation.
- Do not execute scripts, hooks, binaries, or other Pack content during
  discovery, preview, installation, or editing.
- Render Markdown without raw HTML.

## Acceptance checks

1. Editing a native `SKILL.md` on disk changes the next inventory response.
2. Two skills with the same name both appear with their paths and sources.
3. A malformed `SKILL.md` appears with a diagnostic instead of disappearing.
4. Linking and unlinking a Pack leave its source directory unchanged.
5. Installing a Pack creates an app-owned copy and receipt.
6. Uninstalling a managed Pack removes its assignments and moves its directory
   to trash.
7. An unsupported Pack delivery does not stop the Turn and appears in the
   latest configuration report.
8. A user can create a skill in `My Skills`, attach that Pack to a Workspace,
   and preview the generated `SKILL.md`.
9. Typecheck, Oxlint, ESLint, unit tests, Runtime integration tests, and the
   desktop build pass.

## Deferred

- Hub, Catalog, marketplace purchases, teams, roles, and access grants
- Git-backed installation and updates
- Version selection and rollback UI
- Project-specific Pack assignments
- Per-skill enable switches inside a Pack
- Automatic repair of invalid skills
- Claims that a Harness used a skill without an explicit provider event
- Project templates

The next product step can add Project Templates with starter files, an
`AGENTS.md` body, and required Pack identifiers. Creating a Project from a
template should attach the required Packs after explaining that a Workspace
assignment affects its other Projects.
