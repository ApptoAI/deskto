import type { PromptReference } from "@deskto/protocol"

export type ComposerDraft = {
  text: string
  references: PromptReference[]
}

/**
 * Unsent composer text, kept for the app session. A task view is remounted
 * every time the person opens another task, so without this the half-written
 * message they left behind is gone when they come back. Images are not kept:
 * their bytes belong to the box that is going away, and a picture the person
 * has to attach again is cheaper than one they did not expect to reappear.
 */
const drafts = new Map<string, ComposerDraft>()

export function readComposerDraft(key: string): ComposerDraft | undefined {
  return drafts.get(key)
}

export function writeComposerDraft(key: string, draft: ComposerDraft): void {
  if (draft.text.length === 0 && draft.references.length === 0) {
    drafts.delete(key)
    return
  }
  drafts.set(key, draft)
}
