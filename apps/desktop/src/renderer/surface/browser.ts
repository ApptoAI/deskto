import type { BrowserElementContext } from "@deskto/protocol"

import type {
  BrowserAction,
  BrowserBounds,
  BrowserEvent,
  BrowserViewState,
  ResultRef,
} from "../../shared/desktop-api.js"
import type { TaskPanelCapability } from "./task-panel.js"

export class BrowserSurfaceApi {
  constructor(private readonly panel: TaskPanelCapability) {}

  open(threadId: string): void {
    this.panel.open({ threadId, surface: "browser" })
  }

  place(threadId: string, bounds: BrowserBounds): Promise<BrowserViewState> {
    return window.deskto.browser.show(threadId, bounds)
  }

  hide(threadId: string): Promise<void> {
    return window.deskto.browser.hide(threadId)
  }

  state(threadId: string): Promise<BrowserViewState> {
    return window.deskto.browser.state(threadId)
  }

  navigate(threadId: string, url: string): Promise<BrowserViewState> {
    return window.deskto.browser.navigate(threadId, url)
  }

  action(threadId: string, action: BrowserAction): Promise<BrowserViewState> {
    return window.deskto.browser.action(threadId, action)
  }

  openArtifact(result: ResultRef): Promise<BrowserViewState> {
    this.open(result.threadId)
    return window.deskto.browser.openArtifact(result)
  }

  selectElement(threadId: string): Promise<BrowserElementContext | undefined> {
    return window.deskto.browser.selectElement(threadId)
  }

  cancelElementSelection(threadId: string): Promise<void> {
    return window.deskto.browser.cancelElementSelection(threadId)
  }

  subscribe(listener: (event: BrowserEvent) => void): () => void {
    return window.deskto.browser.subscribe(listener)
  }
}
