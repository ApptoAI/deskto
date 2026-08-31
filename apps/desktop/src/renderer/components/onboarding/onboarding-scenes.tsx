import type { CSSProperties, ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Decorative mock windows for the wizard's explainer steps. Everything is
 * drawn from theme tokens so the scenes follow the palette the user picks on
 * the appearance step, and everything is aria-hidden: the copy on the left
 * carries the meaning.
 */

// One row of mock UI plus its gap; the roving highlight moves by this much.
const roveStep = "2.375rem"

/** Shared frame: a mock window with a title bar, sized like the theme pane. */
export function ScenePanel({ children }: { children: ReactNode }) {
  return (
    <div
      aria-hidden
      className="flex h-56 flex-col overflow-hidden rounded-window bg-fill-card ring-1 ring-edge-strong"
    >
      <div className="flex h-6 shrink-0 items-center gap-1.5 border-b border-border bg-fill-chip px-2.5">
        <span className="size-1.5 rounded-full bg-border" />
        <span className="size-1.5 rounded-full bg-border" />
        <span className="size-1.5 rounded-full bg-border" />
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  )
}

/**
 * The inbox: four task rows in different states while a soft focus ring
 * strolls through them, the way triage feels. Reduced motion parks the
 * focus on the first row.
 */
export function InboxScene() {
  return (
    <ScenePanel>
      <div className="flex h-full flex-col gap-2 p-3">
        <p className="eyebrow text-muted-foreground">Inbox</p>
        <div
          className="relative flex flex-col gap-1.5"
          // SAFETY: CSSProperties has no index for custom properties, but
          // React passes them straight through to the style attribute.
          style={{ "--rove-step": roveStep } as CSSProperties}
        >
          <span
            className="absolute inset-x-0 top-0 h-8 rounded-lg bg-foreground/6 motion-safe:animate-[scene-rove_7s_var(--ease-in-out-quart)_infinite]"
            style={{ animationDelay: "0s" }}
          />
          <SceneRow
            dot="bg-foreground/50 motion-safe:animate-pulse"
            title="w-28 bg-foreground/70"
            meta="Working"
          />
          <SceneRow dot="bg-foreground" title="w-36 bg-foreground/70" meta="Review" />
          <SceneRow
            dot="bg-muted-foreground"
            title="w-24 bg-muted-foreground/50"
            meta="Done"
          />
          <SceneRow
            className="opacity-60"
            dot="bg-muted-foreground/40"
            title="w-32 bg-muted-foreground/50"
            meta="3h"
          />
        </div>
      </div>
    </ScenePanel>
  )
}

function SceneRow({
  dot,
  dotDelay,
  title,
  meta,
  className,
}: {
  dot: string
  /** Offsets a pulsing dot so siblings do not blink in unison. */
  dotDelay?: string
  title: string
  meta: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "relative flex h-8 items-center gap-2.5 rounded-row border border-edge bg-fill-card px-3",
        className
      )}
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", dot)}
        style={dotDelay ? { animationDelay: dotDelay } : undefined}
      />
      <span className={cn("h-1 rounded-full", title)} />
      <span className="ml-auto text-[9px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {meta}
      </span>
    </span>
  )
}

/**
 * Projects: a sidebar of three project rows with the same roving focus, and
 * a main pane whose content swaps in step with it — each project is its own
 * folder, its own tasks. The layer delays put each pane on screen exactly
 * while the focus sits on its row.
 */
export function ProjectsScene() {
  return (
    <ScenePanel>
      <div className="flex h-full">
        <div className="flex w-2/5 shrink-0 flex-col gap-2 border-r border-border bg-fill-chip p-3">
          <p className="eyebrow text-muted-foreground">Projects</p>
          <div
            className="relative flex flex-col gap-1.5"
            // SAFETY: CSSProperties has no index for custom properties, but
            // React passes them straight through to the style attribute.
            style={{ "--rove-step": roveStep } as CSSProperties}
          >
            <span className="absolute inset-x-0 top-0 h-8 rounded-lg bg-foreground/6 motion-safe:animate-[scene-rove_7s_var(--ease-in-out-quart)_infinite]" />
            <ProjectRow name="w-16" />
            <ProjectRow name="w-20" />
            <ProjectRow name="w-12" />
          </div>
        </div>
        <div className="relative min-w-0 flex-1 p-3">
          <ProjectPane bars={["w-3/5", "w-full", "w-4/5"]} delay="0s" static />
          <ProjectPane bars={["w-2/5", "w-3/4", "w-full", "w-1/2"]} delay="-4.667s" />
          <ProjectPane bars={["w-1/2", "w-5/6"]} delay="-2.333s" />
        </div>
      </div>
    </ScenePanel>
  )
}

/**
 * Orchestration: a parent task fanning out into child threads on a tree
 * line, each child in a different phase — drawn straight from what the MCP
 * orchestrator actually does.
 */
export function OrchestrationScene() {
  return (
    <ScenePanel>
      <div className="flex h-full flex-col gap-2 p-3">
        <p className="eyebrow text-muted-foreground">Task</p>
        <SceneRow
          dot="bg-foreground/50 motion-safe:animate-pulse"
          title="w-36 bg-foreground/70"
          meta="Fanning out"
        />
        <div className="ml-4 flex flex-col gap-1.5 border-l border-border pl-3">
          <SceneRow
            dot="bg-foreground/50 motion-safe:animate-pulse"
            title="w-24 bg-foreground/60"
            meta="Working"
          />
          <SceneRow
            dot="bg-foreground/50 motion-safe:animate-pulse"
            dotDelay="0.4s"
            title="w-28 bg-foreground/60"
            meta="Working"
          />
          <SceneRow
            dot="bg-muted-foreground"
            title="w-20 bg-muted-foreground/50"
            meta="Done"
          />
        </div>
      </div>
    </ScenePanel>
  )
}

function ProjectRow({ name }: { name: string }) {
  return (
    <span className="relative flex h-8 items-center gap-2 rounded-lg px-2.5">
      <span className="size-2.5 shrink-0 rounded-sm border border-edge bg-fill-card" />
      <span className={cn("h-1 rounded-full bg-foreground/60", name)} />
    </span>
  )
}

function ProjectPane({
  bars,
  delay,
  static: isStatic,
}: {
  bars: string[]
  delay: string
  /** The layer left visible when reduced motion turns the swap off. */
  static?: boolean
}) {
  return (
    <span
      className={cn(
        "absolute inset-3 flex flex-col gap-2 motion-safe:animate-[scene-slot_7s_linear_infinite]",
        isStatic ? "opacity-100" : "opacity-0"
      )}
      style={{ animationDelay: delay }}
    >
      <span className="h-1.5 w-1/3 rounded-full bg-foreground/70" />
      {bars.map((width, index) => (
        <span
          key={index}
          className={cn("h-1 rounded-full bg-muted-foreground/40", width)}
        />
      ))}
      <span className="mt-auto h-7 rounded-row border border-edge bg-fill-card" />
    </span>
  )
}
