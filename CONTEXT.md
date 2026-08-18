# Product context

## Purpose

This application gives non-technical users a desktop place to hand work to local AI agents. A user opens a folder as a project, starts a task, chooses Claude or Codex, and follows the result in a chat.

The first release is local and small. It has an Electron client, a Node runtime, SQLite storage, Markdown messages, approvals, cancellation, and resumable agent sessions. It does not contain team administration, automation, a hosted service, or a marketplace.

## Glossary

- **Surface**: A user-facing application. Desktop is the only Surface in the MVP. Web and mobile may follow.
- **Client**: Surface-side code that calls the Runtime through a transport. It does not import Node, SQLite, Electron, or a provider SDK.
- **Runtime**: The application service that owns projects, threads, turns, persistence, and Harness sessions.
- **Environment**: A place where a Runtime runs and where work executes. The MVP has one local Environment inside the Electron main process.
- **Connection**: Client configuration for reaching an Environment. Desktop uses Electron IPC. A future hosted Runtime can use HTTP and WebSocket without changing Client use cases.
- **Workspace**: A container of Projects for one area of life or work, modeled on Arc browser Spaces. It owns a name, color, icon, its attached Packs, and the last active Project. Every install has a non-deletable Personal Workspace.
- **Project**: A folder the user has opened as a project. It belongs to exactly one Workspace. Use "project" in UI copy and `Project` in code.
- **Thread**: A task and its conversation inside one Project. Use "task" in UI copy and `Thread` in code.
- **Background task**: A Thread created by another Thread through Deskto's local MCP server. It stays in the same Project, keeps its own Harness session and conversation, and points to its parent Thread.
- **Turn**: One user request and one Harness execution in a Thread.
- **Message Attachment**: An image supplied with a user Message. The Runtime owns its bytes and metadata, deletes it with the Message, exposes only metadata in Thread views, and returns image data on demand for previews.
- **Activity**: A bounded summary of one unit of Harness work inside a Turn. Its kind is provider-neutral: a tool call, a file change, a working plan, or a subagent. Subagent work nests under the Activity that spawned it.
- **Artifact**: A file inside a Project that a Turn produced, either named by a completed file-change Activity or found in the Project folder by a sweep. The UI calls it a file. An Artifact keeps a stable identity for its project-relative path.
- **Turn Output**: The attribution between a Turn and an Artifact it created or changed. One Artifact can be an output of several Turns.
- **Browser**: One in-app web tab owned by a Task. A Surface shows it, while a Runtime-provided MCP lease lets the selected Harness inspect and operate the same tab.
- **Browser Element Context**: A bounded semantic description of a page element the person selected in a Task's Browser for the next Turn. Page metadata is untrusted context, never an instruction.
- **Harness**: An agent product that performs work, such as Claude Code or Codex.
- **Harness SDK**: The provider-neutral package that defines Harness descriptors, sessions, events, approvals, and test helpers.
- **Harness Adapter**: Runtime code that maps one Harness protocol into the Harness SDK contract.
- **MCP Server**: The local `@deskto/mcp-server` in-process HTTP server that lets a Harness create, inspect, search, wait for, and continue Runtime Threads. Desktop starts and configures it without user setup.
- **Execution Profile**: The model, thinking level, and permission mode used by a Harness. A Thread owns the editable profile; every Turn stores the profile it started with.
- **Skill Occurrence**: One skill directory found at one physical location. Occurrences keep their identity even when another skill has the same name or their `SKILL.md` is invalid.
- **Skill Exposure**: The relationship between a Skill Occurrence and a Harness. It records native discovery or Deskto's latest attempt to configure an app-supplied root. It does not claim the Harness used the skill.
- **Pack**: A provider-neutral directory of skills attached to multiple Workspaces. A managed Pack lives under Deskto's application data directory. A linked Pack stays at a user-selected external path. Prompts, MCP configuration, templates, tool requirements, and versioning may follow.
- **Prompt Reference**: A semantic reference selected while composing a Turn, currently a Project entry or a Skill. The Client keeps visible token text while the Runtime validates the reference and a Harness Adapter translates it to its native input. A Skill reference may name a Pack skill, which every Harness reaches through Deskto, or a skill found in one Harness's own folder, which only that Harness may reference.
- **Catalog**: A future list of Packs available to a person or organization.
- **Hub**: A future service that publishes Catalogs and Packs. A Hub does not execute Threads.

