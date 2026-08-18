import { useCallback, useEffect, useRef } from "react"

/**
 * Returns a debounced wrapper: calls collapse until `delayMs` of quiet, then
 * `callback` runs once. A pending run is dropped on unmount or when `callback`
 * changes identity, so pass a stable callback.
 */
export function useDebouncedCallback(
  callback: () => void,
  delayMs: number
): () => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current)
        timer.current = null
      }
    },
    [callback, delayMs]
  )

  return useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
    }
    timer.current = setTimeout(() => {
      timer.current = null
      callback()
    }, delayMs)
  }, [callback, delayMs])
}
