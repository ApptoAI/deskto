import { isActivityBlocked, type Thread } from "@deskto/protocol"

/**
 * The task inbox (ADR 0007): pure classification over thread records, shared
 * by every Surface. The Runtime stores facts and enforces the same guards;
 * everything here is derived, so two clients reading the same records always
 * agree on section membership.
 */

const DAY_MS = 24 * 60 * 60 * 1_000
const HOUR_MS = 60 * 60 * 1_000

/** Quiet days before a task closes itself. Becomes a setting later. */
export const autoDoneAfterDays = 3

/** NaN-safe Date.parse: a malformed timestamp must not poison a comparison
    or a sort, so it sinks to the epoch instead. */
export function parseTimestampMs(isoDate: string | null | undefined): number {
  if (isoDate == null) return 0
  const parsed = Date.parse(isoDate)
  return Number.isNaN(parsed) ? 0 : parsed
}

function isAfter(candidate: string | null, reference: string | null): boolean {
  if (candidate == null) return false
  const candidateMs = Date.parse(candidate)
  if (Number.isNaN(candidateMs)) return false
  if (reference == null) return true
  return candidateMs > parseTimestampMs(reference)
}

/** When the task last saw real activity, for the auto-close rule. */
export function threadLastActivityAt(
  thread: Pick<Thread, "lastUserMessageAt" | "lastTurnCompletedAt">
): string | null {
  const candidates = [thread.lastUserMessageAt, thread.lastTurnCompletedAt]
  let latest: string | null = null
  let latestMs = Number.NEGATIVE_INFINITY
  for (const candidate of candidates) {
    if (candidate == null) continue
    const parsed = Date.parse(candidate)
    if (!Number.isNaN(parsed) && parsed > latestMs) {
      latest = candidate
      latestMs = parsed
    }
  }
  return latest
}

/**
 * A completion the user has not seen. This is a separate axis from status:
 * it says the task needs a look, not what the task is doing.
 */
export function hasUnreadCompletion(
  thread: Pick<Thread, "lastTurnCompletedAt" | "lastVisitedAt">
): boolean {
  return isAfter(thread.lastTurnCompletedAt, thread.lastVisitedAt)
}

type SnoozeShell = Pick<
  Thread,
  "status" | "snoozedUntil" | "snoozedAt" | "lastTurnCompletedAt" | "failedAt"
>

/**
 * Something happened that outranks the snooze: the agent is blocked on the
 * user, the task failed after the snooze was set, or a turn completed after
 * it. A failure older than the snooze does not wake — that snooze was the
 * user saying "seen it, not now". failedAt is the dedicated failure edge;
 * updatedAt would not do, since profile and session writes bump it too.
 */
export function threadRaisedHandWhileSnoozed(shell: SnoozeShell): boolean {
  if (shell.status === "waiting-approval") return true
  if (shell.status === "failed" && isAfter(shell.failedAt, shell.snoozedAt)) {
    return true
  }
  return (
    shell.snoozedAt != null &&
    isAfter(shell.lastTurnCompletedAt, shell.snoozedAt)
  )
}

/**
 * Hidden on the Later shelf: wake time still ahead and no raised hand. No
 * Runtime event fires at the wake time; the stale fields simply stop
 * classifying the task as snoozed.
 */
export function effectiveSnoozed(
  shell: SnoozeShell,
  options: { readonly now: string }
): boolean {
  if (shell.snoozedUntil == null) return false
  const wakeAtMs = Date.parse(shell.snoozedUntil)
  // Malformed data never hides a task.
  if (Number.isNaN(wakeAtMs)) return false
  if (wakeAtMs <= parseTimestampMs(options.now)) return false
  return !threadRaisedHandWhileSnoozed(shell)
}

/**
 * When a snoozed task came back, or null if it never snoozed / is still
 * hidden. The inbox sort is static, so the row returns to its old position
 * and this signal has to carry the attention; visiting clears it the same
 * way it clears unread. Early hand-raise wakes report the triggering event
 * time, not the scheduled one, so a visit before the early wake does not
 * suppress the indicator.
 */