## Core rules

- A Project points to one folder, belongs to one Workspace, and owns its Threads.
- Deleting a Workspace moves its Projects to the Personal Workspace. Nothing on disk is touched.
- A Thread uses one Harness. Its provider session identifier stays in Runtime storage and never becomes a Client concern.
- A Background task is a normal durable Thread. Write access through MCP stays inside the current Thread tree; read-only search may span all local Threads.
- Deleting a Thread removes it and its Turns for good, stopping any Turn in flight. It is the only destructive task action; Done is a classification, not a delete. Nothing on disk is touched.
- A Thread's Execution Profile can change only between Turns. Available models and thinking levels come from its Harness rather than a shared hardcoded catalog.
- The Runtime persists user messages before starting a Harness.
- Message Attachment bytes stay in Runtime storage and are read on demand. Thread views and Runtime events carry metadata only.
- The Runtime converts provider output into Harness SDK events before it reaches the Client.
- Permission modes have common product meaning. Harness Adapters own their provider-specific security mapping.
- Tool activity shown in a Thread is a bounded summary, not a transcript or an audit log.
- A Thread shows prose and the tool calls that produced it; a settled Turn folds that work behind one disclosure. A plan and its subagents are the task's state, not its transcript: they render beside the conversation and never inside it, along with any work done within a subagent.
- Artifact contents are read on demand through Runtime queries. They do not live in Activities, Thread views, or Runtime events.
- A task's panel has stable Files, Activities, and Browser surfaces. Producing a file never opens the panel or replaces what the user is viewing; settled answers link to the files attributed to their Turn.
- Conversation links open page-like HTML and PDF files in Browser by default. Files remains the default for other formats and for browsing the task's Artifact collection.
- Browser tools are provider-neutral session customization. Each Harness Adapter translates the same private HTTP MCP connection to its native configuration.
- Browser Element Context stays in the Surface draft. On send, the Runtime adds it to the Harness prompt as explicitly untrusted page data while the persisted user Message keeps the person's original text.
- Computer Use is a Codex plugin capability, not a shared Harness feature. Deskto does not expose it to Claude or reimplement operating-system control.
- A Harness that does not report what a tool wrote is not asked to. The Runtime watches the Project folder around work of that kind and applies one set of capture rules to reported and observed files alike.
- A Surface may write an Artifact back only for formats a simplified editor cannot damage, and only against the version it loaded. The Runtime, not the Surface, decides both.
- The Client rebuilds current state from Runtime queries. Runtime events only make an open view current: high-frequency changes arrive as sequenced thread deltas, and any gap falls back to a query.
- Local use never requires a Hub or an account.
- Provider-specific types stay inside their Harness Adapter.
- Project, user, and system skill files remain on disk and are not mirrored in SQLite.
- A Pack attachment applies to every Project in its Workspace.
- Unlinking a Pack never deletes files. Uninstalling is limited to managed Packs and moves their directory to trash.

## Package boundaries

- `packages/harness-sdk` has pure TypeScript contracts and test helpers. It has no provider, Electron, database, or UI dependencies.
- `packages/protocol` defines serializable Runtime requests, responses, events, and domain records.
- `packages/settings` defines every user-configurable setting: its key, schema, default value, and editor kind. The Runtime stores only overrides; defaults stay in the registry.
- `packages/client` wraps a transport with task-oriented methods for any Surface.
- `packages/runtime` implements use cases, SQLite persistence, and built-in Harness Adapters.
- `packages/mcp-server` exposes bounded thread orchestration and local full-text search to Harnesses through MCP. It calls the Runtime protocol and never owns persistence.
- `packages/ui` contains reusable DOM components. It does not call Electron or the Runtime.
- `apps/desktop` hosts the Runtime in Electron main, exposes a narrow preload bridge, and composes the React Surface.

## Deliberately deferred

- Web and mobile Surfaces
- A remotely hosted Runtime
- Authentication and team administration
- Hub, Catalog, remote Pack distribution, and policy enforcement
- User and Pack MCP provisioning, beyond the app-owned Browser server
- Starter project distribution
- Automation and usage screens
- A user-facing global search screen

The boundaries above reserve a place for these features. They do not justify placeholder services or UI in the MVP.
