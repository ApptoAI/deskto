import readXlsxFile from "read-excel-file/web-worker"

import {
  visibleColumnLimit,
  visibleRowLimit,
  visibleSheetLimit,
  type WorkbookPreview,
} from "./spreadsheet-preview-data.js"

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  readXlsxFile(event.data).then(
    (sheets) => {
      const workbook: WorkbookPreview = {
        totalSheets: sheets.length,
        sheets: sheets.slice(0, visibleSheetLimit).map((sheet) => {
          let maxColumns = 0
          for (const row of sheet.data) {
            maxColumns = Math.max(maxColumns, row.length)
          }
          return {
            sheet: sheet.sheet,
            data: sheet.data
              .slice(0, visibleRowLimit)
              .map((row) => row.slice(0, visibleColumnLimit)),
            totalRows: sheet.data.length,
            maxColumns,
          }
        }),
      }
      self.postMessage({ ok: true, workbook })
    },
    (error: unknown) =>
      self.postMessage({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      })
  )
}
