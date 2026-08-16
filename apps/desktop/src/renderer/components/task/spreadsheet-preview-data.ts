import { z } from "zod"

export const visibleSheetLimit = 50
export const visibleRowLimit = 200
export const visibleColumnLimit = 50

export const previewCellSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.date(),
  z.null(),
])
export type PreviewCell = z.infer<typeof previewCellSchema>

export type PreviewSheet = {
  sheet: string
  data: PreviewCell[][]
  totalRows: number
  maxColumns: number
}

export type WorkbookPreview = {
  sheets: PreviewSheet[]
  totalSheets: number
}
