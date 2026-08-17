import { describe, expect, it } from "vitest"

import {
  minimapHasPersistentGutter,
  minimapHeightStyle,
  minimapHighlightedIndexes,
  minimapHitStripWidth,
  minimapIndexFromPointer,
  minimapPreviewText,
  minimapPreviewTranslate,
  minimapTopPercent,
  minimapTrackHeightStyle,
} from "./timeline-minimap.js"

describe("minimapHeightStyle", () => {
  it("grows by the tick spacing and caps at the viewport height", () => {
    expect(minimapHeightStyle(20)).toBe("min(152px, calc(100vh - 18rem))")
  })

  it("holds a floor so a short conversation stays hittable", () => {
    expect(minimapHeightStyle(2)).toBe("min(48px, calc(100vh - 18rem))")
    expect(minimapHeightStyle(5)).toBe("min(48px, calc(100vh - 18rem))")
  })
})

describe("minimapTrackHeightStyle", () => {
  it("keeps the stops at their spacing inside a padded hit strip", () => {
    expect(minimapTrackHeightStyle(2)).toBe("min(8px, calc(100vh - 18rem))")
    expect(minimapTrackHeightStyle(5)).toBe("min(32px, calc(100vh - 18rem))")
  })

  it("matches the strip once the rail outgrows the floor", () => {
    expect(minimapTrackHeightStyle(20)).toBe(minimapHeightStyle(20))
  })
})

describe("minimapTopPercent", () => {
  it("spreads the stops evenly from the top to the bottom", () => {
    expect(minimapTopPercent(0, 5)).toBe(0)
    expect(minimapTopPercent(2, 5)).toBe(50)
    expect(minimapTopPercent(4, 5)).toBe(100)
  })

  it("pins a lone stop to the top and clamps out-of-range indexes", () => {
    expect(minimapTopPercent(0, 1)).toBe(0)
    expect(minimapTopPercent(9, 3)).toBe(100)
    expect(minimapTopPercent(-4, 3)).toBe(0)
  })
})

describe("minimapIndexFromPointer", () => {
  const rail = { itemCount: 5, railTop: 100, railHeight: 200 }

  it("snaps to the nearest stop", () => {
    expect(minimapIndexFromPointer({ ...rail, pointerY: 100 })).toBe(0)
    expect(minimapIndexFromPointer({ ...rail, pointerY: 205 })).toBe(2)
    expect(minimapIndexFromPointer({ ...rail, pointerY: 300 })).toBe(4)
  })

  it("clamps a pointer that ran past either end", () => {
    expect(minimapIndexFromPointer({ ...rail, pointerY: -50 })).toBe(0)
    expect(minimapIndexFromPointer({ ...rail, pointerY: 9000 })).toBe(4)
  })

  it("returns null when there is nothing to point at", () => {
    expect(
      minimapIndexFromPointer({ ...rail, itemCount: 0, pointerY: 150 })
    ).toBeNull()
    expect(
      minimapIndexFromPointer({ ...rail, railHeight: 0, pointerY: 150 })
    ).toBeNull()
  })

  it("answers with the only stop when the rail holds one", () => {
    expect(
      minimapIndexFromPointer({ ...rail, itemCount: 1, pointerY: 0 })
    ).toBe(0)
  })
})

