import type { ModelListResponse } from "./generated/codex-app-server/v2/ModelListResponse.ts";
import type { ThreadForkResponse } from "./generated/codex-app-server/v2/ThreadForkResponse.ts";
import type { Thread } from "./generated/codex-app-server/v2/Thread.ts";
import type { ThreadListResponse } from "./generated/codex-app-server/v2/ThreadListResponse.ts";
import type { ThreadReadResponse } from "./generated/codex-app-server/v2/ThreadReadResponse.ts";
import type { ThreadResumeResponse } from "./generated/codex-app-server/v2/ThreadResumeResponse.ts";
import type { ThreadStartResponse } from "./generated/codex-app-server/v2/ThreadStartResponse.ts";
import type { TurnStartResponse } from "./generated/codex-app-server/v2/TurnStartResponse.ts";
import type { GetAccountResponse } from "./generated/codex-app-server/v2/GetAccountResponse.ts";
import type { GetAccountRateLimitsResponse } from "./generated/codex-app-server/v2/GetAccountRateLimitsResponse.ts";
import type { GetAccountTokenUsageResponse } from "./generated/codex-app-server/v2/GetAccountTokenUsageResponse.ts";
import type { BridgeEvent, BridgeModel, BridgeTaskConfig, BridgeThread, BridgeThreadStatus } from "./types.ts";
import { AppServerProcess } from "./app-server.ts";
import type { RpcMessage } from "./rpc.ts";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const text = (value: unknown) => typeof value === "string" ? value : null;

const normalizedEffort = (value: unknown) => text(value)?.toLowerCase() ?? "medium";

const approvalPolicy = (value: BridgeTaskConfig["approvalPolicy"]) => {
  if (value === "never") return "never";
  if (value === "onRequest") return "on-request";
  return "untrusted";
};

const sandboxPolicy = (config: BridgeTaskConfig) => {
  const networkAccess = config.networkAccess === "enabled";
  if (config.sandboxMode === "readOnly") return { type: "readOnly", networkAccess };
  return {
    type: "workspaceWrite",
    writableRoots: [config.cwd],
    networkAccess,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
};

const threadStartSandbox = (config: BridgeTaskConfig) => config.sandboxMode === "readOnly" ? "read-only" : "workspace-write";

const threadTimestamp = (value: number | null) => value == null ? null : new Date(value * 1000).toISOString();
const threadSource = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const key = Object.keys(value as Record<string, unknown>)[0];
    return key ?? "unknown";
  }
  return "unknown";
};
const threadStatus = (value: Thread["status"]): BridgeThreadStatus => value.type === "active" ? "running" : value.type === "systemError" ? "error" : value.type;

export function normalizeThread(thread: Thread): BridgeThread {
  return {
    id: thread.id,
    sessionId: thread.sessionId,
    forkedFromId: thread.forkedFromId,
    name: thread.name,
    preview: thread.preview,
    cwd: String(thread.cwd),
    modelProvider: thread.modelProvider,
    status: threadStatus(thread.status),
    isPinned: thread.isPinned,
    createdAt: threadTimestamp(thread.createdAt) ?? new Date(0).toISOString(),
    updatedAt: threadTimestamp(thread.updatedAt) ?? new Date(0).toISOString(),
    recencyAt: threadTimestamp(thread.recencyAt),
    source: threadSource(thread.source),
    threadSource: thread.threadSource,
    canAcceptDirectInput: thread.canAcceptDirectInput,
  };
}

