# Settings organization and local skill management

Accepted, 2026-09-05.

Computer use remains one Settings page, as in ADR 0031, but horizontal tabs separate everyday browser controls, sign-ins, computer capabilities, and advanced options. The explicitly requested Computer use and Plugins coming-soon spaces are exceptions to the deferred-feature placeholder rule: they do not add authentication, a marketplace, or a hosted service.

The provider preference for follow-ups extends ADR 0040. A steering-capable provider can be configured to queue instead. The Runtime still persists the message first and owns the FIFO queue; selecting steering retains the existing fallback when the provider cannot accept it. Providers without steering remain queue-only.

Detected personal and project skills can be edited in place with version checks. Administrator sources and linked skill folders remain read-only. Disabling a skill preserves its contents as `SKILL.md.disabled` on disk and permits restoring it; it must not silently delete a person's instructions. Duplicate presentation groups identical instructions while retaining their individual locations and exposure information.

Skill saves preserve the displaced file in a hidden `.deskto-skill-<uuid>.recovery` sibling before publishing the new contents without overwriting an existing path. The displaced identity and contents are checked before and after publication. Recovery copies remain because another editor can still write through an open file descriptor after those checks; this is a preservation protocol, not a claim of atomic compare-and-replace against arbitrary external writers. Interrupted saves and observed conflicts tell the person how to restore or compare the preserved file. Recovery files are excluded from skill content digests so they do not split otherwise identical skill copies.

A subagent's Activities entry opens a read-only preview of the work the Harness reports. This is a view of the bounded Activity tree, not a promise of a complete provider transcript. The main conversation remains in place and the preview has a way back to Activities.
