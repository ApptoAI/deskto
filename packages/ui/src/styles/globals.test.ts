import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "globals.css"),
  "utf8"
)

/** The custom properties declared directly inside one top-level block. */
function declarations(selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {`)
  if (start === -1) throw new Error(`no ${selector} block`)
  const end = css.indexOf("\n}", start)
  const body = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "")
  const found = new Map<string, string>()
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1] ?? "", (match[2] ?? "").replace(/\s+/g, " ").trim())
  }
  return found
}

const light = declarations(":root")
const dark = declarations(".dark")

/** A value that names a colour of its own rather than pointing at a token. */
function paintsAColour(value: string): boolean {
  return /oklch\(|#[0-9a-f]{3,8}\b|rgba?\(/i.test(value)
}

describe("palette parity", () => {
  it("does not override in dark a token light never declared", () => {
    const orphans = [...dark.keys()].filter((token) => !light.has(token))
    expect(orphans).toEqual([])
  })

  it("restates every light colour in dark", () => {
    const missing = [...light.entries()]
      .filter(([, value]) => paintsAColour(value))
      .map(([token]) => token)
      .filter((token) => !dark.has(token))
    expect(missing).toEqual([])
  })

  it("keeps every dark colour distinct from its light value", () => {
    // A token that reads the same in both palettes is either a bug or a
    // deliberate constant; the deliberate ones are listed here.
    const constants = new Set(["--paper-fg-muted", "--elevation-send"])
    const unchanged = [...dark.entries()]
      .filter(([token, value]) => light.get(token) === value)
      .map(([token]) => token)
      .filter((token) => !constants.has(token))
    expect(unchanged).toEqual([])
  })
})

describe("exposed tokens", () => {
  it("maps every surface token a component can name onto a palette value", () => {
    const inlineStart = css.indexOf("@theme inline {")
    const inlineEnd = css.indexOf("\n}", inlineStart)
    const references = [
      ...css.slice(inlineStart, inlineEnd).matchAll(/var\((--[\w-]+)\)/g),
    ].map((match) => match[1] ?? "")
    const dangling = references.filter(
      (token) => !light.has(token) && !css.includes(`${token}:`)
    )
    expect(dangling).toEqual([])
  })

  it("has no token declared in light that nothing reads", () => {
    // Read by a component through an arbitrary-value utility rather than by
    // this stylesheet.
    const readElsewhere = new Set(["--secondary-hover"])
    const unread = [...light.keys()].filter((token) => {
      const uses = css.split(`var(${token}`).length - 1
      return uses === 0 && !readElsewhere.has(token)
    })
    expect(unread).toEqual([])
  })
})
