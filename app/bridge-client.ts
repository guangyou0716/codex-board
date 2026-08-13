import type { CodexThread, DiscoveredRepository } from "./state";

export interface BridgeHealth {
  status: "offline" | "connecting" | "online" | "degraded" | "error";
  bridgeVersion: string;
  codexExecutable: "detected" | "missing";
  codexVersion: string | null;
  appServer: "running" | "stopped" | "starting" | "error";
  authenticated: boolean | null;
  accountType: string | null;
  plan: string | null;
  platform: string;
  hostname: string;
  approvedRoots: string[];
  repositoriesDiscovered: number | null;
  modelsAvailable: number | null;
  capabilities: string[];
  lastSeenAt: string | null;
  error: string | null;
}

export interface BridgeStreamEvent {
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

type BridgeResponse<T> = { data?: T; error?: string };

function bridgeUrl() {
  if (typeof window !== "undefined" && window.__CODEX_BRIDGE_URL__) return window.__CODEX_BRIDGE_URL__.replace(/\/$/, "");
  return "http://127.0.0.1:4321";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${bridgeUrl()}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const payload = await response.json() as BridgeResponse<T> & T;
  if (!response.ok) throw new Error(payload.error ?? "Local Codex bridge request failed.");
  return payload as T;
}

export class BridgeClient {
  health() { return request<BridgeHealth>("/v1/health"); }
  models() { return request<{ models: import("./state").ModelOption[] }>("/v1/models"); }
  account() { return request<{ account: unknown; requiresOpenaiAuth: boolean }>("/v1/account"); }
  rateLimits() { return request<unknown>("/v1/rate-limits"); }
  usage() { return request<unknown>("/v1/usage"); }
  repositories() { return request<{ repositories: DiscoveredRepository[] }>("/v1/repositories"); }
  threads() { return request<{ threads: CodexThread[] }>("/v1/threads"); }
  repositoryStatus(path: string) { return request<DiscoveredRepository>("/v1/repositories/status", { method: "POST", body: JSON.stringify({ path }) }); }
  startThread(config: unknown) { return request<{ threadId: string; sessionId: string; cwd: string; model: string; reasoningEffort: string | null }>("/v1/threads", { method: "POST", body: JSON.stringify(config) }); }
  resumeThread(threadId: string, config: unknown) { return request<{ threadId: string; sessionId: string; cwd: string; model: string; reasoningEffort: string | null }>(`/v1/threads/${encodeURIComponent(threadId)}/resume`, { method: "POST", body: JSON.stringify({ config }) }); }
  forkThread(threadId: string, config: unknown) { return request<{ threadId: string; sessionId: string; forkedFromId: string | null }>(`/v1/threads/${encodeURIComponent(threadId)}/fork`, { method: "POST", body: JSON.stringify({ config }) }); }
  startTurn(threadId: string, config: unknown, prompt: string) { return request<{ turnId: string }>(`/v1/threads/${encodeURIComponent(threadId)}/turns`, { method: "POST", body: JSON.stringify({ config, prompt }) }); }
  interruptTurn(threadId: string, turnId: string) { return request<unknown>(`/v1/threads/${encodeURIComponent(threadId)}/interrupt`, { method: "POST", body: JSON.stringify({ turnId }) }); }
  readThread(threadId: string) { return request<unknown>(`/v1/threads/${encodeURIComponent(threadId)}`); }
  diff(path: string) { return request<{ files: { fileName: string; additions: number; deletions: number; lines: string[] }[] }>(`/v1/diff?path=${encodeURIComponent(path)}`); }
  respondToApproval(requestId: string, decision: string) { return request<{ ok: true }>(`/v1/approvals/${encodeURIComponent(requestId)}`, { method: "POST", body: JSON.stringify({ decision }) }); }

  async *events(): AsyncIterable<BridgeStreamEvent> {
    if (typeof EventSource === "undefined") throw new Error("This browser does not support local bridge event streaming.");
    const source = new EventSource(`${bridgeUrl()}/v1/events`);
    const queue: BridgeStreamEvent[] = [];
    let wake: (() => void) | null = null;
    let closed = false;
    const onMessage = (event: MessageEvent<string>) => { try { queue.push(JSON.parse(event.data) as BridgeStreamEvent); wake?.(); } catch { /* ignore malformed browser event */ } };
    source.addEventListener("message", onMessage);
    try {
      while (!closed) {
        if (queue.length === 0) await new Promise<void>((resolve) => { wake = resolve; });
        while (queue.length) yield queue.shift()!;
      }
    } finally {
      closed = true;
      source.removeEventListener("message", onMessage);
      source.close();
    }
  }
}

declare global {
  interface Window {
    __CODEX_BRIDGE_URL__?: string;
  }
}
