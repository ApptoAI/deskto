# ADR 0036: Import cookies from local browsers into the Task Browser

- Status: accepted
- Date: 2026-09-02

## Context

ADR 0016 gives every Task one Browser tab backed by a persistent profile, and
ADR 0033 makes that profile belong to the Task's Workspace, so logins persist
across Tasks in one Workspace and never cross into another. But a profile
starts empty, so an agent opening a site the person already uses lands on a
sign-in wall. The person
runs their real work in Chrome, Chromium, Brave, Edge, or Vivaldi, where they
are already signed in.

Those browsers store cookies in a SQLite database and encrypt each value with
a per-platform scheme: AES-128-CBC on Linux (the "peanuts" password for v10,
or a keyring password for v11) and macOS (a keychain password), and
AES-256-GCM on Windows with a DPAPI-wrapped key from `Local State`. The live
database is locked while the browser runs.

## Decision

The Computer use settings tab gains an "Import sign-ins" section. It lists the
browser profiles found on this machine, lets the person choose one, the
websites to bring over, and the Workspace that receives them, and copies the
matching cookies into that Workspace's profile session (the same
`persist:workspace-<id>` partition its Task tabs open, per ADR 0033) through
`session.cookies.set`. The import request names the Workspace, and Main
accepts only a Workspace the Runtime still has.

The importer lives in Electron main, next to the Browser sessions it writes
to; a renderer cannot set a cookie itself. It copies the cookie database before
reading it, so the locked live file is never opened in place. It decrypts only
what the current platform and user can unlock and skips the rest rather than
writing a corrupt value. Decrypted values exist only in memory for the length
of the write: they are never persisted outside the browser session, logged, or
returned to the renderer. The renderer sees a count and, on failure, a next
step ("Close Chrome and try again", "Grant keychain access").

Cookies are filtered to the hosts the person chose, including their
subdomains. A cookie for a host outside that list is never read into the
session.

## Consequences

- A person can hand an agent a site they already use without re-authenticating
  inside Deskto.
- Import reaches only the person's own browsers on their own machine, under
  their own OS credentials; it never leaves the device.
- Platform decrypt paths that cannot be exercised on the build machine
  (macOS keychain, Windows DPAPI, Linux keyring for v11) follow each browser's
  documented format. The cipher and parsing code is covered by round-trip and
  fixture tests; the OS key-retrieval steps degrade to a skip-with-next-step
  when a key is unavailable.
- Cookies land in exactly one Workspace's profile. Seeding a second Workspace
  is a second import; nothing is written to a shared session.
- This does not grant Computer Use to any Harness. It only seeds an existing
  Workspace browser profile, so the boundaries of ADR 0016 and ADR 0033 stand.
