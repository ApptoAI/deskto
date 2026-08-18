import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react"
import ArrowLeftIcon from "lucide-react/dist/esm/icons/arrow-left"
import ArrowRightIcon from "lucide-react/dist/esm/icons/arrow-right"
import GlobeIcon from "lucide-react/dist/esm/icons/globe"
import MousePointer2Icon from "lucide-react/dist/esm/icons/mouse-pointer-2"
import RotateCwIcon from "lucide-react/dist/esm/icons/rotate-cw"
import type { BrowserElementContext } from "@deskto/protocol"
import type { BrowserViewState } from "../../../shared/desktop-api.js"

import { Button } from "@workspace/ui/components/button"

import {
  browserState,
  cancelBrowserElementSelection,
  hideBrowser,
  navigateBrowser,
  runBrowserAction,
  selectBrowserElement,
  showBrowser,
  subscribeBrowser,
} from "../../lib/desktop.js"
import { describedErrorSchema } from "../../runtime/describe-error.js"
import { InlineError } from "../inline-error.js"

export function BrowserPanel({
  threadId,
  selectedElementCount,
  onSelectElement,
}: {
  threadId: string
  selectedElementCount: number
  onSelectElement: (context: BrowserElementContext) => void
}) {
  const slotRef = useRef<HTMLDivElement>(null)
  const addressFocused = useRef(false)
  const [state, setState] = useState<BrowserViewState>()
  const [address, setAddress] = useState("")
  const [error, setError] = useState<string>()
  const [selecting, setSelecting] = useState(false)
  const selectionSequence = useRef(0)

  useEffect(() => {
    let active = true
    void browserState(threadId)
      .then((next) => {
        if (!active) return
        setState(next)
        setAddress(next.url)
      })
      .catch((reason) => {
        if (active) setError(describedErrorSchema.parse(reason))
      })
    const unsubscribe = subscribeBrowser((event) => {
      if (event.type !== "state" || event.state.threadId !== threadId) return
      setState(event.state)
      if (!addressFocused.current) setAddress(event.state.url)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [threadId])

  const placeBrowser = useCallback(() => {
    const slot = slotRef.current
    if (!slot) return
    const bounds = slot.getBoundingClientRect()
    if (bounds.width < 1 || bounds.height < 1) return
    void showBrowser(threadId, {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    })
      .then((next) => {
        setError(undefined)
        setState(next)
      })
      .catch((reason) => setError(describedErrorSchema.parse(reason)))
  }, [threadId])

  useLayoutEffect(() => {
    const slot = slotRef.current
    if (!slot) return
    placeBrowser()
    const observer = new ResizeObserver(placeBrowser)
    observer.observe(slot)
    window.addEventListener("resize", placeBrowser)
    return () => {
      selectionSequence.current += 1
      observer.disconnect()
      window.removeEventListener("resize", placeBrowser)
      void cancelBrowserElementSelection(threadId).catch(() => undefined)
      void hideBrowser(threadId)
    }
  }, [placeBrowser, threadId])

  async function navigate(event: FormEvent) {
    event.preventDefault()
    setError(undefined)
    try {
      setState(await navigateBrowser(threadId, address))
    } catch (reason) {
      setError(describedErrorSchema.parse(reason))
    }
  }

  async function action(value: "back" | "forward" | "reload") {
    setError(undefined)
    try {
      setState(await runBrowserAction(threadId, value))
    } catch (reason) {
      setError(describedErrorSchema.parse(reason))
    }
  }

  async function toggleElementSelection() {
    setError(undefined)
    const sequence = selectionSequence.current + 1
    selectionSequence.current = sequence
    if (selecting) {
      setSelecting(false)
      try {
        await cancelBrowserElementSelection(threadId)
      } catch (reason) {
        if (selectionSequence.current === sequence) {
          setError(describedErrorSchema.parse(reason))
        }
      }
      return
    }

    setSelecting(true)
    try {
      const context = await selectBrowserElement(threadId)
      if (selectionSequence.current === sequence && context) {
        onSelectElement(context)
      }
    } catch (reason) {
      if (selectionSequence.current === sequence) {
        setError(describedErrorSchema.parse(reason))
      }
    } finally {
      if (selectionSequence.current === sequence) setSelecting(false)
    }
  }

  const message = error ?? state?.error

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border p-2">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!state?.canGoBack}
          aria-label="Back"
          onClick={() => void action("back")}
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!state?.canGoForward}
          aria-label="Forward"
          onClick={() => void action("forward")}
        >
          <ArrowRightIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reload"
          onClick={() => void action("reload")}
        >
          <RotateCwIcon
            className={state?.loading ? "animate-spin" : undefined}
          />
        </Button>
        <Button
          variant={selecting ? "secondary" : "ghost"}
          size="icon-sm"
          disabled={
            (!selecting && (!state?.url || state.loading)) ||
            selectedElementCount >= 16
          }
          aria-label={
            selecting ? "Cancel element selection" : "Select a page element"
          }
          title={
            selecting
              ? "Cancel element selection"
              : "Add a page element to the next message"
          }
          onClick={() => void toggleElementSelection()}
        >
          <MousePointer2Icon />
        </Button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => void navigate(event)}
        >
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={() => {
              addressFocused.current = true
            }}
            onBlur={() => {
              addressFocused.current = false
            }}
            aria-label="Browser address"
            placeholder="Enter a URL or search"
            className="h-7 w-full rounded-md border border-input bg-muted/40 px-2.5 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </form>
      </div>
      {message ? (
        <div className="shrink-0 p-2">
          <InlineError message={message} />
        </div>
      ) : null}
      <div ref={slotRef} className="relative min-h-0 flex-1 bg-background">
        {!state?.url ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
            <GlobeIcon className="size-7 opacity-50" />
            <span>Open a website here, or ask the agent to use Browser.</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
