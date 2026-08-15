// Content-Security-Policy builders shared by the development header policy
// (src/main/security.ts) and the packaged <meta> tag (electron.vite.config.ts).
// Keeping one directive list stops the two policies from drifting apart.
// This module must stay free of Electron imports so the Vite config can load it.

const sharedDirectives = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "frame-src 'self' blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
]

// Vite serves modules with eval-based source maps and HMR over websockets,
// and @vitejs/plugin-react injects an inline Fast Refresh preamble.
export function developmentContentSecurityPolicy(
  devServerOrigin: string
): string {
  return [
    ...sharedDirectives,
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    `connect-src ${devServerOrigin} ws:`,
    "frame-ancestors 'none'",
  ].join("; ")
}

export function packagedContentSecurityPolicy(): string {
  return [
    ...sharedDirectives,
    "script-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
}

// frame-ancestors is omitted because browsers ignore it in <meta> policies.
export function packagedMetaContentSecurityPolicy(): string {
  return [...sharedDirectives, "script-src 'self'", "connect-src 'self'"].join(
    "; "
  )
}
