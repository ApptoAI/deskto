# ADR 0010: Task results and file previews

- Status: accepted
- Date: 2026-08-15

## Context

A file-change Activity tells the user that an agent touched a path, but the
path is only a summary chip in the conversation. The user must leave Appto,
find the file in the project folder, and choose another application before
they can judge the work. This is especially costly for people who think in
documents, images, reports, and tables rather than source changes.

Putting file contents into `Activity`, `ThreadView`, or `thread.delta` would
break their bounded size. Letting the renderer read arbitrary local paths
would also break the Client and Runtime boundary from ADR 0001.

## Decision

An Artifact is a durable record for one project-relative file. A Turn Output
links a Turn to an Artifact it created or changed. The same path keeps one
Artifact identity and can be attributed to several Turns. The task Surface
calls these records results.

The Runtime records Turn Outputs only when a completed `file-change` Activity
names a file that exists inside the Project. It resolves the Project and file
through their real paths, rejects traversal and symlink escapes, skips folders
and missing paths, and limits each Activity to 200 reported files. A real file
remains a result even if later work in the Turn fails or is cancelled.

`artifact.list` returns the latest attribution for every available Artifact in
a Thread. `artifact.preview` reads one selected file on demand. Neither file
contents nor binary data enter `ThreadView` or Runtime events. The
`artifact.changed` event only invalidates the result list.

The first Surface supports bounded previews for plain text, Markdown, CSV,
HTML, common raster images, PDF, `.xlsx`, and `.docx`. Text, Markdown, CSV,
and HTML are limited to 1 MB. Images and PDF are limited to 10 MB. Office
documents are limited to 20 MB. Other file types remain visible but have no
inline preview. Markdown does not enable raw HTML. Generated HTML renders in
a sandboxed frame after sanitization and cannot run scripts. Word conversion
also passes through an HTML sanitizer. PDF data becomes a short-lived blob URL
in the renderer; the Content Security Policy allows blob frames but keeps
object embedding disabled.

## Consequences

- A user can inspect the concrete output of a task without searching the
  project folder.
- The database stores file identity, attribution, and metadata, not file
  contents. The Project folder remains the source of truth.
- Deleted files disappear from result queries. Preview requests also repeat
  the containment check, so a path or symlink changed after capture cannot
  expose a file outside the Project.
- Attachments, legacy `.xls` and `.doc` files, file editing, version history,
  and agent-controlled browser sessions remain separate product decisions.
