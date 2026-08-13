import { BridgeClient, type BridgeHealth, type BridgeStreamEvent } from "./bridge-client";
import type {
  ActivityEvent,
  CodexThread,
  DiscoveredRepository,
  ExecutionProvider,
  ModelOption,
  Repository,
  Task,
} from "./state";

export interface CodexThreadConfig {
  cwd: string;
  model: string;
  effort: string;
  approvalPolicy: "unlessTrusted" | "onRequest" | "never";
  sandboxMode: "workspaceWrite" | "readOnly";
  networkAccess: "disabled" | "enabled";
}

export interface CodexStreamEvent {
  id: string;
  type: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  requestId?: string;
  summary?: string;
  command?: string;
  cwd?: string;
  status?: string;
  exitCode?: number | null;
  fileName?: string;
  additions?: number;
  deletions?: number;
  output?: string;
  reason?: string;
  availableDecisions?: string[];
  timestamp: string;
}

export interface TurnStartResult {
  turnId: string | null;
  events: Omit<ActivityEvent, "id" | "taskId" | "timestamp">[];
}

export interface CodexAdapter {
  provider: ExecutionProvider;
  connect(): Promise<BridgeHealth | null>;
  disconnect(): Promise<void>;
  getAccount(): Promise<{ plan: string | null; authenticated?: boolean | null; accountType?: string | null }>;
  getModels(): Promise<ModelOption[]>;
  getRateLimits(): Promise<unknown>;
  getUsage(): Promise<unknown>;
  listRepositories(): Promise<Repository[]>;
  listThreads(): Promise<CodexThread[]>;
  getRepositoryStatus(repository: Repository): Promise<unknown>;
  startThread(config: CodexThreadConfig): Promise<{ threadId: string; sessionId: string }>;
  resumeThread(threadId: string, config: CodexThreadConfig): Promise<void>;
  forkThread(threadId: string, config: CodexThreadConfig): Promise<{ threadId: string; sessionId: string; forkedFromId: string | null }>;
  startTurn(threadId: string, config: CodexThreadConfig, prompt: string): Promise<TurnStartResult>;
  interruptTurn(threadId: string, turnId?: string): Promise<void>;
  readThread(threadId: string): Promise<unknown>;
  streamThreadEvents(): AsyncIterable<CodexStreamEvent>;
  respondToApproval(requestId: string, decision: string): Promise<void>;
  getDiff(task: Task): Promise<{ fileName: string; additions: number; deletions: number; lines: string[] }[]>;
}

export const MOCK_MODELS: ModelOption[] = [
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", defaultReasoningEffort: "High", supportedReasoningEfforts: ["Low", "Medium", "High"] },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", defaultReasoningEffort: "Medium", supportedReasoningEfforts: ["Minimal", "Low", "Medium", "High"] },
  { id: "gpt-5.5-codex", name: "GPT-5.5 Codex", defaultReasoningEffort: "Medium", supportedReasoningEfforts: ["Low", "Medium", "High"] },
];

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class MockCodexAdapter implements CodexAdapter {
  readonly provider = "mock" as const;

  async connect() { await wait(80); return null; }
  async disconnect() { await wait(40); }
  async getAccount() { return { plan: "Codex Pro", authenticated: null, accountType: "mock" }; }
  async getModels() { return MOCK_MODELS; }
  async getRateLimits() { return { primaryRemaining: 68, secondaryRemaining: 81 }; }
  async getUsage() { return { tokensToday: "18.4M" }; }
  async listRepositories() { return []; }
  async listThreads() { return []; }
  async getRepositoryStatus(repository: Repository) { return { repositoryId: repository.id, status: "unknown" }; }
  async startThread() {
    const suffix = Math.random().toString(36).slice(2, 8);
    return { threadId: `thread_mock_${suffix}`, sessionId: `session_mock_${suffix}` };
  }
  async resumeThread() { await wait(80); }
  async forkThread() {
    const suffix = Math.random().toString(36).slice(2, 8);
    return { threadId: `thread_mock_${suffix}`, sessionId: `session_mock_${suffix}`, forkedFromId: null };
  }
  async startTurn(_threadId: string, _config: CodexThreadConfig, prompt: string): Promise<TurnStartResult> {
    return {
      turnId: null,
      events: [
        { type: "agent", summary: prompt || "Continuing the task with Codex" },
        { type: "command", summary: "Running focused repository checks", command: "npm test -- --runInBand", cwd: "selected repository", status: "running" },
      ],
    };
  }
  async interruptTurn() { await wait(80); }
  async readThread(threadId: string) { return { threadId, status: "mock" }; }
  async *streamThreadEvents(): AsyncIterable<CodexStreamEvent> { yield* []; }
  async respondToApproval() { await wait(30); }
  async getDiff(task: Task) {
    return [{ fileName: task.repositoryId === "repo-backend" ? "src/auth/refresh-token.ts" : "src/features/task.ts", additions: 18, deletions: 6, lines: ["@@ -42,8 +42,20 @@ export async function refreshToken()", "-  return refresh(accessToken);", "+  if (inFlightRefresh) return inFlightRefresh;", "+  inFlightRefresh = refresh(accessToken)", "+    .finally(() => { inFlightRefresh = null; });", "+  return inFlightRefresh;"] }];
  }
}

