/**
 * How a file separates its rows. A file is written back with the separator it
 * arrived with, so opening a Windows export on a Mac does not rewrite every
 * line.
 */
export type LineEnding = "\r\n" | "\n" | "\r"

/**
 * Delimited text as a grid, together with everything a save has to put back:
 * how the file ended its lines, whether it ended with one, and which cells it
 * chose to wrap in quotes. The parser and the serializer are a pair, so a file
 * that is opened and saved without an edit comes back byte for byte.
 */
export type CsvGrid = {
  /**
   * Rows exactly as the file wrote them. A short row stays short: the padding
   * that makes the grid look rectangular belongs to rendering, not to the
   * file. See rectangular.
   */
  rows: string[][]
  /** Width of the widest row, which is how many columns the grid renders. */
  columns: number
  /**
   * Which cells arrived wrapped in quotes, including cells that did not need
   * them. Writers that quote every field are common, and unwrapping them all
   * would turn a one-cell edit into a whole-file diff.
   */
  quoted: boolean[][]
  lineEnding: LineEnding
  trailingNewline: boolean
}

/**
 * Editing loads every cell as an input, so the grid stays small enough to
 * render as one table. A larger result opens read-only instead of being
 * silently cut down to the part that fits — saving a truncated grid would
 * delete the rows the user never saw. Virtualization would raise these.
 */
export const csvEditRowLimit = 500
export const csvEditColumnLimit = 60

export function parseCsv(content: string, delimiter = ","): CsvGrid {
  const rows: string[][] = []
  const quoted: boolean[][] = []
  let row: string[] = []
  let rowQuoted: boolean[] = []
  let value = ""
  let inQuotes = false
  let cellOpenedQuoted = false
  // Whether anything at all has landed in the row being read. A row holding
  // one empty quoted cell leaves behind no value and no earlier cell, so this
  // is the only thing that tells it apart from a file that ran out after a
  // line ending.
  let started = false
  let columns = 0
  let crlf = 0
  let lf = 0
  let cr = 0

  const endCell = () => {
    row.push(value)
    rowQuoted.push(cellOpenedQuoted)
    value = ""
    cellOpenedQuoted = false
  }

  const endRow = () => {
    endCell()
    columns = Math.max(columns, row.length)
    rows.push(row)
    quoted.push(rowQuoted)
    row = []
    rowQuoted = []
    started = false
  }

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!
    if (character === '"') {
      if (inQuotes && content[index + 1] === '"') {
        // A doubled quote inside a quoted cell is one literal quote.
        value += '"'
        index += 1
      } else if (inQuotes) {
        inQuotes = false
      } else if (!cellOpenedQuoted && value === "") {
        inQuotes = true
        cellOpenedQuoted = true
      } else {
        // RFC 4180 readers and Excel only give a quote its special meaning
        // where a cell starts, so `say "hi" now` is one cell holding two
        // literal quotes rather than a quoted section that swallows the comma
        // after it.
        value += '"'
      }
      started = true
    } else if (character === delimiter && !inQuotes) {
      endCell()
      started = true
    } else if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\n") {
        lf += 1
      } else if (content[index + 1] === "\n") {
        crlf += 1
        index += 1
      } else {
        cr += 1
      }
      endRow()
    } else {
      value += character
      started = true
    }
  }

  // Nothing is left over only when a line ending closed the last row off.
  const trailingNewline = !started && rows.length > 0
  if (started) endRow()

  return {
    rows,
    columns,
    quoted,
    lineEnding: dominantLineEnding(crlf, lf, cr),
    trailingNewline,
  }
}

/**
 * The separator the file used for most of its rows. A file that mixes them is
 * already inconsistent, and picking the majority is the only reading that
 * leaves a consistent file untouched.
 */
function dominantLineEnding(crlf: number, lf: number, cr: number): LineEnding {
  if (crlf > lf && crlf > cr) return "\r\n"
  if (cr > lf && cr > crlf) return "\r"
  return "\n"
}

/**
 * Writes the grid back as text. Rows are written at the width they carry, so
 * a row the user never touched keeps the cells it had and gains none.
 */
export function serializeCsv(grid: CsvGrid, delimiter = ","): string {
  const text = grid.rows
    .map((row, rowIndex) =>
      row
        .map((cell, columnIndex) =>
          quoteCell(
            cell,
            delimiter,
            grid.quoted[rowIndex]?.[columnIndex] === true
          )
        )
        .join(delimiter)
    )
    .join(grid.lineEnding)
  return grid.trailingNewline ? `${text}${grid.lineEnding}` : text
}

function quoteCell(
  value: string,
  delimiter: string,
  wasQuoted: boolean
): string {
  // Mirror the parser: a quote is only a delimiter where a cell starts, so a
  // cell quoting something mid-way reads back the same without any wrapping.
  // Everything that would read back as a different cell has to be wrapped, and
  // a cell the file already wrapped stays wrapped.
  const needsQuotes =
    wasQuoted ||
    value.startsWith('"') ||
    value.includes(delimiter) ||
    value.includes("\n") ||
    value.includes("\r")
  return needsQuotes ? `"${value.replaceAll('"', '""')}"` : value
}

/**
 * Pads every row to the same width so the grid renders as a rectangle. This is
 * for display only: the padding never reaches the grid, because a save that
 * wrote it would add cells to rows the user never opened.
 */
export function rectangular(grid: CsvGrid): string[][] {
  return grid.rows.map((row) =>
    row.length === grid.columns
      ? row
      : [...row, ...Array<string>(grid.columns - row.length).fill("")]
  )
}

/**
 * Writes one cell. Typing past the end of a short row is what makes the
 * padding in front of it real: those cells are now part of the row the user
 * edited, so they are saved with it.
 */
export function withCell(
  grid: CsvGrid,
  rowIndex: number,
  columnIndex: number,
  value: string
): CsvGrid {
  return {
    ...grid,
    rows: grid.rows.map((row, index) =>
      index === rowIndex ? replaceCell(row, columnIndex, value) : row
    ),
    columns: Math.max(grid.columns, columnIndex + 1),
  }
}

function replaceCell(
  row: string[],
  columnIndex: number,
  value: string
): string[] {
  const next = [...row]
  while (next.length < columnIndex) next.push("")
  next[columnIndex] = value
  return next
}

/** Appends a row. It has no earlier width to keep, so it starts full width. */
export function withRow(grid: CsvGrid): CsvGrid {
  const columns = Math.max(grid.columns, 1)
  return {
    ...grid,
    rows: [...grid.rows, Array<string>(columns).fill("")],
    columns,
  }
}

/**
 * Widens the grid by one column. Nothing is written into the rows yet: the new
 * column reaches the file for the rows the user fills in, because writing an
 * empty cell onto every row is the rewrite this model exists to avoid.
 */
export function withColumn(grid: CsvGrid): CsvGrid {
  return { ...grid, columns: grid.columns + 1 }
}
