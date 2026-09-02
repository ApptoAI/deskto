import { useEffect, useState } from "react"
import { hasBrowserProfileData, type BrowserProfile } from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"

import {
  clearBrowserProfile,
  loadBrowserProfiles,
  openBrowserProfileFolder,
} from "../../lib/desktop.js"
import { formatExactTime } from "../../lib/format-time.js"
import { describedErrorSchema } from "../../runtime/describe-error.js"
import { InlineError } from "../inline-error.js"

type ProfilesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; profiles: BrowserProfile[] }

/**
 * Clearing is a two-click confirm on the same button, like deleting a
 * workspace: the first click names what happens, the second does it. The
 * result stays on the row until the next action so the person sees what
 * changed.
 */
export function BrowserProfilesSection() {
  const [state, setState] = useState<ProfilesState>({ status: "loading" })
  const [confirming, setConfirming] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function refresh() {
    try {
      setState({ status: "ready", profiles: await loadBrowserProfiles() })
    } catch (error) {
      setState({ status: "error", message: describedErrorSchema.parse(error) })
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function clear(profile: BrowserProfile) {
    setPending(profile.workspaceId)
    setConfirming(null)
    setErrors((current) => without(current, profile.workspaceId))
    try {
      const result = await clearBrowserProfile(profile.workspaceId)
      setNotes((current) => ({
        ...current,
        [profile.workspaceId]: `Cleared ${formatBytes(result.clearedBytes)}. Sites will ask you to sign in again.`,
      }))
      await refresh()
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [profile.workspaceId]: describedErrorSchema.parse(error),
      }))
    } finally {
      setPending(null)
    }
  }

  async function openFolder(profile: BrowserProfile) {
    setErrors((current) => without(current, profile.workspaceId))
    try {
      await openBrowserProfileFolder(profile.workspaceId)
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [profile.workspaceId]: describedErrorSchema.parse(error),
      }))
    }
  }

  if (state.status === "loading") {
    return <p className="text-xs text-muted-foreground">Checking profiles…</p>
  }
  if (state.status === "error") {
    return (
      <div className="space-y-2">
        <InlineError message={state.message} />
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          Try again
        </Button>
      </div>
    )
  }

  return (
    <ul className="divide-y divide-border">
      {state.profiles.map((profile) => {
        const hasData = hasBrowserProfileData(profile)
        const busy = pending === profile.workspaceId
        const error = errors[profile.workspaceId]
        const note = notes[profile.workspaceId]
        return (
          <li key={profile.workspaceId} className="py-3 first:pt-1 last:pb-1">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {profile.workspaceName}
                </p>
                <p className="pt-0.5 font-mono text-xs text-muted-foreground">
                  {hasData
                    ? `${formatBytes(profile.sizeBytes)}${
                        profile.lastUsedAt
                          ? ` · last used ${formatExactTime(profile.lastUsedAt)}`
                          : ""
                      }`
                    : "No browser data yet"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasData || busy}
                  onClick={() => void openFolder(profile)}
                >
                  Open folder
                </Button>
                {confirming === profile.workspaceId ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setConfirming(null)}
                    >
                      Keep
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => void clear(profile)}
                    >
                      Signs you out of every site. Clear?
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!hasData || busy}
                    onClick={() => setConfirming(profile.workspaceId)}
                  >
                    {busy ? "Clearing…" : "Clear browser data"}
                  </Button>
                )}
              </div>
            </div>
            {note && !error ? (
              <p role="status" className="pt-1.5 text-xs text-muted-foreground">
                {note}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="pt-1.5 text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function without(record: Record<string, string>, key: string) {
  const next = { ...record }
  delete next[key]
  return next
}

const byteUnits = ["B", "KB", "MB", "GB"] as const

export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < byteUnits.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${byteUnits[unit]}`
}
