import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import FileIcon from "lucide-react/dist/esm/icons/file"
import FileImageIcon from "lucide-react/dist/esm/icons/file-image"
import FileSpreadsheetIcon from "lucide-react/dist/esm/icons/file-spreadsheet"
import FileTextIcon from "lucide-react/dist/esm/icons/file-text"
import PanelsTopLeftIcon from "lucide-react/dist/esm/icons/panels-top-left"
import TableIcon from "lucide-react/dist/esm/icons/table"
import XIcon from "lucide-react/dist/esm/icons/x"
import type { Artifact, ArtifactPreview } from "@openappto/protocol"

import { Button } from "@workspace/ui/components/button"
import { Markdown } from "@workspace/ui/components/chat/markdown"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"

import { useRuntimeClient } from "../../runtime/runtime-client-context.js"
import { useRuntimeEvent } from "../../runtime/use-runtime-event.js"
import { useRuntimeQuery } from "../../runtime/use-runtime-query.js"
import { InlineError } from "../inline-error.js"
import { base64ToArrayBuffer } from "./preview-bytes.js"
import {
  visibleColumnLimit,
  visibleRowLimit,
} from "./spreadsheet-preview-data.js"

const SpreadsheetPreview = lazy(() =>
  import("./spreadsheet-preview.js").then((module) => ({
    default: module.SpreadsheetPreview,
  }))
)
const DocumentPreview = lazy(() =>
  import("./document-preview.js").then((module) => ({
    default: module.DocumentPreview,
  }))
)
const HtmlPreview = lazy(() =>
  import("./html-preview.js").then((module) => ({
    default: module.HtmlPreview,
  }))
)

export function ResultsPanel({
  threadId,
  onClose,
}: {
  threadId: string
  onClose: () => void
}) {
  const client = useRuntimeClient()
  const loadResults = useCallback(
    () => client.listResults(threadId),
    [client, threadId]
  )
  const results = useRuntimeQuery(loadResults)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const outputList =
    results.state.status === "ready" ? results.state.data : undefined
  const effectiveSelectedId =
    selectedId &&
    outputList?.some((output) => output.artifact.id === selectedId)
      ? selectedId
      : (outputList?.[0]?.artifact.id ?? null)

  const selected = outputList?.find(
    (output) => output.artifact.id === effectiveSelectedId
  )?.artifact
  const selectedUpdatedAt = selected?.updatedAt
  const loadPreview = useMemo(() => {
    const artifactVersion = selectedUpdatedAt
    return effectiveSelectedId
      ? () => {
          // A changed version replaces this loader and refreshes the preview
          // after artifact.changed has invalidated the result list.
          void artifactVersion
          return client.previewArtifact(effectiveSelectedId)
        }
      : null
  }, [client, effectiveSelectedId, selectedUpdatedAt])
  const preview = useRuntimeQuery(loadPreview)
  const revalidateResults = results.revalidate
  useRuntimeEvent(
    "artifact.changed",
    useCallback(
      (event) => {
        if (event.threadId !== threadId) return
        revalidateResults()
      },
      [revalidateResults, threadId]
    )
  )

  return (
    <aside className="flex h-full w-[min(42vw,36rem)] min-w-80 shrink-0 flex-col border-l border-border bg-background">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Results</h2>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close results"
        >
          <XIcon />
        </Button>
      </header>

      {results.state.status === "error" ? (
        <div className="p-3">
          <InlineError message={results.state.message} />
        </div>
      ) : outputList?.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          Files created or changed by this task will appear here.
        </div>
      ) : (
        <>
          <div className="max-h-44 shrink-0 overflow-y-auto border-b border-border p-2">
            {outputList?.map((output) => (
              <ResultRow
                key={output.artifact.id}
                artifact={output.artifact}
                selected={output.artifact.id === effectiveSelectedId}
                onSelect={() => setSelectedId(output.artifact.id)}
              />
            ))}
            {results.state.status === "loading" ||
            results.state.status === "idle" ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                Loading results…
              </p>
            ) : null}
          </div>

          <div className="min-h-0 flex-1">
            {selected ? (
              <PreviewPane artifact={selected} state={preview.state} />
            ) : null}
          </div>
        </>
      )}
    </aside>
  )
}

function ResultRow({
  artifact,
  selected,
  onSelect,
}: {
  artifact: Artifact
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50",
        selected && "bg-muted"
      )}
    >
      <ArtifactIcon artifact={artifact} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">
          {artifact.name}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {artifact.relativePath} · {formatBytes(artifact.sizeBytes)}
        </span>
      </span>
    </button>
  )
}

function PreviewPane({
  artifact,
  state,
}: {
  artifact: Artifact
  state:
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: ArtifactPreview }
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-4 py-2">
        <p className="truncate text-xs font-medium">{artifact.name}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {artifact.relativePath}
        </p>
      </div>
      {state.status === "error" ? (
        <div className="p-3">
          <InlineError message={state.message} />
        </div>
      ) : state.status !== "ready" ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading preview…
        </div>
      ) : (
        <ArtifactPreviewPane
          key={`${artifact.id}:${artifact.updatedAt}`}
          preview={state.data}
        />
      )}
    </div>
  )
}

