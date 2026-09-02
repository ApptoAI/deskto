import { useMemo } from "react"

import { ScrollArea } from "@workspace/ui/components/scroll-area"

import { parseCsv, rectangular } from "./csv-model.js"
import {
  visibleColumnLimit,
  visibleRowLimit,
} from "./spreadsheet-preview-data.js"

/**
 * Delimited text as a table with the first row treated as the header. Large
 * files are cut down to a readable window and say so, because a table that
 * silently stops is read as the whole file.
 */
export function CsvPreview({ content }: { content: string }) {
  const grid = useMemo(() => parseCsv(content), [content])
  const rows = useMemo(() => rectangular(grid), [grid])
  const width = Math.min(visibleColumnLimit, grid.columns)
  const visible = rows.slice(0, visibleRowLimit)
  const hiddenRows = rows.length - visible.length
  const hiddenColumns = grid.columns - width

  return (
    <ScrollArea className="flex-1">
      <table className="w-max min-w-full border-collapse text-xs">
        <tbody>
          {visible.map((row, rowIndex) => (
            <tr key={rowIndex} className={rowIndex === 0 ? "bg-muted/60" : ""}>
              {row.slice(0, width).map((cell, columnIndex) => {
                const Cell = rowIndex === 0 ? "th" : "td"
                return (
                  <Cell
                    key={columnIndex}
                    className="max-w-72 border-r border-b border-border px-2 py-1.5 text-left font-normal break-words tabular-nums"
                  >
                    {cell}
                  </Cell>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {hiddenRows > 0 || hiddenColumns > 0 ? (
        <p className="p-3 text-xs text-muted-foreground">
          {truncationNotice(hiddenRows, hiddenColumns)}
        </p>
      ) : null}
    </ScrollArea>
  )
}

function truncationNotice(hiddenRows: number, hiddenColumns: number): string {
  const parts: string[] = []
  if (hiddenRows > 0)
    parts.push(`${hiddenRows} more ${hiddenRows === 1 ? "row" : "rows"}`)
  if (hiddenColumns > 0)
    parts.push(
      `${hiddenColumns} more ${hiddenColumns === 1 ? "column" : "columns"}`
    )
  const verb = hiddenRows + hiddenColumns === 1 ? "is" : "are"
  return `${parts.join(" and ")} ${verb} not shown in this preview.`
}
