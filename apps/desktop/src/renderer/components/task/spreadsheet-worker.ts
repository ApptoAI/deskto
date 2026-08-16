import readXlsxFile from "read-excel-file/web-worker"

import {
  visibleColumnLimit,
  visibleRowLimit,
  visibleSheetLimit,
  previewCellSchema,
  type WorkbookPreview,
} from "./spreadsheet-preview-data.js"

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const sheets = await readXlsxFile(event.data)
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
            .map((row) =>
              row
                .slice(0, visibleColumnLimit)
                .map((cell) => previewCellSchema.parse(cell))
            ),
          totalRows: sheet.data.length,
          maxColumns,
        }
      }),
    }
    self.postMessage({ ok: true, workbook })
  } catch (error) {
    self.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
