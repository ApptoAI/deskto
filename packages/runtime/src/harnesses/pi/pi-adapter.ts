import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  AsyncQueue,
  harnessFailure,
  type ActivityStart,
  type ApprovalDecision,
  type ApprovalKind,
  type ChangedFile,
  type HarnessAdapterFactory,
  type HarnessAvailability,
  type HarnessEvent,
  type HarnessFollowUpInput,
  type HarnessModelOption,
  type HarnessRunInput,
  type HarnessSession,
  type NativeSkillRoot,
  type SkillDiscoveryInput,
  type SkillProvisioningResult,
  type SkillRoot,
  type TextGenerationInput,
} from "@deskto/harness-sdk"
import {
  jsonObjectSchema,
  type JsonObject,
  type JsonValue,
} from "@deskto/protocol"
import { minimatch } from "minimatch"
import { z } from "zod"

import { generateTextWithSession } from "../generate-text.js"
import { positiveTokens } from "../token-usage.js"

import {
  getString,
  parseJsonObject,
  piAssistantMessageSchema,
  piAvailableModelsSchema,
  piStateSchema,
  type PiEvent,
  type PiModel,
  type PiState,
} from "./pi-protocol.js"
import { PiRpcClient, type PiRpcClientOptions } from "./pi-rpc-client.js"
import { piMcpEnvironment, writeMcpExtension } from "./pi-mcp-extension.js"

export interface PiClient {
  request<T extends JsonValue>(
    command: JsonObject,
    schema: z.ZodType<T>
  ): Promise<T>
  send(command: JsonObject): void
  onEvent(listener: (event: PiEvent) => void): () => void
  onFailure(listener: (error: Error) => void): () => void
  close(): void
}

export type PiClientFactory = (
  command: string,
  cwd: string,
  options?: PiRpcClientOptions
) => PiClient

/** Stdout of `pi --version` and `pi --list-models`, read by discovery. */
export type PiCommandRunner = (args: string[], cwd: string) => Promise<string>

type PiAdapterOptions = {
  /** Folder used only by availability and model discovery processes. */
  discoveryCwd?: string
  /** Host-provided skills available to every Pi session. */
  hostSkillRoots?: SkillRoot[]
  /** Where the approval extension Pi loads is written; defaults to the OS temp folder. */
  extensionsPath?: string
  /** Pi's config directory; defaults to Pi's own `~/.pi/agent`. */
  configPath?: string
  runCommand?: PiCommandRunner
}

export const piNotInstalledReason =
  "Pi was not found. Open Terminal and run `npm install -g @earendil-works/pi-coding-agent`."
const piVersionCheckFailedReason =
  "Pi could not be started. Open Terminal, run `pi --version`, and fix what it reports."
// The adapter settles a Turn on `agent_settled`, which Pi's RPC mode emits
// only from this version on; an older Pi would leave every task running.
const piMinimumVersion = "0.80.4"
export const piTooOldReason = (version: string) =>
  `Pi ${version} is too old; Deskto needs ${piMinimumVersion} or newer. Open Terminal and run \`npm install -g @earendil-works/pi-coding-agent\`.`

const commandNotFoundSchema = z.object({ code: z.literal("ENOENT") })
const discoveryTimeoutMs = 20_000
/** Model discovery runs Pi without a session so nothing lands in its store. */
const discoveryLaunchArgs = ["--no-session", "--no-extensions"]

// Pi's own vocabulary for --thinking, in ascending order. A model exposes
// the extended `xhigh` and `max` only when its thinkingLevelMap names them,
// and hides any level the map sets to null; Pi clamps a request outside
// that set, so the menu must not offer it.
const piThinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]
const piExtendedThinkingLevels = new Set(["xhigh", "max"])
const piDefaultThinkingLevel = "medium"

const piSettingsSchema = z.object({
  defaultProvider: z.string().optional(),
  defaultModel: z.string().optional(),
  defaultThinkingLevel: z.string().optional(),
  modelThinkingLevels: z.record(z.string(), z.string()).optional(),
  enabledModels: z.array(z.string()).optional(),
})

/** Pi has no permission prompt of its own; this extension asks through the RPC UI channel. */
const approvalExtensionFileName = "deskto-approvals.mjs"
const approvalTitlePrefix = "deskto-approval:"
const approvalExtensionSource = `const readOnlyTools = new Set(["read", "grep", "find", "ls"])
export default function (pi) {
  pi.on("tool_call", async (event, ctx) => {
    if (readOnlyTools.has(event.toolName)) return undefined
    const input = event.input ?? {}
    const detail =
      typeof input.command === "string"
        ? input.command
        : typeof input.path === "string"
          ? input.path
          : ""
    // Pi's abort waits for the agent to go idle; a dialog that ignores the
    // signal would keep it waiting forever.
    const allowed = await ctx.ui.confirm(
      "${approvalTitlePrefix}" + event.toolName,
      detail,
      { signal: ctx.signal }
    )
    if (!allowed) return { block: true, reason: "The person did not allow this step." }
    return undefined
  })
}
`

