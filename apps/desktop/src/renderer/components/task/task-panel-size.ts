// Wide enough on first open that a document preview reaches its own reading
// measure. A panel that opens under it makes every file look narrow, and the
// user has to drag before reading anything.
export const defaultTaskPanelWidth = 480
export const minimumTaskPanelWidth = 280
export const maximumTaskPanelWidth = 1_024
// The composer's controls set this floor, not the text. Below roughly this
// width the toolbar has nowhere to put a harness, a model, a thinking level, a
// permission mode and Send, and they start overlapping each other rather than
// wrapping — which reads as an app whose buttons do not work.
export const minimumConversationWidth = 520

/**
 * The narrowest window in which every minimum above can be honoured at once:
 * the task list, this floor, and the panel's own minimum. `createMainWindow`
 * holds the native window to it, so the three constraints never have to be
 * resolved by squeezing the conversation.
 */
export const minimumWindowWidth = 288 + minimumConversationWidth + minimumTaskPanelWidth

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
