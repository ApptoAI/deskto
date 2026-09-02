import pathlib, sys

root = pathlib.Path("/home/exedev/deskto/.claude/worktrees/wf_c4a39633-e9d-4")

def edit(rel, pairs):
    p = root / rel
    s = p.read_text()
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            print(f"FAIL {rel}: expected 1 match, got {n} for:\n{old[:120]}")
            sys.exit(1)
        s = s.replace(old, new)
    p.write_text(s)
    print("ok", rel)

G = "packages/ui/src/styles/globals.css"
edit(G, [
    # expose scrim and scrollbar tokens
    ("""  --color-knockout: var(--knockout);
""", """  --color-knockout: var(--knockout);
  --color-scrim: var(--scrim);
  --color-scrollbar-thumb: var(--scrollbar-thumb);
  --color-scrollbar-thumb-hover: var(--scrollbar-thumb-hover);
"""),
    # drop the unused glass aliases
    ("""  --glass-composer: #ffffff;
  --glass-window: var(--shell);
  --glass-panel-light: var(--pane);
  --glass-panel-dark: var(--pane);
""", """  --glass-composer: #ffffff;
"""),
    # scrim + scrollbar tokens, light
    ("""  /* Popovers are frosted: the surface at most of its opacity over a wide blur,
       so what sits beneath a menu is felt rather than seen. */
  --blur-popover: blur(44px) saturate(1.4);
""", """  /* Popovers are frosted: the surface at most of its opacity over a wide blur,
       so what sits beneath a menu is felt rather than seen. */
  --blur-popover: blur(44px) saturate(1.4);

  /* What a dialog dims the window with. Dark needs far more of it: 30% black
       over a near-black pane is no dimming at all. */
  --scrim: oklch(0 0 0 / 30%);

  /* A slim lane that reads as content continuing, not as chrome. */
  --scrollbar-thumb: oklch(0 0 0 / 14%);
  --scrollbar-thumb-hover: oklch(0 0 0 / 22%);
"""),
    # text ramp: light text-4/5 measured against AA
    ("""  --text-3: oklch(0 0 0 / 57%);
  /* Descriptions remain below supporting text without falling below body-copy
       readability when they span more than one line. */
  --text-4: oklch(0 0 0 / 47%);
  --text-5: oklch(0 0 0 / 31%);
""", """  --text-3: oklch(0 0 0 / 57%);
  /* Descriptions remain below supporting text without falling below body-copy
       readability when they span more than one line: 55% is the first step
       that clears 4.5:1 on both the pane and the shell (47% sat at 3.6:1,
       while the dark value clears 5:1). */
  --text-4: oklch(0 0 0 / 55%);
  /* The decorative rank: 3:1, the floor for a glyph, on the pane. */
  --text-5: oklch(0 0 0 / 42%);
"""),
    # ring alpha
    ("""  /* Translucent on purpose: the focus halo should read as a glow around the
       control, not a second border stacked on the first. */
  --ring: var(--accent-ring, oklch(0.4 0.006 286 / 40%));
  --chart-1: oklch(0.87 0 0);
  --chart-2: oklch(0.556 0 0);
  --chart-3: oklch(0.439 0 0);
  --chart-4: oklch(0.371 0 0);
  --chart-5: oklch(0.269 0 0);
""", """  /* Translucent on purpose: the focus halo should read as a glow around the
       control, not a second border stacked on the first. The alpha is the
       lowest that still clears 3:1 against the pane, which is what a focus
       indicator owes a keyboard user; 40% read at 2:1. */
  --ring: var(--accent-ring, oklch(0.4 0.006 286 / 62%));
  /* Rank tokens follow the text ramp so a dot or a bar painted with them is
       visible in both palettes; a fixed grey ramp vanished on one of them. */
  --chart-1: var(--text-1);
  --chart-2: var(--text-2);
  --chart-3: var(--text-3);
  --chart-4: var(--text-4);
  --chart-5: var(--text-5);
"""),
    # dark overrides
    ("""  --blur-popover: blur(44px) saturate(1.4);
""" if False else """  --elevation-composer: inset 0 0 0 1px var(--edge);

  --text-1: #ececee;
""", """  --elevation-composer: inset 0 0 0 1px var(--edge);

  --scrim: oklch(0 0 0 / 55%);

  --scrollbar-thumb: oklch(1 0 0 / 8%);
  --scrollbar-thumb-hover: oklch(1 0 0 / 12%);

  --text-1: #ececee;
"""),
    ("""  --ring: var(--accent-ring, oklch(0.75 0.006 286 / 45%));
}
""", """  --ring: var(--accent-ring, oklch(0.75 0.006 286 / 55%));
}
"""),
    # body: no wallpaper any more, nothing to pin
    ("""    background: var(--wp-base);
    background-attachment: fixed;

    font-size: var(--text-base);
""", """    background: var(--wp-base);

    font-size: var(--text-base);
"""),
    # reduced motion: looping opacity is decoration
    ("""/* The window shell. */
@utility glass-window {
""", """/* A pulse is decoration on top of a state the text already names, and it
   loops for as long as the state lasts. It is stated outside the layers so it
   outranks the utility wherever a component reached for it. */
@media (prefers-reduced-motion: reduce) {
  .animate-pulse {
    animation: none;
  }
}

/* The window shell. */
@utility glass-window {
"""),
])

