# ADR 0011: Result tabs, file actions, and editing

- Status: accepted
- Date: 2026-08-16

## Context

ADR 0010 gave a task a durable record for every file its agents produced and
a bounded preview for each one. What it did not give the user is anything to
do with the file. The panel could show a spreadsheet but not open it in the
application that owns spreadsheets, not put a copy where the user needs it,
and not correct a single wrong cell. The files an Activity reported were
printed in the conversation as inert chips, so the shortest route from "the
agent changed customers.csv" to seeing that file was to open a separate
panel and find the row again.

A viewer with no actions makes Appto a place to look at work rather than a
place to do it. That is the wrong shape for people who think in reports and
tables and who already own Excel, Word, and Preview.

The PDF preview from ADR 0010 never worked. Every PDF result drew a blank
frame. Chromium's built-in viewer is a plugin, it attaches only to an
embedded object, and the app's Content Security Policy was being stamped onto
every response in the default session including the viewer's own internal
document, whose `frame-ancestors 'none'` then refused to let it be embedded in
a preview. Three settings had to change before a page appeared, and each one
moves the app's security posture.

## Decision

A result opens as a tab in the task's side panel. Tabs are per task, held
outside React so a result stays open across panel toggles and task switches,
and deliberately not persisted across restarts: a restored tab pointing at a
file an agent has since deleted reads as a bug. A file named by a
`file-change` Activity in the conversation opens the same tab, so the
transcript is a way into the work rather than a report about it.

Each tab carries the file's own actions: save a copy through a system save
dialog, reveal it in the file manager, and open it in the application that
owns its format. A Surface names a result for these, never a path. The
Electron main process resolves the file itself through `artifact.locate`,
which repeats the containment check from ADR 0010, so a renderer cannot ask
the shell to touch a file the Runtime did not vouch for.

Opening is restricted to an explicit list of document formats, listed
separately from the preview formats rather than derived from them. Handing a
path to the shell launches whatever claims that type, and an agent chooses
both the name and the contents of every file it writes: a script, a page that
runs when a browser opens it, and a macro-bearing legacy Office file are all
previewable and none are safe to launch.

`artifact.write` replaces the file behind a result. It accepts plain text,
Markdown, and CSV only, and refuses when the file's modification time no
longer matches the version the editor loaded. Binary office formats stay
read-only: rebuilding a workbook from a simplified table would drop
formulas, styles, and every sheet the editor did not load. `Artifact.sizeBytes`
and `Artifact.updatedAt` now come from the file rather than from the capture
row, so the conflict check and the preview both read the version on disk. The
write lands in a sibling temp file that is renamed over the target, so a
failure leaves the user's original rather than a truncated file.

Editing a delimited file has to be lossless in the trivial case. Opening a
result and saving it with no edit returns the same bytes: quoting style, line
endings, a trailing newline, and rows shorter than the widest row all survive.
The grid the editor draws is rectangular; the file it writes is not.

A PDF result renders in Chromium's own viewer. That costs three changes to the
window and the policy, and saves shipping a PDF renderer of our own. The
renderer window enables `plugins`, `object-src` allows `blob:`, and the preview
embeds the blob instead of framing it. The policy listener is narrowed to the
app's own documents — the dev server origin in development, `file://` when
packaged — so it no longer stamps `frame-ancestors 'none'` onto Chromium's
internal pages. This supersedes the sentence in ADR 0010 that keeps
object embedding disabled. Everything else in that policy stands, including
`frame-ancestors 'none'` for the app's own documents.

The Surface keeps one registry entry per preview kind — its icon, its
renderer, and which editor it opens — instead of a chain of format checks
inside the panel. Loading, size limits, and containment stay in the Runtime;
an entry only decides how a result looks.

## Consequences

- A user can act on a result without leaving the task or finding the folder.
- A wrong cell or a wrong sentence is fixable in place for the formats where
  a simplified editor cannot lose information.
- An agent edit that lands while a tab is open refreshes the preview. It does
  not restart an open editor: the editor stays on the version it loaded, says
  the file has changed, and offers to reload. A save against the old version
  is refused rather than applied.
- Conflict detection is only as precise as the filesystem's modification time.
  Two writes inside the same millisecond, or a filesystem with coarse
  timestamps, defeat it. The containment and inode checks still hold, so the
  failure is a lost edit rather than a damaged file.
- CSV editing loads every cell as an input, so it is capped at 500 rows and
  60 columns; larger tables stay read-only until the grid is virtualized.
- Word and PowerPoint results remain preview-limited but are now openable and
  copyable, which is what their formats actually need.
- `object-src blob:` and `plugins` widen what code running in the main renderer
  can reach. Reaching them requires script injection there, which already means
  the renderer is lost. A preview only claims `pdf` for a `.pdf` extension and
  the embed declares `application/pdf`, so Chromium picks the plugin rather
  than sniffing some other file into a document renderer.
- The narrowed listener gives up a Content Security Policy on responses that
  are not the app's own documents. Nothing loads remote content today. A window
  that does would need its own policy instead of inheriting one.
- TSV is not editable yet. The parser is delimiter-aware but the format map
  classifies only `.csv`, and shipping `.tsv` parsed on commas would be worse
  than not shipping it.
- Results still come only from a completed `file-change` Activity. A file an
  agent produces through a shell command never becomes a result, and no
  amount of panel work fixes that; it needs a second discovery source and is
  left to a separate decision.
