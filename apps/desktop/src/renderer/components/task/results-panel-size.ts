export const defaultResultsPanelWidth = 560
export const minimumResultsPanelWidth = 280
export const maximumResultsPanelWidth = 1_024
export const minimumConversationWidth = 288

export function maximumResultsPanelWidthForContainer(
  containerWidth: number
): number {
  return Math.min(
    maximumResultsPanelWidth,
    Math.max(
      minimumResultsPanelWidth,
      containerWidth - minimumConversationWidth
    )
  )
}

export function clampResultsPanelWidth(
  width: number,
  containerWidth: number
): number {
  const maximum = maximumResultsPanelWidthForContainer(containerWidth)
  return Math.round(
    Math.min(maximum, Math.max(minimumResultsPanelWidth, width))
  )
}
