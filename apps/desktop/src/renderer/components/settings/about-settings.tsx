import { Button } from "@workspace/ui/components/button"

import { InlineError } from "../inline-error.js"
import { useUpdates } from "../../updates/updates-context.js"

export function AboutSettings() {
  const { state, loadError, actionError, check, install } = useUpdates()

  const checking = state?.status === "checking"
  const downloading = state?.status === "downloading"
  const unavailable = !state || state.status === "unavailable"

  return (
    <section aria-label="About Deskto" className="space-y-4">
      {actionError ? <InlineError message={actionError} /> : null}
      {loadError ? <InlineError message={loadError} /> : null}
      {state?.status === "error" ? (
        <InlineError message={state.message} />
      ) : null}

      <div className="rounded-lg border border-border p-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="text-sm font-medium">Deskto</h2>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              Version{" "}
              {state?.currentVersion ?? (loadError ? "unavailable" : "…")}
            </p>
          </div>
          {state?.status === "ready" ? (
            <Button onClick={() => void install()}>Restart to update</Button>
          ) : (
            <Button
              variant="outline"
              disabled={checking || downloading || unavailable}
              onClick={() => void check()}
            >
              {checking
                ? "Checking…"
                : downloading
                  ? "Downloading…"
                  : "Check for updates"}
            </Button>
          )}
        </div>

        <p aria-live="polite" className="mt-4 text-sm text-muted-foreground">
          <UpdateStatus state={state} loadError={loadError} />
        </p>
      </div>
    </section>
  )
}

function UpdateStatus({
  state,
  loadError,
}: {
  state: ReturnType<typeof useUpdates>["state"]
  loadError: string | null
}) {
  if (loadError) return "Update controls are unavailable until Deskto restarts."
  if (!state) return "Reading update status…"

  switch (state.status) {
    case "unavailable":
      return state.message
    case "idle":
      return "Deskto checks for updates automatically."
    case "checking":
      return "Checking for a newer version…"
    case "up-to-date":
      return "Deskto is up to date."
    case "downloading":
      return `Downloading version ${state.availableVersion}${
        state.percent === undefined ? "…" : `, ${state.percent}%`
      }`
    case "ready":
      return `Version ${state.availableVersion} is ready to install.`
    case "error":
      return "Automatic checks will continue in the background."
  }
}
