import * as React from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@workspace/ui/lib/utils"

const proseClassName = cn(
  "text-sm leading-relaxed break-words",
  "[&>:first-child]:mt-0 [&>:last-child]:mb-0",
  "[&_p]:my-3",
  "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:font-heading [&_h1]:text-base [&_h1]:font-medium",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:font-heading [&_h2]:text-sm [&_h2]:font-medium",
  "[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-medium",
  "[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_li]:my-1 [&_li::marker]:text-muted-foreground",
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_hr]:my-4 [&_hr]:border-border",
  "[&_table]:my-3 [&_table]:w-full [&_table]:text-left [&_th]:border-b [&_th]:border-border [&_th]:py-1.5 [&_th]:pr-3 [&_th]:font-medium",
  "[&_td]:border-b [&_td]:border-border/60 [&_td]:py-1.5 [&_td]:pr-3 [&_td]:align-top",
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted/60 [&_pre]:p-3 [&_pre]:text-xs [&_pre]:leading-relaxed",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-xs",
  "[&_code]:rounded [&_code]:bg-muted/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]"
)

type MarkdownProps = {
  children: string
  className?: string
  onLinkActivate?: (href: string) => void
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
            <span className="text-muted-foreground underline underline-offset-3">
              {label}
            </span>
          )
        }

        return (
          <a
            href={href}
            className="underline underline-offset-3 hover:text-foreground"
            onClick={(event) => {
              event.preventDefault()
              onLinkActivate(href)
            }}
          >
            {label}
          </a>
        )
      },
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
