# ADR 0029: One shell, one pane, frost only where the system paints it

- Status: accepted
- Date: 2026-09-01

## Context

ADR 0027 made the whole Surface glass over a painted wallpaper and blurred
every layer. ADR 0028 reversed it: the blur-everything treatment read as flat
grey, was heavy to composite, and made light mode a derivation that never
quite mirrored dark. Both are right about something. The transcript is the
product and must be read on an opaque, still surface. And a window that is
one undifferentiated sheet, with hairlines the only structure, reads as heavy
rather than calm.

The refresh takes its cue from a desktop app whose lightness the team admires.
Its recipe is narrow: the window is a single frosted shell that the operating
system blurs, the sidebar sits directly on that shell with no border, and the
content is one opaque card inset on the shell with its own hairline and a
small radius. Chrome fills and hairlines are alpha ink rather than opaque
greys. Blur appears in exactly two places: under the shell, where the
compositor does it for free, and on popovers, which are small. Light mode is
designed on its own terms: a white card, a grey shell, white popovers that
earn their separation from a border and a shadow.

## Decision

**The window is a shell with one pane inset on it.** The titlebar and the
sidebar sit on the shell and carry no rule between them. The pane is the one
opaque card, inset by 8px with a 10px radius and a hairline border, and it is
where every screen is read. Its border is the only persistent edge in the
window. Panels inside the pane, such as the task panel, keep ADR 0028's
hairline.

**Frost is native or nowhere.** On macOS the window uses `under-window`
vibrancy; on Windows 11 22H2 and later it uses acrylic. The shell colour thins
to let the blur through, and the main process tells the renderer with one
argv flag. Everywhere else the shell is opaque and nothing changes. There is
no wallpaper and no CSS backdrop filter over content.

**Popovers are frosted.** Menus, context menus, tooltips, and dialogs paint at
most of their opacity over a 44px blur, with a hairline and a real shadow.
They are the only CSS blur in the app. Under forced colours they go solid.

**Light is specified, not derived.** The pane is white, the shell warm grey,
the composer a white plate with a hairline and a faint lift, popovers white
over frost with a border and a shadow. Hairlines run 1.35 times heavier than
dark so they read at the same weight.

**Motion gets a vocabulary.** A menu enters in 140ms with a fade, a 2 percent
scale, and a 4px drop, and leaves in 100ms. A dialog enters in 180ms on the
expo-out curve. A new screen rises into the pane over 420ms on the same
curve; a screen that only updates does not move. The task panel slides in and out on its right margin over 260ms,
keeping its width so nothing inside it reflows, and stays mounted until the
slide lands. Hovers fade over 150ms and never snap. Every entrance collapses to a fade or to nothing under
`prefers-reduced-motion`.

**Chrome is set at 13px and cornered at 8px.** Sidebar rows, menu rows,
buttons, and the pane header use one size a step under reading text, so the
frame is quieter than what it frames. Buttons share the 8px corner of the
rows and chips around them rather than being pills; what says "this does
something" is the fill under the pointer and the dip on press. Key caps are
an ink plate with no border. The user bubble and the composer take a 16px
corner.

**There is no titlebar strip.** The window nav (sidebar toggle, history, new
task) sits in the first row of the sidebar column, in line with the traffic
lights, and the pane starts at the top beside it with an 8px inset. The pane
names what it shows in its own 40px header and carries that screen's actions
and, on Windows and Linux, the window controls. When the sidebar is hidden the
nav moves into that header. The sidebar is 256px.

**What stays.** ADR 0027's monochrome rule, the optional Workspace accent,
status carried by shape, paper for real documents, the provider mark, and the
destructive colour. Inter and Geist Mono. Lists never reorder on activity.

## Consequences

- ADR 0028's "no blur" line is narrowed, not reversed: content is never read
  through blur, and the two blurs that exist are native or small.
- The renderer learns one boolean from the main process, `frostedShell`, and
  the main process learns the chosen palette from the renderer, so the native
  blur and the pre-paint frame follow the app theme rather than the system's.
- `--shell` and `--pane` are the two surfaces; `--background` resolves to the
  pane and `--sidebar` to the shell, so components that ask for semantic
  slots follow without being rewritten.
- A new edge, fill, or shadow argues with this ADR by naming the relationship
  it separates or the lift it communicates.
