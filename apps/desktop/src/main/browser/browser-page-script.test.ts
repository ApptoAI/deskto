// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import {
  browserCancelElementPickerScript,
  browserElementBoundsScript,
  browserElementPickerScript,
  browserSetValueScript,
  browserSnapshotScript,
} from "./browser-page-script.js"

const snapshotSchema = z.object({
  text: z.string(),
  elements: z.array(
    z.object({
      ref: z.string(),
      name: z.string(),
      value: z.string().optional(),
    })
  ),
})

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe("browser snapshot page script", () => {
  it("never returns a password value or value attribute", () => {
    document.body.innerHTML = `
      <input type="password" placeholder="Password" value="server-secret">
      <input type="text" placeholder="Email" value="person@example.com">
    `
    const password = document.querySelector<HTMLInputElement>(
      'input[type="password"]'
    )
    if (!password) throw new Error("Password input fixture is missing")
    password.value = "autofilled-secret"
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 120,
      height: 24,
      top: 0,
      right: 120,
      bottom: 24,
      left: 0,
      toJSON: () => ({}),
    })

    const snapshot = snapshotSchema.parse(
      // biome-ignore lint/security/noGlobalEval: generated page code must run in the jsdom Window
      window.eval(browserSnapshotScript("__deskto_test_registry"))
    )

    expect(JSON.stringify(snapshot)).not.toContain("secret")
    expect(snapshot.elements[0]).toEqual(
      expect.objectContaining({ name: "Password" })
    )
    expect(snapshot.elements[0]).not.toHaveProperty("value")
    expect(snapshot.elements[1]).toEqual(
      expect.objectContaining({
        name: "Email",
        value: "person@example.com",
      })
    )
  })

  it("does not retarget a ref after its original element is replaced", () => {
    document.body.innerHTML = "<button>Delete draft</button>"
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 120,
      height: 24,
      top: 0,
      right: 120,
      bottom: 24,
      left: 0,
      toJSON: () => ({}),
    })
    const registryKey = "__deskto_identity_registry"
    // biome-ignore lint/security/noGlobalEval: generated page code must run in the jsdom Window
    window.eval(browserSnapshotScript(registryKey))
    document.body.innerHTML = "<button>Delete account</button>"

    expect(
      // biome-ignore lint/security/noGlobalEval: generated page code must run in the jsdom Window
      window.eval(browserElementBoundsScript(registryKey, "e1"))
    ).toBeNull()
  })

  it("drops the previous element registry after a new snapshot", () => {
    const first = "__deskto_first_registry"
    const second = "__deskto_second_registry"

    // biome-ignore lint/security/noGlobalEval: generated page code must run in the jsdom Window
    window.eval(browserSnapshotScript(first))
    expect(Object.hasOwn(window, first)).toBe(true)

    // biome-ignore lint/security/noGlobalEval: generated page code must run in the jsdom Window
    window.eval(browserSnapshotScript(second, first))
    expect(Object.hasOwn(window, first)).toBe(false)
    expect(Object.hasOwn(window, second)).toBe(true)
  })

  it("uses the native value setter and dispatches input events", () => {
    const input = document.createElement("input")
    document.body.append(input)
    const ownSetter = vi.fn()
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => "tracked",
      set: ownSetter,
    })
    const events: string[] = []
    input.addEventListener("input", (event) => events.push(event.type))
    input.addEventListener("change", (event) => events.push(event.type))
    const registryKey = "__deskto_value_registry"
    Object.defineProperty(window, registryKey, {
      configurable: true,
      value: { e1: input },
    })

    // biome-ignore lint/security/noGlobalEval: generated page code must run in the jsdom Window
    expect(window.eval(browserSetValueScript(registryKey, "e1", "next"))).toBe(
      true
    )
    expect(ownSetter).not.toHaveBeenCalled()
    expect(events).toEqual(["input", "change"])
    Reflect.deleteProperty(input, "value")
    expect(input.value).toBe("next")
  })

  it("rejects a click point covered by another element", () => {
    const button = document.createElement("button")
    const overlay = document.createElement("div")
    document.body.append(button, overlay)
    button.scrollIntoView = vi.fn()
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 10,
      width: 120,
      height: 24,
      top: 10,
      right: 130,
      bottom: 34,
      left: 10,
      toJSON: () => ({}),
    })
    const registryKey = "__deskto_click_registry"
    Object.defineProperty(window, registryKey, {
      configurable: true,
      value: { e1: button },
    })
    const originalElementFromPoint = Object.getOwnPropertyDescriptor(
      document,
      "elementFromPoint"
    )
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => overlay),
    })

    try {
      // biome-ignore lint/security/noGlobalEval: generated page code must run in the jsdom Window
      expect(
        window.eval(browserElementBoundsScript(registryKey, "e1"))
      ).toBeNull()
    } finally {
      if (originalElementFromPoint) {
        Object.defineProperty(
          document,
          "elementFromPoint",
          originalElementFromPoint
        )
      } else {
        Reflect.deleteProperty(document, "elementFromPoint")
      }
    }
  })
})

describe("browser element picker page script", () => {
  function evaluatePickerScript<Result>(script: string): Result {
    // biome-ignore lint/security/noGlobalEval: generated picker code must run in the jsdom Window
    // SAFETY: Each call supplies the generated script's documented result type.
    return window.eval(script) as Result
  }

  it("captures bounded semantic details without form values", async () => {
    document.body.innerHTML = `
      <label>Email <input type="email" value="private@example.com"></label>
    `
    const input = document.querySelector("input")
    if (!input) throw new Error("Input fixture is missing")
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 10,
      width: 120,
      height: 24,
      top: 10,
      right: 130,
      bottom: 34,
      left: 10,
      toJSON: () => ({}),
    })

    const controlKey = "__deskto_picker_test"
    // SAFETY: The generated picker script always evaluates to its one-shot Promise.
    const pending = evaluatePickerScript<Promise<unknown>>(
      browserElementPickerScript(controlKey)
    )
    input.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))
    input.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    )
    const result = await pending

    expect(result).toEqual(
      expect.objectContaining({
        selector: "body > label > input",
        tagName: "input",
        role: "textbox",
        name: null,
        text: null,
      })
    )
    expect(JSON.stringify(result)).not.toContain("private@example.com")
    expect(document.querySelector("[data-deskto-element-picker]")).toBeNull()
  })

  it.each([
    ["textarea", "<label>Private note<textarea>launch code</textarea></label>"],
    ["contenteditable", '<div contenteditable="true">launch code</div>'],
  ])("redacts %s contents", async (_kind, markup) => {
    document.body.innerHTML = markup
    const target = document.querySelector("textarea, [contenteditable]")
    if (!target) throw new Error("Sensitive element fixture is missing")

    // SAFETY: The generated picker script always evaluates to its one-shot Promise.
    const pending = evaluatePickerScript<Promise<unknown>>(
      browserElementPickerScript("__deskto_sensitive_picker_test")
    )
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    )

    await expect(pending).resolves.toEqual(
      expect.objectContaining({ name: null, text: null })
    )
  })

  it("can be cancelled from the Browser toolbar", async () => {
    const controlKey = "__deskto_picker_cancel_test"
    // SAFETY: The generated picker script always evaluates to its one-shot Promise.
    const pending = evaluatePickerScript<Promise<unknown>>(
      browserElementPickerScript(controlKey)
    )

    evaluatePickerScript<void>(browserCancelElementPickerScript(controlKey))

    await expect(pending).resolves.toBeNull()
    expect(document.querySelector("[data-deskto-element-picker]")).toBeNull()
  })
})
