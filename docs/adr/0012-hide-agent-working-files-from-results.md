# ADR 0012: Hide agent working files from results

- Status: accepted
- Date: 2026-08-16

## Context

An agent often creates a script, cache, or conversion input before it creates
the document a person asked for. ADR 0010 classified every existing file named
by a completed file-change Activity as a result. That made internal files such
as `tmp/pdfs/build-report.py` appear beside the requested PDF and inflated the
Results count while the task was still running.

The file-change protocol does not say whether a path is a deliverable or an
implementation detail. Its directory does carry a useful signal when the agent
puts the file in an established working directory.

## Decision

Files below `tmp`, `.tmp`, `temp`, `.temp`, `.cache`, or `node_modules` are
working files, not results. The Runtime excludes them both when capturing a
file-change Activity and when listing existing results. Matching is
case-insensitive and applies to directory components, not a file whose name
happens to contain one of those words.

The files stay untouched in the Project. Existing Artifact and Turn Output
rows also stay in storage; the list filter makes records written by an older
build disappear without a destructive migration.

This narrows ADR 0010's rule that every safe file named by a completed
file-change Activity becomes a result.

## Consequences

- A conversion script under `tmp` no longer competes with the PDF it builds.
- Results counts describe user-facing files more closely while work is active.
- A person who deliberately asks for a deliverable inside one of the excluded
  directories must move it elsewhere before it appears in Results.
- Providers still do not report intent directly. Files outside known working
  directories remain results even when an agent meant them as intermediate
  work.
