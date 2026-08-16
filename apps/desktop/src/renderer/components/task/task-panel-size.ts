export const defaultTaskPanelWidth = 560
export const minimumTaskPanelWidth = 280
export const maximumTaskPanelWidth = 1_024
export const minimumConversationWidth = 288

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
