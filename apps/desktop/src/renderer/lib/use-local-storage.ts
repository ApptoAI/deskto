import { useEffect, useState } from "react"
import type { z } from "zod"

/**
 * Renderer-only UI state that should survive restarts (collapsed sections,
 * last-used toggles). Reads once on mount and writes through on every set;
 * runtime-owned data (selection, preferences) stays with the runtime.
 */
export function useLocalStorage<T>(
  key: string,
  initial: T,
  schema: z.ZodType<T>
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw === null) return initial
      const parsed = schema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Persistence is best-effort; the in-memory state still updates.
    }
  }, [key, value])

  return [value, setValue] as const
}
