import BookOpenIcon from "lucide-react/dist/esm/icons/book-open"
import BriefcaseIcon from "lucide-react/dist/esm/icons/briefcase"
import CameraIcon from "lucide-react/dist/esm/icons/camera"
import FolderIcon from "lucide-react/dist/esm/icons/folder"
import HeartIcon from "lucide-react/dist/esm/icons/heart"
import HomeIcon from "lucide-react/dist/esm/icons/home"
import NewspaperIcon from "lucide-react/dist/esm/icons/newspaper"
import RocketIcon from "lucide-react/dist/esm/icons/rocket"
import StarIcon from "lucide-react/dist/esm/icons/star"
import type { ComponentType } from "react"

/**
 * Workspaces store neutral color and icon tokens; only this file knows what
 * they look like. Class names stay literal so Tailwind generates them.
 */
const colorSwatches: Record<string, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  rose: "bg-rose-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  cyan: "bg-cyan-500",
  pink: "bg-pink-500",
}

export const workspaceColors = Object.keys(colorSwatches)

export function workspaceSwatch(color: string): string {
  return colorSwatches[color] ?? colorSwatches["slate"]!
}

const icons: Record<string, ComponentType<{ className?: string }>> = {
  home: HomeIcon,
  newspaper: NewspaperIcon,
  briefcase: BriefcaseIcon,
  heart: HeartIcon,
  star: StarIcon,
  folder: FolderIcon,
  rocket: RocketIcon,
  "book-open": BookOpenIcon,
  camera: CameraIcon,
}

export const workspaceIcons = Object.keys(icons)

export function WorkspaceIcon({
  icon,
  className,
}: {
  icon: string
  className?: string
}) {
  const Icon = icons[icon] ?? HomeIcon
  return <Icon className={className} />
}
