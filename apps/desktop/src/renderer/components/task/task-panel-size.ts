// Wide enough on first open that a document preview reaches its own reading
// measure. A panel that opens under it makes every file look narrow, and the
// user has to drag before reading anything.
export const defaultTaskPanelWidth = 720
export const minimumTaskPanelWidth = 280
export const maximumTaskPanelWidth = 1_024
export const minimumConversationWidth = 288

/**
 * The two measures long-form text is held to. They live beside the panel
 * widths because they are the same geometry: how wide the panel opens only
 * matters against the measure the document inside it is trying to reach.
 *
 * The conversation is the narrower of the two — it is read in turns, with a
 * composer under it — while a file is read as a page.
 */
export const conversationMeasureClassName = "max-w-[46rem]"
export const documentMeasureClassName = "max-w-[52rem]"

export function maximumTaskPanelWidthForContainer(
  containerWidth: number
): number {
  return Math.min(
    maximumTaskPanelWidth,
    Math.max(minimumTaskPanelWidth, containerWidth - minimumConversationWidth)
  )
}

export function clampTaskPanelWidth(
  width: number,
  containerWidth: number
): number {
  const maximum = maximumTaskPanelWidthForContainer(containerWidth)
  return Math.round(Math.min(maximum, Math.max(minimumTaskPanelWidth, width)))
}
