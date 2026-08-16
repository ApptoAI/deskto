import { Component, type ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"

import { InlineError } from "../inline-error.js"

type ResultPreviewBoundaryProps = { children: ReactNode }
type ResultPreviewBoundaryState =
  | { failed: false; message: "" }
  | { failed: true; message: string }

/** Keeps one broken preview from taking down the task and the rest of Deskto. */
export class ResultPreviewBoundary extends Component<
  ResultPreviewBoundaryProps,
  ResultPreviewBoundaryState
> {
  state: ResultPreviewBoundaryState = { failed: false, message: "" }

  static getDerivedStateFromError(error: Error): ResultPreviewBoundaryState {
    return { failed: true, message: resultPreviewErrorMessage(error) }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <InlineError
          message={`Deskto could not show this preview. ${this.state.message}`}
        />
        <p className="max-w-sm text-xs text-muted-foreground">
          The file is still in the project. You can open another result or try
          this preview again.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => this.setState({ failed: false, message: "" })}
        >
          Try preview again
        </Button>
      </div>
    )
  }
}

export function resultPreviewErrorMessage(error: Error): string {
  if (error.message.trim()) return error.message
  return "The preview renderer stopped unexpectedly."
}
