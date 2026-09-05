# ADR 0042: The Workspace accent tints the shell

- Status: accepted
- Date: 2026-09-05

## Context

ADR 0027 introduced the optional Workspace accent: when a person turns it on,
the filled control (`--primary`) takes the colour of the Workspace they are
standing in. ADR 0028 and ADR 0029 kept that accent and otherwise reserved
hue for identity and the destructive action. The shell — the surface the
titlebar and sidebar sit on — stayed a fixed grey in both palettes.

In practice the accent is easy to miss. A filled button is small and often
off screen, so the one cue that says "you are in the blue Workspace" is
absent from most views. The shell is the surface that is always visible and
already carries the Workspace name and swatch.

## Decision

**When the accent is on, the shell takes a small share of it.** `--shell` is
a `color-mix` of the palette's grey (`--shell-base`) and `--accent-base` at
7%. With the accent off `--accent-base` is absent, the mix falls back to the
base on both sides, and the shell is exactly the grey it was. The vibrant
variants mix the same way, keeping their alpha.

**The pane does not change.** The pane is where the work is read and stays
the palette's opaque white or near-black. Only the frame carries the hue.

**7% is a tint, not a colour.** The shell must still read as neutral grey at a
glance; the accent is recognisable only next to the untinted pane or another
Workspace. Text and hairline contrast on the shell are unaffected at this
strength in both palettes.

## Consequences

- The accent is now visible from every screen, not only where a filled
  control happens to be.
- ADR 0028's "hue is reserved for identity" line holds: the tint is the
  Workspace's identity colour, applied to the frame that names it.
- Any future surface that derives from `--shell` inherits the tint. A surface
  that must stay neutral reads `--shell-base` instead.
