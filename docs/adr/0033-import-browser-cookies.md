# ADR 0033: Import cookies from local browsers into the Task Browser

- Status: accepted
- Date: 2026-09-02

## Context

ADR 0016 gives every Task one Browser tab backed by a persistent profile, and
its logins persist across Tasks. But the profile starts empty, so an agent
opening a site the person already uses lands on a sign-in wall. The person
runs their real work in Chrome, Chromium, Brave, Edge, or Vivaldi, where they
are already signed in.

Those browsers store cookies in a SQLite database and encrypt each value with
a per-platform scheme: AES-128-CBC on Linux (the "peanuts" password for v10,
or a keyring password for v11) and macOS (a keychain password), and
AES-256-GCM on Windows with a DPAPI-wrapped key from `Local State`. The live
database is locked while the browser runs.

## Decision

The Computer use settings tab gains an "Import sign-ins" section. It lists the
browser profiles found on this machine, lets the person choose one and the
websites to bring over, and copies the matching cookies into the shared
Task Browser session through `session.cookies.set`.

The importer lives in Electron main, next to the Browser session it writes to;
a renderer cannot set a cookie itself. It copies the cookie database before
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
- This does not grant Computer Use to any Harness. It only seeds the existing
  Task Browser profile, so ADR 0016's boundary stands.