describe("minimapHighlightedIndexes", () => {
  const viewport = { top: 100, bottom: 500 }
  const highlighted = (anchors: Array<{ top: number; bottom: number }>) =>
    minimapHighlightedIndexes({
      anchorCount: anchors.length,
      anchorAt: (index) => anchors[index]!,
      viewport,
    })

  it("highlights every prompt visible in the viewport", () => {
    expect(
      highlighted([
        { top: 120, bottom: 160 },
        { top: 420, bottom: 460 },
        { top: 700, bottom: 740 },
      ])
    ).toEqual([0, 1])
  })

  it("keeps the preceding prompt highlighted through a long reply", () => {
    expect(
      highlighted([
        { top: -600, bottom: -560 },
        { top: 700, bottom: 740 },
      ])
    ).toEqual([0])
  })

  it("hands highlighting to a prompt as soon as it enters the viewport", () => {
    expect(
      highlighted([
        { top: -600, bottom: -560 },
        { top: 500, bottom: 540 },
      ])
    ).toEqual([1])
  })

  it("leaves every stop dim before the first prompt", () => {
    expect(highlighted([{ top: 700, bottom: 740 }])).toEqual([])
  })

  it("reads logarithmically many off-screen prompts", () => {
    const anchors = Array.from({ length: 64 }, (_, index) => ({
      top: index * 100,
      bottom: index * 100 + 40,
    }))
    let reads = 0

    expect(
      minimapHighlightedIndexes({
        anchorCount: anchors.length,
        anchorAt: (index) => {
          reads++
          return anchors[index]!
        },
        viewport: { top: 3150, bottom: 3190 },
      })
    ).toEqual([31])
    expect(reads).toBeLessThanOrEqual(8)
  })
})

describe("minimapHasPersistentGutter", () => {
  it("keeps the rail on screen once the gutter clears the threshold", () => {
    // 768px column, so a 96px gutter each side.
    expect(minimapHasPersistentGutter(960)).toBe(true)
  })

  it("hides the rail in a window with no room beside the column", () => {
    expect(minimapHasPersistentGutter(820)).toBe(false)
    expect(minimapHasPersistentGutter(600)).toBe(false)
    expect(minimapHasPersistentGutter(0)).toBe(false)
    expect(minimapHasPersistentGutter(Number.NaN)).toBe(false)
  })
})

describe("minimapHitStripWidth", () => {
  it("caps the hover target so it never reaches over the column", () => {
    expect(minimapHitStripWidth(1600)).toBe(40)
  })

  it("shrinks the target with the gutter", () => {
    // The column stops growing at 768px, leaving a 24px gutter here.
    expect(minimapHitStripWidth(800)).toBe(12)
  })

  it("holds the scroller's own padding once the column fills the rest", () => {
    expect(minimapHitStripWidth(700)).toBe(12)
    expect(minimapHitStripWidth(400)).toBe(12)
  })

  it("goes inert in a viewport too narrow to hold the rail", () => {
    expect(minimapHitStripWidth(24)).toBe(0)
    expect(minimapHitStripWidth(0)).toBe(0)
  })
})

describe("minimapPreviewTranslate", () => {
  it("hangs the card inward at the ends and centers it between them", () => {
    expect(minimapPreviewTranslate(0, 5)).toBe("0%")
    expect(minimapPreviewTranslate(2, 5)).toBe("-50%")
    expect(minimapPreviewTranslate(4, 5)).toBe("-100%")
  })
})

describe("minimapPreviewText", () => {
  it("folds a message into one line", () => {
    expect(minimapPreviewText("first\n\n  second   line ")).toBe(
      "first second line"
    )
  })

  it("drops markdown that only reads as noise at this size", () => {
    expect(minimapPreviewText("## Heading\n- **bold** item")).toBe(
      "Heading bold item"
    )
    expect(minimapPreviewText("run `pnpm test` now")).toBe("run pnpm test now")
    expect(minimapPreviewText("see [the docs](https://example.com)")).toBe(
      "see the docs"
    )
    expect(minimapPreviewText("```ts\nconst a = 1\n```\nafter")).toBe("after")
  })

  it("leaves snake_case identifiers alone", () => {
    expect(minimapPreviewText("rename user_id to account_id")).toBe(
      "rename user_id to account_id"
    )
  })

  it("returns null when nothing readable survives", () => {
    expect(minimapPreviewText("```ts\nconst a = 1\n```")).toBeNull()
    expect(minimapPreviewText("   ")).toBeNull()
    expect(minimapPreviewText(undefined)).toBeNull()
  })
})
