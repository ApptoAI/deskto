import type { ComponentProps, ReactNode } from "react"
import ArrowLeftIcon from "lucide-react/dist/esm/icons/arrow-left"
import ArrowRightIcon from "lucide-react/dist/esm/icons/arrow-right"
import MinusIcon from "lucide-react/dist/esm/icons/minus"
import PanelLeftIcon from "lucide-react/dist/esm/icons/panel-left"
import PlusIcon from "lucide-react/dist/esm/icons/plus"
import SquareIcon from "lucide-react/dist/esm/icons/square"
import XIcon from "lucide-react/dist/esm/icons/x"

import { cn } from "@workspace/ui/lib/utils"

/**
 * The window's navigation: the sidebar toggle, where you have been, and a new
 * task. It sits at the top of the sidebar column when the sidebar is open and
 * moves into the pane header when it is not, so it is reachable from every
 * screen without a strip of its own across the window.
 *
 * The strip it sits in is a drag region, so the nav opts back out with
 * `no-drag` or it cannot be clicked at all. On macOS the traffic lights
 * occupy the first 68px of the row, wherever the nav happens to be.
 */
export function WindowNav({
  sidebarOpen,
  canToggleSidebar,
  onToggleSidebar,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  canNewTask,
  onNewTask,
}: {
  sidebarOpen: boolean
  /** False while a screen holds the task list in place (Settings), so the
      button says so instead of silently doing nothing. */
  canToggleSidebar: boolean
  onToggleSidebar: () => void
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  /** False while the New task command stands down; the button follows it. */
  canNewTask: boolean
  onNewTask: () => void
}) {
  const reserveTrafficLights = window.deskto.platform === "darwin"
  return (
    <>
      {reserveTrafficLights ? (
        <span aria-hidden className="w-[68px] shrink-0" />
      ) : null}
      <nav aria-label="Window" className="no-drag flex items-center gap-2.5">
        <span className="flex items-center">
          {/* The toggle moves between the sidebar column and the pane header
              as the sidebar comes and goes; the attribute lets the workbench
              hand focus to wherever it landed. */}
          <TitleBarButton
            label={sidebarOpen ? "Hide the task list" : "Show the task list"}
            pressed={sidebarOpen}
            disabled={!canToggleSidebar}
            onClick={onToggleSidebar}
            data-sidebar-toggle
          >
            <PanelLeftIcon />
          </TitleBarButton>
        </span>
        <span className="flex items-center gap-1">
          <TitleBarButton
            label="Go back"
            disabled={!canGoBack}
            onClick={onBack}
          >
            <ArrowLeftIcon />
          </TitleBarButton>
          <TitleBarButton
            label="Go forward"
            disabled={!canGoForward}
            onClick={onForward}
          >
            <ArrowRightIcon />
          </TitleBarButton>
        </span>
        <span className="flex items-center">
          <TitleBarButton
            label="New task"
            disabled={!canNewTask}
            onClick={onNewTask}
          >
            <PlusIcon />
          </TitleBarButton>
        </span>
      </nav>
    </>
  )
}

/** The renderer-drawn window controls, on platforms that hide the native
    ones. Rendered inside a drag region, so it opts out. */
export function WindowControls() {
  const controls = window.deskto.windowControls
  if (window.deskto.platform === "darwin" || controls === undefined) return null
  return (
    <span className="no-drag ml-1 flex items-center">
      <TitleBarButton label="Minimize" onClick={controls.minimize}>
        <MinusIcon />
      </TitleBarButton>
      <TitleBarButton label="Toggle maximize" onClick={controls.toggleMaximize}>
        <SquareIcon />
      </TitleBarButton>
      <TitleBarButton
        label="Close"
        onClick={controls.close}
        className="hover:bg-destructive/90 hover:text-white"
      >
        <XIcon />
      </TitleBarButton>
    </span>
  )
}

/**
 * The one icon shape in the titlebar. Disabled here means "there is nowhere to
 * go", which is a statement about the history rather than about permission, so
 * it fades rather than greying out into something that looks broken.
 */
function TitleBarButton({
  label,
  pressed,
  disabled,
  onClick,
  className,
  children,
  ...props
}: Omit<ComponentProps<"button">, "onClick" | "children"> & {
  label: string
  pressed?: boolean
  disabled?: boolean
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      {...props}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-button transition-[background-color,color,transform,opacity] duration-120 outline-none",
        "hover:bg-fill-chip focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-40",
        "motion-safe:active:scale-[0.96]",
        "[&_svg]:size-[17px] [&_svg]:stroke-[1.8]",
        pressed ? "text-foreground" : "text-muted-foreground",
        className
      )}
    >
      {children}
    </button>
  )
}

/** What the pane is showing: a task, with the project it belongs to. */
export function TitleBarTask({
  mark,
  title,
  subtitle,
}: {
  mark: ReactNode
  title: string
  subtitle?: string
}) {
  return (
    <>
      {mark}
      <span
        className="max-w-[min(32rem,45vw)] min-w-0 truncate text-control font-semibold tracking-tight text-foreground"
        title={title}
      >
        {title}
      </span>
      {subtitle ? (
        <span className="truncate text-control text-muted-foreground">
          {subtitle}
        </span>
      ) : null}
    </>
  )
}
