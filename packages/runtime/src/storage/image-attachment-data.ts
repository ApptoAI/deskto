import type { UploadImageAttachment } from "@deskto/protocol"

import { RuntimeError } from "../errors.js"

const canonicalBase64 =
  /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/

const imageSignatures = {
  "image/gif": [
    [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }],
    [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }],
  ],
  "image/jpeg": [[{ offset: 0, bytes: [0xff, 0xd8, 0xff] }]],
  "image/png": [
    [
      {
        offset: 0,
        bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      },
    ],
  ],
  "image/webp": [
    [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  ],
} satisfies Record<
  UploadImageAttachment["mimeType"],
  { offset: number; bytes: readonly number[] }[][]
>

export function decodeImageAttachment(
  attachment: UploadImageAttachment
): Buffer {
  const prefix = `data:${attachment.mimeType};base64,`
  const encoded = attachment.dataUrl.slice(prefix.length)
  const data = Buffer.from(encoded, "base64")
  const canonical =
    attachment.dataUrl.startsWith(prefix) &&
    canonicalBase64.test(encoded) &&
    data.toString("base64") === encoded
  if (
    !canonical ||
    data.byteLength !== attachment.sizeBytes ||
    !matchesImageSignature(data, attachment.mimeType)
  ) {
    throw new RuntimeError(
      "invalid-attachment",
      `The image '${attachment.name}' is not valid.`
    )
  }
  return data
}

function matchesImageSignature(
  data: Uint8Array,
  mimeType: UploadImageAttachment["mimeType"]
): boolean {
  return imageSignatures[mimeType].some((signature) =>
    signature.every(({ offset, bytes }) =>
      bytes.every((byte, index) => data[offset + index] === byte)
    )
  )
}
