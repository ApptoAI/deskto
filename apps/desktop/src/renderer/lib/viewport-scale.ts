const referenceViewportWidth = 1920
const referenceViewportHeight = 1080
const scaleStep = 0.25
const maximumScale = 2

/** OS display scaling is already reflected in CSS viewport dimensions. */
export function interfaceViewportScale(width: number, height: number): number {
  const fittedScale = Math.min(
    width / referenceViewportWidth,
    height / referenceViewportHeight
  )
  const steppedScale = Math.floor(fittedScale / scaleStep) * scaleStep
  return Math.min(maximumScale, Math.max(1, steppedScale))
}

export function applyInterfaceViewportScale(): void {
  const root = document.getElementById("root")
  if (!root) return
  root.style.setProperty(
    "zoom",
    String(interfaceViewportScale(window.innerWidth, window.innerHeight))
  )
}
