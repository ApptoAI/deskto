import { useCallback, useMemo } from "react"
import PlusIcon from "lucide-react/dist/esm/icons/plus"

import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"

import { useDraft, type ArtifactEditorProps } from "./artifact-editor.js"
import {
  csvEditColumnLimit,
  csvEditRowLimit,
  parseCsv,
  rectangular,
  serializeCsv,
  withCell,
  withColumn,
  withRow,
} from "./csv-model.js"
import { EditorToolbar } from "./editor-toolbar.js"
import { PreviewUnavailable } from "./preview-states.js"

export function CsvEditor({
  content,
  saving,
  onSave,
  onDirtyChange,
}: ArtifactEditorProps) {
  const { draft, dirty, setDraft, discard } = useDraft(
    content,
    parseCsv,
    onDirtyChange
  )
  // The table shows a rectangle even where the file is ragged, because a row
  // with fewer cells still has to line up under the headings above it. The
  // draft stays ragged, so the padding is only ever on screen.
  const rows = useMemo(() => rectangular(draft), [draft])

  const setCell = useCallback(
    (rowIndex: number, columnIndex: number, value: string) => {
      setDraft(withCell(draft, rowIndex, columnIndex, value))
    },
    [draft, setDraft]
  )

  if (
    draft.rows.length > csvEditRowLimit ||
    draft.columns > csvEditColumnLimit
  ) {
    return (
      <PreviewUnavailable
        reason={`This table is too large to edit in Deskto (over ${csvEditRowLimit} rows or ${csvEditColumnLimit} columns).`}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorToolbar
        dirty={dirty}
        saving={saving}
        onDiscard={discard}
        onSave={() => onSave(serializeCsv(draft))}
        leading={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraft(withRow(draft))}
            >
              <PlusIcon data-icon="inline-start" />
              Row
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraft(withColumn(draft))}
            >
              <PlusIcon data-icon="inline-start" />
              Column
            </Button>
          </>
        }
      />
      <ScrollArea className="min-h-0 flex-1">
        <table className="w-max min-w-full border-collapse text-xs">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, columnIndex) => (
                  <td
                    key={columnIndex}
                    className="border-r border-b border-border p-0"
                  >
                    <input
                      value={cell}
                      spellCheck={false}
                      aria-label={cellLabel(rows, rowIndex, columnIndex)}
                      onChange={(event) =>
                        setCell(rowIndex, columnIndex, event.target.value)
                      }
                      className={cn(
                        "h-8 w-44 bg-transparent px-2 outline-none focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                        // The first row reads as the header in every viewer
                        // that opens this file, so it looks like one here too.
                        rowIndex === 0 && "bg-muted/40 font-medium"
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  )
}

function cellLabel(
  rows: string[][],
  rowIndex: number,
  columnIndex: number
): string {
  const header = rows[0]?.[columnIndex]
  if (rowIndex === 0) return `Column ${columnIndex + 1} heading`
  return header
    ? `${header}, row ${rowIndex}`
    : `Column ${columnIndex + 1}, row ${rowIndex}`
}
