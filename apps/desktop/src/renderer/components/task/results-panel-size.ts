export const defaultResultsPanelWidth = 560
export const minimumResultsPanelWidth = 280
export const maximumResultsPanelWidth = 1_024
export const minimumConversationWidth = 288

export function clampResultsPanelWidth(
  width: number,
  containerWidth: number
): number {
  const available = Math.max(
    minimumResultsPanelWidth,
    containerWidth - minimumConversationWidth
  )
  const maximum = Math.min(maximumResultsPanelWidth, available)
  return Math.round(
    Math.min(maximum, Math.max(minimumResultsPanelWidth, width))
  )
}