const createPiClient: PiClientFactory = (command, cwd, options) =>
  new PiRpcClient(command, cwd, options)

const runPiCommand: PiCommandRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(
      "pi",
      args,
      {
        cwd,
        timeout: discoveryTimeoutMs,
        windowsHide: true,
        shell: process.platform === "win32",
      },
      (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout)
      }
    )
  })

type PendingApproval = {
  id: string
  requestId: string
  request: Extract<HarnessEvent, { type: "approval.requested" }>["request"]
}

export class PiAdapter implements HarnessAdapterFactory {
  readonly descriptor = {
    id: "pi",
    name: "Pi",
    followUps: { queue: true, steer: true },
  }

  constructor(
    private readonly clientFactory: PiClientFactory = createPiClient,
    private readonly options: PiAdapterOptions = {}
  ) {}

  async checkAvailability(): Promise<HarnessAvailability> {
    let output: string
    try {
      output = await this.#run(["--version"])
    } catch (error) {
      return {
        status: "unavailable",
        reason: commandNotFoundSchema.safeParse(error).success
          ? piNotInstalledReason
          : piVersionCheckFailedReason,
      }
    }
    const version = output.trim().split(/\s+/).at(-1)
    if (!version) return { status: "available" }
    if (compareVersions(version, piMinimumVersion) < 0) {
      return { status: "unavailable", reason: piTooOldReason(version) }
    }
    return { status: "available", version }
  }

  async listModels(): Promise<HarnessModelOption[]> {
    const [{ models, initial }, settings] = await Promise.all([
      this.#availableModels(),
      this.#readSettings(),
    ])
    return piModels(models, settings, initial)
  }

  discoverSkillRoots(input: SkillDiscoveryInput): Promise<NativeSkillRoot[]> {
    const roots: NativeSkillRoot[] = []
    if (input.projectPath) {
      roots.push({
        path: join(input.projectPath, ".pi", "skills"),
        scope: "project",
        label: "Pi project skills",
      })
    }
    roots.push({
      path: join(this.#configPath(), "skills"),
      scope: "user",
      label: "Pi personal skills",
    })
    return Promise.resolve(roots)
  }

  start(input: HarnessRunInput, signal: AbortSignal): Promise<HarnessSession> {
    return this.#open(input, signal, { ephemeral: false })
  }

  generateText(
    input: TextGenerationInput,
    signal: AbortSignal
  ): Promise<string> {
    return generateTextWithSession(
      // A title call must not leave a session in Pi's store, where the person
      // would see it beside real tasks in `pi --resume`.
      (run, runSignal) => this.#open(run, runSignal, { ephemeral: true }),
      input,
      signal
    )
  }

  #open(
    input: HarnessRunInput,
    signal: AbortSignal,
    launch: PiLaunchOptions
  ): Promise<HarnessSession> {
    return PiSession.open(
      {
        ...input,
        customization: {
          ...input.customization,
          skillRoots: [
            ...(this.options.hostSkillRoots ?? []),
            ...input.customization.skillRoots,
          ],
        },
      },
      signal,
      this.clientFactory,
      this.options.extensionsPath ?? join(tmpdir(), "deskto-pi"),
      this.#childEnv() ? { ...launch, env: this.#childEnv() } : launch
    )
  }

  #run(args: string[]): Promise<string> {
    return (this.options.runCommand ?? runPiCommand)(
      args,
      this.options.discoveryCwd ?? process.cwd()
    )
  }

  // `pi --list-models` prints a table without each model's thinking levels;
  // the RPC snapshot carries the same models with their thinkingLevelMap.
  // The same process, launched without --model, has already run Pi's own
  // initial-model selection, so its state names the default for this
  // release without Deskto copying Pi's per-provider table.
  async #availableModels(): Promise<{
    models: PiModel[]
    initial: PiState["model"]
  }> {
    const env = this.#childEnv()
    const client = this.clientFactory(
      "pi",
      this.options.discoveryCwd ?? process.cwd(),
      env ? { args: discoveryLaunchArgs, env } : { args: discoveryLaunchArgs }
    )
    try {
      const [{ models }, state] = await Promise.all([
        client.request(
          { type: "get_available_models" },
          piAvailableModelsSchema
        ),
        client.request({ type: "get_state" }, piStateSchema),
      ])
      return { models, initial: state.model }
    } finally {
      client.close()
    }
  }

  #configPath(): string {
    if (this.options.configPath) return this.options.configPath
    const override = process.env.PI_CODING_AGENT_DIR
    return override
      ? resolve(piNormalizedPath(override))
      : join(homedir(), ".pi", "agent")
  }

  // Pi resolves a relative PI_CODING_AGENT_DIR against its own working
  // directory, which is the discovery folder for one process and the project
  // for another; every Pi gets the one absolute path the settings came from.
  #childEnv(): NodeJS.ProcessEnv | undefined {
    if (this.options.configPath || !process.env.PI_CODING_AGENT_DIR) {
      return undefined
    }
    return { ...process.env, PI_CODING_AGENT_DIR: this.#configPath() }
  }

  async #readSettings(): Promise<PiSettings> {
    try {
      const raw = await readFile(
        join(this.#configPath(), "settings.json"),
        "utf8"
      )
      // Pi strips a byte order mark before parsing; JSON.parse would not.
      const parsed = piSettingsSchema.safeParse(
        JSON.parse(raw.replace(/^\uFEFF/, ""))
      )
      return parsed.success ? parsed.data : {}
    } catch {
      return {}
    }
  }
}

