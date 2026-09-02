import * as React from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
// The barrel, not the per-icon path the desktop app uses: that path only
// typechecks against the icon shim under apps/desktop.
import { CheckIcon, CopyIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Agent output is the longest-lived text in the app, so it is set like a
 * document rather than like chat. Three rules do the work:
 *
 * Prose runs one step below white and headings run at it, which means the
 * ladder reads by colour before it reads by size and nothing has to be bold.
 * Every size is in `em`, so one class serves the 14 px conversation and the
 * 15 px file preview without a second scale. Space above a heading is roughly
 * three times the space below it, which is what attaches a heading to the
 * section it opens instead of leaving it floating between two.
 */
export const proseClassName = cn(
  "text-sm leading-[1.7] break-words text-body",
  "[&>:first-child]:mt-0 [&>:last-child]:mb-0",
  "[&_p]:my-[0.85em]",
  "[&_h1]:mt-[1.9em] [&_h1]:mb-[0.6em] [&_h1]:font-heading [&_h1]:text-[1.5em] [&_h1]:leading-[1.25] [&_h1]:font-normal [&_h1]:tracking-[-0.022em] [&_h1]:text-foreground",
  "[&_h2]:mt-[1.8em] [&_h2]:mb-[0.55em] [&_h2]:font-heading [&_h2]:text-[1.22em] [&_h2]:leading-[1.3] [&_h2]:font-normal [&_h2]:tracking-[-0.018em] [&_h2]:text-foreground",
  "[&_h3]:mt-[1.6em] [&_h3]:mb-[0.45em] [&_h3]:text-[1.06em] [&_h3]:leading-[1.4] [&_h3]:font-normal [&_h3]:tracking-[-0.012em] [&_h3]:text-foreground",
  // Past the third level a heading is a label, not a headline; it switches
  // voice to the mono eyebrow rather than inventing a fourth size.
  "[&_h4]:mt-[1.5em] [&_h4]:mb-[0.4em] [&_h4]:font-mono [&_h4]:text-[0.78em] [&_h4]:tracking-[0.1em] [&_h4]:text-muted-foreground [&_h4]:uppercase",
  "[&_strong]:font-medium [&_strong]:text-foreground",
  // The reading measure is the column's job, not the paragraph's. Capping
  // elements here left prose stopping short of the rules, tables and code
  // beside it, which reads as text cut off rather than text set to a width.
  "[&_ol]:my-[0.85em] [&_ol]:list-decimal [&_ol]:pl-[1.5em] [&_ul]:my-[0.85em] [&_ul]:list-disc [&_ul]:pl-[1.35em]",
  "[&_li]:my-[0.3em] [&_li]:pl-[0.2em] [&_li::marker]:text-muted-foreground",
  "[&_li>ol]:my-[0.3em] [&_li>ul]:my-[0.3em]",
  "[&_blockquote]:my-[1.1em] [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-[1em] [&_blockquote]:text-muted-foreground",
  "[&_hr]:my-[2em] [&_hr]:border-border",
  // The header row is a column label, so it takes the eyebrow voice; body
  // rows are divided by hairlines alone, with no fill and no zebra.
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-[0.95em]",
  "[&_th]:border-b [&_th]:border-border [&_th]:pt-0 [&_th]:pr-[1.5em] [&_th]:pb-[0.7em] [&_th]:font-mono [&_th]:text-[0.8em] [&_th]:font-normal [&_th]:tracking-[0.1em] [&_th]:whitespace-nowrap [&_th]:text-muted-foreground [&_th]:uppercase",
  "[&_td]:border-t [&_td]:border-border/50 [&_td]:py-[0.65em] [&_td]:pr-[1.5em] [&_td]:align-top [&_td]:tabular-nums",
  "[&_tbody_tr:first-child_td]:border-t-0 [&_td:last-child]:pr-0 [&_th:last-child]:pr-0",
  // The block's own margin lives on the wrapper that carries the copy button,
  // so the button and the code move together.
  "[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border/70 [&_pre]:bg-card [&_pre]:p-[1em] [&_pre]:text-[0.85em] [&_pre]:leading-[1.6]",
  "[&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[1em] [&_pre_code]:tracking-normal",
  // Tight horizontal padding on purpose: any more and the punctuation that
  // follows a chip reads as though there were a space before it.
  "[&_code]:rounded-[4px] [&_code]:border [&_code]:border-border/60 [&_code]:bg-card [&_code]:px-[0.28em] [&_code]:py-[0.12em] [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:tracking-normal [&_code]:text-foreground"
)

type MarkdownProps = {
  children: string
  className?: string
  onLinkActivate?: (href: string) => void
}

type CopyState = "idle" | "copied" | "failed"

// Keep wide tables inside the reading column. The wrapper owns the margin and
// focus so keyboard users can reach and scroll overflow without changing the
// table's native semantics.
function MarkdownTable({
  children,
  className,
}: React.ComponentProps<"table"> & { node?: unknown }) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Table"
      className="my-[1.4em] max-w-full overflow-x-auto"
    >
      <table className={className}>{children}</table>
    </div>
  )
}

