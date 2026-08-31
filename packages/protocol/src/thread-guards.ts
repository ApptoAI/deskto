import type { z } from "zod"

import type { threadStatusSchema } from "./models.js"

type WithStatus = { status: z.infer<typeof threadStatusSchema> }

/**
 * The inbox guards, in the one place both sides can reach: the Runtime
 * rejects organization commands with them and clients disable the same
 * actions before the round trip, so the two can never drift.
 */

/** Work the agent is doing or waiting on; such a task can never be hidden. */
export function isActivityBlocked(thread: WithStatus): boolean {
  return thread.status === "running" || thread.status === "waiting-approval"
}

export function canMarkDone(thread: WithStatus): boolean {
  return !isActivityBlocked(thread)
}

/** A running task IS snoozable — snoozing only affects visibility, never the
    agent. Only a pending approval blocks it: hiding a question defeats it. */
export function canSnooze(thread: WithStatus): boolean {
  return thread.status !== "waiting-approval"
}

/** Quiet days before a task closes itself. One constant both sides agree on. */
export const autoDoneAfterDays = 3
