// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import {
  browserElementBoundsScript,
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
    window.eval(browserSnapshotScript(registryKey))
    document.body.innerHTML = "<button>Delete account</button>"

    expect(
      window.eval(browserElementBoundsScript(registryKey, "e1"))
    ).toBeNull()
  })
})