S = "apps/desktop/src/renderer/styles.css"
edit(S, [
    ("""  :root {
    --app-scrollbar-width: 6px;
    --app-scrollbar-thumb: oklch(0 0 0 / 14%);
    --app-scrollbar-thumb-hover: oklch(0 0 0 / 22%);
  }

  .dark {
    --app-scrollbar-thumb: oklch(1 0 0 / 8%);
    --app-scrollbar-thumb-hover: oklch(1 0 0 / 12%);
  }
""", """  :root {
    --app-scrollbar-width: 6px;
  }
"""),
    ("""  ::-webkit-scrollbar-thumb {
    background: var(--app-scrollbar-thumb);
    border-radius: 3px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: var(--app-scrollbar-thumb-hover);
  }
""", """  ::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: 3px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }
"""),
    ("""  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  font-size: 12px;
  color: var(--dp-fg);
""", """  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--dp-fg);
"""),
    ("""  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 10px;
""", """  font-family: var(--font-mono);
  font-size: 10px;
"""),
])

edit("packages/ui/src/components/scroll-area.tsx", [
    ("""bg-[var(--app-scrollbar-thumb,var(--color-border))] transition-colors hover:bg-[var(--app-scrollbar-thumb-hover,var(--color-muted-foreground))]""",
     """bg-scrollbar-thumb transition-colors hover:bg-scrollbar-thumb-hover"""),
])

edit("packages/ui/src/components/kbd.tsx", [
    ("""text-tiny leading-none text-muted-foreground/80 tabular-nums""",
     """text-tiny leading-none text-muted-foreground tabular-nums"""),
    (""" * control. An ink plate rather than a border, so it reads the same inside a
 * button, a menu row, and a white popover.
""", """ * control. An ink plate rather than a border, so it reads the same inside a
 * button, a menu row, and a white popover. The label is at full muted
 * strength: at ten pixels it has no contrast to spare.
"""),
])

edit("packages/ui/src/components/dropdown-menu.tsx", [
    ("""        "px-2 pt-1.5 pb-1 eyebrow text-muted-foreground/70 data-inset:pl-7",""",
     """        "px-2 pt-1.5 pb-1 eyebrow text-muted-foreground data-inset:pl-7","""),
])

edit("packages/ui/src/components/switch.tsx", [
    ("""        "pointer-events-none block size-4 rounded-full bg-knockout transition-transform data-checked:translate-x-3.5 data-unchecked:translate-x-0.5\"""",
     """        "pointer-events-none block size-4 rounded-full bg-background transition-transform motion-reduce:transition-none data-checked:translate-x-3.5 data-unchecked:translate-x-0.5\""""),
    ("""function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
""", """/**
 * The thumb is painted in the pane colour rather than the knockout: on the
 * unchecked track (the input edge) the knockout sat under 3:1 in both palettes,
 * and the pane is the one value that clears it against the track in both.
 */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
"""),
])

edit("packages/ui/src/components/dialog.tsx", [
    ("""        "fixed inset-0 isolate z-50 bg-black/30 duration-180""",
     """        "fixed inset-0 isolate z-50 bg-scrim duration-180"""),
])

edit("packages/ui/src/components/sheet.tsx", [
    ("""        "fixed inset-0 isolate z-50 bg-black/30 duration-200""",
     """        "fixed inset-0 isolate z-50 bg-scrim duration-200"""),
])

edit("packages/ui/src/components/chat/message.tsx", [
    ("""      className={cn("animate-pulse text-sm text-muted-foreground", className)}""",
     """      className={cn(
        "motion-safe:animate-pulse text-sm text-muted-foreground",
        className
      )}"""),
])

edit("apps/desktop/src/renderer/components/brand-logos.tsx", [
    ("""  ["claude", "text-[#D97757]"],""", """  ["claude", "text-brand-claude"],"""),
])