type PiSettings = z.infer<typeof piSettingsSchema>

class PiSession implements HarnessSession {
  readonly #queue = new AsyncQueue<HarnessEvent>()
  readonly #approvalQueue: PendingApproval[] = []
  readonly events = this.#queue
  readonly skillProvisioning: SkillProvisioningResult[] = []
  #activeApproval?: PendingApproval
  #contextWindow?: number
  #cancelled = false
  #closed = false
  #settling = false
  #providerSessionId?: string
  #sessionStarted = false
  #sessionConfirmation?: Promise<void>
  #lastAssistantOutcome?: z.infer<typeof piAssistantMessageSchema>

  private constructor(
    private readonly client: PiClient,
    private readonly input: HarnessRunInput,
    private readonly launch: PiLaunchOptions,
    private readonly instructionsFile: string | undefined
  ) {
    client.onEvent((event) => this.#onEvent(event))
    client.onFailure((error) => {
      if (this.#cancelled) {
        this.#finish()
        return
      }
      this.#queue.push({
        type: "turn.failed",
        failure: harnessFailure(error.message),
      })
      this.#finish()
    })
  }

  static async open(
    input: HarnessRunInput,
    signal: AbortSignal,
    clientFactory: PiClientFactory,
    extensionsPath: string,
    launch: PiLaunchOptions
  ): Promise<PiSession> {
    const mcpServers = input.customization.mcpServers ?? []
    const mcpExtension =
      mcpServers.length > 0
        ? await writeMcpExtension(extensionsPath)
        : undefined
    const approvalExtension =
      input.executionProfile.permissionMode === "approval-required"
        ? await writeApprovalExtension(extensionsPath)
        : undefined
    const instructionsFile = input.customization.instructions
      ? await writeInstructions(
          extensionsPath,
          input.customization.instructions
        )
      : undefined
    const projectSkills =
      input.executionProfile.permissionMode === "approval-required"
        ? await existingDirectory(join(input.projectPath, ".pi", "skills"))
        : undefined
    const args = piLaunchArgs(
      input,
      approvalExtension,
      launch,
      instructionsFile,
      projectSkills,
      mcpExtension
    )
    const childEnv =
      mcpServers.length > 0
        ? piMcpEnvironment(mcpServers, launch.env ?? process.env)
        : launch.env
    const client = clientFactory(
      "pi",
      input.projectPath,
      childEnv ? { args, env: childEnv } : { args }
    )
    const session = new PiSession(client, input, launch, instructionsFile)
    session.skillProvisioning.push(
      ...input.customization.skillRoots.map((root) => piProvisioning(root))
    )
    const abort = () => client.close()
    signal.addEventListener("abort", abort, { once: true })
    try {
      if (signal.aborted) abort()
      await session.#start()
      return session
    } catch (error) {
      session.#finish()
      throw error
    } finally {
      signal.removeEventListener("abort", abort)
    }
  }

  async cancel(): Promise<void> {
    this.#cancelled = true
    // Pi's abort waits for the agent to go idle, and the agent may be waiting
    // on an approval dialog; that dialog has to be dismissed first.
    this.#dismissApprovals()
    try {
      await this.client.request({ type: "abort" }, jsonObjectSchema)
    } catch {
      return
    } finally {
      this.#finish()
    }
  }

  async queue(input: HarnessFollowUpInput): Promise<void> {
    if (this.#closed || this.#settling) {
      throw new Error("Pi is no longer running")
    }
    await this.client.request(
      piFollowUpCommand("follow_up", input),
      jsonObjectSchema
    )
  }

  async steer(input: HarnessFollowUpInput): Promise<void> {
    if (this.#closed || this.#settling) {
      throw new Error("Pi is no longer running")
    }
    await this.client.request(
      piFollowUpCommand("steer", input),
      jsonObjectSchema
    )
  }

  respondToApproval(
    approvalId: string,
    decision: ApprovalDecision
  ): Promise<void> {
    const pending = this.#activeApproval
    if (pending?.id !== approvalId)
      return Promise.reject(new Error("Approval is no longer pending"))

    this.#activeApproval = undefined
    this.client.send({
      type: "extension_ui_response",
      id: pending.requestId,
      confirmed: decision === "approve",
    })
    this.#showNextApproval()
    return Promise.resolve()
  }

  async #start(): Promise<void> {
    const state = await this.client.request(
      { type: "get_state" },
      piStateSchema
    )
    if (!state.sessionId) throw new Error("Pi did not report a session id")
    // Pi stands in an `unknown/unknown` model with no inputs when nothing is
    // selected or no credentials exist; the prompt then fails with Pi's own
    // account message, which names the way out better than a modality check.
    const modelInputs = piHasSelectedModel(state.model)
      ? state.model.input
      : undefined
    if (
      (this.input.attachments?.length ?? 0) > 0 &&
      modelInputs &&
      !modelInputs.includes("image")
    ) {
      const model = [state.model?.provider, state.model?.id]
        .filter(Boolean)
        .join("/")
      throw new Error(
        `${model || "This model"} can't read images. Remove the attachment or choose a model that accepts images.`
      )
    }
    this.#providerSessionId = state.sessionId
    this.#contextWindow = positiveTokens(state.model?.contextWindow)
    // A resumed session already has a file. Fresh and forked ids stay
    // provisional until Pi persists their first assistant message.
    if (this.input.providerSessionId && !this.input.forkProviderSession) {
      this.#emitSessionStarted()
    }
    await this.client.request(piPromptCommand(this.input), jsonObjectSchema)
  }

  #onEvent(event: PiEvent): void {
    if (event.type === "message_update") {
      const update = parseJsonObject(event.assistantMessageEvent)
      const kind = getString(update, "type")
      if (kind === "text_delta") {
        const delta = getString(update, "delta")
        if (delta) this.#queue.push({ type: "message.delta", text: delta })
      } else if (kind === "thinking_start" || kind === "thinking_delta") {
        this.#queue.push({
          type: "progress.updated",
          progress: { stage: "thinking", label: "Thinking" },
        })
      } else if (kind === "toolcall_start") {
        this.#queue.push({
          type: "progress.updated",
          progress: {
            stage: "preparing-tool",
            label: piToolLabel(getString(update, "toolName")),
          },
        })
      }
      return
    }

    if (event.type === "tool_execution_start") {
      const activity = piActivity(event)
      if (activity) this.#queue.push({ type: "activity.started", activity })
      return
    }

    if (event.type === "tool_execution_update") {
      this.#queue.push({
        type: "progress.updated",
        progress: {
          stage: "running-tool",
          label: piToolLabel(getString(event, "toolName")),
        },
      })
      return
    }

    if (event.type === "tool_execution_end") {
      const id = getString(event, "toolCallId")
      if (!id) return
      this.#queue.push({
        type: "activity.completed",
        id,
        outcome: event.isError === true ? "failed" : "completed",
      })
      return
    }

    if (event.type === "message_end") {
      const message = piAssistantMessageSchema.safeParse(event.message)
      if (!message.success) return
      this.#confirmSessionStarted()
      const usedTokens = positiveTokens(message.data.usage?.totalTokens)
      if (!usedTokens) return
      this.#queue.push({
        type: "usage.updated",
        usage: this.#contextWindow
          ? { usedTokens, maxTokens: this.#contextWindow }
          : { usedTokens },
      })
      return
    }

    if (event.type === "extension_ui_request") {
      this.#onUiRequest(event)
      return
    }

    if (event.type === "agent_end") {
      const messages = z.array(jsonObjectSchema).safeParse(event.messages)
      const last = messages.success
        ? messages.data
            .map((message) => piAssistantMessageSchema.safeParse(message))
            .filter((message) => message.success)
            .map((message) => message.data)
            .at(-1)
        : undefined
      if (last) this.#lastAssistantOutcome = last
      return
    }

    if (event.type === "agent_settled") void this.#settle()
  }

  #confirmSessionStarted(): void {
    if (
      this.launch.ephemeral ||
      this.#sessionStarted ||
      this.#sessionConfirmation
    )
      return

    // Pi emits message_end before persisting that assistant entry. This RPC
    // round trip cannot be answered until the synchronous write has finished.
    this.#sessionConfirmation = this.client
      .request({ type: "get_state" }, piStateSchema)
      .then((state) => {
        if (
          state.sessionId === this.#providerSessionId &&
          state.sessionFile !== undefined
        ) {
          this.#emitSessionStarted()
        }
      })
      .catch(() => undefined)
  }

  #emitSessionStarted(): void {
    if (
      this.launch.ephemeral ||
      this.#closed ||
      this.#sessionStarted ||
      !this.#providerSessionId
    )
      return
    this.#sessionStarted = true
    this.#queue.push({
      type: "session.started",
      providerSessionId: this.#providerSessionId,
    })
  }

  async #settle(): Promise<void> {
    if (this.#closed || this.#settling) return
    this.#settling = true
    await this.#sessionConfirmation
    if (this.#closed) return

    const last = this.#lastAssistantOutcome
    if (last?.stopReason === "aborted" || this.#cancelled) {
      this.#finish()
      return
    }
    if (last?.stopReason === "error") {
      this.#queue.push({
        type: "turn.failed",
        failure: harnessFailure(
          last.errorMessage ?? "Pi could not complete the task"
        ),
      })
    } else {
      this.#queue.push({ type: "turn.completed" })
    }
    this.#finish()
  }

  #onUiRequest(event: PiEvent): void {
    const requestId = getString(event, "id")
    const method = getString(event, "method")
    if (!requestId || !method) return
    const title = getString(event, "title") ?? ""
    if (
      method === "confirm" &&
      title.startsWith(approvalTitlePrefix) &&
      !this.#cancelled
    ) {
      const toolName = title.slice(approvalTitlePrefix.length)
      const kind = approvalKind(toolName)
      const request: PendingApproval["request"] = {
        id: randomUUID(),
        kind,
        title:
          kind === "command"
            ? "Allow this command?"
            : kind === "file-change"
              ? "Allow this file change?"
              : `Allow ${piToolLabel(toolName).toLowerCase()}?`,
      }
      const detail = getString(event, "message")
      if (detail) request.detail = detail
      this.#approvalQueue.push({ id: request.id, requestId, request })
      this.#showNextApproval()
      return
    }
    // Dialogs from other extensions have no one to answer them here, and a
    // dialog raised after cancellation began would hold Pi's abort open.
    if (
      method === "confirm" ||
      method === "select" ||
      method === "input" ||
      method === "editor"
    ) {
      this.client.send({
        type: "extension_ui_response",
        id: requestId,
        cancelled: true,
      })
    }
  }

  #finish(): void {
    if (this.#closed) return
    this.#closed = true
    this.#dismissApprovals()
    this.client.close()
    this.#queue.close()
    if (this.instructionsFile) {
      void rm(this.instructionsFile, { force: true }).catch(() => undefined)
    }
  }

  #dismissApprovals(): void {
    const approvals = [
      ...(this.#activeApproval ? [this.#activeApproval] : []),
      ...this.#approvalQueue,
    ]
    this.#activeApproval = undefined
    this.#approvalQueue.length = 0
    for (const approval of approvals) {
      try {
        this.client.send({
          type: "extension_ui_response",
          id: approval.requestId,
          cancelled: true,
        })
      } catch {
        break
      }
    }
  }

  #showNextApproval(): void {
    if (this.#activeApproval || this.#closed) return
    const approval = this.#approvalQueue.shift()
    if (!approval) return
    this.#activeApproval = approval
    this.#queue.push({ type: "approval.requested", request: approval.request })
  }
}

