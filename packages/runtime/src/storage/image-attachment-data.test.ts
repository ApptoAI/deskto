import {
  turnImageMimeTypes,
  type UploadImageAttachment,
} from "@deskto/protocol"
import { describe, expect, it } from "vitest"

import { decodeImageAttachment } from "./image-attachment-data.js"

const headers = {
  "image/gif": [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/webp": [0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
} satisfies Record<UploadImageAttachment["mimeType"], readonly number[]>

describe("decodeImageAttachment", () => {
  it.each(turnImageMimeTypes)(
    "accepts a canonical %s payload with the matching signature",
    (mimeType) => {
      const attachment = image(mimeType, headers[mimeType])

      expect(decodeImageAttachment(attachment)).toEqual(
        Buffer.from(headers[mimeType])
      )
    }
  )

  it("rejects non-canonical base64", () => {
    const attachment = image("image/png", headers["image/png"])
    attachment.dataUrl = `${attachment.dataUrl.slice(0, -1)}!`

    expect(() => decodeImageAttachment(attachment)).toThrow("is not valid")
  })

  it("rejects a payload whose bytes do not match its declared MIME type", () => {
    const attachment = image("image/png", headers["image/jpeg"])

    expect(() => decodeImageAttachment(attachment)).toThrow("is not valid")
  })

  it("rejects empty and size-mismatched payloads", () => {
    const empty = image("image/png", [])
    const wrongSize = image("image/png", headers["image/png"])
    wrongSize.sizeBytes += 1

    expect(() => decodeImageAttachment(empty)).toThrow("is not valid")
    expect(() => decodeImageAttachment(wrongSize)).toThrow("is not valid")
  })
})

function image(
  mimeType: UploadImageAttachment["mimeType"],
  bytes: readonly number[]
): UploadImageAttachment {
  const data = Buffer.from(bytes)
  return {
    type: "image",
    id: "3bca8cf5-1d29-4ce2-bd31-dfa05c4c5038",
    name: "image",
    mimeType,
    sizeBytes: data.byteLength,
    dataUrl: `data:${mimeType};base64,${data.toString("base64")}`,
  }
}
