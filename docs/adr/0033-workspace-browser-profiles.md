# ADR 0033: One browser profile per Workspace

- Status: accepted
- Date: 2026-09-02

## Context

The built-in task browser (ADR 0016) opened every tab in one Electron
session, `persist:deskto-browser`. A person who signed in to a client's CRM
while working in one Workspace stayed signed in for every other Workspace,
and an agent in an unrelated project could act with those cookies. Workspaces
exist to separate areas of life or work (ADR 0006); the browser ignored that
line.

Chromium owns the profile folder and writes to it while a page is open, so
Deskto cannot delete it piecemeal, and the core rule that deleting a Workspace
touches nothing on disk applies to browser data as much as to project folders.

## Decision

**Each Workspace has one browser profile.** A task's tab opens in the
partition `persist:workspace-<workspace id>`, derived by
`browserProfilePartition` in `@deskto/protocol` and nowhere else. Cookies,
storage, cache and logins are isolated per Workspace. A tab whose Workspace
cannot be resolved falls back to the old shared partition rather than
borrowing another Workspace's logins.

**Deleting a Workspace leaves its profile alone.** The folder stays under
Electron's `Partitions` directory. The person clears it from the Computer use
settings page, where every Workspace is listed with its profile's size on
disk and last use. Clearing asks for a second click, empties the session's
storage, cache and auth cache, closes the Workspace's open tabs first, and
reports how much was freed. The folder itself remains, because Chromium
recreates it on the next visit anyway.

**The Surface never names a folder.** It asks main for the list of profiles
and acts on a Workspace id, and main resolves the id against the Runtime's
Workspaces before touching a session or revealing a folder.

**"Forget logins between tasks" (ADR 0031) wins over the profile.** With
that setting on, a task gets its throwaway in-memory session as before and
writes nothing to the Workspace profile; it is the stricter choice and the
person asked for it explicitly.

## Consequences

- Existing logins made before this change live in the old shared partition
  and are not visible from the new profiles list. They stop being used once
  every tab opens in a Workspace partition.
- Profile size is measured by walking the folder on each request; the
  settings page reads it on open and after a clear, not continuously.
- A Workspace's profile survives the Workspace. A future clean-up of orphaned
  profile folders is a separate decision.
