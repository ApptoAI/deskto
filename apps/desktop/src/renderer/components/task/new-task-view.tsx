import { useCallback, useState } from "react"
import ChevronDownIcon from "lucide-react/dist/esm/icons/chevron-down"
import ChevronUpIcon from "lucide-react/dist/esm/icons/chevron-up"
import SettingsIcon from "lucide-react/dist/esm/icons/settings"
import type { Harness, Project } from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"

import { useRuntimeClient } from "../../runtime/runtime-client-context.js"
import {
  useRuntimeQuery,
  type QueryState,
} from "../../runtime/use-runtime-query.js"
import { Composer } from "../composer.js"
import { ProjectPanel } from "../project/project-panel.js"
import { DesktoWordmark } from "./deskto-wordmark.js"
import { TaskComposerToolbar } from "./task-composer-toolbar.js"
import { useTaskComposer } from "./use-task-composer.js"

/** How the project panel should show up before the user has chosen. */
export type ProjectPanelPreference = "open" | "collapsed" | "auto"

/**
 * Openers for a project with nothing in it yet. Each one is a whole task a
 * person can actually hand over on a fresh folder, phrased as the outcome
 * rather than the tool, which is the phrasing the rest of the app teaches.
 */
const taskSuggestions = [
  {
    label: "Write a README",
    prompt:
      "Write a README.md for this project explaining what it is and how to use it.",
  },
  {
    label: "Summarize this project",
    prompt:
      "Look through this project and summarize what is in it and how it fits together.",
  },
  {
    label: "Find what needs attention",
    prompt:
      "Review this project and tell me what looks broken, unfinished, or worth fixing first.",
  },
]

export function NewTaskView({
  project,
  harnesses,
  onTaskCreated,
  onTaskStarted,
  panelPreference,
  onPanelCollapsedChange,
}: {
  project: Project
  harnesses: QueryState<Harness[]>
  onTaskCreated: (threadId: string) => void
  onTaskStarted: (threadId: string) => void
  panelPreference: ProjectPanelPreference
  onPanelCollapsedChange: (collapsed: boolean) => void
}) {
  const client = useRuntimeClient()
  const composer = useTaskComposer({
    project,
    harnesses,
    onTaskCreated,
    onTaskStarted,
  })
  // Bumped per pick so choosing the same suggestion twice refills the box.
  const [draft, setDraft] = useState({ text: "", token: 0 })

  const loadDetails = useCallback(
    () => client.getProject(project.id),
    [client, project.id]
  )
  const details = useRuntimeQuery(loadDetails)
  // A fresh project opens with its panel out: the cards are the onboarding.
  // Once instructions exist — or the user closed it once — the screen stays
  // the bare composer until they ask for the panel again. The decision
  // latches on the first loaded details so saving instructions doesn't
  // yank the panel away mid-edit.
  const [autoOpen, setAutoOpen] = useState<boolean | null>(null)
  if (details.state.status === "ready" && autoOpen === null) {
    setAutoOpen(details.state.data.instructions === "")
  }
  const panelVisible =
    panelPreference === "open" ||
    (panelPreference === "auto" && autoOpen === true)

  return (
    <>
      <header className="drag-region h-10 shrink-0" />

      {/* The whole start screen sits as one centered column: wordmark, the
          question, and the composer right under them. Pinning the input to
          the bottom made the empty view read as a half-loaded task. The
          min-h-full wrapper keeps centring honest once the project cards
          expand past the viewport: the column grows and scrolls instead of
          clipping at the top. The negative top margin offsets the drag strip
          above, so the closed screen lands on the optical centre of the
          window rather than 40px below. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="flex min-h-full items-center justify-center">
          <div
            className={`enter-rise flex w-full max-w-3xl flex-col items-center gap-4 ${
              panelVisible ? "" : "-mt-10"
            }`}
          >
            <DesktoWordmark />

            {/* The one display moment in the app. Size and tight tracking
                carry it; there is nothing to bold against on an empty
                screen. */}
            <p className="text-center display-sm text-body">
              What should we do next in{" "}
              <span className="text-foreground">{project.name}</span>?
            </p>

            <div className="w-full">
              <Composer
                projectId={project.id}
                harnessId={composer.harnessId}
                label="What should the agent do?"
                placeholder="Describe the task"
                onSend={composer.send}
                blockedReason={composer.blockedReason}
                draft={draft}
                {...(composer.models.length > 0
                  ? { onOpenModelPicker: () => composer.setModelMenuOpen(true) }
                  : {})}
                autoFocus
                toolbar={<TaskComposerToolbar composer={composer} />}
              />
            </div>

            {/* An empty box asks a question the person may not have an answer
                to yet. These give the shape of one — they fill the composer
                rather than send, so the wording stays theirs. */}
            <ul className="flex w-full flex-wrap justify-center gap-1.5">
              {taskSuggestions.map((suggestion) => (
                <li key={suggestion.label}>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({
                        text: suggestion.prompt,
                        token: current.token + 1,
                      }))
                    }
                    className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors duration-100 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {suggestion.label}
                  </button>
                </li>
              ))}
            </ul>

            {/* Settings live under the composer, out of the way: a quiet
                toggle on the right, cards beneath it when open. */}
            <div className="flex w-full justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground aria-expanded:hover:bg-muted"
                aria-expanded={panelVisible}
                aria-controls="project-settings-panel"
                onClick={() => onPanelCollapsedChange(panelVisible)}
              >
                <SettingsIcon data-icon="inline-start" />
                Project settings
                {panelVisible ? (
                  <ChevronUpIcon data-icon="inline-end" />
                ) : (
                  <ChevronDownIcon data-icon="inline-end" />
                )}
              </Button>
            </div>

            {panelVisible ? (
              <ProjectPanel project={project} details={details} />
            ) : null}
          </div>
        </div>
      </div>
    </>
  )
}
