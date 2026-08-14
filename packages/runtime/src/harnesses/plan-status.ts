import type { PlanStepStatus } from "@openappto/harness-sdk"

/** Maps the step-status words providers use onto the shared vocabulary. */
export function normalizePlanStepStatus(
  raw: string | undefined
): PlanStepStatus {
  if (raw === "completed" || raw === "done") return "done"
  if (raw === "in_progress" || raw === "inProgress" || raw === "active")
    return "active"
  return "pending"
}
