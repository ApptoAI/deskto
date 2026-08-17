import {
  imageAttachmentSchema,
  turnAttachmentLimit,
  turnImageMaxBytes,
  turnImageMimeTypes,
  type UploadImageAttachment,
} from "@deskto/protocol"

export const imageFileInputAccept = turnImageMimeTypes.join(",")
const maxCompressibleSourceBytes = 50 * 1024 * 1024
const qualitySteps = [0.92, 0.84, 0.74, 0.64]
const scaleSteps = [1, 0.75, 0.55]

export function selectImageFiles(
  files: File[],
  reservedCount: number
): { accepted: File[]; error?: string } {
  const accepted: File[] = []
  let count = reservedCount
  let error: string | undefined

  for (const file of files) {
    if (!imageAttachmentSchema.shape.mimeType.safeParse(file.type).success) {
      error = `'${file.name}' is not a supported image. Use PNG, JPEG, GIF, or WebP.`
      continue
    }
    if (count >= turnAttachmentLimit) {
      error = `You can attach up to ${turnAttachmentLimit} images to one message.`
      break
    }
    if (file.size === 0) {
      error = `'${file.name}' is empty.`
      continue
    }
    if (file.size > maxCompressibleSourceBytes) {
      error = `'${file.name}' is too large to process.`
      continue
    }
    accepted.push(file)
    count += 1
  }

  return error ? { accepted, error } : { accepted }
}

export async function prepareImageAttachment(
  file: File
): Promise<UploadImageAttachment> {
  const mimeType = imageAttachmentSchema.shape.mimeType.parse(file.type)
  const prepared =
    file.size <= turnImageMaxBytes
      ? await fileToPayload(file, mimeType)
      : await compress(file)
  return {
    type: "image",
    id: crypto.randomUUID(),
    ...prepared,
  }
}

async function fileToPayload(
  file: File,
  mimeType: UploadImageAttachment["mimeType"]
) {
  return {
    name: file.name || "image",
    mimeType,
    sizeBytes: file.size,
    dataUrl: await blobToDataUrl(file),
  }
}

async function compress(file: File) {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(`'${file.name}' could not be read as an image.`)
  }

  try {
    const longestEdge = Math.max(bitmap.width, bitmap.height)
    const baseEdge = Math.min(2048, longestEdge)
    for (const scale of scaleSteps) {
      const targetEdge = Math.max(1, Math.round(baseEdge * scale))
      const ratio = Math.min(1, targetEdge / longestEdge)
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
      const context = canvas.getContext("2d")
      if (!context) break
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

      for (const quality of qualitySteps) {
        const blob = await canvasToBlob(canvas, "image/webp", quality)
        if (blob && blob.size <= turnImageMaxBytes) {
          return {
            name: replaceExtension(file.name || "image", "webp"),
            mimeType: "image/webp" as const,
            sizeBytes: blob.size,
            dataUrl: await blobToDataUrl(blob),
          }
        }
      }
    }
  } finally {
    bitmap.close()
  }

  throw new Error(`'${file.name}' is too large to attach.`)
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("load", () => {
      resolve(String(reader.result))
    })
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("The image could not be read."))
    })
    reader.readAsDataURL(blob)
  })
}

function replaceExtension(name: string, extension: string): string {
  const dot = name.lastIndexOf(".")
  return `${dot > 0 ? name.slice(0, dot) : name}.${extension}`
}
