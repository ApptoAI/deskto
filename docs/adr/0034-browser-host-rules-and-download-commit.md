# ADR 0034: Host rules govern every request, and downloads commit through staging

- Status: accepted
- Date: 2026-09-02
- Amends: ADR 0030

## Context

ADR 0030 applied the person's allowed and blocked sites to main-frame
navigation only and recorded that "a page that fetches from another host is
not blocked by them". ADR 0033 then imported the person's real cookies into
the task browser and ADR 0032 let an agent screenshot and click whatever the
tab shows. Together those made the gap material: an allowed page could embed
a blocked origin in a frame, that frame could send the imported cookies, and
the agent could read and act on the result.

ADR 0030 also let a page-triggered download land in the project folder. Main
checked every component of the download folder for links, then handed
Chromium a path it wrote to later. A folder swapped for a symlink between the
check and the write let a website overwrite a file outside the project.

## Decision

**Host rules apply to every request a task browser session makes.** Main
registers one `onBeforeRequest` listener on each browser session (the shared
partition, each Workspace profile, and each throwaway task session) for
`http`, `https`, `ws`, and `wss` URLs, and cancels any whose host the rules
reject, whatever fetched it: a frame, an image, a script, a fetch, a
WebSocket, or the hop after a redirect. Child-frame navigations are also
prevented through `will-frame-navigate`, so a blocked iframe or form target
never shows an error page inside an allowed one. The main frame keeps its
own `will-navigate` and `will-redirect` checks, which report the block to the
person. `about:blank`, `data:`, `blob:`, and Artifact previews stay outside
the rules as before, and a first-party redirect between allowed hosts is
allowed like any other request.

**A download is staged, then committed.** Chromium writes into a random file
under `userData/browser-downloads`. When the download completes, main
re-derives the destination from the project and the download folder, walks
every component without following links, checks the folder's real path
against the project's real path, copies the bytes into a uniquely named
temporary file created exclusively in that folder, flushes it, re-checks
that the folder is still the verified one by real path and dev/inode, and
publishes it under the final name with a link that never replaces an
existing file or follows one. A partial file is never visible under the
final name; a failed or refused commit empties the temporary through its
own handle and removes it. Staging entries untouched for an hour are
removed when the browser manager starts, since a crash is the only way one
outlives its download. A refused commit removes the staged file and writes
nothing.

## Consequences

- ADR 0030's consequence that host rules are not a security boundary no
  longer holds for the task browser's network traffic. They are still the
  person's policy, and an empty allow list still allows every host not
  blocked.
- A page on an allowed host that depends on a blocked host will render
  without those resources. That is what the person asked for by blocking it.
- Downloads that are cancelled or interrupted leave nothing in the project;
  a completed download appears there only after its commit.
