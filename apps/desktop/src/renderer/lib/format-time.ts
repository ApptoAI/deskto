const minute = 60_000
const hour = 60 * minute
const day = 24 * hour
const week = 7 * day

/** Compact age used in the task list, e.g. "3m", "2h", "5d". */
export function formatAge(isoDate: string, now = Date.now()): string {
  const timestamp = Date.parse(isoDate)
  if (Number.isNaN(timestamp)) return ""

  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < minute) return "now"
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m`
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h`
  if (elapsed < week) return `${Math.floor(elapsed / day)}d`
  return `${Math.floor(elapsed / week)}w`
}

export function formatExactTime(isoDate: string): string {
  const timestamp = Date.parse(isoDate)
  if (Number.isNaN(timestamp)) return ""

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp)
}