export function normalizeItem(item: unknown, threadId?: string, turnId?: string): BridgeEvent | null {
  const candidate = asRecord(item);
  const itemType = text(candidate.type);
  const itemId = text(candidate.id) ?? undefined;
  if (!itemType) return null;
  const base = { id: `${threadId ?? "unknown"}:${turnId ?? "unknown"}:${itemId ?? itemType}`, threadId, turnId, itemId, timestamp: new Date().toISOString() };
  if (itemType === "agentMessage") return { ...base, type: "agent", summary: text(candidate.text) ?? "Agent message" };
  if (itemType === "commandExecution") {
    return {
      ...base,
      type: "command",
      summary: text(candidate.command) ?? "Command execution",
      command: text(candidate.command) ?? undefined,
      cwd: text(candidate.cwd) ?? undefined,
      status: text(candidate.status) ?? undefined,
      exitCode: typeof candidate.exitCode === "number" ? candidate.exitCode : null,
      output: text(candidate.aggregatedOutput) ?? undefined,
    };
  }
  if (itemType === "fileChange") {
    const changes = Array.isArray(candidate.changes) ? candidate.changes : [];
    const first = asRecord(changes[0]);
    const diff = text(first.diff) ?? "";
    return {
      ...base,
      type: "file",
      summary: changes.length > 1 ? `${changes.length} files changed` : `${text(first.path) ?? "File"} changed`,
      fileName: text(first.path) ?? undefined,
      additions: diff.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++" )).length,
      deletions: diff.split(/\r?\n/).filter((line) => line.startsWith("-") && !line.startsWith("---" )).length,
      output: diff || undefined,
      status: text(candidate.status) ?? undefined,
    };
  }
  if (itemType === "mcpToolCall" || itemType === "dynamicToolCall") {
    return { ...base, type: "tool", summary: text(candidate.tool) ?? "Tool call", status: text(candidate.status) ?? undefined };
  }
  return { ...base, type: "agent", summary: `${itemType} item completed` };
}

let eventSequence = 0;

export function normalizeNotification(message: RpcMessage): BridgeEvent | null {
  if (!message.method) return null;
  const params = asRecord(message.params);
  const threadId = text(params.threadId) ?? undefined;
  const turn = asRecord(params.turn);
  const turnId = text(turn.id) ?? undefined;
  const id = `${Date.now()}-${eventSequence++}`;
  if (message.method === "thread/started") return { id, type: "thread_started", threadId: text(asRecord(params.thread).id) ?? undefined, timestamp: new Date().toISOString() };
  if (message.method === "turn/started") return { id, type: "turn_started", threadId, turnId, timestamp: new Date().toISOString() };
  if (message.method === "turn/completed") return { id, type: "turn_completed", threadId, turnId, status: text(turn.status) ?? undefined, summary: text(asRecord(turn.error).message) ?? "Turn completed", timestamp: new Date().toISOString() };
  if (message.method === "error") return { id, type: "error", threadId, turnId, summary: text(asRecord(params.error).message) ?? "Codex App Server error", timestamp: new Date().toISOString() };
  if (message.method === "item/agentMessage/delta") return { id, type: "agent", threadId, turnId, itemId: text(params.itemId) ?? undefined, summary: text(params.delta) ?? "", timestamp: new Date().toISOString() };
  if (message.method === "item/commandExecution/outputDelta") return { id, type: "command", threadId, turnId, itemId: text(params.itemId) ?? undefined, summary: text(params.delta) ?? "", output: text(params.delta) ?? undefined, status: "running", timestamp: new Date().toISOString() };
  if (message.method === "item/fileChange/patchUpdated") return { id, type: "file", threadId, turnId, itemId: text(params.itemId) ?? undefined, summary: "File change updated", payload: params.changes, timestamp: new Date().toISOString() };
  if (message.method === "turn/diff/updated") return { id, type: "diff", threadId, turnId, summary: "Working diff updated", output: text(params.diff) ?? undefined, timestamp: new Date().toISOString() };
  if (message.method === "item/started" || message.method === "item/completed") {
    return normalizeItem(params.item, threadId, turnId) ?? { id, type: "unknown", threadId, turnId, summary: message.method, timestamp: new Date().toISOString() };
  }
  return { id, type: "unknown", summary: message.method, payload: { keys: Object.keys(params) }, timestamp: new Date().toISOString() };
}

export class CodexAppServerClient {
  private readonly process: AppServerProcess;

  constructor(process: AppServerProcess) {
    this.process = process;
  }

  async models() {
    const models: BridgeModel[] = [];
    let cursor: string | null = null;
    do {
      const response: ModelListResponse = await this.process.request<ModelListResponse>("model/list", { cursor, limit: 100, includeHidden: false });
      for (const model of response.data) {
        if (model.hidden) continue;
        models.push({
          id: model.id,
          name: model.displayName || model.model || model.id,
          defaultReasoningEffort: normalizedEffort(model.defaultReasoningEffort),
          supportedReasoningEfforts: model.supportedReasoningEfforts.map((option: { reasoningEffort: string }) => normalizedEffort(option.reasoningEffort)),
        });
      }
      cursor = response.nextCursor;
    } while (cursor);
    return models;
  }

