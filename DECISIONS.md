# adam-dev implementation

- Requested delivery: all implementation committed and pushed to `adam-dev`; no PR required. Plugin architecture proposals remain outside this branch and start after implementation.
- Starting commit: 91157cd. Created local `adam-dev` from the supplied worktree branch.
- No environment files exist in main checkout; dependencies and pnpm/bun are already available. Do not use live user data for validation.
- Interpreting “Q and Sheer” as queue and steer, matching the feature in HEAD. Preference belongs in Providers for steering-capable providers; Claude retains durable queue behavior.
- Skills: edit detected user/project SKILL.md with concurrency protection; reversible enable/disable; retain and improve existing duplicate grouping without deleting native files automatically. Existing create/install/link supplies setup.
- Subagent preview: click an agent in Activities to see read-only reported work styled like side chat; return to Activities. Do not invent unavailable provider transcript data.
- Computer settings: horizontal tabs, basic controls first, advanced controls under Advanced, explicit future computer-use space without removing working Codex integration. Plugins receives the explicitly requested space, with no fabricated connections.
- Ownership: skills agent owns skill UI/runtime/protocol/client operations; settings agent owns settings UI/registry; subagent_preview agent owns task preview and related provider data; root owns queue preference runtime wiring, integration, docs, validation, delivery and subsequent proposals.

## Integration checks

- Runtime follow-up choice wired with tests for Codex and Pi queue preferences; default steering behavior retains existing tests.
- Initial full repository tests passed (desktop 380, runtime 348); full typecheck passed all 9 tasks. Final scoped focus/filesystem improvements have their own passing tests; final lint/build and visual checks ongoing.
- QA runs a separate Electron process with XDG_CONFIG_HOME=/tmp/adam-dev-qa/config. PID is /tmp/adam-dev-qa/electron.pid. Do not touch any other app process.
- Visual proof in /tmp/adam-dev-qa/proof: both themes for settings, provider model panels measured overflow:auto and max-height:288px. UI queue selection persisted; native skill edited on disk, disabled, and restored successfully.
- Review fixes: preserve file mode, avoid overwriting disable destinations, immediately replace saved skill details, protect simultaneous provider preference updates, restore keyboard focus in subagent preview.

## Implementation complete

- Final `pnpm test`: all 7 package test tasks passed, 893 package tests (383 desktop, 348 runtime); anti-slop and release-script checks also passed.
- Final `pnpm typecheck`: all 9 tasks passed. Final `pnpm lint`: all 8 tasks passed (3 existing desktop warnings, no errors). Desktop production build passed.
- Final Electron checks: native skill edit/save/disable/restore; provider queue preference persisted; separate model scrolling and filtering; Computer tabs and Plugins space; read-only/nested subagent preview and keyboard focus return. Light/dark screenshots and a preview recording are in /tmp/adam-dev-qa/proof.
- Implementation is ready for `adam-dev` delivery. Plugin proposal research starts after pushing; proposal artifacts stay outside this worktree.

## PR 108

- Requested end state: real `adam-dev` → `main` PR open and watched. PR: https://github.com/ApptoAI/deskto/pull/108.
- All 28 PNGs and one MP4 attached on `gh pr create --attach`; no media committed. Initial CI passed at 7fd0e62.
- CodeRabbit findings: external skill-save race, shared tab aria-controls, provider test file placement, Providers description. Fixing these in scope; docstring coverage is not pursued because house comments policy forbids filler.
- Watcher: /tmp/adam-dev-pr108-watch.py, PID stored in /tmp/adam-dev-pr108-watch/pid, latest snapshot in latest.json. Polls every 120 seconds. CLI keyring lookup began hanging; watcher loads the existing akrupa-appto account credential into subprocess environment without exposing it.
- Review fixes validated: all 899 package tests passed (354 runtime, 383 desktop), typecheck 9/9, lint 8/8 with the same 3 existing warnings, and desktop build passed. The first full test run stalled in an unchanged cookie-import test on the VM keyring; rerun used DBUS_SESSION_BUS_ADDRESS pointing to an absent test bus and passed.
- Skill saves preserve the displaced inode in a reserved recovery file, publish without overwriting a recreated target, and test concurrent replacement/open-file writes. Recovery files count toward resource limits but do not affect duplicate digests.
