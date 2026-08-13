import type { DesktopApi } from "../shared/desktop-api"

declare global {
  interface Window {
    appto: DesktopApi
  }
}

export {}
