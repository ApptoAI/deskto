import type { Platform } from "@deskto/settings"

/** Which modifier layout this machine uses: ⌘ on mac, Ctrl elsewhere. */
export function keyboardPlatform(): Platform {
  return /mac/i.test(navigator.platform) ? "mac" : "other"
}
