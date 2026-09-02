import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./app/app.js"
import { DevElementPicker } from "./dev-picker/dev-element-picker.js"
import { applyInterfaceViewportScale } from "./lib/viewport-scale.js"
import "./styles.css"

const container = document.getElementById("root")
if (!container)
  throw new Error("The renderer root element is missing from index.html.")

applyInterfaceViewportScale()
window.addEventListener("resize", applyInterfaceViewportScale)

// Before the first render, so the shell never paints opaque and then thins.
document.documentElement.classList.toggle(
  "vibrant",
  window.deskto?.frostedShell === true
)

createRoot(container).render(
  <StrictMode>
    <App />
    {window.deskto?.devFlags.elementPicker ? <DevElementPicker /> : null}
  </StrictMode>
)
