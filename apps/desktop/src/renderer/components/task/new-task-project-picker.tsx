import FolderIcon from "lucide-react/dist/esm/icons/folder"
import type { Project } from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"

/**
 * The question the all-projects scope asks before the composer: which project
 * the new task belongs to. Picking one is per task — the sidebar stays on
 * All projects.
 */
export function NewTaskProjectPicker({
  projects,
  onSelect,
}: {
  projects: Project[]
  onSelect: (projectId: string) => void
}) {
  return (
    <>
      <header className="drag-region h-10 shrink-0" />

      {/* Mirrors the new-task start screen: one centered column with the
          wordmark and the question, so choosing a project reads as the first
          step of the same flow rather than a detour. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="flex min-h-full items-center justify-center">
          <div className="enter-rise -mt-10 flex w-full max-w-md flex-col items-center gap-4">
            <div
              aria-hidden
              className="font-heading text-6xl leading-none font-normal tracking-[-0.04em] text-foreground/8 select-none sm:text-7xl"
            >
              deskto
            </div>

            <p className="text-center display-sm text-body">
              Which project is this task for?
            </p>

            <div className="flex w-full flex-col gap-2">
              {projects.map((project) => (
                <Button
                  key={project.id}
                  type="button"
                  variant="outline"
                  className="h-auto justify-start py-2.5"
                  onClick={() => onSelect(project.id)}
                >
                  <FolderIcon
                    data-icon="inline-start"
                    className="text-muted-foreground"
                  />
                  <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                    <span className="w-full truncate text-left">
                      {project.name}
                    </span>
                    <span className="w-full truncate text-left text-xs font-normal text-muted-foreground">
                      {project.path}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
