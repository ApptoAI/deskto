import { InlineError } from "../inline-error.js"

export function PreviewLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  )
}

export function PreviewFailure({ message }: { message: string }) {
  return (
    <div className="p-3">
      <InlineError message={message} />
    </div>
  )
}

/**
 * Shown for formats Deskto does not render. The wording stays about the file
 * rather than the viewer: the user still has the real application.
 */
export function PreviewUnavailable({ reason }: { reason?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
      <p className="text-sm text-muted-foreground">
        {reason ?? "Deskto cannot show this file type."}
      </p>
      <p className="text-xs text-muted-foreground">
        Open it in its own application or save a copy.
      </p>
    </div>
  )
}
