import { describe, expect, it } from "vitest"

import { selectImageFiles } from "./image-attachments.js"

function file(name: string, type: string) {
  return new File(["pixels"], name, { type })
}

describe("selectImageFiles", () => {
  it("keeps supported images and reports unsupported files", () => {
    const png = file("screen.png", "image/png")
    const svg = file("drawing.svg", "image/svg+xml")

    expect(selectImageFiles([png, svg], 0)).toEqual({
      accepted: [png],
      error:
        "'drawing.svg' is not a supported image. Use PNG, JPEG, GIF, or WebP.",
    })
  })

  it("reserves the remaining attachment slots", () => {
    const first = file("one.png", "image/png")
    const second = file("two.png", "image/png")

    expect(selectImageFiles([first, second], 7)).toEqual({
      accepted: [first],
      error: "You can attach up to 8 images to one message.",
    })
  })

  it("rejects empty images before preparation", () => {
    const empty = new File([], "empty.png", { type: "image/png" })

    expect(selectImageFiles([empty], 0)).toEqual({
      accepted: [],
      error: "'empty.png' is empty.",
    })
  })
})
