import { session } from "electron"

export function installContentSecurityPolicy(): void {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  const connectSource = rendererUrl
    ? `${new URL(rendererUrl).origin} ws:`
    : "'self'"
  const scriptSource = rendererUrl ? "'self' 'unsafe-eval'" : "'self'"
  const policy = [
    "default-src 'self'",
    `script-src ${scriptSource}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSource}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ")

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy],
      },
    })
  })
}
