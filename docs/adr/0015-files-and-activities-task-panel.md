# ADR 0015: Stable Files and Activities in the task panel

- Status: accepted
- Date: 2026-08-17

## Context

The task panel mixed navigation with open documents. Activity was a permanent
tab, while every selected file became another tab and newly produced files
could decide what appeared when the panel opened. That model is familiar to a
developer using an editor, but it makes reports, spreadsheets, and documents
feel like temporary technical output instead of the work of the task.

The conversation also lacked a durable, direct summary of the files belonging
to each answer. Activities could link a reported path, but a user had to read
the agent's working trace or search the Results panel to find the deliverable.
The same Artifact may be changed by several Turns, so the current file list
alone cannot reconstruct those per-answer links.

## Decision

The large task panel has stable `Files` and `Activities` surfaces. `Files`
starts with an overview of the task's current Artifacts. Selecting a file opens
its existing preview, editing, copy, reveal, and external-open actions inside
that surface; it does not create a peer tab. The file view has a direct route
back to the overview.

The overview groups those Artifacts by the folders they sit in inside the
Project rather than flattening every path into one list. It shows one folder
at a time, starting at the Project root, and a folder row opens that folder. A
folder counts the Artifacts anywhere beneath it, and a chain of folders holding
nothing but the next folder collapses into a single row, so depth the task did
not choose costs no clicks. A crumb line names every folder above the one open
and leads back to any of them. The panel stands in one folder at a time: the
folder holding the open file, or the last one browsed, so leaving a file view
lands beside that file. The Runtime's order is what each group keeps, with a
folder taking the place of the newest Artifact beneath it.

The compact Activity column from ADR 0014 remains. Opening it selects the
large `Activities` surface. The large panel remembers its surface, its folder,
and its selected file for the app session, but producing a new Artifact never
opens the panel, changes the surface, replaces the selected file, or moves the
folder the user is standing in — including a folder that empties and later
fills again.

Each Turn renders captured Outputs as file buttons as soon as they exist.
During a running Turn they sit above the working indicator; once the Turn
settles they move below the final assistant answer. Conversation links open
page-like HTML and PDF outputs in
`Browser`; other formats open inside `Files`. Choosing the same HTML or PDF
from the Files overview still opens its Files preview, so the collection keeps
a consistent place for metadata and file actions. An overflow action opens the
folder that answer's files share, which is the Project root when they are
spread across it.

The Client reads two provider-neutral Runtime projections:

- `artifact.list` returns the latest Turn Output for each current Artifact and
  feeds the Files overview.
- `artifact.listOutputs` returns every Turn-to-Artifact attribution whose file
  is still available inside the Project and feeds the per-answer buttons. The
  stored attribution remains durable when the file disappears, but the Surface
  does not offer a button it cannot open.

Both projections come from normalized Runtime records. A Surface does not
inspect Claude Code, Codex, or any future Harness event format. Harness
Adapters and the Runtime's project sweep remain the only sources of file
capture.

`Browser` is reserved as a future stable surface, but no inactive control or
placeholder ships before that surface has behavior.

## Consequences

- A task has predictable navigation instead of a tab strip that grows with
  its output.
- New work updates the Files overview without stealing focus.
- A task that writes into folders reads as the folders it wrote, and a long
  flat list of paths stops being the only way to see them.
- A file deep in the Project costs clicks to reach that a flat list did not
  charge. Collapsed chains, folder counts, and an answer opening its own
  folder are what keep that price down.
- A finished answer points directly to its deliverables, including a file
  changed again by a later Turn.
- The Files overview shows one current entry per Artifact, while answer links
  preserve repeated attribution across Turns for files that remain available.
- Existing preview, editor, containment, and native file actions are reused;
  this decision changes navigation, not file safety.
- Adding another Harness requires no panel or transcript changes as long as
  its adapter emits the provider-neutral events the Runtime already accepts.
