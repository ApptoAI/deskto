# ADR 0013: Sweep the Project for unreported results

- Status: accepted
- Date: 2026-08-16

## Context

ADR 0010 records a Turn Output only from a completed `file-change` Activity.
Every Harness Adapter derives that Activity from the provider's editing tools:
Claude from `Write`, `Edit`, and `NotebookEdit`, Codex from its `fileChange`
item. A shell command reaches the Runtime as a command Activity carrying a
command line and nothing else.

So an agent that writes a script and runs it produces nothing the Runtime can
see. The script itself is reported, lands under `tmp`, and ADR 0012 correctly
hides it; the PDF the script wrote is invisible. Results is empty while the
files sit in the Project folder. Both harnesses have this gap, and in Codex it
is wider, because the shell is its primary tool.

Reading intent out of a command line would mean a parser per provider for a
surface neither provider guarantees.

## Decision

The Runtime snapshots the Project folder before a Turn's Harness starts, and
walks it again after work whose Activity did not name its files: a command, an
MCP call, a subagent, or any tool kind the Runtime does not recognise. Files
that appeared or changed against the snapshot are offered to the same capture
that a reported path goes through. A sweep proposes paths and decides nothing;
containment, symlink, working-file, and the 200-file bound stay in
`Artifacts.prepareCapture`, so a swept file and a reported one become results
on identical terms.

A Turn whose Activities all named their files is never swept. A sweep also
skips directories whose name begins with a dot and the build outputs `build`,
`coverage`, `dist`, `out`, `target`, and `vendor`, in addition to the working
directories of ADR 0012.

Sweeps are coalesced and each waits a multiple of what the previous walk cost.
A Project larger than 25,000 files gets no snapshot, and its Turns capture from
Activities alone. The snapshot lives in memory for the length of one Turn.

This widens ADR 0010: a result is a file inside the Project that a Turn
produced, not only one a `file-change` Activity named.

## Consequences

- A document written by a script, a converter, or an MCP tool appears in
  Results, on both harnesses and on any harness added later.
- The Runtime, not each Harness Adapter, owns the gap. Adapters are unchanged.
- A file changed by something other than the agent while a Turn ran can become
  a result. The Project folder is the source of truth and it has no author.
- A deliverable an agent writes into a skipped directory does not appear, which
  extends the same trade ADR 0012 made.
- A very large Project keeps the old behaviour rather than a partial snapshot
  that would report files it never really saw.
- Turn start pays one walk of the Project folder.
