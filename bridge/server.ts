import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { hostname, platform } from "node:os";
import { pathToFileURL, URL } from "node:url";
import { ApprovedRoots, loadApprovedRoots, PathSecurityError } from "./path-security.ts";
import { discoverRepositories, readDiff, readRepository } from "./git.ts";
import { AppServerProcess, type AppServerServerRequest } from "./app-server.ts";
import { CodexAppServerClient } from "./codex-client.ts";
import type { BridgeDiagnostics, BridgeEvent, BridgeTaskConfig } from "./types.ts";

const BRIDGE_VERSION = "0.2.0";
const DEFAULT_PORT = 4321;
const DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://codex-board.guangyou1386.chatgpt.site",
];
const CAPABILITIES = [
  "account/read",
  "account/rateLimits/read",
  "account/usage/read",
  "model/list",
  "thread/start",
  "thread/resume",
  "thread/fork",
  "thread/read",
  "turn/start",
  "turn/interrupt",
  "git/status",
  "git/diff",
];

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const stringValue = (value: unknown) => typeof value === "string" ? value : null;
const log = (level: "info" | "warn" | "error", component: string, fields: Record<string, unknown> = {}) => {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level, component, ...fields }));
};

function allowedDecisions(method: string) {
  return method === "item/commandExecution/requestApproval"
    ? ["accept", "acceptForSession", "decline", "cancel"]
    : ["accept", "acceptForSession", "decline", "cancel"];
}

function parseConfig(value: unknown): BridgeTaskConfig {
  const record = asRecord(value);
  const approval = record.approvalPolicy === "onRequest" || record.approvalPolicy === "never" ? record.approvalPolicy : "unlessTrusted";
  const sandbox = record.sandboxMode === "readOnly" ? "readOnly" : "workspaceWrite";
  const network = record.networkAccess === "enabled" ? "enabled" : "disabled";
  if (typeof record.cwd !== "string" || typeof record.model !== "string" || typeof record.effort !== "string") throw new Error("cwd, model, and effort are required.");
  return { cwd: record.cwd, model: record.model, effort: record.effort, approvalPolicy: approval, sandboxMode: sandbox, networkAccess: network };
}

class BridgeService {
  readonly process = new AppServerProcess();
  readonly codex = new CodexAppServerClient(this.process);
  private roots: ApprovedRoots = null as unknown as ApprovedRoots;
  private lastError: string | null = null;
  private authenticated: boolean | null = null;
  private accountType: string | null = null;
  private plan: string | null = null;
  private repositoriesDiscovered: number | null = null;
  private modelsAvailable: number | null = null;
  private lastSeenAt: string | null = null;
  private readonly subscribers = new Set<(event: BridgeEvent) => void>();
  private readonly approvals = new Map<string, AppServerServerRequest>();

  async initialize() {
    this.roots = await loadApprovedRoots();
    this.codex.subscribe((event) => this.publish(event));
    this.process.onServerRequest((request) => this.handleServerRequest(request));
    this.process.onLifecycle((event) => {
      if (event.type === "exited") {
        this.lastError = "Codex App Server stopped.";
        log("warn", "app-server", { event: event.type, code: event.code, signal: event.signal });
      } else if (event.type === "protocol_error") {
        this.lastError = "Malformed JSONL received from Codex App Server.";
        log("error", "app-server", { event: event.type });
      }
    });
    await this.tryStart();
  }

  private async tryStart() {
    try {
      await this.process.start();
      this.lastError = null;
      this.lastSeenAt = new Date().toISOString();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      log("warn", "app-server", { event: "start_failed", message: "Codex App Server could not be started." });
    }
  }

  private handleServerRequest(request: AppServerServerRequest) {
    if (request.method === "currentTime/read") {
      this.process.respond(request.id, { currentTimeAt: Math.floor(Date.now() / 1000) });
      return;
    }
    if (request.method === "account/chatgptAuthTokens/refresh") {
      this.process.respondError(request.id, -32001, "Codex Board does not handle credential refresh requests.");
      this.authenticated = false;
      this.lastError = "Codex authentication is required in the local Codex runtime.";
      return;
    }
    this.approvals.set(String(request.id), request);
    const params = asRecord(request.params);
    this.publish({
      id: `approval:${String(request.id)}`,
      type: request.method.includes("Approval") || request.method.includes("approval") ? "approval" : "unknown_request",
      requestId: String(request.id),
      threadId: stringValue(params.threadId) ?? undefined,
      turnId: stringValue(params.turnId) ?? undefined,
      itemId: stringValue(params.itemId) ?? undefined,
      command: stringValue(params.command) ?? undefined,
      cwd: stringValue(params.cwd) ?? undefined,
      reason: stringValue(params.reason) ?? undefined,
      availableDecisions: allowedDecisions(request.method),
      summary: request.method.includes("Approval") || request.method.includes("approval") ? "Approval required" : `${request.method} request received`,
      timestamp: new Date().toISOString(),
    });
  }

