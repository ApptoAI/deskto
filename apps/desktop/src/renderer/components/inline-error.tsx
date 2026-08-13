import { cn } from "@workspace/ui/lib/utils"

export function InlineError({
  message,
  className,
}: {
  message: string
  className?: string
}) {
  return (
    <p
      role="alert"
      className={cn(
        "rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive",
        className
      )}
    >
      {message}
    </p>
  )
}