const piUnknownModel = "unknown"

function piHasSelectedModel(
  model: PiState["model"]
): model is NonNullable<PiState["model"]> {
  return (
    model !== undefined &&
    !(model.provider === piUnknownModel && model.id === piUnknownModel)
  )
}

export type PiLaunchOptions = {
  /** Skip Pi's session store; the provider session id is then single-use. */
  ephemeral: boolean
  /** Environment for the Pi process when it must differ from this one. */
  env?: NodeJS.ProcessEnv
}

export function piLaunchArgs(
  input: HarnessRunInput,
  approvalExtension?: string,
  launch: PiLaunchOptions = { ephemeral: false },
  instructionsFile?: string,
  projectSkills?: string,
  mcpExtension?: string
): string[] {
  // Discovered extensions would ask questions nobody can answer over RPC.
  // RPC mode cannot show Pi's trust prompt either, so trust follows the
  // permission mode: full access lets the folder's own .pi settings load,
  // while approval-required keeps repository-controlled package installs
  // from running before the person's first approval. Skills are text, so
  // the project's own skill folder still reaches Pi through --skill.
  const args = [
    "--no-extensions",
    input.executionProfile.permissionMode === "approval-required"
      ? "--no-approve"
      : "--approve",
  ]
  if (projectSkills) args.push("--skill", projectSkills)
  if (launch.ephemeral) args.push("--no-session")
  if (input.providerSessionId) {
    args.push(
      input.forkProviderSession ? "--fork" : "--session",
      input.providerSessionId
    )
  }
  const { modelId, effort } = input.executionProfile
  if (modelId) args.push("--model", modelId)
  if (effort) args.push("--thinking", effort)
  if (approvalExtension) args.push("--extension", approvalExtension)
  if (mcpExtension) args.push("--extension", mcpExtension)
  for (const root of input.customization.skillRoots) {
    args.push("--skill", root.path)
  }
  // Pi reads the flag's value as a file whenever that path exists, so the
  // instructions travel in a file Deskto owns rather than as literal text.
  if (instructionsFile) args.push("--append-system-prompt", instructionsFile)
  return args
}

