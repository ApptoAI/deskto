import type { ReactNode } from "react"
import ArrowLeftIcon from "lucide-react/dist/esm/icons/arrow-left"
import ArrowRightIcon from "lucide-react/dist/esm/icons/arrow-right"
import MinusIcon from "lucide-react/dist/esm/icons/minus"
import PanelLeftIcon from "lucide-react/dist/esm/icons/panel-left"
import PlusIcon from "lucide-react/dist/esm/icons/plus"
import SquareIcon from "lucide-react/dist/esm/icons/square"
import XIcon from "lucide-react/dist/esm/icons/x"

import { cn } from "@workspace/ui/lib/utils"

/**
 * The window's one navigation surface. Deskto used to carry this in a sidebar
 * that was always on screen; the sidebar is now something you summon, so the
 * titlebar holds what has to be reachable from every screen — the sidebar
 * toggle, where you have been, and a new task — and then says what you are
 * looking at.
 *
 * The strip is a drag region, so anything interactive inside it opts back out
 * with `no-drag` or it cannot be clicked at all.
 */
export function TitleBar({
  sidebarOpen,
  onToggleSidebar,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onNewTask,
  children,
  trailing,
}: {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  onNewTask: () => void
  children?: ReactNode
  trailing?: ReactNode
}) {
  const drawWindowControls = window.deskto.platform !== "darwin"
  return (
    <header className="drag-region flex h-13 shrink-0 items-center px-4">
      {/* macOS draws its traffic lights over the top-left of the content with
          `titleBarStyle: hiddenInset`, so the row starts clear of them.
          Elsewhere the native titlebar is hidden and the controls sit on the
          right, where those platforms expect them. */}
      {drawWindowControls ? null : (
        /* Lights start at x=16 and span ~52px; the spacer must clear their
            right edge (~68px) plus a visible gap before the first control. */
        <span aria-hidden className="w-[80px] shrink-0" />
      )}

      <nav aria-label="Window" className="no-drag flex items-center gap-3">
        <span className="flex items-center">
          <TitleBarButton
            label={sidebarOpen ? "Hide the task list" : "Show the task list"}
            pressed={sidebarOpen}
            onClick={onToggleSidebar}
          >
            <PanelLeftIcon />
          </TitleBarButton>
        </span>
        <span className="flex items-center gap-1">
          <TitleBarButton label="Go back" disabled={!canGoBack} onClick={onBack}>
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
          <TitleBarButton label="New task" onClick={onNewTask}>
            <PlusIcon />
          </TitleBarButton>
        </span>
      </nav>

      {children ? (
        <div className="ml-3 flex min-w-0 items-center gap-1.5">{children}</div>
      ) : null}

      <div
        className={`no-drag ml-auto flex shrink-0 items-center gap-1${trailing ? " pl-1" : ""}`}
      >
        {trailing}
        {drawWindowControls ? <WindowControls /> : null}
      </div>
    </header>
  )
}

/**
 * Minimize, maximize, and close for the platforms whose native chrome the
 * window hides. They keep the titlebar's quiet icon voice; close alone may
 * take the destructive hue on hover, the one place hue is allowed.
 * Maximize reads no state back, so its glyph is the action rather than the
 * current geometry.
 */
function WindowControls() {
  const controls = window.deskto.windowControls
  return (
    <span className="ml-1 flex items-center">
      <TitleBarButton label="Minimize" onClick={controls.minimize}>
        <MinusIcon />
      </TitleBarButton>
      <TitleBarButton label="Maximize" onClick={controls.toggleMaximize}>
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
}: {
  label: string
  pressed?: boolean
  disabled?: boolean
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-md outline-none transition-colors duration-150",
        "hover:bg-fill-chip focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-40",
        "[&_svg]:size-[17px] [&_svg]:stroke-[1.8]",
        pressed ? "text-foreground" : "text-muted-foreground",
        className
      )}
    >
      {children}
    </button>
  )
}

/** What the window is showing: a task, with the project it belongs to. */
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
      <span className="truncate text-title font-semibold text-foreground">
        {title}
      </span>
      {subtitle ? (
        <span className="hidden truncate text-title text-muted-foreground sm:inline">
          {subtitle}
        </span>
      ) : null}
    </>
  )
}
