import { useCallback, useState } from "react"

/**
 * Renderer-only UI state that should survive restarts (collapsed sections,
 * last-used toggles). Reads once on mount and writes through on every set;
 * runtime-owned data (selection, preferences) stays with the runtime.
 */
export function useLocalStorage<T>(
  key: string,
  initial: T,
  decode: (value: unknown) => T
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw === null ? initial : decode(JSON.parse(raw))
    } catch {
      return initial
    }
  })

  const set = useCallback(
    (next: T | ((previous: T) => T)) => {
      setValue((previous) => {
        const resolved =
          typeof next === "function"
            ? (next as (previous: T) => T)(previous)
            : next
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved))
        } catch {
          // Persistence is best-effort; the in-memory state still updates.
        }
        return resolved
      })
    },
    [key]
  )

  return [value, set] as const
}