  private publish(event: BridgeEvent) {
    this.lastSeenAt = new Date().toISOString();
    for (const subscriber of this.subscribers) subscriber(event);
  }

  subscribe(listener: (event: BridgeEvent) => void) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  diagnostics(): BridgeDiagnostics {
    const running = this.process.isRunning;
    const missing = this.lastError?.includes("ENOENT") ?? false;
    return {
      status: this.lastError ? (running ? "degraded" : "error") : running ? this.authenticated === false ? "degraded" : "online" : "offline",
      bridgeVersion: BRIDGE_VERSION,
      codexExecutable: missing ? "missing" : "detected",
      codexVersion: this.process.initializeResponse?.userAgent.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null,
      appServer: running ? "running" : this.lastError ? "error" : "stopped",
      authenticated: this.authenticated,
      accountType: this.accountType,
      plan: this.plan,
      platform: `${platform()} ${process.arch}`,
      hostname: hostname(),
      approvedRoots: this.roots?.list() ?? [],
      repositoriesDiscovered: this.repositoriesDiscovered,
      modelsAvailable: this.modelsAvailable,
      capabilities: CAPABILITIES,
      lastSeenAt: this.lastSeenAt,
      error: this.lastError,
    };
  }

  async account() {
    const response = await this.codex.account();
    const account = response.account ? asRecord(response.account) : null;
    this.authenticated = account !== null || !response.requiresOpenaiAuth;
    this.accountType = stringValue(account?.type);
    this.plan = stringValue(account?.planType);
    return response;
  }

  async models() {
    const models = await this.codex.models();
    this.modelsAvailable = models.length;
    return models;
  }

  rateLimits() {
    return this.codex.rateLimits();
  }

  usage() {
    return this.codex.usage();
  }

  async repositories() {
    const repositories = await discoverRepositories(this.roots);
    this.repositoriesDiscovered = repositories.length;
    return repositories;
  }

  repositoryStatus(path: string) {
    return readRepository(this.roots, path);
  }

  async startThread(config: BridgeTaskConfig) {
    const cwd = await this.roots.resolve(config.cwd);
    const result = await this.codex.startThread({ ...config, cwd });
    return result;
  }

  async resumeThread(threadId: string, config: BridgeTaskConfig) {
    const cwd = await this.roots.resolve(config.cwd);
    return this.codex.resumeThread(threadId, { ...config, cwd });
  }

  async forkThread(threadId: string, config: BridgeTaskConfig) {
    const cwd = await this.roots.resolve(config.cwd);
    return this.codex.forkThread(threadId, { ...config, cwd });
  }

  async startTurn(threadId: string, config: BridgeTaskConfig, prompt: string) {
    if (!prompt.trim()) throw new Error("A turn prompt is required.");
    const cwd = await this.roots.resolve(config.cwd);
    return this.codex.startTurn(threadId, { ...config, cwd }, prompt);
  }

  interruptTurn(threadId: string, turnId: string) {
    if (!turnId) throw new Error("turnId is required to interrupt a turn.");
    return this.codex.interruptTurn(threadId, turnId);
  }

  readThread(threadId: string) {
    return this.codex.readThread(threadId);
  }

  diff(path: string) {
    return readDiff(this.roots, path);
  }

  async respondToApproval(requestId: string, decision: string) {
    const request = this.approvals.get(requestId);
    if (!request) throw new Error("Approval request is no longer pending.");
    if (!["accept", "acceptForSession", "decline", "cancel"].includes(decision)) throw new Error("Unsupported approval decision.");
    this.codex.respondToApproval(request, decision);
    this.approvals.delete(requestId);
    this.publish({ id: `approval:${requestId}:resolved`, type: "approval_resolved", requestId, summary: `Approval ${decision}`, timestamp: new Date().toISOString() });
  }
}

const responseHeaders = (origin: string | undefined, origins: string[]) => {
  const allowedOrigin = origin && origins.includes(origin) ? origin : undefined;
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin, Vary: "Origin" } : {}),
  };
};

async function body(request: IncomingMessage) {
  let content = "";
  for await (const chunk of request) {
    content += String(chunk);
    if (content.length > 300_000) throw new Error("Request body is too large.");
  }
  return content ? JSON.parse(content) as unknown : {};
}

function sendJson(response: ServerResponse, status: number, payload: unknown, origin: string | undefined, origins: string[]) {
  response.writeHead(status, responseHeaders(origin, origins));
  response.end(JSON.stringify(payload));
}

function errorStatus(error: unknown) {
  if (error instanceof PathSecurityError) return 403;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("required") || message.includes("Unsupported")) return 400;
  if (message.includes("no longer pending")) return 409;
  return 502;
}

