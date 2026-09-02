# ADR 0030: Computer use settings

- Status: accepted
- Date: 2026-09-02

## Context

ADR 0016 gave every Task one built-in Browser with a fixed profile: one
persistent Chromium partition shared by every Task, Chromium's own user
agent, a hard-coded off-screen page size, downloads blocked, and a blank
first page. None of that was the person's to change. Sales work runs into
each of those limits: a site that serves a different page to an unknown user
agent, a CRM login that must not leak into a task for another client, a
report that a page offers only as a download, a portal every task starts
from, and sites an agent must never open at all.

Cookie import from an installed Chrome, per-workspace browser profiles, and
a computer-use MCP server are close behind, and each would otherwise add its
own page and its own storage.

## Decision

Settings gets one "Computer use" page. It renders a list of sections, and
each later capability adds a section to that list rather than a page. The
first section is the built-in Browser.

Every setting for this page lives in `@deskto/settings` under the
`computerUse.` prefix, beside the rest of the registry: the Runtime stores
only overrides, validation is the definition's schema, and the page renders
whatever the registry says. The host-rule, download-folder, and start-page
predicates ship from the same package so the settings screen and Electron
main agree on what is valid without either copying the rule.

The Browser section controls six things, and each one reaches the
`WebContentsView` in Electron main:

- User agent: applied to every tab, existing ones included.
- Page size: the bounds a tab has while its Task is not on screen, which is
  also what an agent sees in a screenshot before the panel opens.
- Allowed and blocked sites: host rules with `*.` for subdomains. A blocked
  host wins; an empty allow list allows every host not blocked. Main applies
  the rules to Harness navigation, toolbar navigation, redirects, and the
  start page. `about:blank` and Artifact previews are never subject to them.
- Forget logins between tasks: a Task opened while this is on gets its own
  in-memory partition instead of the shared persistent one, and main clears
  that partition when the tab closes. Existing tabs keep their session.
- Download folder: a project-relative folder. When set, a download lands
  there under a sanitised file name that never overwrites an existing file;
  main resolves the Task's project through the Runtime and refuses any
  folder that would leave it. Empty keeps downloads blocked, as before.
- Start page: opened once into a tab that has shown nothing yet, whether the
  person opens the Browser panel or an agent calls `open` without a URL.

Main reads the resolved settings from the Runtime at startup and again on
every `settings.changed` event. The Browser never reads SQLite or the
settings registry directly.

## Consequences

- A person can shape the Browser without a config file, and an agent gets the
  same Browser whichever Harness runs the Task.
- Host rules are a person's policy, not a security boundary: the check runs
  in main before navigation, and a page that fetches from another host is
  not blocked by them.
- Turning "forget logins" on or off does not touch tabs that already exist,
  so a task keeps the session it started with until its tab closes.
- Cookie import, per-workspace profiles, and a computer-use MCP server each
  add a section to `computer-use-sections.ts` and keys under `computerUse.*`.
  They do not add pages, and they are not built here.
