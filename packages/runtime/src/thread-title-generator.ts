import {
  appSettings,
  settingValue,
  type HarnessModelSelection,
} from "@deskto/settings"
import type { ExecutionProfile } from "@deskto/protocol"

import type { HarnessRegistry } from "./harness-registry.js"
import type { Store } from "./storage/store.js"
import { newThreadTitle } from "./storage/threads.js"
import type { UserSettings } from "./user-settings.js"

const generationTimeoutMs = 60_000

export class ThreadTitleGenerator {
  // Keyed by thread so a deleted task can stop the provider call it started.
  readonly #controllers = new Map<string, Set<AbortController>>()
  readonly #jobs = new Set<Promise<void>>()

  constructor(
    private readonly store: Store,
    private readonly harnesses: HarnessRegistry,
    private readonly settings: UserSettings,
    private readonly changed: (threadId: string) => void
  ) {}

  start(input: ThreadTitleGenerationInput): void {
    const controller = new AbortController()
    const running = this.#controllers.get(input.threadId) ?? new Set()
    running.add(controller)
    this.#controllers.set(input.threadId, running)
    const timeout = setTimeout(() => controller.abort(), generationTimeoutMs)
    timeout.unref?.()
    const job = this.#generate(input, controller.signal)
      .catch((error) => {
        console.debug("Could not generate thread title:", error)
      })
      .finally(() => {
        clearTimeout(timeout)
        running.delete(controller)
        if (running.size === 0) this.#controllers.delete(input.threadId)
        this.#jobs.delete(job)
      })
    this.#jobs.add(job)
  }

  /** Stops the title work for one Thread. The provider call is a separate
      spawn from the Turn's session, so deleting a task has to end it here. */
  cancel(threadId: string): void {
    const running = this.#controllers.get(threadId)
    if (!running) return
    running.forEach((controller) => controller.abort())
  }

  async dispose(): Promise<void> {
    for (const running of this.#controllers.values()) {
      running.forEach((controller) => controller.abort())
    }
    await Promise.allSettled(this.#jobs)
  }

  async #generate(
    input: ThreadTitleGenerationInput,
    signal: AbortSignal
  ): Promise<void> {
    const selected = settingValue(
      this.settings.snapshot(),
      appSettings.threadTitleModel
    )
    const model = titleModel(selected, input)
    const harness = await this.harnesses.requireAvailable(model.harnessId)
    if (!harness.generateText || signal.aborted) return
    const executionProfile = await this.#profileFor(model)
    const title = sanitizeThreadTitle(
      await harness.generateText(
        {
          projectPath: input.projectPath,
          prompt: threadTitlePrompt(input.prompt),
          executionProfile,
        },
        signal
      ),
      input.prompt
    )
    if (!title) return
    if (
      this.store.threads.replaceTitle(input.threadId, newThreadTitle, title)
    ) {
      this.changed(input.threadId)
    }
  }

  #profileFor(model: TitleModel): Promise<ExecutionProfile> {
    if (model.modelId === null) {
      return this.harnesses.resolveProfile(model.harnessId)
    }
    return this.harnesses.resolveProfile(model.harnessId, {
      modelId: model.modelId,
      effort: null,
      permissionMode: "approval-required",
    })
  }
}

type ThreadTitleGenerationInput = {
  threadId: string
  projectPath: string
  prompt: string
  harnessId: string
  executionProfile: ExecutionProfile
}

type TitleModel = {
  harnessId: string
  modelId: string | null
}

function titleModel(
  selected: HarnessModelSelection,
  thread: { harnessId: string; executionProfile: ExecutionProfile }
): TitleModel {
  if (selected.harnessId === null) {
    return {
      harnessId: thread.harnessId,
      modelId: thread.executionProfile.modelId,
    }
  }
  return { harnessId: selected.harnessId, modelId: selected.modelId }
}

export function threadTitlePrompt(message: string): string {
  return `Generate a title that will help the user recognize this task later.
Return only the title, with no quotes or explanation.

Focus on the durable subject and desired outcome, not on instructions about tools, planning, reports, or implementation steps.

Rules:
- Use the same language as the user.
- Use 1-8 words and fewer than 40 characters.
- Use a compact noun phrase or clear action phrase.
- Do not claim the work is complete.
- Do not copy and truncate the message.
- For a short greeting, acknowledgement, or celebration, use its own words as the title.
- Never explain, refuse, or judge whether the message is a task.
- Avoid filler and trailing punctuation.

User message:
${message.slice(0, 8_000)}`
}

export function sanitizeThreadTitle(
  output: string,
  userMessage?: string
): string | undefined {
  const fallback = shortThreadTitle(userMessage)
  const firstLine = output
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  if (!firstLine) return fallback

  const title = firstLine
    .replace(/^(?:title|tytuł)\s*:\s*/i, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (
    title &&
    title !== newThreadTitle &&
    title.length < 40 &&
    title.split(/\s+/).length <= 8
  ) {
    return title
  }
  return fallback
}

function shortThreadTitle(message?: string): string | undefined {
  const title = message?.replace(/\s+/g, " ").trim()
  return title && title.length < 40 && title.split(" ").length <= 8
    ? title
    : undefined
}
