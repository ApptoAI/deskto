import { useState } from "react"

import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"

import { InlineError } from "../inline-error.js"
import {
  visibleColumnLimit,
  visibleRowLimit,
  visibleSheetLimit,
  type PreviewSheet,
  type WorkbookPreview,
} from "./spreadsheet-preview-data.js"
import { useWorkerResult } from "./use-worker-result.js"

export function SpreadsheetPreview({ dataBase64 }: { dataBase64: string }) {
  const state = useWorkerResult(
    createSpreadsheetWorker,
    dataBase64,
    workbookFromWorker,
    "Workbook worker failed",
    "Workbook worker returned an unreadable result"
  )
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null)

  if (state.status === "error") {
    return (
      <div className="p-3">
        <InlineError
          message={`Could not read this workbook. ${state.message}`}
        />
      </div>
    )
  }
  if (state.status !== "ready") return <PreviewLoading />

  const { sheets, totalSheets } = state.data
  const sheet =
    sheets.find((candidate) => candidate.sheet === selectedSheet) ?? sheets[0]
  if (!sheet) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        This workbook has no sheets.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {sheets.length > 1 ? (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
          {sheets.map((candidate) => (
            <button
              key={candidate.sheet}
              type="button"
              onClick={() => setSelectedSheet(candidate.sheet)}
              className={cn(
                "shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground",
                candidate.sheet === sheet.sheet &&
                  "bg-muted font-medium text-foreground"
              )}
            >
              {candidate.sheet}
            </button>
          ))}
          {totalSheets > sheets.length ? (
            <span className="shrink-0 px-2 py-1 text-xs text-muted-foreground">
              First {visibleSheetLimit} of {totalSheets} sheets
            </span>
          ) : null}
        </div>
      ) : null}
      <SpreadsheetGrid sheet={sheet} />
    </div>
  )
}

type WorkbookWorkerSuccess = { ok: true; workbook: WorkbookPreview }

function createSpreadsheetWorker(): Worker {
  return new Worker(new URL("./spreadsheet-worker.ts", import.meta.url), {
    type: "module",
  })
}

function workbookFromWorker(result: WorkbookWorkerSuccess): WorkbookPreview {
  return result.workbook
}

function SpreadsheetGrid({ sheet }: { sheet: PreviewSheet }) {
  const rows = sheet.data
  let width = 0
  for (const row of rows) width = Math.max(width, row.length)

  return (
    <ScrollArea className="flex-1">
      <table className="w-max min-w-full border-collapse text-xs">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <th className="sticky left-0 z-10 w-10 border-r border-b border-border bg-muted px-2 py-1.5 text-right font-normal text-muted-foreground tabular-nums">
                {rowIndex + 1}
              </th>
              {Array.from({ length: width }, (_, columnIndex) => (
                <td
                  key={columnIndex}
                  className="max-w-72 min-w-24 border-r border-b border-border px-2 py-1.5 align-top break-words"
                >
                  {formatCell(row[columnIndex])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sheet.totalRows > rows.length ||
      sheet.maxColumns > visibleColumnLimit ? (
        <p className="p-3 text-xs text-muted-foreground">
          {previewLimitMessage(sheet)}
        </p>
      ) : null}
    </ScrollArea>
  )
}

function previewLimitMessage(sheet: PreviewSheet): string {
  const rowsLimited = sheet.totalRows > sheet.data.length
  const columnsLimited = sheet.maxColumns > visibleColumnLimit
  if (rowsLimited && columnsLimited) {
    return `Preview limited to the first ${visibleRowLimit} rows and ${visibleColumnLimit} columns.`
  }
  if (rowsLimited) {
    return `Preview limited to the first ${visibleRowLimit} rows.`
  }
  return `Preview limited to the first ${visibleColumnLimit} columns.`
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toLocaleString()
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  return String(value)
}

function PreviewLoading() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      Reading workbook…
    </div>
  )
}