const repoId = (localPath: string) => {
  let hash = 0;
  for (const character of localPath) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return `repo-local-${Math.abs(hash).toString(36)}`;
};

const mapRepository = (repository: DiscoveredRepository): Repository => {
  const now = new Date().toISOString();
  return {
    id: repoId(repository.localPath),
    name: repository.name,
    localPath: repository.localPath,
    githubRepo: repository.remote ?? "",
    defaultBranch: repository.defaultBranch ?? repository.currentBranch ?? "main",
    enabled: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
    connectionState: "connected",
    currentBranch: repository.currentBranch,
    remote: repository.remote,
    dirty: repository.dirty,
    lastCommit: repository.lastCommit,
    lastSeen: repository.lastSeen,
  };
};

const mapStreamEvent = (event: BridgeStreamEvent): CodexStreamEvent => ({ ...event });

export class LocalCodexAdapter implements CodexAdapter {
  readonly provider = "local" as const;
  private readonly bridge = new BridgeClient();

  connect() { return this.bridge.health(); }
  async disconnect() { /* The bridge owns the long-lived App Server process. */ }
  async getAccount() {
    const response = await this.bridge.account();
    const account = response.account && typeof response.account === "object" ? response.account as Record<string, unknown> : null;
    return { plan: typeof account?.planType === "string" ? account.planType : null, authenticated: account !== null || !response.requiresOpenaiAuth, accountType: typeof account?.type === "string" ? account.type : null };
  }
  async getModels() { return (await this.bridge.models()).models; }
  getRateLimits() { return this.bridge.rateLimits(); }
  getUsage() { return this.bridge.usage(); }
  async listRepositories() { return (await this.bridge.repositories()).repositories.map(mapRepository); }
  async listThreads() { return (await this.bridge.threads()).threads; }
  getRepositoryStatus(repository: Repository) { return this.bridge.repositoryStatus(repository.localPath); }
  async startThread(config: CodexThreadConfig) {
    const result = await this.bridge.startThread(config);
    return { threadId: result.threadId, sessionId: result.sessionId };
  }
  async resumeThread(threadId: string, config: CodexThreadConfig) { await this.bridge.resumeThread(threadId, config); }
  forkThread(threadId: string, config: CodexThreadConfig) { return this.bridge.forkThread(threadId, config); }
  async startTurn(threadId: string, config: CodexThreadConfig, prompt: string) { return { turnId: (await this.bridge.startTurn(threadId, config, prompt)).turnId, events: [] }; }
  async interruptTurn(threadId: string, turnId?: string) {
    if (!turnId) throw new Error("The active Codex turn has no turn ID yet.");
    await this.bridge.interruptTurn(threadId, turnId);
  }
  readThread(threadId: string) { return this.bridge.readThread(threadId); }
  async *streamThreadEvents() {
    for await (const event of this.bridge.events()) yield mapStreamEvent(event);
  }
  async respondToApproval(requestId: string, decision: string) { await this.bridge.respondToApproval(requestId, decision); }
  async getDiff(task: Task) {
    const repository = task.cwd ?? task.repositoryId;
    return (await this.bridge.diff(repository)).files;
  }
}
