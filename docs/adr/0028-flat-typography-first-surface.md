# ADR 0028: The Surface is flat and typography-first

- Status: accepted
- Date: 2026-08-31

## Context

ADR 0027 made glass, wallpaper blur, bevels, and elevation the structure of the
Surface. A refreshed task-page design reverses that hierarchy. The transcript
is the product, so chrome should recede behind type and spacing rather than
announce depth. The glass treatment also made quiet controls and adjacent
panels depend on effects that were harder to mirror consistently in light mode.

The refreshed design keeps ADR 0027's monochrome rule, provider and Workspace
identity colours, destructive colour, paper previews, and first-class light
and dark themes. This ADR changes how surfaces separate, not what hue means.

## Decision

The Surface uses opaque, flat layers. The window canvas, sidebar, transcript,
and task panel are separated only where their relationship requires a
hairline. The composer and user messages use one nearby solid fill. They have
no bevel, border, blur, gradient, glow, or shadow. Menus and dialogs may still
float because they cross component boundaries; real document previews remain
paper.

Typography and spacing carry task hierarchy. Agent prose is frameless, user
messages are compact right-aligned blocks, settled work folds into a quiet
summary, and files are small pills or rows rather than cards. The main
conversation is 680px wide, separated into 26px blocks. The task sidebar is
236px and the task panel opens at 340px.

Motion represents an interaction or a live state. Side panels move with an
interruptible horizontal transition. Buttons dip to 96% while pressed. Running
indicators may pulse or spin. Settled content, idle chrome, and final states do
not loop. Every transition stops under `prefers-reduced-motion`.

Both themes are specified directly. Dark is the design's native near-black
palette; light mirrors its rank with warm neutral opaque surfaces rather than
trying to derive transparency over a wallpaper.

## Consequences

- ADR 0027 is superseded for glass, wallpaper, bevel, and derived-theme rules.
- Its semantic colour restrictions, status shapes, paper previews, and
  optional Workspace accent remain in force.
- Components can continue using the existing semantic token names while those
  tokens now resolve to opaque surfaces.
- A new persistent edge, card, or ambient animation must explain what
  relationship or active state it communicates.