  async listThreads(): Promise<BridgeThread[]> {
    const threads: BridgeThread[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const response: ThreadListResponse = await this.process.request<ThreadListResponse>("thread/list", {
        cursor,
        limit: 100,
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: false,
        useStateDbOnly: true,
      });
      threads.push(...response.data.map(normalizeThread));
      cursor = response.nextCursor;
      if (!cursor) break;
    }
    return threads;
  }

  account() {
    return this.process.request<GetAccountResponse>("account/read", { refreshToken: false });
  }

  rateLimits() {
    return this.process.request<GetAccountRateLimitsResponse>("account/rateLimits/read", undefined);
  }

  usage() {
    return this.process.request<GetAccountTokenUsageResponse>("account/usage/read", undefined);
  }

  async startThread(config: BridgeTaskConfig) {
    const response = await this.process.request<ThreadStartResponse>("thread/start", {
      model: config.model,
      cwd: config.cwd,
      runtimeWorkspaceRoots: [config.cwd],
      approvalPolicy: approvalPolicy(config.approvalPolicy),
      sandbox: threadStartSandbox(config),
      threadSource: "codex-board",
    });
    return { threadId: response.thread.id, sessionId: response.thread.sessionId, cwd: response.cwd, model: response.model, reasoningEffort: response.reasoningEffort };
  }

  async resumeThread(threadId: string, config: BridgeTaskConfig) {
    const response = await this.process.request<ThreadResumeResponse>("thread/resume", {
      threadId,
      cwd: config.cwd,
      runtimeWorkspaceRoots: [config.cwd],
      approvalPolicy: approvalPolicy(config.approvalPolicy),
      sandbox: threadStartSandbox(config),
      excludeTurns: true,
    });
    return { threadId: response.thread.id, sessionId: response.thread.sessionId, cwd: response.cwd, model: response.model, reasoningEffort: response.reasoningEffort };
  }

  async forkThread(threadId: string, config: BridgeTaskConfig) {
    const response = await this.process.request<ThreadForkResponse>("thread/fork", {
      threadId,
      cwd: config.cwd,
      runtimeWorkspaceRoots: [config.cwd],
      approvalPolicy: approvalPolicy(config.approvalPolicy),
      sandbox: threadStartSandbox(config),
      excludeTurns: true,
    });
    return { threadId: response.thread.id, sessionId: response.thread.sessionId, forkedFromId: response.thread.forkedFromId, cwd: response.cwd, model: response.model, reasoningEffort: response.reasoningEffort };
  }

  async startTurn(threadId: string, config: BridgeTaskConfig, prompt: string) {
    const response = await this.process.request<TurnStartResponse>("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt, text_elements: [] }],
      cwd: config.cwd,
      runtimeWorkspaceRoots: [config.cwd],
      approvalPolicy: approvalPolicy(config.approvalPolicy),
      sandboxPolicy: sandboxPolicy(config),
      model: config.model,
      effort: normalizedEffort(config.effort),
    });
    return { turnId: response.turn.id };
  }

  interruptTurn(threadId: string, turnId: string) {
    return this.process.request("turn/interrupt", { threadId, turnId });
  }

  readThread(threadId: string) {
    return this.process.request<ThreadReadResponse>("thread/read", { threadId, includeTurns: true });
  }

  respondToApproval(request: { id: number | string; method: string }, decision: string) {
    if (request.method === "item/commandExecution/requestApproval") return this.process.respond(request.id, { decision });
    if (request.method === "item/fileChange/requestApproval") return this.process.respond(request.id, { decision });
    throw new Error("This Codex approval type is not supported by the bridge.");
  }

  subscribe(listener: (event: BridgeEvent) => void) {
    return this.process.onNotification((message) => {
      const event = normalizeNotification(message);
      if (event) listener(event);
    });
  }
}
