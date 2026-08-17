# ADR 0014: Fold a settled Turn, and move its agents to the panel

- Status: accepted
- Date: 2026-08-16

ADR 0015 supersedes only the dynamic Results tabs described here. The compact
Activity column and the full Activity surface remain unchanged.

## Context

A Thread printed everything a Turn did, forever. Twenty tool rows, a plan
card, a subagent card with its own nested rail, three preamble sentences, and
then — somewhere below all of it — the answer. Nothing shrank when the Turn
finished. Scrolling back through a week-old task meant scrolling back through
a week-old task's tool log, and the one sentence worth rereading was the
hardest thing in the view to find.

The subagent card was the worst of it. It is a card inside a conversation
holding a second conversation, and it grows while the outer one is trying to
stream. A card that unfolds mid-answer moves the text the user is reading.

The panel beside the conversation already existed and held exactly one kind
of thing: files. It was open perhaps a tenth of the time and empty the rest.

## Decision

**A settled Turn folds.** Every tool call and every intermediate assistant
sentence collapses into one closed disclosure, `Worked for 1m 1s`, sitting
above the answer under a full-width rule. Opening it shows the work in order.
A running Turn never folds: its tool calls land inline, and only the newest
five stay on screen, with the rest behind `+N more tool calls`, so a long run
reads as a live tail rather than a growing wall. It gets no header of its
own — the working indicator at the tail is already a counter, and a second
one at the top of the same Turn only asks the reader which to believe. The
duration appears when the Turn settles and there is one number to give. The
fold is keyed to the
Turn, not to a row: a prompt opens one, the next prompt closes it, and the
`turnId` a provider stamps on its mini-turns is not the grouping the user
sees.

**Plans and subagents leave the conversation entirely.** Not as a folded row,
not as a pointer — they are gone from the transcript. A plan is a document an
agent rewrites and a subagent is a process that is still running; neither is
something that _happened at a point in the conversation_, which is the only
thing a transcript is good at holding. They are the task's current state, and
state belongs beside the transcript rather than inside it.

**Beside means a column, not an overlay.** When the panel is closed, a card
sits in its own column to the right of the conversation carrying the plan and
the agent roster. The conversation narrows to make room rather than being
covered: text that a floating box sits on top of is text the user has to move
the box to read. The column folds away below the `lg` breakpoint, where the
conversation needs the width more than the roster does.

**One slot, two sizes.** Opening the panel is that same information at full
width, so the column gives up its slot instead of repeating itself. The card's
one button opens the panel; a click on any agent row does the same. The compact
column opens the stable Activities surface in the large panel. ADR 0015
supersedes the dynamic Results tabs: Files is the other stable surface, and
selecting a file opens it inside Files instead of creating a tab. The surface
selector badges agents still running, so a task says it is working while a
spreadsheet is in front of it.

The conversation column widens from `max-w-3xl` to `max-w-4xl`. It carries
prose now, not nested cards.

Work a Turn did _inside_ a subagent never reaches the conversation either. A
child Activity belongs to its parent, and the parent is in the column.

## Consequences

- A finished task reads as prompts and answers. The work is one click away
  from each answer, and it is the same rows it always was.
- A running task is legible while it runs: one counter, a live tail of tool
  calls, and no card unfolding under the text being read.
- Scrolling back through an old Turn shows no trace that it spawned agents.
  The roster is the whole thread's, not the Turn's, so a Turn's agents are
  findable but not attributable from the transcript. That is the cost of a
  conversation that holds still, and it is the intended trade.
- A Turn that only spawned agents has an empty fold. It keeps its
  `Worked for` label and drops the toggle, rather than offering to open onto
  blank space.
- A Turn's end is read from the last Activity to finish, because the Client
  never sees a Turn record. An answer that kept streaming after the last tool
  call reports slightly short. It is the closest honest number available
  without putting Turn timings in the protocol.
- A Turn with no Activity at all draws no header. There is nothing to report.
- Below `lg` the column is gone and the plan and roster are reachable only
  through the panel. A narrow window has one surface at a time either way.
- Rows are shared between the conversation and the panel rather than
  reimplemented. A tool call folded into a settled Turn and the same call read
  inside an agent are one component, so they cannot drift apart.
- The panel's stored width keeps its old key. A rename is no reason to hand a
  user's dragged width back.
- Activity is derived at render from the Thread view's activities. It adds no
  Runtime query, no event, and no storage.