export function piPromptCommand(
  input: Pick<
    HarnessRunInput | HarnessFollowUpInput,
    "prompt" | "references" | "attachments"
  >
): JsonObject {
  return piInputCommand("prompt", input)
}

export function piFollowUpCommand(
  type: "follow_up" | "steer",
  input: HarnessFollowUpInput
): JsonObject {
  return piInputCommand(type, input)
}

function piInputCommand(
  type: "prompt" | "follow_up" | "steer",
  input: Pick<
    HarnessRunInput | HarnessFollowUpInput,
    "prompt" | "references" | "attachments"
  >
): JsonObject {
  const lines = [input.prompt]
  for (const reference of input.references) {
    lines.push(
      reference.kind === "skill"
        ? `Use the skill at ${reference.path} (read its SKILL.md first).`
        : `Referenced ${reference.entryKind}: ${reference.path}`
    )
  }
  const command: JsonObject = {
    type,
    message: lines.filter(Boolean).join("\n\n"),
  }
  const images = (input.attachments ?? []).flatMap((attachment) => {
    const data = attachment.dataUrl.split(",", 2)[1]
    return data ? [{ type: "image", data, mimeType: attachment.mimeType }] : []
  })
  if (images.length > 0) command.images = images
  return command
}

export function piModels(
  available: PiModel[],
  settings: PiSettings = {},
  initial?: PiState["model"]
): HarnessModelOption[] {
  // Pi's discovery process already chose the model it would start with:
  // the saved default when it is in scope and has credentials, else the
  // first scoped model, else its release's provider defaults. Reading that
  // choice keeps Deskto's default equal to Pi's on every release it accepts.
  const settingsDefaultId =
    settings.defaultProvider && settings.defaultModel
      ? `${settings.defaultProvider}/${settings.defaultModel}`
      : undefined
  const defaultId = piHasSelectedModel(initial)
    ? `${initial.provider}/${initial.id}`
    : settingsDefaultId
  // enabledModels still supplies Pi's per-entry thinking level, but it does
  // not decide what Deskto offers. Model visibility belongs to Deskto.
  const enabled = piModelScope(settings.enabledModels ?? [], available)
  const options = new Map<PiModel, HarnessModelOption>()
  for (const model of available) {
    const id = `${model.provider}/${model.id}`
    const efforts = piSupportedEfforts(model)
    const option: HarnessModelOption = {
      id,
      name: model.id,
      description: model.provider,
      supportedEfforts: efforts,
      isDefault: id === defaultId,
      supportedPermissionModes: ["approval-required", "full-access"],
    }
    if (efforts.length > 0) {
      // Pi's order: the `:level` on the enabledModels entry, then the
      // per-model setting, then the global default.
      option.defaultEffort = clampThinkingLevel(
        enabled.find((scoped) => scoped.model === model)?.thinkingLevel ??
          settings.modelThinkingLevels?.[id] ??
          settings.defaultThinkingLevel ??
          piDefaultThinkingLevel,
        efforts
      )
    }
    options.set(model, option)
  }
  const offered = [...options.values()]
  if (offered.length > 0 && !offered.some((model) => model.isDefault)) {
    // Pi reported nothing usable (or a model outside the current catalog):
    // the first entry, which is Pi's own last resort.
    offered[0]!.isDefault = true
  }
  return offered
}