export async function createBridgeServer() {
  const service = new BridgeService();
  await service.initialize();
  const origins = (process.env.CODEX_ALLOWED_ORIGINS ?? DEFAULT_ORIGINS.join(",")).split(",").map((item) => item.trim()).filter(Boolean);
  const server = createServer(async (request, response) => {
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (request.method === "OPTIONS") {
      response.writeHead(204, { ...responseHeaders(origin, origins), "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "content-type" });
      response.end();
      return;
    }
    try {
      if (url.pathname === "/health" || url.pathname === "/v1/health" || url.pathname === "/v1/diagnostics") {
        sendJson(response, 200, service.diagnostics(), origin, origins);
        return;
      }
      if (url.pathname === "/v1/events" && request.method === "GET") {
        const threadFilter = url.searchParams.get("threadId");
        response.writeHead(200, { ...responseHeaders(origin, origins), "Content-Type": "text/event-stream", Connection: "keep-alive" });
        response.write(": connected\n\n");
        const unsubscribe = service.subscribe((event) => {
          if (threadFilter && event.threadId !== threadFilter) return;
          response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
        });
        const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 15_000);
        request.on("close", () => { clearInterval(keepAlive); unsubscribe(); });
        return;
      }
      if (url.pathname === "/v1/models" && request.method === "GET") {
        sendJson(response, 200, { models: await service.models() }, origin, origins);
        return;
      }
      if (url.pathname === "/v1/account" && request.method === "GET") {
        sendJson(response, 200, await service.account(), origin, origins);
        return;
      }
      if (url.pathname === "/v1/rate-limits" && request.method === "GET") {
        sendJson(response, 200, await service.rateLimits(), origin, origins);
        return;
      }
      if (url.pathname === "/v1/usage" && request.method === "GET") {
        sendJson(response, 200, await service.usage(), origin, origins);
        return;
      }
      if (url.pathname === "/v1/repositories" && request.method === "GET") {
        const repositories = await service.repositories();
        sendJson(response, 200, { repositories }, origin, origins);
        return;
      }
      if (url.pathname === "/v1/repositories/status" && request.method === "POST") {
        const input = asRecord(await body(request));
        sendJson(response, 200, await service.repositoryStatus(String(input.path ?? "")), origin, origins);
        return;
      }
      if (url.pathname === "/v1/diff" && request.method === "GET") {
        sendJson(response, 200, { files: await service.diff(url.searchParams.get("path") ?? "") }, origin, origins);
        return;
      }
      if (url.pathname === "/v1/threads" && request.method === "POST") {
        sendJson(response, 200, await service.startThread(parseConfig(await body(request))), origin, origins);
        return;
      }
      const threadMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)(?:\/(resume|fork|turns|interrupt))?$/);
      if (threadMatch && request.method === "GET" && !threadMatch[2]) {
        sendJson(response, 200, await service.readThread(decodeURIComponent(threadMatch[1])), origin, origins);
        return;
      }
      if (threadMatch && request.method === "POST") {
        const threadId = decodeURIComponent(threadMatch[1]);
        const action = threadMatch[2];
        const input = asRecord(await body(request));
        if (action === "resume") sendJson(response, 200, await service.resumeThread(threadId, parseConfig(input.config)), origin, origins);
        else if (action === "fork") sendJson(response, 200, await service.forkThread(threadId, parseConfig(input.config)), origin, origins);
        else if (action === "turns") sendJson(response, 200, await service.startTurn(threadId, parseConfig(input.config), String(input.prompt ?? "")), origin, origins);
        else if (action === "interrupt") sendJson(response, 200, await service.interruptTurn(threadId, String(input.turnId ?? "")), origin, origins);
        else sendJson(response, 404, { error: "Unknown thread action." }, origin, origins);
        return;
      }
      const approvalMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)$/);
      if (approvalMatch && request.method === "POST") {
        const input = asRecord(await body(request));
        await service.respondToApproval(decodeURIComponent(approvalMatch[1]), String(input.decision ?? ""));
        sendJson(response, 200, { ok: true }, origin, origins);
        return;
      }
      sendJson(response, 404, { error: "Bridge endpoint not found." }, origin, origins);
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Bridge request failed." }, origin, origins);
    }
  });
  const port = Number(process.env.CODEX_BRIDGE_PORT ?? DEFAULT_PORT);
  const host = process.env.CODEX_BRIDGE_HOST ?? "127.0.0.1";
  if (!/^127\.0\.0\.1$|^localhost$|^::1$/.test(host)) throw new Error("Codex Board Bridge must bind to localhost.");
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  log("info", "bridge", { event: "listening", host, port });
  const shutdown = () => { service.process.stop(); server.close(); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return { server, service };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void createBridgeServer().catch((error) => {
    log("error", "bridge", { event: "startup_failed", message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  });
}
