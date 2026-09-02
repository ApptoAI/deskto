# ADR 0034: Palette tokens carry a contrast floor

- Status: accepted
- Date: 2026-09-02

## Context

ADR 0027 made the text ramp an opacity ramp and ADR 0029 specified light on
its own terms rather than deriving it from dark. Neither said what a rank had
to clear, so the two palettes drifted apart: the fourth text rank cleared
5:1 in dark and 3.6:1 in light, the focus ring sat at 2:1 in both, the
keyboard hint and the menu group label thinned an already-muted colour, and
the chart ramp was one fixed set of greys that was invisible on a white pane.
Each was a one-line tuning that nobody had a rule to check against.

## Decision

Every token has a floor, and both palettes are measured against it on the
pane and on the shell.

- Text ranks one to four clear 4.5:1 (WCAG AA for body copy). Rank five is
  the decorative rank and clears 3:1, the floor for a glyph or a large label.
- The focus ring clears 3:1 against the pane at whatever alpha it takes. It
  stays translucent so it reads as a halo, but a halo nobody can find is not
  a focus indicator.
- A control's boundary (`--input`) clears 3:1 against the pane.
- A component may not thin a text token with an opacity modifier. If a rank
  is too strong, the next rank down is the answer; if no rank fits, the ramp
  is wrong and gets a new step.
- Rank tokens such as the chart ramp point at the text ramp rather than
  carrying their own greys, so they inherit the floor.
- Paper rebinds every token a control inside it can read (border, input,
  ring, scrollbar), because the values it inherits were resolved against the
  pane, not the sheet.

The one exception is the Workspace accent ring. The eight accents are mid
lightness by design so a near-black label sits on them, and on a white pane
no alpha of those hues clears 3:1. When the accent is on, the control's
border carries the 3:1 and the ring carries the hue.

`packages/ui/src/styles/globals.test.ts` holds the palettes to parity: every
colour light states, dark restates, and nothing is declared that nothing
reads. `packages/ui/src/styles/contrast-floors.test.ts` measures the floors
above against both palettes, compositing translucent tokens over the pane and
the shell the way the browser paints them.

## Consequences

- Moving a token now means stating its measured ratio in the comment beside
  it, as the text ramp and the ring do.
- A dialog dims the window through `--scrim`, which is a palette value rather
  than a fixed black, because a fixed black that dims a white pane does
  nothing to a near-black one.
- The accent ring's shortfall in light is recorded here rather than fixed by
  darkening the accents, which would break the label that sits on them.
