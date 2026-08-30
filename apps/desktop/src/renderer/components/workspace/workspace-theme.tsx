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
 *
 * These are the one set of hues the monochrome palette keeps, and they survive
 * for the same reason the provider mark does: they identify a thing rather than
 * style the app. A person picked this colour to tell their workspaces apart at
 * a glance, so it is their data, not our chrome. Nothing else in the app may
 * reach for a hue — status is carried by shape, hierarchy by opacity.
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

/**
 * The same eight colours as literal values, for the one place a class name
 * cannot reach: the accent, which is a CSS variable the whole window reads.
 *
 * These are tuned rather than copied from the swatch. A swatch is a 20px tile
 * and can be as saturated as it likes; an accent fills buttons and carries
 * text on top of them, so each one is pulled toward the lightness where a
 * near-black label stays legible on it in both palettes.
 */
const accentValues = new Map<string, string>([
  ["slate", "oklch(0.72 0.04 256)"],
  ["blue", "oklch(0.7 0.15 254)"],
  ["violet", "oklch(0.7 0.17 293)"],
  ["rose", "oklch(0.72 0.17 15)"],
  ["amber", "oklch(0.79 0.15 78)"],
  ["emerald", "oklch(0.75 0.15 163)"],
  ["cyan", "oklch(0.78 0.12 213)"],
  ["pink", "oklch(0.73 0.17 348)"],
])

/** The accent a Workspace lends the window, or null if it names no colour. */
export function workspaceAccent(color: string | undefined): string | null {
  if (color === undefined) return null
  return accentValues.get(color) ?? null
}

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
