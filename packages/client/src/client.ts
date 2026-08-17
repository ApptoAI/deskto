import type {
  JsonObject,
  ManagedSkillDraft,
  RequestFor,
  RuntimeEvent,
  RuntimeMethod,
  RuntimeResponses,
  RuntimeTransport,
  SkillLookupContext,
} from "@deskto/protocol"
import { turnInputSchema } from "@deskto/protocol"
import type { TurnInput } from "@deskto/protocol"

export type { SkillLookupContext } from "@deskto/protocol"

export class RuntimeClientError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "RuntimeClientError"
  }
}

export class RuntimeClient {
  constructor(private readonly transport: RuntimeTransport) {}

  async request<M extends RuntimeMethod>(
    request: RequestFor<M>
  ): Promise<RuntimeResponses[M]> {
    const response = await this.transport.request(request)
    if (!response.ok)
      throw new RuntimeClientError(response.error.code, response.error.message)
    return response.data
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    return this.transport.subscribe(listener)
  }

  listHarnesses() {
    return this.request({ method: "harness.list", params: {} })
  }

  setHarnessEnabled(harnessId: string, enabled: boolean) {
    return this.request({
      method: "harness.setEnabled",
      params: { harnessId, enabled },
    })
  }

  refreshHarnesses() {
    return this.request({ method: "harness.refresh", params: {} })
  }

  getPreferences(workspaceId: string) {
    return this.request({ method: "preferences.get", params: { workspaceId } })
  }

  getSettings() {
    return this.request({ method: "settings.get", params: {} })
  }

  /** Applies setting overrides; a null entry clears one back to its default. */
  updateSettings(entries: JsonObject) {
    return this.request({ method: "settings.update", params: { entries } })
  }

  listWorkspaces() {
    return this.request({ method: "workspace.list", params: {} })
  }

  createWorkspace(name: string, color: string, icon: string) {
    return this.request({
      method: "workspace.create",
      params: { name, color, icon },
    })
  }

  updateWorkspace(
    workspaceId: string,
    patch: { name?: string; color?: string; icon?: string }
  ) {
    return this.request({
      method: "workspace.update",
      params: { workspaceId, ...patch },
    })
  }

  deleteWorkspace(workspaceId: string) {
    return this.request({ method: "workspace.delete", params: { workspaceId } })
  }

  getSelection() {
    return this.request({ method: "selection.get", params: {} })
  }

  setSelection(workspaceId: string, projectId?: string) {
    return this.request({
      method: "selection.set",
      params: { workspaceId, projectId },
    })
  }

  listPacks() {
    return this.request({ method: "pack.list", params: {} })
  }

  createPack(name: string) {
    return this.request({ method: "pack.create", params: { name } })
  }

  installPackFromFolder(path: string) {
    return this.request({
      method: "pack.install",
      params: { source: { kind: "folder", path } },
    })
  }

  installPackFromZip(path: string) {
    return this.request({
      method: "pack.install",
      params: { source: { kind: "zip", path } },
    })
  }

  linkPack(path: string) {
    return this.request({ method: "pack.link", params: { path } })
  }

  unlinkPack(packId: string) {
    return this.request({ method: "pack.unlink", params: { packId } })
  }

  uninstallPack(packId: string) {
    return this.request({ method: "pack.uninstall", params: { packId } })
  }

  setWorkspacePack(workspaceId: string, packId: string, attached: boolean) {
    return this.request({
      method: "workspace.setPack",
      params: { workspaceId, packId, attached },
    })
  }

  listWorkspaceSkills(workspaceId: string) {
    return this.request({
      method: "workspace.listSkills",
      params: { workspaceId },
    })
  }

  listSkillsForProject(projectId: string) {
    return this.request({
      method: "skill.listForProject",
      params: { projectId },
    })
  }

  listSkillsForWorkspace(workspaceId: string) {
    return this.request({
      method: "skill.listForWorkspace",
      params: { workspaceId },
    })
  }

  listSkillsOnComputer() {
    return this.request({ method: "skill.listOnComputer", params: {} })
  }

  getSkill(occurrenceId: string, context?: SkillLookupContext) {
    return this.request({
      method: "skill.get",
      params: { occurrenceId, ...context },
    })
  }

