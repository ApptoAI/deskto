import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * tailwind-merge only knows the sizes Tailwind ships with, and files a name it
 * has never heard of under text colour. Left unsaid, `cn("text-body",
 * "text-reading")` would drop the colour and keep the size it was overriding —
 * so every theme size this project adds has to be declared here too.
 */
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["reading"] }] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
