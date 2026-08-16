import { describe, expect, it } from "vitest"

import {
  parseCsv,
  rectangular,
  serializeCsv,
  withCell,
  withColumn,
  withRow,
} from "./csv-model.js"

/**
 * Files the editor has to be able to open and save without touching. Every one
 * of them is checked for the round trip below, so anything the parser learns
 * to read belongs here too.
 */
const files = {
  empty: "",
  headerOnly: "name,size\n",
  trailingNewline: "a,b\nc,d\n",
  noTrailingNewline: "a,b\nc,d",
  windows: "a,b\r\nc,d\r\n",
  classicMac: "a,b\rc,d\r",
  ragged: "a,b,c\nd\n",
  bareQuotesMidCell: '1,say "hi" now',
  emptyQuotedRow: 'a\n""\n',
  emptyQuotedLastRow: 'a\n""',
  delimiterInQuotes: 'a,"b,c"\n',
  newlineInQuotes: 'a,"b\nc"\n',
  doubledQuotes: 'a,"b""c"\n',
  quotedThroughout: '"a","b"\r\n"c","d"\r\n',
  blankLine: "a,b\n\nc,d\n",
  onlyNewline: "\n",
} satisfies Record<string, string>

describe("round trip", () => {
  for (const [name, content] of Object.entries(files)) {
    it(`saves ${name} back byte for byte`, () => {
      expect(serializeCsv(parseCsv(content))).toBe(content)
    })
  }

  it("preserves a tab-delimited file and treats commas as text", () => {
    const content = 'a,b\t"c\td"\n'
    const parsed = parseCsv(content, "\t")
    expect(parsed.rows).toEqual([["a,b", "c\td"]])
    expect(serializeCsv(parsed, "\t")).toBe(content)
  })
})

describe("parseCsv", () => {
  it("reads an empty file as no rows", () => {
    const grid = parseCsv(files.empty)
    expect(grid.rows).toEqual([])
    expect(grid.columns).toBe(0)
    expect(grid.trailingNewline).toBe(false)
  })

  it("reads a header on its own", () => {
    const grid = parseCsv(files.headerOnly)
    expect(grid.rows).toEqual([["name", "size"]])
    expect(grid.trailingNewline).toBe(true)
  })

  it("records the line ending the file used", () => {
    expect(parseCsv(files.windows).lineEnding).toBe("\r\n")
    expect(parseCsv(files.classicMac).lineEnding).toBe("\r")
    expect(parseCsv(files.trailingNewline).lineEnding).toBe("\n")
    expect(parseCsv(files.bareQuotesMidCell).lineEnding).toBe("\n")
  })

  it("records whether the file ended on a line ending", () => {
    expect(parseCsv(files.trailingNewline).trailingNewline).toBe(true)
    expect(parseCsv(files.noTrailingNewline).trailingNewline).toBe(false)
  })

  it("leaves a short row short", () => {
    const grid = parseCsv(files.ragged)
    expect(grid.rows).toEqual([["a", "b", "c"], ["d"]])
    expect(grid.columns).toBe(3)
  })

  it("keeps a quote in the middle of a cell as text", () => {
    expect(parseCsv(files.bareQuotesMidCell).rows).toEqual([
      ["1", 'say "hi" now'],
    ])
  })

  it("keeps a delimiter inside a quoted cell", () => {
    expect(parseCsv(files.delimiterInQuotes).rows).toEqual([["a", "b,c"]])
  })

  it("keeps a line ending inside a quoted cell", () => {
    expect(parseCsv(files.newlineInQuotes).rows).toEqual([["a", "b\nc"]])
    expect(parseCsv('a,"b\r\nc"\r\n').rows).toEqual([["a", "b\r\nc"]])
  })

  it("reads a doubled quote as one literal quote", () => {
    expect(parseCsv(files.doubledQuotes).rows).toEqual([["a", 'b"c']])
  })

  it("keeps a last row that is one empty quoted cell", () => {
    expect(parseCsv(files.emptyQuotedLastRow).rows).toEqual([["a"], [""]])
    expect(parseCsv(files.emptyQuotedRow).rows).toEqual([["a"], [""]])
  })

  it("remembers which cells the file wrapped in quotes", () => {
    expect(parseCsv(files.quotedThroughout).quoted).toEqual([
      [true, true],
      [true, true],
    ])
    expect(parseCsv(files.trailingNewline).quoted).toEqual([
      [false, false],
      [false, false],
    ])
  })
})

describe("serializeCsv", () => {
  it("wraps a cell that would otherwise read back as something else", () => {
    const grid = parseCsv(files.headerOnly)
    expect(serializeCsv(withCell(grid, 0, 1, 'a,b\nc"d'))).toBe(
      'name,"a,b\nc""d"\n'
    )
  })

  it("wraps a cell that starts with a quote, and reads it back whole", () => {
    const written = serializeCsv(withCell(parseCsv("a\n"), 0, 0, '"quoted"'))
    expect(written).toBe('"""quoted"""\n')
    expect(parseCsv(written).rows).toEqual([['"quoted"']])
  })

  it("does not write the padding a ragged grid renders with", () => {
    const grid = parseCsv(files.ragged)
    expect(rectangular(grid)).toEqual([
      ["a", "b", "c"],
      ["d", "", ""],
    ])
    expect(serializeCsv(grid)).toBe(files.ragged)
  })
})

describe("editing", () => {
  it("writes an edited cell and leaves the rest of the file alone", () => {
    expect(serializeCsv(withCell(parseCsv(files.windows), 1, 0, "x"))).toBe(
      "a,b\r\nx,d\r\n"
    )
  })

  it("fills in the cells before one typed past the end of a short row", () => {
    expect(serializeCsv(withCell(parseCsv(files.ragged), 1, 2, "x"))).toBe(
      "a,b,c\nd,,x\n"
    )
  })

  it("keeps a cell wrapped once the file wrapped it", () => {
    expect(
      serializeCsv(withCell(parseCsv(files.quotedThroughout), 0, 0, "z"))
    ).toBe('"z","b"\r\n"c","d"\r\n')
  })

  it("adds a row at the width of the grid", () => {
    const grid = withRow(parseCsv(files.trailingNewline))
    expect(grid.rows).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["", ""],
    ])
    expect(serializeCsv(grid)).toBe("a,b\nc,d\n,\n")
  })

  it("adds a row to an empty file", () => {
    expect(withRow(parseCsv(files.empty)).rows).toEqual([[""]])
  })

  it("shows an added column but writes it only where it was filled in", () => {
    const grid = withColumn(parseCsv(files.trailingNewline))
    expect(grid.columns).toBe(3)
    expect(rectangular(grid)).toEqual([
      ["a", "b", ""],
      ["c", "d", ""],
    ])
    expect(serializeCsv(grid)).toBe(files.trailingNewline)
    expect(serializeCsv(withCell(grid, 0, 2, "e"))).toBe("a,b,e\nc,d\n")
  })
})