export function threadWokeAt(
  shell: SnoozeShell,
  options: { readonly now: string }
): string | null {
  if (shell.snoozedUntil == null) return null
  const wakeAtMs = Date.parse(shell.snoozedUntil)
  if (Number.isNaN(wakeAtMs)) return null
  if (threadRaisedHandWhileSnoozed(shell)) {
    if (
      shell.snoozedAt != null &&
      isAfter(shell.lastTurnCompletedAt, shell.snoozedAt)
    ) {
      return shell.lastTurnCompletedAt
    }
    if (shell.status === "failed" && isAfter(shell.failedAt, shell.snoozedAt)) {
      return shell.failedAt
    }
    return shell.snoozedAt
  }
  return wakeAtMs <= parseTimestampMs(options.now) ? shell.snoozedUntil : null
}

/** Whether the "came back" indicator should show: the task woke and the
    user has not visited since. Shared by list rows and the task view so
    both clear it by the same rule. */
export function threadCameBack(
  shell: SnoozeShell & Pick<Thread, "lastVisitedAt">,
  options: { readonly now: string }
): boolean {
  const wokeAt = threadWokeAt(shell, options)
  return wokeAt !== null && isAfter(wokeAt, shell.lastVisitedAt)
}

type DoneShell = Pick<
  Thread,
  | "status"
  | "doneOverride"
  | "lastUserMessageAt"
  | "lastTurnCompletedAt"
  | "snoozedUntil"
>

/**
 * Done resolution, in fixed order: activity blockers hold the task open no
 * matter what; past them the explicit override wins in both directions;
 * without one a quiet task closes itself after the window — except a failed
 * task, which stays visible until the user acts.
 */
export function effectiveDone(
  shell: DoneShell,
  options: {
    readonly now: string
    readonly autoDoneAfterDays: number | null
  }
): boolean {
  if (isActivityBlocked(shell)) return false
  if (shell.doneOverride === "done") return true
  if (shell.doneOverride === "active") return false
  if (shell.status === "failed") return false
  if (options.autoDoneAfterDays === null) return false
  let referenceMs = parseTimestampMs(threadLastActivityAt(shell))
  // An elapsed wake time counts as activity: the user scheduled the task to
  // come back, so the quiet window restarts at the wake. Without this, a
  // snooze longer than the window would wake straight into the Done shelf
  // and the return the user asked for would never surface.
  if (shell.snoozedUntil != null) {
    const wakeMs = Date.parse(shell.snoozedUntil)
    if (
      !Number.isNaN(wakeMs) &&
      wakeMs <= parseTimestampMs(options.now) &&
      wakeMs > referenceMs
    ) {
      referenceMs = wakeMs
    }
  }
  if (referenceMs === 0) return false
  return (
    referenceMs < parseTimestampMs(options.now) - options.autoDoneAfterDays * DAY_MS
  )
}

export type InboxSection = "pinned" | "active" | "later" | "done"

export interface InboxPartition<T extends Thread> {
  pinned: T[]
  active: T[]
  later: T[]
  done: T[]
}

/**
 * Splits threads into inbox sections, in priority order: snoozed beats a pin
 * ("hide until Tuesday" temporarily suspends "keep on top"; the pin survives
 * underneath), a pin beats done (a pinned task never closes itself out of
 * sight), and everything else is either done or active.
 *
 * The active sort is static on purpose: creation order, newest first.
 * Activity never reorders the list — a row moves only when it changes
 * section, so the sidebar holds still while agents work. Later sorts by
 * soonest wake ("what comes back next" is the shelf's question) and Done by
 * when the work ended.
 */
export function partitionInbox<T extends Thread>(
  threads: readonly T[],
  options: {
    readonly now: string
    readonly autoDoneAfterDays: number | null
  }
): InboxPartition<T> {
  const pinned: T[] = []
  const active: T[] = []
  const later: T[] = []
  const done: T[] = []
  for (const thread of threads) {
    if (effectiveSnoozed(thread, options)) {
      later.push(thread)
    } else if (thread.pinnedAt != null) {
      pinned.push(thread)
    } else if (effectiveDone(thread, options)) {
      done.push(thread)
    } else {
      active.push(thread)
    }
  }
  return {
    pinned: pinned.sort(
      (left, right) =>
        parseTimestampMs(left.pinnedAt) - parseTimestampMs(right.pinnedAt) ||
        left.id.localeCompare(right.id)
    ),
    active: active.sort(
      (left, right) =>
        parseTimestampMs(right.createdAt) - parseTimestampMs(left.createdAt) ||
        left.id.localeCompare(right.id)
    ),
    later: later.sort(
      (left, right) =>
        parseTimestampMs(left.snoozedUntil) -
          parseTimestampMs(right.snoozedUntil) ||
        left.id.localeCompare(right.id)
    ),
    done: done.sort(
      (left, right) =>
        resolveDoneTimestampMs(right) - resolveDoneTimestampMs(left) ||
        left.id.localeCompare(right.id)
    ),
  }
}