  createManagedSkill(packId: string, draft: ManagedSkillDraft) {
    return this.request({
      method: "skill.createManaged",
      params: { packId, ...draft },
    })
  }

  updateManagedSkill(
    packId: string,
    directoryName: string,
    draft: ManagedSkillDraft
  ) {
    return this.request({
      method: "skill.updateManaged",
      params: { packId, directoryName, ...draft },
    })
  }

  listProjects() {
    return this.request({ method: "project.list", params: {} })
  }

  addProject(path: string, name: string, workspaceId: string) {
    return this.request({
      method: "project.add",
      params: { path, name, workspaceId },
    })
  }

  moveProject(projectId: string, workspaceId: string) {
    return this.request({
      method: "project.move",
      params: { projectId, workspaceId },
    })
  }

  searchProjectEntries(projectId: string, query: string, limit = 50) {
    return this.request({
      method: "project.searchEntries",
      params: { projectId, query, limit },
    })
  }

  listThreads(projectId: string) {
    return this.request({ method: "thread.list", params: { projectId } })
  }

  createThread(
    projectId: string,
    harnessId: string,
    executionProfile?: RequestFor<"thread.create">["params"]["executionProfile"],
    options: Pick<
      RequestFor<"thread.create">["params"],
      "parentThreadId" | "title"
    > = {}
  ) {
    return this.request({
      method: "thread.create",
      params: { projectId, harnessId, executionProfile, ...options },
    })
  }

  searchThreads(
    originThreadId: string,
    query: string,
    scope: RequestFor<"thread.search">["params"]["scope"] = "project",
    limit = 10
  ) {
    return this.request({
      method: "thread.search",
      params: { originThreadId, query, scope, limit },
    })
  }

  configureThread(
    threadId: string,
    executionProfile: RequestFor<"thread.configure">["params"]["executionProfile"]
  ) {
    return this.request({
      method: "thread.configure",
      params: { threadId, executionProfile },
    })
  }

  getThread(threadId: string) {
    return this.request({ method: "thread.get", params: { threadId } })
  }

  setThreadDone(threadId: string, done: boolean) {
    return this.request({
      method: "thread.setDone",
      params: { threadId, done },
    })
  }

  snoozeThread(threadId: string, until: string) {
    return this.request({
      method: "thread.snooze",
      params: { threadId, until },
    })
  }

  wakeThread(threadId: string) {
    return this.request({ method: "thread.wake", params: { threadId } })
  }

  setThreadPinned(threadId: string, pinned: boolean) {
    return this.request({
      method: "thread.setPinned",
      params: { threadId, pinned },
    })
  }

  markThreadVisited(threadId: string) {
    return this.request({ method: "thread.markVisited", params: { threadId } })
  }

  deleteThread(threadId: string) {
    return this.request({ method: "thread.delete", params: { threadId } })
  }

  listFiles(threadId: string) {
    return this.request({ method: "artifact.list", params: { threadId } })
  }

  listTurnOutputs(threadId: string) {
    return this.request({
      method: "artifact.listOutputs",
      params: { threadId },
    })
  }

  previewArtifact(threadId: string, artifactId: string) {
    return this.request({
      method: "artifact.preview",
      params: { threadId, artifactId },
    })
  }

  previewAttachment(threadId: string, attachmentId: string) {
    return this.request({
      method: "attachment.preview",
      params: { threadId, attachmentId },
    })
  }

  writeArtifact(
    threadId: string,
    artifactId: string,
    content: string,
    baseUpdatedAt: string
  ) {
    return this.request({
      method: "artifact.write",
      params: { threadId, artifactId, content, baseUpdatedAt },
    })
  }

  startTurn(threadId: string, input: TurnInput | string) {
    const parsedInput = turnInputSchema.safeParse(input)
    return this.request({
      method: "turn.start",
      params: parsedInput.success
        ? { threadId, input: parsedInput.data }
        : { threadId, prompt: String(input) },
    })
  }

  cancelTurn(threadId: string) {
    return this.request({ method: "turn.cancel", params: { threadId } })
  }

  resolveApproval(
    threadId: string,
    approvalId: string,
    decision: "approve" | "deny"
  ) {
    return this.request({
      method: "approval.resolve",
      params: { threadId, approvalId, decision },
    })
  }
}