// A reasoning model gets Pi's levels minus the ones its map hides; the
// extended ones need an explicit mapping. A model without reasoning offers
// no choice at all.
function piSupportedEfforts(model: PiModel): string[] {
  if (!model.reasoning) return []
  return piThinkingLevels.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level]
    if (mapped === null) return false
    if (piExtendedThinkingLevels.has(level)) return mapped !== undefined
    return true
  })
}

// Pi's clamp: an unsupported level takes the nearest supported level above
// it, then the nearest below, and a level outside the vocabulary takes the
// lowest one.
function clampThinkingLevel(level: string, supported: string[]): string {
  if (supported.includes(level)) return level
  const index = piThinkingLevels.indexOf(level)
  const first = supported[0] ?? "off"
  if (index === -1) return first
  return (
    piThinkingLevels
      .slice(index)
      .find((candidate) => supported.includes(candidate)) ??
    piThinkingLevels
      .slice(0, index)
      .reverse()
      .find((candidate) => supported.includes(candidate)) ??
    first
  )
}

type ScopedModel = { model: PiModel; thinkingLevel?: string }
type ParsedModelPattern = ScopedModel | { model?: undefined }

// Mirrors Pi's own scope resolution for `enabledModels`. A glob (`*`, `?`,
// `[...]`) keeps a `:<thinking>` suffix as the level, then takes an exact
// `provider/id` reference or a case-insensitive minimatch on `provider/id`
// or the bare id. Plain text takes an exact reference or a substring of the
// id or name, preferring an alias over a dated version, and retries without
// its last `:suffix` until nothing is left. The first entry naming a model
// wins, as in Pi.
function piModelScope(patterns: string[], models: PiModel[]): ScopedModel[] {
  const scoped: ScopedModel[] = []
  const add = (matches: PiModel[], thinkingLevel: string | undefined) => {
    for (const model of matches) {
      if (scoped.some((entry) => entry.model === model)) continue
      scoped.push(thinkingLevel ? { model, thinkingLevel } : { model })
    }
  }
  for (const pattern of patterns) {
    if (/[*?[]/.test(pattern)) {
      const { reference: glob, thinkingLevel } = splitThinkingSuffix(pattern)
      const exact = exactModel(glob, models)
      if (exact) {
        add([exact], thinkingLevel)
        continue
      }
      add(
        models.filter(
          (model) =>
            minimatch(`${model.provider}/${model.id}`, glob, {
              nocase: true,
            }) || minimatch(model.id, glob, { nocase: true })
        ),
        thinkingLevel
      )
      continue
    }
    const parsed = parseModelPattern(pattern, models)
    if (parsed.model) add([parsed.model], parsed.thinkingLevel)
  }
  return scoped
}

// Pi's parse of a plain entry: the whole text first, then without its last
// `:suffix`. A suffix from the thinking vocabulary becomes the level; any
// other is dropped with a warning that also voids a level named further in.
function parseModelPattern(
  pattern: string,
  models: PiModel[]
): ParsedModelPattern & { warned: boolean } {
  const match = exactModel(pattern, models) ?? partialModel(pattern, models)
  if (match) return { model: match, warned: false }
  const colon = pattern.lastIndexOf(":")
  if (colon === -1) return { warned: false }
  const inner = parseModelPattern(pattern.slice(0, colon), models)
  if (!inner.model) return inner
  const suffix = pattern.slice(colon + 1)
  if (!piThinkingLevels.includes(suffix)) {
    return { model: inner.model, warned: true }
  }
  return inner.warned
    ? inner
    : { model: inner.model, thinkingLevel: suffix, warned: false }
}

function splitThinkingSuffix(pattern: string): {
  reference: string
  thinkingLevel?: string
} {
  const colon = pattern.lastIndexOf(":")
  const suffix = pattern.slice(colon + 1)
  return colon !== -1 && piThinkingLevels.includes(suffix)
    ? { reference: pattern.slice(0, colon), thinkingLevel: suffix }
    : { reference: pattern }
}

function exactModel(reference: string, models: PiModel[]): PiModel | undefined {
  const wanted = reference.trim().toLowerCase()
  if (!wanted) return undefined
  const canonical = models.filter(
    (model) => `${model.provider}/${model.id}`.toLowerCase() === wanted
  )
  if (canonical.length === 1) return canonical[0]
  if (canonical.length > 1) return undefined
  const slash = wanted.indexOf("/")
  if (slash !== -1) {
    const provider = wanted.slice(0, slash).trim()
    const id = wanted.slice(slash + 1).trim()
    if (provider && id) {
      const byProvider = models.filter(
        (model) =>
          model.provider.toLowerCase() === provider &&
          model.id.toLowerCase() === id
      )
      if (byProvider.length === 1) return byProvider[0]
      if (byProvider.length > 1) return undefined
    }
  }
  // A bare id counts when exactly one provider offers it.
  const byId = models.filter((model) => model.id.toLowerCase() === wanted)
  return byId.length === 1 ? byId[0] : undefined
}

function partialModel(
  reference: string,
  models: PiModel[]
): PiModel | undefined {
  const wanted = reference.toLowerCase()
  const matches = models.filter(
    (model) =>
      model.id.toLowerCase().includes(wanted) ||
      model.name?.toLowerCase().includes(wanted)
  )
  if (matches.length === 0) return undefined
  const aliases = matches.filter((model) => isModelAlias(model.id))
  const candidates = aliases.length > 0 ? aliases : matches
  return [...candidates].sort((a, b) => b.id.localeCompare(a.id))[0]
}

// Pi treats an id without a trailing -YYYYMMDD date as an alias.
function isModelAlias(id: string): boolean {
  return id.endsWith("-latest") || !/-\d{8}$/.test(id)
}

// Dotted numeric versions; a missing component counts as zero.
function compareVersions(left: string, right: string): number {
  const parse = (version: string) =>
    version.split(".").map((part) => Number.parseInt(part, 10) || 0)
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

export function piActivity(event: JsonObject): ActivityStart | undefined {
  const id = getString(event, "toolCallId")
  const toolName = getString(event, "toolName")
  if (!id || !toolName) return undefined
  const args = parseJsonObject(event.args)
  const path = getString(args, "path")
  if (isShellTool(toolName)) {
    return {
      id,
      name: "Run command",
      ...detailOf(getString(args, "command")),
      payload: { kind: "tool", tool: "command" },
    }
  }
  if (toolName === "write" || toolName === "edit") {
    const files: ChangedFile[] = path ? [{ path }] : []
    return {
      id,
      name: "Change files",
      ...detailOf(path),
      payload:
        files.length > 0
          ? { kind: "file-change", files }
          : { kind: "tool", tool: "other" },
    }
  }
  if (toolName === "read") {
    return {
      id,
      name: "Read file",
      ...detailOf(path),
      payload: { kind: "tool", tool: "other" },
    }
  }
  if (toolName === "grep" || toolName === "find" || toolName === "ls") {
    return {
      id,
      name: "Search files",
      ...detailOf(getString(args, "pattern") ?? path),
      payload: { kind: "tool", tool: "search" },
    }
  }
  if (toolName === "fetch" || toolName === "web_search") {
    return {
      id,
      name: "Search web",
      ...detailOf(getString(args, "url") ?? getString(args, "query")),
      payload: { kind: "tool", tool: "web" },
    }
  }
  return {
    id,
    name: piToolLabel(toolName),
    payload: { kind: "tool", tool: "other" },
  }
}

function piToolLabel(toolName: string | undefined): string {
  if (!toolName) return "Using tool"
  if (isShellTool(toolName)) return "Run command"
  if (toolName === "write" || toolName === "edit") return "Change files"
  if (toolName === "read") return "Read file"
  if (toolName === "grep" || toolName === "find" || toolName === "ls")
    return "Search files"
  const words = toolName.replaceAll(/[-_]+/g, " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function approvalKind(toolName: string): ApprovalKind {
  if (isShellTool(toolName)) return "command"
  if (toolName === "write" || toolName === "edit") return "file-change"
  return "tool"
}

// Pi's Windows shell tool takes the same `command` input as bash.
function isShellTool(toolName: string): boolean {
  return toolName === "bash" || toolName === "powershell"
}

function detailOf(detail: string | undefined): { detail?: string } {
  return detail ? { detail: detail.slice(0, 500) } : {}
}

function piProvisioning(root: SkillRoot): SkillProvisioningResult {
  const result: SkillProvisioningResult = {
    rootId: root.id ?? root.path,
    rootPath: root.path,
    status: "configured",
    method: "skill-flag",
  }
  if (root.contentDigest) result.contentDigest = root.contentDigest
  return result
}

async function existingDirectory(path: string): Promise<string | undefined> {
  try {
    await access(path)
    return path
  } catch {
    return undefined
  }
}

/**
 * Pi's own reading of a path in `PI_CODING_AGENT_DIR`: a Git Bash or MSYS
 * drive path becomes a Windows one, `~` expands to the home folder, and a
 * `file://` URL becomes a path.
 */
export function piNormalizedPath(
  input: string,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir()
): string {
  let path = input
  if (platform === "win32") path = windowsShellPath(path)
  if (path === "~") return home
  if (path.startsWith("~/") || (platform === "win32" && path.startsWith("~\\")))
    return join(home, path.slice(2))
  if (path.startsWith("file://")) return fileURLToPath(path)
  return path
}

function windowsShellPath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
    return path
  const match = /^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i.exec(path)
  if (!match) return path
  const suffix = match[2]?.replaceAll("/", "\\")
  return `${match[1]!.toUpperCase()}:\\${suffix ?? ""}`
}

async function writeInstructions(
  directory: string,
  instructions: string
): Promise<string> {
  const folder = join(directory, "instructions")
  await mkdir(folder, { recursive: true })
  const file = join(folder, `${randomUUID()}.md`)
  await writeFile(file, instructions, "utf8")
  return file
}

async function writeApprovalExtension(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true })
  const file = join(directory, approvalExtensionFileName)
  // Sessions opening at once must never hand Pi a half-written file.
  const staging = `${file}.${randomUUID()}`
  await writeFile(staging, approvalExtensionSource, "utf8")
  await rename(staging, file)
  return file
}
