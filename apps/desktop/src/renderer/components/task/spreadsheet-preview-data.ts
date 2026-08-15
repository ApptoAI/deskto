import type { Sheet } from "read-excel-file/browser"

export const visibleSheetLimit = 50
export const visibleRowLimit = 200
export const visibleColumnLimit = 50

export type PreviewSheet = {
  sheet: string
  data: Sheet["data"]
  totalRows: number
  maxColumns: number
}

export type WorkbookPreview = {
  sheets: PreviewSheet[]
  totalSheets: number
}
