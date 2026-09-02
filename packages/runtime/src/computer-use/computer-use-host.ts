export type ComputerUseSize = { width: number; height: number }

export type ComputerUsePoint = { x: number; y: number }

export type ComputerUseModifier = "shift" | "control" | "alt" | "meta"

export type ComputerUseMouseButton = "left" | "middle" | "right"

/**
 * Pointer events also carry which buttons are held, so a page sees
 * `event.buttons` set while a drag is in motion.
 */
export type ComputerUseMouseModifier = ComputerUseModifier | "leftbuttondown"

/**
 * The subset of Electron's `sendInputEvent` payloads that screen control
 * emits. Every member must stay assignable to Electron's input event union so
 * the desktop host can forward them unchanged; the Runtime never imports
 * Electron to check that.
 */
export type ComputerUseInputEvent =
  | {
      type: "mouseDown" | "mouseUp" | "mouseMove"
      x: number
      y: number
      button?: ComputerUseMouseButton
      clickCount?: number
      modifiers?: ComputerUseMouseModifier[]
    }
  | {
      type: "mouseWheel"
      x: number
      y: number
      deltaX: number
      deltaY: number
      modifiers?: ComputerUseModifier[]
    }
  | {
      type: "keyDown" | "keyUp" | "char"
      keyCode: string
      modifiers?: ComputerUseModifier[]
    }

/** What a screenshot needs from a captured page image. */
export interface ComputerUseCapture {
  resize(size: ComputerUseSize): { toPNG(): Buffer }
}

/**
 * One Task's browser page as screen control sees it: a viewport of a known
 * size that takes raw input and can be captured. Electron's WebContents
 * satisfies the last two directly.
 */
export interface ComputerUsePage {
  size(): ComputerUseSize
  capturePage(): Promise<ComputerUseCapture>
  sendInputEvent(event: ComputerUseInputEvent): void
}

/** Electron implements this interface; Runtime and Harness Adapters do not. */
export interface ComputerUseHost {
  /**
   * Runs one screen action against the Task's browser page, holding the
   * page's agent-input lease so it cannot race the person's element picker
   * or another tool call.
   */
  operate<T>(
    threadId: string,
    run: (page: ComputerUsePage) => Promise<T>
  ): Promise<T>
}