function ArtifactPreviewPane({ preview }: { preview: ArtifactPreview }) {
  if (preview.kind === "image") {
    return (
      <ScrollArea className="flex-1">
        <div className="flex min-h-full items-start justify-center bg-muted/20 p-4">
          <img
            src={preview.dataUrl}
            alt="Result preview"
            className="max-h-full max-w-full rounded border border-border object-contain shadow-sm"
          />
        </div>
      </ScrollArea>
    )
  }
  if (preview.kind === "pdf") {
    return <PdfPreview dataBase64={preview.dataBase64} />
  }
  if (preview.kind === "spreadsheet") {
    return (
      <Suspense fallback={<PreviewLoading label="Loading spreadsheet…" />}>
        <SpreadsheetPreview dataBase64={preview.dataBase64} />
      </Suspense>
    )
  }
  if (preview.kind === "document") {
    return (
      <Suspense fallback={<PreviewLoading label="Loading document…" />}>
        <DocumentPreview dataBase64={preview.dataBase64} />
      </Suspense>
    )
  }
  if (preview.kind === "html") {
    return (
      <Suspense fallback={<PreviewLoading label="Loading page…" />}>
        <HtmlPreview content={preview.content} />
      </Suspense>
    )
  }
  if (preview.kind === "markdown") {
    return (
      <ScrollArea className="flex-1">
        <Markdown className="p-5">{preview.content}</Markdown>
      </ScrollArea>
    )
  }
  if (preview.kind === "csv") {
    return <CsvPreview content={preview.content} />
  }
  if (preview.kind === "text") {
    return (
      <ScrollArea className="flex-1">
        <pre className="p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
          {preview.content}
        </pre>
      </ScrollArea>
    )
  }
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
      A preview is not available for this file type. You can open it from the
      project folder.
    </div>
  )
}

function PdfPreview({ dataBase64 }: { dataBase64: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const decoded = useMemo(() => {
    try {
      return {
        ok: true as const,
        bytes: new Uint8Array(base64ToArrayBuffer(dataBase64)),
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }, [dataBase64])
  const bytes = decoded.ok ? decoded.bytes : undefined

  useEffect(() => {
    if (!bytes) return
    const nextUrl = URL.createObjectURL(
      new Blob([bytes], { type: "application/pdf" })
    )
    const frame = frameRef.current
    if (frame) frame.src = nextUrl
    return () => {
      if (frame) frame.removeAttribute("src")
      URL.revokeObjectURL(nextUrl)
    }
  }, [bytes])

  if (!decoded.ok) {
    return (
      <div className="p-3">
        <InlineError message={`Could not read this PDF. ${decoded.message}`} />
      </div>
    )
  }

  return (
    <iframe
      ref={frameRef}
      sandbox="allow-scripts"
      title="PDF result preview"
      className="size-full border-0 bg-white"
    />
  )
}

function CsvPreview({ content }: { content: string }) {
  const parsed = useMemo(() => parseCsv(content), [content])
  const { rows, maxColumns } = parsed
  const width = Math.min(
    visibleColumnLimit,
    rows.reduce((largest, row) => Math.max(largest, row.length), 0)
  )
  const rowsLimited = rows.length === visibleRowLimit
  const columnsLimited = maxColumns > visibleColumnLimit
  return (
    <ScrollArea className="flex-1">
      <table className="w-max min-w-full border-collapse text-xs">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className={rowIndex === 0 ? "bg-muted/60" : ""}>
              {Array.from({ length: width }, (_, columnIndex) => {
                const Cell = rowIndex === 0 ? "th" : "td"
                return (
                  <Cell
                    key={columnIndex}
                    className="max-w-72 border-r border-b border-border px-2 py-1.5 text-left font-normal break-words"
                  >
                    {row[columnIndex] ?? ""}
                  </Cell>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rowsLimited || columnsLimited ? (
        <p className="p-3 text-xs text-muted-foreground">
          {csvPreviewLimitMessage(rowsLimited, columnsLimited)}
        </p>
      ) : null}
    </ScrollArea>
  )
}

function parseCsv(content: string): {
  rows: string[][]
  maxColumns: number
} {
  const rows: string[][] = []
  let row: string[] = []
  let value = ""
  let quoted = false
  let maxColumns = 0
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === "," && !quoted) {
      row.push(value)
      value = ""
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1
      row.push(value)
      maxColumns = Math.max(maxColumns, row.length)
      rows.push(row.slice(0, visibleColumnLimit))
      row = []
      value = ""
      if (rows.length === visibleRowLimit) return { rows, maxColumns }
    } else {
      value += character
    }
  }
  if (value !== "" || row.length > 0) {
    row.push(value)
    maxColumns = Math.max(maxColumns, row.length)
    rows.push(row.slice(0, visibleColumnLimit))
  }
  return { rows, maxColumns }
}

function csvPreviewLimitMessage(
  rowsLimited: boolean,
  columnsLimited: boolean
): string {
  if (rowsLimited && columnsLimited) {
    return `Preview limited to the first ${visibleRowLimit} rows and ${visibleColumnLimit} columns.`
  }
  if (rowsLimited) {
    return `Preview limited to the first ${visibleRowLimit} rows.`
  }
  return `Preview limited to the first ${visibleColumnLimit} columns.`
}

function ArtifactIcon({ artifact }: { artifact: Artifact }) {
  const className = "size-4 shrink-0 text-muted-foreground"
  if (artifact.previewKind === "image")
    return <FileImageIcon className={className} />
  if (artifact.previewKind === "csv") return <TableIcon className={className} />
  if (artifact.previewKind === "spreadsheet")
    return <FileSpreadsheetIcon className={className} />
  if (artifact.previewKind === "html")
    return <PanelsTopLeftIcon className={className} />
  if (
    artifact.previewKind === "text" ||
    artifact.previewKind === "markdown" ||
    artifact.previewKind === "pdf" ||
    artifact.previewKind === "document"
  ) {
    return <FileTextIcon className={className} />
  }
  return <FileIcon className={className} />
}

function PreviewLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}
