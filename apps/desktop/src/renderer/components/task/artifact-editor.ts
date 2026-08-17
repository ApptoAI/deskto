import { useCallback, useEffect, useState } from "react"

/**
 * What every file editor receives. The Surface holds one draft per open
 * tab and writes only when the user asks, so an editor never has to know how
 * the file reaches the Project folder.
 */
export type ArtifactEditorProps = {
  content: string
  saving: boolean
  onSave: (content: string) => void
  onDirtyChange: (dirty: boolean) => void
}

/**
 * Keeps a draft next to the saved content. The draft is seeded once: a save
 * that lands, or an agent edit that arrives while the tab is open, remounts
 * the editor on the new version rather than rebasing it in place, so the
 * editor never shows a version the file no longer has.
 */
export function useDraft<T>(
  content: string,
  parse: (content: string) => T,
  onDirtyChange: (dirty: boolean) => void
) {
  const [draft, setDraft] = useState(() => parse(content))
  const [dirty, setDirty] = useState(false)

  const discard = useCallback(() => {
    setDraft(parse(content))
    setDirty(false)
  }, [content, parse])
  const changeDraft = useCallback((next: T) => {
    setDraft(next)
    setDirty(true)
  }, [])

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  return {
    draft,
    dirty,
    setDraft: changeDraft,
    discard,
  }
}
