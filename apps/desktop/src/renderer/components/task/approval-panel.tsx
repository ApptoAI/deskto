import { useState } from "react"
import type { Approval } from "@openappto/protocol"

import { Button } from "@workspace/ui/components/button"

import { describeError } from "../../runtime/describe-error.js"
import { InlineError } from "../inline-error.js"

const kindHeadings: Record<Approval["kind"], string> = {
  command: "The agent wants to run a command",
  "file-change": "The agent wants to change files",
  tool: "The agent wants to use a tool",
}

export function ApprovalPanel({
  approval,
  onResolve,
}: {
  approval: Approval
  onResolve: (decision: "approve" | "deny") => Promise<void>
}) {
  const [pending, setPending] = useState<"approve" | "deny" | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function resolve(decision: "approve" | "deny") {
    setPending(decision)
    setError(null)
    try {
      await onResolve(decision)
    } catch (resolveError) {
      setError(describeError(resolveError))
    } finally {
      setPending(null)
    }
  }

  return (
    <section
      aria-labelledby={`approval-${approval.id}`}
      className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <div className="space-y-1">
        <h3 id={`approval-${approval.id}`} className="text-sm font-medium">
          {kindHeadings[approval.kind]}
        </h3>
        <p className="text-sm text-muted-foreground">{approval.title}</p>
      </div>

      {approval.detail ? (
        <pre className="max-h-40 overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {approval.detail}
        </pre>
      ) : null}

      {error ? <InlineError message={error} /> : null}

      <div className="flex items-center gap-2">
        <Button onClick={() => resolve("approve")} disabled={pending !== null}>
          {pending === "approve" ? "Allowing…" : "Allow"}
        </Button>
        <Button
          variant="outline"
          onClick={() => resolve("deny")}
          disabled={pending !== null}
        >
          {pending === "deny" ? "Declining…" : "Decline"}
        </Button>
      </div>
    </section>
  )
}
