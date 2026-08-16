import type { PlanStepStatus } from "@deskto/harness-sdk"

/** Maps the step-status words providers use onto the shared vocabulary. */
export function normalizePlanStepStatus(
  raw: string | undefined
): PlanStepStatus {
  const value = raw?.toLowerCase().replace(/[\s_-]+/g, "")
  if (value === "completed" || value === "done") return "done"
  if (value === "inprogress" || value === "active" || value === "running")
    return "active"
  return "pending"
}
