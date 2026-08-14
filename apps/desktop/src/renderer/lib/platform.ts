import type { Platform } from "@openappto/settings"

/** Which modifier layout this machine uses: ⌘ on mac, Ctrl elsewhere. */
export function keyboardPlatform(): Platform {
  return /mac/i.test(navigator.platform) ? "mac" : "other"
}
