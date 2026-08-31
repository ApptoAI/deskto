const referenceViewportWidth = 1920
const referenceViewportHeight = 1080
const scaleStep = 0.25
const maximumScale = 2

/**
 * Fits the Surface to a familiar desktop-sized viewport when the window is
 * unusually large in CSS pixels. OS display scaling has already reduced the
 * viewport before this runs, so a 4K display at 200% remains at native size.
 */
export function interfaceViewportScale(width: number, height: number): number {
  const fittedScale = Math.min(
    width / referenceViewportWidth,
    height / referenceViewportHeight
  )
  const steppedScale = Math.round(fittedScale / scaleStep) * scaleStep
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