/** Done rows are history: they order and label by when the work ended, not
    by when the task was created. */
export function resolveDoneTimestamp(
  thread: Pick<
    Thread,
    "doneAt" | "lastUserMessageAt" | "lastTurnCompletedAt" | "updatedAt"
  >
): string | null {
  if (thread.doneAt != null && !Number.isNaN(Date.parse(thread.doneAt))) {
    return thread.doneAt
  }
  return threadLastActivityAt(thread) ?? thread.updatedAt
}

function resolveDoneTimestampMs(
  thread: Pick<
    Thread,
    "doneAt" | "lastUserMessageAt" | "lastTurnCompletedAt" | "updatedAt"
  >
): number {
  return parseTimestampMs(resolveDoneTimestamp(thread))
}

export interface SnoozePreset {
  readonly id: "hour" | "three-hours" | "evening" | "tomorrow" | "next-week"
  readonly label: string
  /** ISO wake time. */
  readonly until: string
}

const EVENING_HOUR = 18
const MORNING_HOUR = 9

function atHour(base: Date, hour: number): Date {
  const next = new Date(base)
  next.setHours(hour, 0, 0, 0)
  return next
}

// Calendar-day advance instead of adding a day of milliseconds: fixed
// offsets land on the wrong local day across DST transitions.
function addDays(base: Date, days: number): Date {
  const next = new Date(base)
  next.setDate(next.getDate() + days)
  return next
}

/**
 * Shared "later until" choices. "This evening" only appears while it is
 * meaningfully before evening; after that the calendar choices start at
 * "Tomorrow".
 */
export function resolveSnoozePresets(now: Date): readonly SnoozePreset[] {
  const presets: SnoozePreset[] = [
    {
      id: "hour",
      label: "In 1 hour",
      until: new Date(now.getTime() + HOUR_MS).toISOString(),
    },
    {
      id: "three-hours",
      label: "In 3 hours",
      until: new Date(now.getTime() + 3 * HOUR_MS).toISOString(),
    },
  ]
  const evening = atHour(now, EVENING_HOUR)
  if (evening.getTime() - now.getTime() > HOUR_MS) {
    presets.push({
      id: "evening",
      label: "This evening",
      until: evening.toISOString(),
    })
  }
  presets.push({
    id: "tomorrow",
    label: "Tomorrow",
    until: atHour(addDays(now, 1), MORNING_HOUR).toISOString(),
  })
  const daysUntilMonday = (1 - now.getDay() + 7) % 7 || 7
  presets.push({
    id: "next-week",
    label: "Next week",
    until: atHour(addDays(now, daysUntilMonday), MORNING_HOUR).toISOString(),
  })
  return presets
}

/**
 * Compact "wakes in" label for Later rows: "45m", "3h", "2d". Minutes round
 * up so a snooze never reads "0m" while still hidden.
 */
export function snoozeWakeLabel(
  snoozedUntil: string,
  options: { readonly now: string }
): string {
  const wakeMs = Date.parse(snoozedUntil)
  const nowMs = Date.parse(options.now)
  if (Number.isNaN(wakeMs) || Number.isNaN(nowMs)) return "now"
  const remainingMs = wakeMs - nowMs
  if (remainingMs <= 0) return "now"
  if (remainingMs < HOUR_MS) {
    return `${Math.max(1, Math.ceil(remainingMs / 60_000))}m`
  }
  if (remainingMs < DAY_MS) return `${Math.ceil(remainingMs / HOUR_MS)}h`
  return `${Math.ceil(remainingMs / DAY_MS)}d`
}