/**
 * A code block with the one action anybody wants from one. The text is read
 * off the rendered `<pre>` rather than reassembled from React children, so
 * what lands on the clipboard is exactly what is on screen — highlighting
 * spans, language classes and all.
 *
 * The button is invisible until the pointer or the keyboard reaches the block:
 * a page of code blocks should not read as a page of buttons. What happened
 * after a press is said out loud in a live region rather than only drawn,
 * because a pointer user never has focus on the button to hear its label
 * change — and because a clipboard the window is not allowed to write to fails
 * silently otherwise.
 */
// Nothing is spread onto the <pre> below: react-markdown hands every custom
// component the hast node it came from, and passing that through would set
// node="[object Object]" on the element.
function CodeBlock({
  children,
  className,
}: React.ComponentProps<"pre"> & { node?: unknown }) {
  const preRef = React.useRef<HTMLPreElement>(null)
  const [state, setState] = React.useState<CopyState>("idle")
  // Cleared on unmount so a block that scrolls out mid-confirmation cannot
  // set state on a gone component.
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    []
  )

  function settle(next: CopyState) {
    setState(next)
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState("idle"), 2000)
  }

  async function copy() {
    const text = preRef.current?.textContent
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      settle("copied")
    } catch {
      settle("failed")
    }
  }

  const label =
    state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"

  return (
    <div className="group/code relative my-[1.2em]">
      {/* A wide block scrolls sideways, and a scroll container nobody can
          focus is a scroll container the keyboard cannot reach. */}
      <pre
        ref={preRef}
        tabIndex={0}
        role="region"
        aria-label="Code block"
        className={className}
      >
        {children}
      </pre>
      <Button
        variant="secondary"
        size="icon-sm"
        onClick={copy}
        aria-label={`${label} code`}
        title={`${label} code`}
        className={cn(
          "absolute top-2 right-2 opacity-0 transition-opacity duration-150 ease-out",
          "group-hover/code:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100",
          state !== "idle" && "opacity-100"
        )}
      >
        {state === "copied" ? (
          <CheckIcon aria-hidden />
        ) : (
          <CopyIcon aria-hidden />
        )}
      </Button>
      <span role="status" className="sr-only">
        {state === "idle" ? "" : label}
      </span>
    </div>
  )
}

/**
 * Renders trusted agent output. Raw HTML in the source is dropped rather than
 * parsed, so no `rehype-raw` here.
 */
function Markdown({ children, className, onLinkActivate }: MarkdownProps) {
  const components = React.useMemo<Components>(
    () => ({
      a({ href, children: label }) {
        const isExternal =
          href?.startsWith("http://") || href?.startsWith("https://")
        if (!href || !isExternal || !onLinkActivate) {
          return (
            <span className="text-muted-foreground underline decoration-muted-foreground/40 underline-offset-3">
              {label}
            </span>
          )
        }

        // A link that opens is the one thing in the prose brighter than the
        // prose. The underline stays quiet until the pointer is on it.
        return (
          <a
            href={href}
            className="text-foreground underline decoration-foreground/50 underline-offset-3 transition-colors duration-150 hover:decoration-foreground"
            onClick={(event) => {
              event.preventDefault()
              onLinkActivate(href)
            }}
          >
            {label}
          </a>
        )
      },
      pre: CodeBlock,
      table: MarkdownTable,
    }),
    [onLinkActivate]
  )

  return (
    <div data-slot="markdown" className={cn(proseClassName, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

export { Markdown }
