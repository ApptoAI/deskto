import BookOpenIcon from "lucide-react/dist/esm/icons/book-open"
import BriefcaseIcon from "lucide-react/dist/esm/icons/briefcase"
import CameraIcon from "lucide-react/dist/esm/icons/camera"
import FolderIcon from "lucide-react/dist/esm/icons/folder"
import HeartIcon from "lucide-react/dist/esm/icons/heart"
import HomeIcon from "lucide-react/dist/esm/icons/home"
import NewspaperIcon from "lucide-react/dist/esm/icons/newspaper"
import RocketIcon from "lucide-react/dist/esm/icons/rocket"
import StarIcon from "lucide-react/dist/esm/icons/star"

/**
 * Workspaces store neutral color and icon tokens; only this file knows what
 * they look like. Class names stay literal so Tailwind generates them.
 */
const colorSwatches = new Map<string, string>([
  ["slate", "bg-slate-500"],
  ["blue", "bg-blue-500"],
  ["violet", "bg-violet-500"],
  ["rose", "bg-rose-500"],
  ["amber", "bg-amber-500"],
  ["emerald", "bg-emerald-500"],
  ["cyan", "bg-cyan-500"],
  ["pink", "bg-pink-500"],
])

export const workspaceColors = [...colorSwatches.keys()]

export function workspaceSwatch(color: string): string {
  return colorSwatches.get(color) ?? "bg-slate-500"
}

export const workspaceIcons = [
  "home",
  "newspaper",
  "briefcase",
  "heart",
  "star",
  "folder",
  "rocket",
  "book-open",
  "camera",
]

export function WorkspaceIcon({
  icon,
  className,
}: {
  icon: string
  className?: string
}) {
  if (icon === "newspaper") return <NewspaperIcon className={className} />
  if (icon === "briefcase") return <BriefcaseIcon className={className} />
  if (icon === "heart") return <HeartIcon className={className} />
  if (icon === "star") return <StarIcon className={className} />
  if (icon === "folder") return <FolderIcon className={className} />
  if (icon === "rocket") return <RocketIcon className={className} />
  if (icon === "book-open") return <BookOpenIcon className={className} />
  if (icon === "camera") return <CameraIcon className={className} />
  return <HomeIcon className={className} />
}
