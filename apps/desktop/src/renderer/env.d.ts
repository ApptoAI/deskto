import type { DesktopApi } from "../shared/desktop-api"

declare global {
  interface Window {
    deskto: DesktopApi
  }
}

export {}
