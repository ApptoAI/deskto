# ADR 0027: The Surface is monochrome glass over a wallpaper

- Status: accepted
- Date: 2026-08-30

## Context

Deskto's Surface was a flat shadcn palette: opaque surfaces stepping up a
four-value ladder, colour-coded status dots, and a light and a dark theme whose
values were tuned independently of each other.

A redesign replaced that visual layer wholesale. Its brief drew a monochrome
glass system — translucent surfaces over a blurred wallpaper, status carried by
the shape of a glyph rather than its hue — and it made two decisions that
contradict what the app already did. It dropped light mode, and it introduced a
"paper" surface for real document content, which `document-preview.tsx` had
explicitly refused. Neither can be adopted silently.

## Decision

The Surface is monochrome glass. Every surface, edge, and text colour is the
canvas or its opposite at some opacity, over a wallpaper that the glass blurs.

**Three rules generate the palette**, and both themes are the same rules read
from opposite ends:

1. Raised is closer to the light, recessed is further from it. A composer lifts
   off the window; a side panel sinks under it.
2. The bevel is always white. An inset top highlight is an edge catching light
   from above, and light comes from above in both themes. It is the one value
   that does not invert.
3. The filled pill is whatever the canvas is not.

**Both themes stay first-class**, against the brief. The brief dropped light
mode; the app ships a persisted `appearance.theme` setting, and removing the
palette would have removed a feature a person had already chosen. Dark is
transcribed from the design, which is the theme it was drawn in. Light is
derived by the three rules above, and the derivation is real work rather than
an inversion filter: the wallpaper needed a much wider lightness ramp than a
first pass gave it, and a recessed panel needed a flood of mid grey rather than
the few per cent of black that mirroring the dark tint suggested. At 3.5% the
sidebar sat level with the canvas and the wallpaper's own gradient was louder
than the surface meant to be reading as recessed.

**Status is carried by shape**, never by hue. Six states, six silhouettes: a
half-wedge ring for running, the same ring at full strength for needs-you, a
dashed ring for snoozed, a solid disc for an unseen completion, and a disc with
a check or a cross cut out of it for done and failed. Weight separates the two
rings; the cut mark is painted in `--knockout`, the opaque colour the glass
resolves to, because a translucent cut would tint whatever scrolled beneath it.

**Two exceptions keep their colour**, both because they identify something
rather than style the app:

- The provider mark. Claude's `#D97757` says whose model is running.
- Workspace swatches. A person picked that colour to tell their workspaces
  apart, so it is their data.

A third, narrower exception is `--destructive`. The design is monochrome, but
its rule is about *status*, and warning that an action cannot be undone is a
different job. Deleting a Thread is the only destructive task action Deskto has,
and its control stays red.

**Real document content is paper**, reversing the decision recorded in
`document-preview.tsx`, which held that "a drop-shadowed white sheet would be
the one object in the app pretending to be physical." The redesign makes the
break deliberate: when Deskto shows the file it produced rather than the agent
talking about that file, the surface stops being glass and becomes an opaque
lifted sheet. The shift *is* the signal. Paper rebinds the semantic tokens for
everything inside it, because the sheet is light in both themes and the dark
theme's near-white foreground would otherwise vanish into it.

The wallpaper is painted by `body` and is structural, not decoration. A glass
panel over a flat single colour reads as flat grey; the blur needs something
varied behind it to be a blur of anything.

## Consequences

- Adding a hue to the Surface is now a decision that has to argue with this
  ADR, not a styling choice.
- A component asking for `bg-card` or `text-muted-foreground` gets the right
  glass without knowing it: the semantic slots are mapped onto the glass
  vocabulary, so most of the Surface followed the token layer rather than being
  rewritten.
- Light mode is derived rather than specified. Where the design file is silent,
  light is this repository's answer, and the three rules are how a future change
  stays consistent rather than guessing again.
- `--knockout` and the `paper` token rebinding exist because translucency
  breaks two assumptions that opaque surfaces let components make: that a
  knocked-out shape can be painted in the surface colour, and that
  `text-foreground` is legible on any surface in the app.
- The glass is `backdrop-filter`, which forced-colours mode has its own opinion
  about. Those surfaces go solid under `forced-colors: active`.
- The main process paints `--wp-base` behind a window that outruns its web
  contents, not a surface colour, because the wallpaper is what is furthest
  back. It has to be kept in step by hand.
