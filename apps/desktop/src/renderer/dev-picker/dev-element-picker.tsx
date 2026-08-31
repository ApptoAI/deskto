import {
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Eraser,
  Hand,
  MessageSquarePlus,
  MousePointer2,
  Pencil,
  Scan,
  Trash2,
  type LucideIcon,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  describeDevPickerElement,
  serializeDevPickerBrief,
  type DevPickerRegion,
  type DevPickerStroke,
} from "./dev-picker-context.js"

type PickerMode =
  | "notation"
  | "select"
  | "region"
  | "draw"
  | "erase"
  | "interact"

type Mark = {
  id: number
  element: HTMLElement
  note: string
}

type Point = { x: number; y: number }

type DraftRegion = { start: Point; end: Point }

const annotationColor = "#8b5cf6"
const pickerUiSelector = "[data-dev-picker-ui]"
const actionAttribute = "data-dev-picker-action"

const modeIcons = {
  notation: MessageSquarePlus,
  select: MousePointer2,
  region: Scan,
  draw: Pencil,
  erase: Eraser,
  interact: Hand,
} satisfies Record<PickerMode, LucideIcon>

const modeLabels = {
  notation: "Add notation",
  select: "Select elements",
  region: "Mark region",
  draw: "Draw",
  erase: "Erase",
  interact: "Interact",
} satisfies Record<PickerMode, string>

const modeShortcuts = {
  notation: "N",
  select: "S",
  region: "R",
  draw: "D",
  erase: "E",
  interact: "V",
} satisfies Record<PickerMode, string>

const pickerModes = [
  "notation",
  "select",
  "region",
  "draw",
  "erase",
  "interact",
] as const satisfies readonly PickerMode[]

function keyboardModeForKey(key: string) {
  switch (key.toLowerCase()) {
    case "n":
      return "notation"
    case "s":
      return "select"
    case "r":
      return "region"
    case "d":
      return "draw"
    case "e":
      return "erase"
    case "v":
      return "interact"
    default:
      return undefined
  }
}

function normalizeRegion(region: DraftRegion): DevPickerRegion {
  return {
    x: Math.min(region.start.x, region.end.x),
    y: Math.min(region.start.y, region.end.y),
    width: Math.abs(region.end.x - region.start.x),
    height: Math.abs(region.end.y - region.start.y),
  }
}

function elementAtPoint(x: number, y: number) {
  const element = document.elementFromPoint(x, y)
  if (!(element instanceof HTMLElement) || element.closest(pickerUiSelector)) {
    return undefined
  }
  return element
}

function parentElementOf(element: HTMLElement) {
  let node: Element | null = element.parentElement
  while (node && !(node instanceof HTMLElement)) node = node.parentElement
  return node ?? undefined
}

function firstDescendantOf(element: HTMLElement) {
  let node = element.firstElementChild
  while (node) {
    if (node instanceof HTMLElement) return node
    node = node.firstElementChild
  }
  return undefined
}

function strokePath(stroke: DevPickerStroke) {
  return stroke.points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ")
}

function pointInRegion(point: Point, region: DevPickerRegion) {
  return (
    point.x >= region.x &&
    point.x <= region.x + region.width &&
    point.y >= region.y &&
    point.y <= region.y + region.height
  )
}

function strokeContainsPoint(point: Point, stroke: DevPickerStroke) {
  return stroke.points.some(
    (strokePoint) =>
      Math.hypot(strokePoint.x - point.x, strokePoint.y - point.y) <= 12
  )
}

function clampX(x: number, width: number) {
  return Math.min(Math.max(x, 8), window.innerWidth - width - 8)
}

