export type DevPickerElementContext = {
  selector: string
  tagName: string
  role?: string
  text?: string
  attributes: Record<string, string>
  bounds: { x: number; y: number; width: number; height: number }
  html: string
}

export type DevPickerSelection = DevPickerElementContext & {
  note?: string
}

export type DevPickerRegion = {
  x: number
  y: number
  width: number
  height: number
}

export type DevPickerStroke = {
  points: Array<{ x: number; y: number }>
}

const preferredAttributes = ["data-testid", "data-slot", "aria-label", "name"]
const maximumHtmlLength = 1_200
const maximumTextLength = 240

function escapeIdentifier(value: string) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value)
  return value.replace(
    /(^-?\d)|[^a-zA-Z0-9_-]/g,
    (character) => `\\${character.codePointAt(0)?.toString(16)} `
  )
}

function escapeAttributeValue(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}

function uniquelyIdentifies(element: Element, selector: string) {
  try {
    const matches = element.ownerDocument.querySelectorAll(selector)
    return matches.length === 1 && matches[0] === element
  } catch {
    return false
  }
}

function structuralSegment(element: Element) {
  const tagName = element.tagName.toLowerCase()
  const parent = element.parentElement
  if (!parent) return tagName

  const siblings = Array.from(parent.children).filter(
    (sibling) => sibling.tagName === element.tagName
  )
  if (siblings.length === 1) return tagName
  return `${tagName}:nth-of-type(${siblings.indexOf(element) + 1})`
}

export function createDevPickerSelector(element: Element) {
  if (element.id) {
    const selector = `#${escapeIdentifier(element.id)}`
    if (uniquelyIdentifies(element, selector)) return selector
  }

  const tagName = element.tagName.toLowerCase()
  for (const attribute of preferredAttributes) {
    const value = element.getAttribute(attribute)
    if (!value) continue
    const selector = `${tagName}[${attribute}="${escapeAttributeValue(value)}"]`
    if (uniquelyIdentifies(element, selector)) return selector
  }

  const stableClasses = Array.from(element.classList)
    .filter((className) => /^[a-zA-Z_][\w-]*$/.test(className))
    .slice(0, 3)
  for (let count = 1; count <= stableClasses.length; count += 1) {
    const selector = `${tagName}.${stableClasses
      .slice(0, count)
      .map(escapeIdentifier)
      .join(".")}`
    if (uniquelyIdentifies(element, selector)) return selector
  }

  const segments: string[] = []
  let current: Element | null = element
  while (current && segments.length < 8) {
    segments.unshift(structuralSegment(current))
    const selector = segments.join(" > ")
    if (uniquelyIdentifies(element, selector)) return selector
    current = current.parentElement
  }
  return segments.join(" > ") || tagName
}

export function describeDevPickerElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  const text = (element.innerText ?? element.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim()
  const attributes = Object.fromEntries(
    Array.from(element.attributes)
      .filter(({ name }) =>
        ["id", "class", "role", ...preferredAttributes].includes(name)
      )
      .map(({ name, value }) => [name, value])
  )
  const html = element.outerHTML.replace(/\s+/g, " ").trim()

  return {
    selector: createDevPickerSelector(element),
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute("role") ?? undefined,
    text: text ? text.slice(0, maximumTextLength) : undefined,
    attributes,
    bounds: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    html:
      html.length > maximumHtmlLength
        ? `${html.slice(0, maximumHtmlLength)}…`
        : html,
  } satisfies DevPickerElementContext
}

export function serializeDevPickerBrief(input: {
  instruction: string
  selections: DevPickerSelection[]
  regions: DevPickerRegion[]
  strokes: DevPickerStroke[]
}) {
  const lines = [
    "<deskto_dev_annotation>",
    input.instruction.trim() || "Review the marked parts of the Deskto UI.",
  ]

  if (input.selections.length > 0) {
    lines.push("", "Selected DOM elements:")
    input.selections.forEach((selection, index) => {
      lines.push(`${index + 1}. ${selection.selector}`)
      if (selection.note?.trim())
        lines.push(`   Note: ${selection.note.trim()}`)
      lines.push(`   Element: <${selection.tagName}>`)
      if (selection.text) lines.push(`   Text: ${selection.text}`)
      lines.push(
        `   Bounds: x=${selection.bounds.x}, y=${selection.bounds.y}, width=${selection.bounds.width}, height=${selection.bounds.height}`,
        `   HTML: ${selection.html}`
      )
    })
  }

  if (input.regions.length > 0) {
    lines.push("", "Marked regions:")
    input.regions.forEach((region, index) => {
      lines.push(
        `${index + 1}. x=${Math.round(region.x)}, y=${Math.round(region.y)}, width=${Math.round(region.width)}, height=${Math.round(region.height)}`
      )
    })
  }

  if (input.strokes.length > 0) {
    lines.push(
      "",
      `Freehand drawing: ${input.strokes.length} stroke${input.strokes.length === 1 ? "" : "s"} over the live UI.`
    )
  }

  lines.push("</deskto_dev_annotation>")
  return lines.join("\n")
}
