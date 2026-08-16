import { useState } from "react"
import RefreshCwIcon from "lucide-react/dist/esm/icons/refresh-cw"
import type { Harness } from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"

import { formatAge } from "../../lib/format-time.js"
import { describeHarnessHealth } from "../../lib/harness.js"
import { describedErrorSchema } from "../../runtime/describe-error.js"
import { useRuntimeClient } from "../../runtime/runtime-client-context.js"
import type { RuntimeQuery } from "../../runtime/use-runtime-query.js"
import { HarnessLogo } from "../brand-logos.js"
import { InlineError } from "../inline-error.js"
import { StatusPanel } from "../status-panel.js"

// Key used for the refresh button in the pending set, next to harness ids.
const refreshKey = "refresh"

export function HarnessSettings({
  harnesses,
}: {
  harnesses: RuntimeQuery<Harness[]>
}) {
  const client = useRuntimeClient()
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)

  async function run(key: string, action: () => Promise<Harness[]>) {
    setPending((current) => new Set(current).add(key))
    setActionError(null)
    try {
      harnesses.replace(await action())
    } catch (error) {
      setActionError(describedErrorSchema.parse(error))
    } finally {
      setPending((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  const checking = pending.has(refreshKey)
  const checked = checkedAgo(harnesses)

  return (
    <section aria-label="Agents" className="space-y-3">
      <div className="flex items-center justify-end gap-3">
        {checked ? (
          <p className="mr-auto text-xs text-muted-foreground">{checked}</p>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => run(refreshKey, () => client.refreshHarnesses())}
          disabled={checking || harnesses.state.status !== "ready"}
        >
          <RefreshCwIcon
            data-icon="inline-start"
            className={cn(checking && "animate-spin")}
          />
          {checking ? "Checking…" : "Check again"}
        </Button>
      </div>

      {actionError ? <InlineError message={actionError} /> : null}

      {harnesses.state.status === "loading" ||
      harnesses.state.status === "idle" ? (
        <StatusPanel title="Checking which agents are installed…" />
      ) : harnesses.state.status === "error" ? (
        <StatusPanel
          title="Deskto cannot read the list of agents"
          description={harnesses.state.message}
          tone="danger"
        >
          <Button variant="outline" onClick={harnesses.revalidate}>
            Try again
          </Button>
        </StatusPanel>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {harnesses.state.data.map((harness) => {
            const status = describeHarnessHealth(harness)
            return (
              <li
                key={harness.id}
                className="flex items-center gap-4 px-4 py-3"
              >
                <HarnessLogo
                  harnessId={harness.id}
                  className="size-5 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        status.dotClassName
                      )}
                    />
                    <span className="text-sm font-medium">{harness.name}</span>
                  </div>
                  <p className="pt-0.5 pl-3.5 text-xs leading-snug text-muted-foreground">
                    {status.detail}
                  </p>
                </div>
                <Switch
                  aria-label={`Use ${harness.name}`}
                  checked={harness.enabled}
                  disabled={pending.has(harness.id)}
                  onCheckedChange={(enabled) =>
                    run(harness.id, () =>
                      client.setHarnessEnabled(harness.id, enabled)
                    )
                  }
                />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Null until a check has actually happened; the page heading already says
    what this list is. */
function checkedAgo(harnesses: RuntimeQuery<Harness[]>): string | null {
  if (harnesses.state.status !== "ready") return null
  const latest = harnesses.state.data
    .map((harness) => harness.checkedAt)
    .filter((checkedAt): checkedAt is string => checkedAt !== null)
    .sort()
    .at(-1)
  if (!latest) return null
  const age = formatAge(latest)
  return age === "now" ? "Checked just now." : `Checked ${age} ago.`
}
