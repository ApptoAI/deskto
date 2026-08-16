import { session } from "electron"

import {
  developmentContentSecurityPolicy,
  packagedContentSecurityPolicy,
} from "./csp.js"

// In development the renderer is served over HTTP, so the policy rides on
// response headers. The packaged renderer loads from disk, where the <meta>
// tag injected at build time (see electron.vite.config.ts) is what reaches
// file:// documents — the session-wide header below still covers any other
// document a future window might load.
export function installContentSecurityPolicy(): void {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  const policy = rendererUrl
    ? developmentContentSecurityPolicy(new URL(rendererUrl).origin)
    : packagedContentSecurityPolicy()

  // Scoped to the app's own documents. An unfiltered listener also stamps the
  // policy onto Chromium's internal pages — the built-in PDF viewer among
  // them — and `frame-ancestors` then stops that viewer from being embedded
  // in a result preview.
  const urls = rendererUrl
    ? [`${new URL(rendererUrl).origin}/*`]
    : ["file://*/*"]

  session.defaultSession.webRequest.onHeadersReceived(
    { urls },
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [policy],
        },
      })
    }
  )
}
