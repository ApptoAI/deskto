import mammoth from "mammoth"

const convertedHtmlLimit = 5_000_000

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const result = await mammoth.convertToHtml(
      { arrayBuffer: event.data },
      {
        convertImage: mammoth.images.dataUri,
        externalFileAccess: false,
      }
    )
    if (result.value.length > convertedHtmlLimit) {
      throw new Error("The converted document is too large to display")
    }
    self.postMessage({
      ok: true,
      html: result.value,
      warnings: result.messages.filter((message) => message.type === "warning")
        .length,
    })
  } catch (error) {
    self.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
