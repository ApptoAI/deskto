import { isBrowserArtifactUrl } from "./browser-artifact.js"

export function sanitizeBrowserContextUrl(value: string): string {
  try {
    const url = new URL(value)
    if (isBrowserArtifactUrl(value)) {
      url.search = ""
      url.hash = ""
      return url.toString().slice(0, 2_048)
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return ""
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    return url.toString().slice(0, 2_048)
  } catch {
    return ""
  }
}

export function sanitizeBrowserContextTitle(value: string): string {
  const title = Array.from(value)
    .map((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127 ? " " : character
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 256)
  return /(?:bearer|password|secret|token|credential|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/iu.test(
    title
  )
    ? ""
    : title
}
