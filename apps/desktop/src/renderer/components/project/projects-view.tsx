import { useMemo, useState } from "react"
import ChevronDownIcon from "lucide-react/dist/esm/icons/chevron-down"
import FolderPlusIcon from "lucide-react/dist/esm/icons/folder-plus"
import PinIcon from "lucide-react/dist/esm/icons/pin"
import PinOffIcon from "lucide-react/dist/esm/icons/pin-off"
import SearchIcon from "lucide-react/dist/esm/icons/search"
import type { Project } from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import { formatAge, formatExactTime } from "../../lib/format-time.js"

type ProjectSort = "updated" | "name"

const sortLabels = {
  updated: "Last updated",
  name: "Name",
} satisfies Record<ProjectSort, string>

function isProjectSort(value: string): value is ProjectSort {
  return Object.hasOwn(sortLabels, value)
}

/**
 * Workspace-level overview of every project: the browsing and managing
 * counterpart to the sidebar switcher, which stays the quick way to jump.
 */
export function ProjectsView({
  projects,
  onOpenProject,
  onNewProject,
  onSetPinned,
  creating,
}: {
  projects: Project[]
  onOpenProject: (projectId: string) => void
  onNewProject: () => void
  onSetPinned: (projectId: string, pinned: boolean) => void
  creating: boolean
}) {
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<ProjectSort>("updated")

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matches = needle
      ? projects.filter(
          (project) =>
            project.name.toLowerCase().includes(needle) ||
            project.description.toLowerCase().includes(needle)
        )
      : projects
    // The runtime list floats pinned projects first; "Last updated" promises
    // recency, so both sorts order explicitly instead of trusting it.
    if (sort === "updated")
      return [...matches].sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      )
    return [...matches].sort((a, b) => a.name.localeCompare(b.name))
  }, [projects, query, sort])

  return (
    <>
      <div className="min-h-0 flex-1 overflow-hidden p-5">
        <div className="mx-auto flex h-full w-full max-w-6xl flex-col">
          <div className="flex shrink-0 items-start justify-between gap-4 pb-5">
            <div>
              <h1 className="font-heading display-sm">Projects</h1>
              <p className="pt-1 text-sm text-muted-foreground">
                Everything this workspace is working on.
              </p>
            </div>
            <div className="no-drag flex items-center gap-2">
              <Button type="button" onClick={onNewProject} disabled={creating}>
                <FolderPlusIcon data-icon="inline-start" />
                New project
              </Button>
            </div>
          </div>

          <div className="no-drag flex shrink-0 items-center gap-2 border-b border-border pb-3">
            <div className="relative w-full max-w-72">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects..."
                aria-label="Search projects"
                className="pl-8"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button type="button" variant="ghost" size="sm" />}
              >
                <span className="text-muted-foreground">Sort by</span>
                {sortLabels[sort]}
                <ChevronDownIcon
                  data-icon="inline-end"
                  className="text-muted-foreground"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={(value) => {
                    const next = String(value)
                    if (isProjectSort(next)) setSort(next)
                  }}
                >
                  <DropdownMenuRadioItem value="updated" closeOnClick>
                    Last updated
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="name" closeOnClick>
                    Name
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="ml-auto text-micro text-muted-foreground tabular-nums">
              {shown.length === 1 ? "1 project" : `${shown.length} projects`}
            </span>
          </div>

          <div className="no-drag min-h-0 flex-1 overflow-y-auto overscroll-contain pt-4">
            {projects.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <p className="text-sm text-muted-foreground">
                  No projects yet. A project keeps related tasks, files, and
                  instructions together.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onNewProject}
                  disabled={creating}
                >
                  Create your first project
                </Button>
              </div>
            ) : shown.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                No projects match “{query.trim()}”.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onOpen={() => onOpenProject(project.id)}
                    onSetPinned={(pinned) => onSetPinned(project.id, pinned)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function ProjectCard({
  project,
  onOpen,
  onSetPinned,
}: {
  project: Project
  onOpen: () => void
  onSetPinned: (pinned: boolean) => void
}) {
  const pinned = project.pinnedAt !== null
  const age = formatAge(project.updatedAt)

  return (
    <Card className="relative transition-shadow hover:ring-foreground/25">
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-1.5">
          {/* The whole card opens the project: the name is the real button and
              its ::after stretches over the card, so the pin stays clickable
              above it without nesting interactive elements. */}
          <button
            type="button"
            onClick={onOpen}
            className="truncate text-left outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {project.name}
          </button>
        </CardTitle>
        <CardAction>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={pinned ? "Unpin project" : "Pin project"}
            onClick={() => onSetPinned(!pinned)}
            className={cn(
              "relative z-10 -mt-1 -mr-1 text-muted-foreground",
              pinned
                ? ""
                : "opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100"
            )}
          >
            {pinned ? <PinOffIcon /> : <PinIcon />}
          </Button>
        </CardAction>
        <CardDescription className="line-clamp-2 min-h-10">
          {project.description || "No description yet."}
        </CardDescription>
      </CardHeader>
      <div className="mt-auto flex items-center gap-2 px-(--card-spacing) text-xs text-muted-foreground">
        {pinned ? (
          <>
            <PinIcon className="size-3 shrink-0" />
            <span className="sr-only">Pinned</span>
          </>
        ) : null}
        <span title={formatExactTime(project.updatedAt)}>
          {age === "now" ? "Just now" : `${age} ago`}
        </span>
        {project.locationKind === "linked" ? (
          <span className="min-w-0 truncate font-mono text-micro">
            {project.path}
          </span>
        ) : null}
      </div>
    </Card>
  )
}
