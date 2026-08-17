import { useDraft, type ArtifactEditorProps } from "./artifact-editor.js"
import { EditorToolbar } from "./editor-toolbar.js"

const identity = (content: string) => content

/** Plain and Markdown files are edited as their own source text. */
export function TextEditor({
  content,
  saving,
  onSave,
  onDirtyChange,
}: ArtifactEditorProps) {
  const { draft, dirty, setDraft, discard } = useDraft(
    content,
    identity,
    onDirtyChange
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorToolbar
        dirty={dirty}
        saving={saving}
        onDiscard={discard}
        onSave={() => onSave(draft)}
      />
      <textarea
        value={draft}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        aria-label="Edit this file"
        className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-xs leading-relaxed outline-none"
      />
    </div>
  )
}
