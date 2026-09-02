import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// The floors in docs/adr/0034-palette-contrast-floors.md, measured the way a
// browser paints them: a translucent token is composited over the surface in
// sRGB, then both are compared by WCAG relative luminance.

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "globals.css"),
  "utf8"
)

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

/** Follows `var(--token, fallback)` chains down to a painted value. */
function resolve(value: string, palette: Map<string, string>): string {
  const match = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(value)
  if (!match) return value
  const next = palette.get(match[1] ?? "") ?? match[2]
  if (next === undefined) throw new Error(`${value} resolves to nothing`)
  return resolve(next, palette)
}

type Rgba = { r: number; g: number; b: number; a: number }

function gammaToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function linearToGamma(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
}

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const n = Number.parseInt(hex[1] ?? "", 16)
    return {
      r: (n >> 16) / 255,
      g: ((n >> 8) & 255) / 255,
      b: (n & 255) / 255,
      a: 1,
    }
  }
  const ok = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+)%)?\)$/.exec(
    value
  )
  if (!ok) throw new Error(`cannot parse ${value}`)
  const lightness = Number(ok[1])
  const chroma = Number(ok[2])
  const hue = (Number(ok[3]) * Math.PI) / 180
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (c: number) => Math.min(1, Math.max(0, c))
  return {
    r: linearToGamma(
      clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
    ),
    g: linearToGamma(
      clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
    ),
    b: linearToGamma(
      clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
    ),
    a: ok[4] === undefined ? 1 : Number(ok[4]) / 100,
  }
}

function luminance(c: Rgba): number {
  return (
    0.2126 * gammaToLinear(c.r) +
    0.7152 * gammaToLinear(c.g) +
    0.0722 * gammaToLinear(c.b)
  )
}

function contrast(foreground: string, surface: string): number {
  const bg = parse(surface)
  const fg = parse(foreground)
  const mix = (f: number, b: number) => fg.a * f + (1 - fg.a) * b
  const l1 = luminance({
    r: mix(fg.r, bg.r),
    g: mix(fg.g, bg.g),
    b: mix(fg.b, bg.b),
    a: 1,
  })
  const l2 = luminance(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

const light = declarations(":root")
const dark = new Map([...light, ...declarations(".dark")])
const darkPaper = new Map([...dark, ...declarations("@utility paper")])

describe.each([
  ["light", light],
  ["dark", dark],
])("%s palette", (_name, palette) => {
  const on = (token: string, surface: string) =>
    contrast(
      resolve(`var(${token})`, palette),
      resolve(`var(${surface})`, palette)
    )

  it.each(["--text-1", "--text-2", "--text-3", "--text-4"])(
    "%s clears 4.5:1 on the pane and the shell",
    (token) => {
      expect(on(token, "--pane")).toBeGreaterThanOrEqual(4.5)
      expect(on(token, "--shell")).toBeGreaterThanOrEqual(4.5)
    }
  )

  it("keeps the decorative rank at 3:1 on the pane", () => {
    expect(on("--text-5", "--pane")).toBeGreaterThanOrEqual(3)
  })

  it("makes the focus ring findable on the pane", () => {
    expect(on("--ring", "--pane")).toBeGreaterThanOrEqual(3)
  })

  it("draws a control's boundary at 3:1 on the pane", () => {
    expect(on("--input", "--pane")).toBeGreaterThanOrEqual(3)
  })
})

describe("dark paper", () => {
  const onPaper = (token: string) =>
    contrast(
      resolve(`var(${token})`, darkPaper),
      resolve("var(--paper-bg)", darkPaper)
    )

  it("keeps a secondary copy button's ink and boundary visible", () => {
    expect(onPaper("--secondary-foreground")).toBeGreaterThanOrEqual(4.5)
    expect(onPaper("--edge-button")).toBeGreaterThanOrEqual(3)
    expect(onPaper("--input")).toBeGreaterThanOrEqual(3)
  })
})
