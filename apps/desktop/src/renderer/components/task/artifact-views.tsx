import { lazy, Suspense, type ComponentType, type ReactNode } from "react"
import FileIcon from "lucide-react/dist/esm/icons/file"
import FileImageIcon from "lucide-react/dist/esm/icons/file-image"
import FileSpreadsheetIcon from "lucide-react/dist/esm/icons/file-spreadsheet"
import FileTextIcon from "lucide-react/dist/esm/icons/file-text"
import FileTypeIcon from "lucide-react/dist/esm/icons/file-type"
import PanelsTopLeftIcon from "lucide-react/dist/esm/icons/panels-top-left"
import TableIcon from "lucide-react/dist/esm/icons/table"
import type { ArtifactPreview } from "@openappto/protocol"

import type { ArtifactEditorProps } from "./artifact-editor.js"

import { Markdown } from "@workspace/ui/components/chat/markdown"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

import { CsvEditor } from "./csv-editor.js"
import { CsvPreview } from "./csv-preview.js"
import { PdfPreview } from "./pdf-preview.js"
import { PreviewLoading, PreviewUnavailable } from "./preview-states.js"
import { TextEditor } from "./text-editor.js"

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

type PreviewKind = ArtifactPreview["kind"]
/**
 * The preview variant that carries this kind. `Extract` cannot do it: the
 * variants that share a payload declare several kinds at once, so matching
 * has to ask whether the kind is one of a variant's rather than its only one.
 */
type PreviewOf<K extends PreviewKind> = ArtifactPreview extends infer Variant
  ? Variant extends { kind: infer Kinds }
    ? K extends Kinds
      ? Variant
      : never
    : never
  : never
type Icon = ComponentType<{ className?: string }>

/**
 * One entry per format the Surface knows how to show. Loading, size limits,
 * and containment stay in the Runtime; an entry only decides how the result
 * looks, which icon stands for it, and which editor opens for it.
 *
 * `editor` is the one place that decides whether a format can be edited here.
 * The Runtime refuses a write it disagrees with, so a mismatch is a dead
 * action rather than a lost file.
 */
type ArtifactView<K extends PreviewKind> = {
  Icon: Icon
  editor: ComponentType<ArtifactEditorProps> | null
  render: (preview: PreviewOf<K>) => ReactNode
}

const artifactViews = {
  markdown: {
    Icon: FileTextIcon,
    editor: TextEditor,
    render: (preview) => (
      <ScrollArea className="flex-1">
        <Markdown className="p-5">{preview.content}</Markdown>
      </ScrollArea>
    ),
  },
  text: {
    Icon: FileTextIcon,
    editor: TextEditor,
    render: (preview) => (
      <ScrollArea className="flex-1">
        <pre className="p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
          {preview.content}
        </pre>
      </ScrollArea>
    ),
  },
  csv: {
    Icon: TableIcon,
    editor: CsvEditor,
    render: (preview) => <CsvPreview content={preview.content} />,
  },
  html: {
    editor: null,
    Icon: PanelsTopLeftIcon,
    render: (preview) => (
      <Suspense fallback={<PreviewLoading label="Loading page…" />}>
        <HtmlPreview content={preview.content} />
      </Suspense>
    ),
  },
  image: {
    editor: null,
    Icon: FileImageIcon,
    render: (preview) => (
      <ScrollArea className="flex-1">
        <div className="flex min-h-full items-start justify-center bg-muted/20 p-4">
          <img
            src={preview.dataUrl}
            alt="Result preview"
            className="max-h-full max-w-full rounded border border-border object-contain shadow-sm"
          />
        </div>
      </ScrollArea>
    ),
  },
  pdf: {
    editor: null,
    Icon: FileTextIcon,
    render: (preview) => <PdfPreview dataBase64={preview.dataBase64} />,
  },
  spreadsheet: {
    editor: null,
    Icon: FileSpreadsheetIcon,
    render: (preview) => (
      <Suspense fallback={<PreviewLoading label="Loading spreadsheet…" />}>
        <SpreadsheetPreview dataBase64={preview.dataBase64} />
      </Suspense>
    ),
  },
  document: {
    editor: null,
    Icon: FileTypeIcon,
    render: (preview) => (
      <Suspense fallback={<PreviewLoading label="Loading document…" />}>
        <DocumentPreview dataBase64={preview.dataBase64} />
      </Suspense>
    ),
  },
  unsupported: {
    editor: null,
    Icon: FileIcon,
    render: () => <PreviewUnavailable />,
  },
} satisfies { [K in PreviewKind]: ArtifactView<K> }

export function ArtifactIcon({
  kind,
  className,
}: {
  kind: PreviewKind
  className?: string
}) {
  const Icon = artifactViews[kind].Icon
  return <Icon className={className} />
}

/** Whether this format can be written back from the Surface at all. */
export function isEditableArtifactKind(kind: PreviewKind): boolean {
  return artifactViews[kind].editor !== null
}

/** Renders the editor this format opens with, or nothing when read-only. */
export function ArtifactEditorSlot({
  kind,
  ...props
}: { kind: PreviewKind } & ArtifactEditorProps) {
  const Editor = artifactViews[kind].editor
  return Editor ? <Editor {...props} /> : null
}

export function ArtifactPreviewBody({ preview }: { preview: ArtifactPreview }) {
  // SAFETY: `artifactViews` is keyed by the same discriminant the preview
  // carries, so the entry looked up here renders exactly this variant. The
  // mapped type cannot express that on its own.
  const render = artifactViews[preview.kind].render as (
    preview: ArtifactPreview
  ) => ReactNode
  return <>{render(preview)}</>
}
