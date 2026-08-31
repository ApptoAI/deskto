// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"

import {
  createDevPickerSelector,
  describeDevPickerElement,
  serializeDevPickerBrief,
} from "./dev-picker-context.js"

describe("development element picker context", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("prefers a unique id", () => {
    document.body.innerHTML = '<button id="send-task">Send</button>'
    const element = document.querySelector("button")
    expect(element && createDevPickerSelector(element)).toBe("#send-task")
  })

  it("uses a stable test attribute before a structural path", () => {
    document.body.innerHTML = `
      <main>
        <button data-testid="task-action">First</button>
        <button>Second</button>
      </main>
    `
    const element = document.querySelector<HTMLElement>("[data-testid]")
    expect(element && createDevPickerSelector(element)).toBe(
      'button[data-testid="task-action"]'
    )
  })

  it("falls back to an unambiguous structural selector", () => {
    document.body.innerHTML = `
      <main>
        <section><button>First</button><button>Second</button></section>
      </main>
    `
    const element = document.querySelectorAll("button")[1]
    if (!element) throw new Error("Test button is missing")
    expect(createDevPickerSelector(element)).toBe("button:nth-of-type(2)")
  })

  it("captures concise element context", () => {
    document.body.innerHTML =
      '<button aria-label="Send task"><span>Send now</span></button>'
    const element = document.querySelector<HTMLElement>("button")
    if (!element) throw new Error("Test button is missing")

    expect(describeDevPickerElement(element)).toMatchObject({
      selector: 'button[aria-label="Send task"]',
      tagName: "button",
      attributes: { "aria-label": "Send task" },
    })
  })

  it("serializes instructions, selectors, regions, and drawing", () => {
    const brief = serializeDevPickerBrief({
      instruction: "Tighten this row.",
      selections: [
        {
          selector: "#task-row",
          tagName: "div",
          text: "Task",
          attributes: { id: "task-row" },
          bounds: { x: 10, y: 20, width: 300, height: 40 },
          html: '<div id="task-row">Task</div>',
          note: "Reduce the height.",
        },
      ],
      regions: [{ x: 4, y: 8, width: 12, height: 16 }],
      strokes: [
        {
          points: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        },
      ],
    })

    expect(brief).toContain("<deskto_dev_annotation>")
    expect(brief).toContain("Tighten this row.")
    expect(brief).toContain("#task-row")
    expect(brief).toContain("Note: Reduce the height.")
    expect(brief).toContain("Marked regions:")
    expect(brief).toContain("Freehand drawing: 1 stroke")
  })
})
