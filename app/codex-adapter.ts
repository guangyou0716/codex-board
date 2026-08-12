import type {
  ActivityEvent,
  ModelOption,
  Repository,
  Task,
} from "./state";

export interface CodexThreadConfig {
  cwd: string;
  model: string;
  effort: string;
  approvalPolicy: string;
  sandboxMode: string;
  networkAccess: string;
}

export interface CodexAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getAccount(): Promise<{ plan: string | null }>;
  getModels(): Promise<ModelOption[]>;
  getRateLimits(): Promise<unknown>;
  getUsage(): Promise<unknown>;
  listRepositories(): Promise<Repository[]>;
  getRepositoryStatus(repository: Repository): Promise<unknown>;
  startThread(config: CodexThreadConfig): Promise<{ threadId: string; sessionId: string }>;
  resumeThread(threadId: string): Promise<void>;
  startTurn(threadId: string, config: CodexThreadConfig, prompt: string): Promise<Omit<ActivityEvent, "id" | "taskId" | "timestamp">[]>;
  interruptTurn(threadId: string): Promise<void>;
  readThread(threadId: string): Promise<unknown>;
  streamThreadEvents(threadId: string): AsyncIterable<ActivityEvent>;
  getDiff(task: Task): Promise<{ fileName: string; additions: number; deletions: number; lines: string[] }[]>;
}

export const MOCK_MODELS: ModelOption[] = [
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    defaultReasoningEffort: "High",
    supportedReasoningEfforts: ["Low", "Medium", "High"],
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    defaultReasoningEffort: "Medium",
    supportedReasoningEfforts: ["Minimal", "Low", "Medium", "High"],
  },
  {
    id: "gpt-5.5-codex",
    name: "GPT-5.5 Codex",
    defaultReasoningEffort: "Medium",
    supportedReasoningEfforts: ["Low", "Medium", "High"],
  },
];

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class MockCodexAdapter implements CodexAdapter {
  async connect() {
    await wait(160);
  }

  async disconnect() {
    await wait(80);
  }

  async getAccount() {
    return { plan: "Codex Pro" };
  }

  async getModels() {
    return MOCK_MODELS;
  }

  async getRateLimits() {
    return { primaryRemaining: 68, secondaryRemaining: 81 };
  }

  async getUsage() {
    return { tokensToday: "18.4M" };
  }

  async listRepositories() {
    return [];
  }

  async getRepositoryStatus(repository: Repository) {
    return { repositoryId: repository.id, status: "unknown" };
  }

  async startThread() {
    const suffix = Math.random().toString(36).slice(2, 8);
    return {
      threadId: `thread_mock_${suffix}`,
      sessionId: `session_mock_${suffix}`,
    };
  }

  async resumeThread() {
    await wait(120);
  }

  async startTurn(threadId: string, _config: CodexThreadConfig, prompt: string) {
    return [
      { type: "agent", summary: prompt || "Continuing the task with Codex" },
      { type: "command", summary: "Running focused repository checks", command: "npm test -- --runInBand", cwd: "selected repository", status: "running" },
    ];
  }

  async interruptTurn() {
    await wait(80);
  }

  async readThread(threadId: string) {
    return { threadId, status: "mock" };
  }

  async *streamThreadEvents() {
    yield* [];
  }

  async getDiff(task: Task) {
    return [
      {
        fileName: task.repositoryId === "repo-backend" ? "src/auth/refresh-token.ts" : "src/features/task.ts",
        additions: 18,
        deletions: 6,
        lines: [
          "@@ -42,8 +42,20 @@ export async function refreshToken()",
          "-  return refresh(accessToken);",
          "+  if (inFlightRefresh) return inFlightRefresh;",
          "+  inFlightRefresh = refresh(accessToken)",
          "+    .finally(() => { inFlightRefresh = null; });",
          "+  return inFlightRefresh;",
        ],
      },
    ];
  }
}

/**
 * Production boundary for the secure local bridge. It deliberately refuses to
 * claim connectivity until the bridge implements the App Server handshake.
 */
export class LocalCodexAdapter implements CodexAdapter {
  private unavailable(): never {
    throw new Error("Local Codex host offline. Connect the approved bridge before using computer-backed actions.");
  }

  connect(): Promise<void> { return Promise.reject(this.unavailable()); }
  disconnect(): Promise<void> { return Promise.reject(this.unavailable()); }
  getAccount(): Promise<{ plan: string | null }> { return Promise.reject(this.unavailable()); }
  getModels(): Promise<ModelOption[]> { return Promise.reject(this.unavailable()); }
  getRateLimits(): Promise<unknown> { return Promise.reject(this.unavailable()); }
  getUsage(): Promise<unknown> { return Promise.reject(this.unavailable()); }
  listRepositories(): Promise<Repository[]> { return Promise.reject(this.unavailable()); }
  getRepositoryStatus(): Promise<unknown> { return Promise.reject(this.unavailable()); }
  startThread(): Promise<{ threadId: string; sessionId: string }> { return Promise.reject(this.unavailable()); }
  resumeThread(): Promise<void> { return Promise.reject(this.unavailable()); }
  startTurn(): Promise<Omit<ActivityEvent, "id" | "taskId" | "timestamp">[]> { return Promise.reject(this.unavailable()); }
  interruptTurn(): Promise<void> { return Promise.reject(this.unavailable()); }
  readThread(): Promise<unknown> { return Promise.reject(this.unavailable()); }
  async *streamThreadEvents(): AsyncIterable<ActivityEvent> { yield* []; }
  getDiff(): Promise<{ fileName: string; additions: number; deletions: number; lines: string[] }[]> { return Promise.reject(this.unavailable()); }
}
