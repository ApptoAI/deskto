import { AsyncQueue } from "./async-queue.js"
import type {
  ApprovalDecision,
  HarnessAdapterFactory,
  HarnessAvailability,
  HarnessDescriptor,
  HarnessEvent,
  HarnessModelOption,
  HarnessRunInput,
  HarnessSession,
} from "./types.js"

export type ScriptedHarnessRun = {
  input: HarnessRunInput
  emit(event: HarnessEvent): void
  finish(): void
  cancelled: boolean
  approvals: Map<string, ApprovalDecision>
}

export class ScriptedHarness implements HarnessAdapterFactory {
  readonly runs: ScriptedHarnessRun[] = []

  constructor(
    readonly descriptor: HarnessDescriptor = {
      id: "scripted",
      name: "Scripted",
    },
    private readonly availability: HarnessAvailability = { status: "available" }
  ) {}

  checkAvailability(): Promise<HarnessAvailability> {
    return Promise.resolve(this.availability)
  }

  listModels(): Promise<HarnessModelOption[]> {
    return Promise.resolve([
      {
        id: "test-model",
        name: "Test model",
        supportedEfforts: ["low", "medium", "high"],
        defaultEffort: "medium",
        isDefault: true,
        supportedPermissionModes: ["approval-required", "auto", "full-access"],
      },
    ])
  }

  start(input: HarnessRunInput, signal: AbortSignal): Promise<HarnessSession> {
    const queue = new AsyncQueue<HarnessEvent>()
    const run: ScriptedHarnessRun = {
      input,
      emit: (event) => queue.push(event),
      finish: () => queue.close(),
      cancelled: false,
      approvals: new Map(),
    }
    this.runs.push(run)
    signal.addEventListener(
      "abort",
      () => {
        run.cancelled = true
        queue.close()
      },
      { once: true }
    )

    return Promise.resolve({
      events: queue,
      cancel: () => {
        run.cancelled = true
        queue.close()
        return Promise.resolve()
      },
      respondToApproval: (approvalId, decision) => {
        run.approvals.set(approvalId, decision)
        return Promise.resolve()
      },
    })
  }
}
