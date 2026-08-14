# ADR 0006: Add Workspaces above Projects, with Packs as the skill unit

- Status: accepted
- Date: 2026-08-14

## Context

People organize their work in areas such as press, personal, or client work, and each area spans several project folders. The application has only two levels today: a project (currently named `Workspace` in code) and its Threads. Skills reach the agent only because each Harness reads its own global and project configuration from disk; the application neither knows nor manages them. CONTEXT.md already reserves Pack, Catalog, and Hub for skill distribution.

Both supported Harnesses share two de facto standards: the SKILL.md folder format and AGENTS.md instructions. The Claude Agent SDK can load a local directory of skills into a session, and the Codex app-server can add external skill roots over RPC. The Codex RPC surface is experimental and tied to whatever binary version the person has installed.

## Decision

Rename the existing `Workspace` type to `Project` across code, protocol, and storage, in its own change. The name Workspace then means the new layer.

A Workspace is a container, modeled on Arc browser Spaces. It owns a name, color, icon, ordering, its attached Packs, the last active Project, and the last used Execution Profile. A Project belongs to exactly one Workspace and can be moved. A migration creates a non-deletable "Personal" Workspace and adopts all existing Projects; deleting a Workspace moves its Projects to Personal. Switching Workspaces is a full context switch: the sidebar shows only the active Workspace's Projects. Active selections persist in the existing settings table. Enabled Harnesses stay global.

A Pack is a provider-neutral directory under the application data folder: a small manifest, a `skills/` directory of SKILL.md folders, and later AGENTS.md instructions and MCP configuration. Packs attach to Workspaces many-to-many. They are created empty in the UI or imported from a folder; git and Hub sources come later and reuse the same layout.

Packs reach sessions through one neutral contract in the harness SDK: the run input gains a customization value, starting with skill root paths. The Runtime builds it from the active Workspace's Packs and knows nothing about providers. Each Adapter translates it to native mechanisms, a session plugin for Claude and extra skill roots for Codex, and degrades silently when the installed binary cannot honor it. Provider conditionals live only inside Adapters. Project-level skills stay file-based in the repository, read natively by each Harness. User-global Harness configuration keeps loading; Packs are additive.

## Consequences

- The rename is mechanical and touches roughly forty identifiers, but removes the standing mismatch between code (`Workspace`) and UI copy ("project").
- The Pack layout commits to SKILL.md and AGENTS.md rather than any provider's plugin manifest, so one Pack serves every Harness and the reserved Hub and Catalog concepts gain a concrete unit to distribute.
- Delivery quality varies by Harness and version; graceful degradation is part of the Adapter contract, not a workaround.
- Skill management UI starts small: attach and detach Packs per Workspace with a read-only preview of each skill's frontmatter. In-app editing, MCP in Packs, and per-Workspace Harness toggles stay deferred.
- Keyboard shortcuts for Workspace switching wait for the shortcut settings work in progress.
