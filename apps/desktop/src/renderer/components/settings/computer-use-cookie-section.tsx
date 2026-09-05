import { useCallback, useEffect, useId, useState } from "react"
import CheckIcon from "lucide-react/dist/esm/icons/check"
import RefreshCwIcon from "lucide-react/dist/esm/icons/refresh-cw"
import { isCookieImportHost, type BrowserProfile } from "@deskto/protocol"
import type {
  CookieImportResult,
  DetectedBrowserProfile,
} from "../../../shared/desktop-api.js"

import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

import { describedErrorSchema } from "../../runtime/describe-error.js"
import {
  discoverBrowserProfiles,
  importBrowserCookies,
  loadBrowserProfiles,
} from "../../lib/desktop.js"
import { InlineError } from "../inline-error.js"

type ProfilesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; profiles: DetectedBrowserProfile[] }

type WorkspacesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; workspaces: BrowserProfile[] }

// The person types one website per line; commas and spaces separate too. Only
// the host part of anything URL-shaped is kept, exactly as typed: cookies
// match hosts precisely, so "www.example.com" and "example.com" are different
// entries and the person lists each one they want.
export function parseHosts(text: string): string[] {
  const seen = new Set<string>()
  for (const token of text.split(/[\s,]+/u)) {
    const host = hostOf(token)
    if (host) seen.add(host)
  }
  return [...seen]
}

function hostOf(token: string): string | undefined {
  const trimmed = token.trim()
  if (!trimmed) return undefined
  let parsed: URL
  try {
    parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`
    )
  } catch {
    return undefined
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return undefined
  }
  const host = parsed.hostname.toLowerCase()
  return isCookieImportHost(host) ? host : undefined
}

export function CookieImportSection() {
  const [profiles, setProfiles] = useState<ProfilesState>({ status: "loading" })
  const [selectedId, setSelectedId] = useState<string | undefined>()
  // Each workspace keeps its own browser profile, so the import has to name
  // the one that receives the cookies.
  const [workspaces, setWorkspaces] = useState<WorkspacesState>({
    status: "loading",
  })
  const [workspaceId, setWorkspaceId] = useState<string | undefined>()
  const [hosts, setHosts] = useState("")
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<CookieImportResult | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const hostsId = useId()
  const workspaceSelectId = useId()

  // Kept out of the mount effect's synchronous path: the state starts at
  // "loading", so a first fetch never sets state before its await. Rescan
  // shows the spinner itself before calling this.
  const load = useCallback(async () => {
    try {
      const found: DetectedBrowserProfile[] = await discoverBrowserProfiles()
      setProfiles({ status: "ready", profiles: found })
      setSelectedId((current) =>
        found.some((profile) => profile.id === current) ? current : found[0]?.id
      )
    } catch (error) {
      setProfiles({
        status: "error",
        message: describedErrorSchema.parse(error),
      })
    }
  }, [])

  function rescan() {
    setProfiles({ status: "loading" })
    void load()
  }

  const loadWorkspaces = useCallback(async () => {
    try {
      const found: BrowserProfile[] = await loadBrowserProfiles()
      setWorkspaces({ status: "ready", workspaces: found })
      setWorkspaceId((current) =>
        found.some((workspace) => workspace.workspaceId === current)
          ? current
          : found[0]?.workspaceId
      )
    } catch (error) {
      setWorkspaces({
        status: "error",
        message: describedErrorSchema.parse(error),
      })
    }
  }, [])

  useEffect(() => {
    void load()
    void loadWorkspaces()
  }, [load, loadWorkspaces])

  const parsedHosts = parseHosts(hosts)
  const canImport =
    !running &&
    selectedId !== undefined &&
    workspaceId !== undefined &&
    parsedHosts.length > 0

  async function runImport() {
    if (!selectedId || !workspaceId) return
    setRunning(true)
    setResult(null)
    setActionError(null)
    try {
      setResult(
        await importBrowserCookies({
          profileId: selectedId,
          workspaceId,
          hosts: parsedHosts,
        })
      )
    } catch (error) {
      setActionError(describedErrorSchema.parse(error))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">

        <Button
          variant="outline"
          size="sm"
          onClick={rescan}
          disabled={profiles.status === "loading"}
        >
          <RefreshCwIcon
            data-icon="inline-start"
            className={cn(profiles.status === "loading" && "animate-spin")}
          />
          Rescan
        </Button>
      </div>

      {profiles.status === "loading" ? (
        <p className="text-xs text-muted-foreground">
          Looking for installed browsers…
        </p>
      ) : profiles.status === "error" ? (
        <InlineError message={profiles.message} />
      ) : profiles.profiles.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No Chrome, Chromium, Brave, Edge, or Vivaldi profile was found on this
          computer.
        </p>
      ) : (
        <ul className="space-y-1">
          {profiles.profiles.map((profile) => {
            const selected = profile.id === selectedId
            return (
              <li key={profile.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedId(profile.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm",
                    selected ? "bg-muted" : "hover:bg-muted/60"
                  )}
                >
                  <CheckIcon
                    className={cn("size-4 shrink-0", !selected && "opacity-0")}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{profile.browserLabel}</span>
                    <span className="text-muted-foreground">
                      {" · "}
                      {profile.profileName}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="space-y-1.5">
        <label htmlFor={hostsId} className="text-sm font-medium">
          Websites
        </label>
        <Textarea
          id={hostsId}
          value={hosts}
          placeholder="example.com&#10;mail.example.com"
          spellCheck={false}
          className="min-h-16 w-full font-mono text-xs"
          onChange={(event) => setHosts(event.currentTarget.value)}
        />

      </div>

      <div className="space-y-1.5">
        <label htmlFor={workspaceSelectId} className="text-sm font-medium">
          Workspace
        </label>
        {workspaces.status === "loading" ? (
          <p className="text-xs text-muted-foreground">Checking workspaces…</p>
        ) : workspaces.status === "error" ? (
          <InlineError message={workspaces.message} />
        ) : workspaces.workspaces.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Create a workspace first; cookies are imported into its browser
            profile.
          </p>
        ) : (
          <select
            id={workspaceSelectId}
            value={workspaceId ?? ""}
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
            onChange={(event) => setWorkspaceId(event.currentTarget.value)}
          >
            {workspaces.workspaces.map((workspace) => (
              <option key={workspace.workspaceId} value={workspace.workspaceId}>
                {workspace.workspaceName}
              </option>
            ))}
          </select>
        )}

      </div>

      {actionError ? <InlineError message={actionError} /> : null}
      {result ? <ImportOutcome result={result} /> : null}

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => void runImport()}
          disabled={!canImport}
        >
          {running ? "Importing…" : "Import cookies"}
        </Button>
      </div>
    </div>
  )
}

function ImportOutcome({ result }: { result: CookieImportResult }) {
  if (result.error) return <InlineError message={result.error} />

  const skipped =
    result.skipped > 0
      ? ` ${result.skipped} could not be read on this computer.`
      : ""
  return (
    <p role="status" className="text-xs text-muted-foreground">
      {result.imported === 0
        ? "No cookies matched those websites."
        : `Imported ${result.imported} ${
            result.imported === 1 ? "cookie" : "cookies"
          }.`}
      {skipped}
    </p>
  )
}