export function DevElementPicker() {
  const [appDark, setAppDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  )
  const [expanded, setExpanded] = useState(false)
  const [mode, setMode] = useState<PickerMode>("notation")
  const [active, setActive] = useState(false)
  const [marks, setMarks] = useState<Mark[]>([])
  const [drafts, setDrafts] = useState<Mark[]>([])
  const [regions, setRegions] = useState<DevPickerRegion[]>([])
  const [strokes, setStrokes] = useState<DevPickerStroke[]>([])
  const [hovered, setHovered] = useState<HTMLElement>()
  const [draftRegion, setDraftRegion] = useState<DraftRegion>()
  const [draftStroke, setDraftStroke] = useState<DevPickerStroke>()
  const [layoutVersion, setLayoutVersion] = useState(0)
  const [copied, setCopied] = useState(false)
  const nextId = useRef(1)
  const pointerDown = useRef(false)
  const lastPointer = useRef<Point>({ x: 0, y: 0 })
  const actionsRef = useRef<(action: string) => void>(() => undefined)

  const selecting = active && (mode === "notation" || mode === "select")
  const annotationCount =
    marks.length + drafts.length + regions.length + strokes.length
  const ModeIcon = modeIcons[mode]

  // The blob inverts the Surface palette: dark app, light blob. The theme is
  // a class on the document element, so a mutation observer follows it.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setAppDark(document.documentElement.classList.contains("dark"))
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
    return () => observer.disconnect()
  }, [])

  // Annotation boxes are positioned from live element rects, so every scroll
  // or resize needs one rerender to re-measure them.
  useEffect(() => {
    const updateLayout = () => setLayoutVersion((version) => version + 1)
    window.addEventListener("resize", updateLayout)
    document.addEventListener("scroll", updateLayout, true)
    return () => {
      window.removeEventListener("resize", updateLayout)
      document.removeEventListener("scroll", updateLayout, true)
    }
  }, [])

  const pick = useCallback(
    (element: HTMLElement, additive: boolean) => {
      if (marks.some((mark) => mark.element === element)) {
        setMarks((current) =>
          current.filter((mark) => mark.element !== element)
        )
        return
      }
      if (mode === "notation") {
        setDrafts((current) => {
          const draft = { id: nextId.current++, element, note: "" }
          return additive ? [...current, draft] : [draft]
        })
        return
      }
      setMarks((current) => {
        const mark = { id: nextId.current++, element, note: "" }
        return additive ? [...current, mark] : [mark]
      })
    },
    [mode, marks]
  )

  const commitDraft = useCallback((draft: Mark) => {
    setDrafts((current) => current.filter((item) => item.id !== draft.id))
    if (!draft.element.isConnected) return
    setMarks((current) =>
      current.some((mark) => mark.element === draft.element)
        ? current
        : [...current, draft]
    )
  }, [])

  const copyBrief = useCallback(async () => {
    const brief = serializeDevPickerBrief({
      instruction: "",
      selections: [...marks, ...drafts]
        .filter(({ element }) => element.isConnected)
        .map(({ element, note }) => ({
          ...describeDevPickerElement(element),
          note: note || undefined,
        })),
      regions,
      strokes,
    })
    await navigator.clipboard.writeText(brief)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_600)
  }, [drafts, marks, regions, strokes])

  // The picker's pointer shield runs on window capture, above every listener
  // the app can register, so the app's outside-click handlers never see an
  // interaction with the blob, dock, or note inputs. React's own delegated
  // listeners sit below that shield, so dock buttons dispatch through a
  // native action attribute instead of onClick.
  useEffect(() => {
    actionsRef.current = (action: string) => {
      if (action === "toggle") {
        if (active) {
          setActive(false)
          setHovered(undefined)
          return
        }
        if (mode === "interact") setMode("notation")
        setActive(true)
        return
      }
      if (action === "expand") return setExpanded(true)
      if (action === "collapse") return setExpanded(false)
      if (action === "clear") {
        setMarks([])
        setDrafts([])
        setRegions([])
        setStrokes([])
        setHovered(undefined)
        return
      }
      if (action === "copy") return void copyBrief()
      if (action.startsWith("mode:")) {
        // SAFETY: the attribute is written as `mode:<key>` from pickerModes,
        // so the slice is one of those keys.
        const nextMode = action.slice(5) as PickerMode
        setMode(nextMode)
        setHovered(undefined)
        setActive(nextMode !== "interact")
      }
    }
  })

  // Mode shortcuts and the global exits. Text fields keep their own keys.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault()
        event.stopPropagation()
        void copyBrief()
        return
      }
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return
      }
      if (event.key === "Escape") {
        if (drafts.length > 0) setDrafts([])
        else if (active) {
          setActive(false)
          setHovered(undefined)
        } else if (expanded) setExpanded(false)
        else return
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const keyboardMode = keyboardModeForKey(event.key)
      if (keyboardMode) {
        event.stopPropagation()
        setMode(keyboardMode)
        setHovered(undefined)
        setActive(keyboardMode !== "interact")
      }
    }
    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [active, copyBrief, drafts.length, expanded])

  // Arrow navigation over the live DOM while a selection mode is armed.
  useEffect(() => {
    if (!selecting) return
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault()
        event.stopPropagation()
        setHovered((current) => {
          const base =
            current ??
            elementAtPoint(lastPointer.current.x, lastPointer.current.y)
          if (!base) return current
          return event.key === "ArrowUp"
            ? (parentElementOf(base) ?? base)
            : (firstDescendantOf(base) ?? base)
        })
        return
      }
      if (event.key === "Enter" && hovered) {
        event.preventDefault()
        event.stopPropagation()
        pick(hovered, event.shiftKey)
      }
    }
    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [hovered, pick, selecting])

  useEffect(() => {
    const insidePickerUi = (target: EventTarget | null) =>
      target instanceof Element && target.closest(pickerUiSelector)

    const eraseAt = (point: Point) => {
      const draft = [...drafts]
        .reverse()
        .find(({ element }) =>
          pointInRegion(point, element.getBoundingClientRect())
        )
      if (draft) {
        setDrafts((current) => current.filter((item) => item.id !== draft.id))
        return
      }
      const mark = [...marks]
        .reverse()
        .find(({ element }) =>
          pointInRegion(point, element.getBoundingClientRect())
        )
      if (mark) {
        setMarks((current) => current.filter((item) => item.id !== mark.id))
        return
      }
      const reversedRegionIndex = [...regions]
        .reverse()
        .findIndex((region) => pointInRegion(point, region))
      if (reversedRegionIndex >= 0) {
        const regionIndex = regions.length - reversedRegionIndex - 1
        setRegions((current) =>
          current.filter((_, index) => index !== regionIndex)
        )
        return
      }
      const reversedStrokeIndex = [...strokes]
        .reverse()
        .findIndex((stroke) => strokeContainsPoint(point, stroke))
      if (reversedStrokeIndex >= 0) {
        const strokeIndex = strokes.length - reversedStrokeIndex - 1
        setStrokes((current) =>
          current.filter((_, index) => index !== strokeIndex)
        )
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      lastPointer.current = { x: event.clientX, y: event.clientY }
      if (insidePickerUi(event.target)) {
        if (selecting) setHovered(undefined)
        event.stopImmediatePropagation()
        return
      }
      if (!active) return
      event.stopImmediatePropagation()
      if (selecting) {
        setHovered(elementAtPoint(event.clientX, event.clientY))
        return
      }
      if (!pointerDown.current) return
      if (mode === "region") {
        setDraftRegion((current) =>
          current
            ? { ...current, end: { x: event.clientX, y: event.clientY } }
            : current
        )
      }
      if (mode === "draw") {
        setDraftStroke((current) =>
          current
            ? {
                points: [
                  ...current.points,
                  { x: event.clientX, y: event.clientY },
                ],
              }
            : current
        )
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (insidePickerUi(event.target)) {
        // Focus, caret placement, and text selection inside the picker's own
        // fields are default actions, so only propagation is stopped here.
        event.stopImmediatePropagation()
        return
      }
      if (!active) return
      event.preventDefault()
      event.stopImmediatePropagation()
      pointerDown.current = true
      const point = { x: event.clientX, y: event.clientY }

      if (selecting) {
        const element = elementAtPoint(point.x, point.y)
        if (element) pick(element, event.shiftKey)
        return
      }
      if (mode === "region") setDraftRegion({ start: point, end: point })
      if (mode === "draw") setDraftStroke({ points: [point] })
      if (mode === "erase") eraseAt(point)
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (!pointerDown.current) {
        if (insidePickerUi(event.target)) event.stopImmediatePropagation()
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      pointerDown.current = false
      if (mode === "region") {
        setDraftRegion((current) => {
          if (!current) return undefined
          const region = normalizeRegion(current)
          if (region.width >= 6 && region.height >= 6) {
            setRegions((existing) => [...existing, region])
          }
          return undefined
        })
      }
      if (mode === "draw") {
        setDraftStroke((current) => {
          if (current && current.points.length > 1) {
            setStrokes((existing) => [...existing, current])
          }
          return undefined
        })
      }
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target
      if (insidePickerUi(target)) {
        event.stopImmediatePropagation()
        const actionTarget =
          target instanceof Element
            ? target.closest(`[${actionAttribute}]`)
            : null
        if (actionTarget) {
          actionsRef.current(actionTarget.getAttribute(actionAttribute) ?? "")
        }
        return
      }
      if (active) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }

    window.addEventListener("pointermove", handlePointerMove, true)
    window.addEventListener("pointerdown", handlePointerDown, true)
    window.addEventListener("pointerup", handlePointerUp, true)
    window.addEventListener("click", handleClick, true)
    return () => {
      window.removeEventListener("pointermove", handlePointerMove, true)
      window.removeEventListener("pointerdown", handlePointerDown, true)
      window.removeEventListener("pointerup", handlePointerUp, true)
      window.removeEventListener("click", handleClick, true)
    }
  }, [active, drafts, marks, mode, pick, regions, selecting, strokes])

  void layoutVersion

  const markRects = marks
    .filter(({ element }) => element.isConnected)
    .map((mark, index) => ({
      mark,
      index,
      rect: mark.element.getBoundingClientRect(),
    }))
  const draftRects = drafts
    .filter(({ element }) => element.isConnected)
    .map((draft, index) => ({
      draft,
      number: marks.length + index + 1,
      rect: draft.element.getBoundingClientRect(),
    }))
  const hoverRect =
    selecting && hovered?.isConnected
      ? hovered.getBoundingClientRect()
      : undefined
  const normalizedDraftRegion = draftRegion
    ? normalizeRegion(draftRegion)
    : undefined

  return (
    <div
      className="dev-picker-layer"
      data-dev-picker-ui
      data-app-dark={appDark}
    >
      {hoverRect ? (
        <>
          <div
            className="dev-picker-hover-box"
            style={{
              left: hoverRect.x,
              top: hoverRect.y,
              width: hoverRect.width,
              height: hoverRect.height,
            }}
          />
          <span
            className="dev-picker-hover-chip"
            style={{
              left: clampX(hoverRect.x, 160),
              top: Math.max(hoverRect.y - 20, 4),
            }}
          >
            {hovered?.tagName.toLowerCase()}
          </span>
        </>
      ) : null}

      {markRects.map(({ mark, index, rect }) => (
        <div
          key={mark.id}
          className="dev-picker-selection-box"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
        >
          <span>{index + 1}</span>
        </div>
      ))}

      {draftRects.map(({ draft, number: index, rect }) => (
        <div
          key={draft.id}
          className="dev-picker-draft-box"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
        >
          <span>{index}</span>
        </div>
      ))}

      {[
        ...regions,
        ...(normalizedDraftRegion ? [normalizedDraftRegion] : []),
      ].map((region, index) => (
        <div
          key={`${region.x}-${region.y}-${index}`}
          className="dev-picker-region-box"
          style={{
            left: region.x,
            top: region.y,
            width: region.width,
            height: region.height,
          }}
        />
      ))}

      <svg className="dev-picker-drawing" aria-hidden="true">
        {[...strokes, ...(draftStroke ? [draftStroke] : [])].map(
          (stroke, index) => (
            <path
              key={index}
              d={strokePath(stroke)}
              fill="none"
              stroke={annotationColor}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )
        )}
      </svg>

      {draftRects.map(({ draft, rect }) => {
        const flip = rect.bottom + 160 > window.innerHeight
        return (
          <div
            key={draft.id}
            className="dev-picker-note"
            style={{
              left: clampX(rect.x, 224),
              top: flip ? undefined : rect.bottom + 8,
              bottom: flip ? window.innerHeight - rect.top + 8 : undefined,
            }}
          >
            <textarea
              autoFocus
              rows={2}
              value={draft.note}
              placeholder="What should change here?"
              onChange={(event) =>
                setDrafts((current) =>
                  current.map((item) =>
                    item.id === draft.id
                      ? { ...item, note: event.target.value }
                      : item
                  )
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  event.stopPropagation()
                  commitDraft(draft)
                }
                if (event.key === "Escape") {
                  event.stopPropagation()
                  setDrafts((current) =>
                    current.filter((item) => item.id !== draft.id)
                  )
                }
              }}
            />
          </div>
        )
      })}

      {expanded ? (
        <aside className="dev-picker-dock" aria-label="Development annotations">
          {pickerModes.map((key) => {
            const Icon = modeIcons[key]
            return (
              <button
                key={key}
                type="button"
                data-dev-picker-action={`mode:${key}`}
                className="dev-picker-icon-button"
                data-active={mode === key || undefined}
                aria-label={`${modeLabels[key]} (${modeShortcuts[key]})`}
                data-tip={`${modeLabels[key]} · ${modeShortcuts[key]}`}
              >
                <Icon size={15} />
              </button>
            )
          })}
          <span className="dev-picker-divider" />
          <button
            type="button"
            data-dev-picker-action="clear"
            className="dev-picker-icon-button"
            aria-label="Clear annotations"
            data-tip="Clear all"
            disabled={annotationCount === 0}
          >
            <Trash2 size={15} />
          </button>
          <button
            type="button"
            data-dev-picker-action="copy"
            className="dev-picker-icon-button dev-picker-copy"
            aria-label="Copy annotation brief"
            data-tip="Copy brief · ⌘Enter"
            disabled={annotationCount === 0}
          >
            {copied ? <Check size={15} /> : <Clipboard size={15} />}
            {annotationCount > 0 ? (
              <span className="dev-picker-badge">{annotationCount}</span>
            ) : null}
          </button>
          <button
            type="button"
            data-dev-picker-action="collapse"
            className="dev-picker-icon-button"
            aria-label="Collapse to blob"
            data-tip="Collapse"
          >
            <ChevronDown size={15} />
          </button>
        </aside>
      ) : (
        <div className="dev-picker-blob">
          {annotationCount > 0 && !active ? (
            <span className="dev-picker-badge">{annotationCount}</span>
          ) : null}
          <button
            type="button"
            data-dev-picker-action="toggle"
            data-active={active || undefined}
            aria-label={`${modeLabels[mode]} — ${active ? "stop" : "start"}`}
            data-tip={`${modeLabels[mode]} · ${modeShortcuts[mode]}`}
          >
            <ModeIcon size={16} />
          </button>
          <button
            type="button"
            data-dev-picker-action="expand"
            aria-label="Expand annotations dock"
            data-tip="Expand"
          >
            <ChevronUp size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
