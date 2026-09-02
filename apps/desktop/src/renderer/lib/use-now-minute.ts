import { useEffect, useState } from "react"

/** Re-renders once a minute so time-based task transitions land while the
    app just sits open. */
export function useNowMinute(): string {
  const [now, setNow] = useState(() => new Date().toISOString())
  useEffect(() => {
    const id = window.setInterval(
      () => setNow(new Date().toISOString()),
      60_000
    )
    return () => window.clearInterval(id)
  }, [])
  return now
}
