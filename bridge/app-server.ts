import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { InitializeResponse } from "./generated/codex-app-server/InitializeResponse.ts";
import type { ClientInfo } from "./generated/codex-app-server/ClientInfo.ts";
import type { InitializeCapabilities } from "./generated/codex-app-server/InitializeCapabilities.ts";
import { RpcRequestManager, type RpcMessage, type RpcId } from "./rpc.ts";

export type AppServerLifecycle =
  | { type: "started" }
  | { type: "exited"; code: number | null; signal: string | null }
  | { type: "stderr" }
  | { type: "protocol_error" };

export interface AppServerServerRequest {
  id: RpcId;
  method: string;
  params: unknown;
}

export class AppServerProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<InitializeResponse> | null = null;
  private initialized: InitializeResponse | null = null;
  private readonly rpc = new RpcRequestManager();
  private readonly notifications = new Set<(message: RpcMessage) => void>();
  private readonly serverRequests = new Set<(request: AppServerServerRequest) => void>();
  private readonly lifecycle = new Set<(event: AppServerLifecycle) => void>();

  onNotification(listener: (message: RpcMessage) => void) {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }

  onServerRequest(listener: (request: AppServerServerRequest) => void) {
    this.serverRequests.add(listener);
    return () => this.serverRequests.delete(listener);
  }

  onLifecycle(listener: (event: AppServerLifecycle) => void) {
    this.lifecycle.add(listener);
    return () => this.lifecycle.delete(listener);
  }

  get isRunning() {
    return this.child !== null && this.initialized !== null;
  }

  get initializeResponse() {
    return this.initialized;
  }

  async start() {
    if (this.initialized) return this.initialized;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal().finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  private async startInternal() {
    const executable = process.env.CODEX_EXECUTABLE ?? "codex";
    const child = spawn(executable, ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    this.child = child;
    this.initialized = null;
    child.once("error", (error) => this.handleExit(error));
    child.once("exit", (code, signal) => this.handleExit(new Error(`Codex App Server exited (${code ?? signal ?? "unknown"}).`), code, signal));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (chunk.trim()) this.emitLifecycle({ type: "stderr" });
    });
    const lines = createInterface({ input: child.stdout });
    child.stdout.setEncoding("utf8");
    lines.on("line", (line) => this.handleLine(line));
    this.emitLifecycle({ type: "started" });

    const clientInfo: ClientInfo = { name: "codex-board-bridge", title: "Codex Board Local Bridge", version: "0.2.0" };
    const capabilities: InitializeCapabilities = { experimentalApi: true, requestAttestation: false };
    const response = await this.requestInternal<InitializeResponse>("initialize", { clientInfo, capabilities }, 15_000);
    this.write({ method: "initialized" });
    this.initialized = response;
    return response;
  }

  private handleLine(line: string) {
    if (!line.trim()) return;
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      this.emitLifecycle({ type: "protocol_error" });
      return;
    }
    if (this.rpc.handle(message)) return;
    if (message.method && message.id !== undefined) {
      for (const listener of this.serverRequests) listener({ id: message.id, method: message.method, params: message.params });
      return;
    }
    if (message.method) {
      for (const listener of this.notifications) listener(message);
    }
  }

  private write(message: RpcMessage) {
    if (!this.child || this.child.stdin.destroyed) throw new Error("Codex App Server is not running.");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private requestInternal<T>(method: string, params: unknown, timeoutMs: number) {
    return this.rpc.request<T>((message) => this.write(message), method, params, timeoutMs);
  }

  async request<T>(method: string, params: unknown, timeoutMs = 30_000) {
    await this.start();
    return this.requestInternal<T>(method, params, timeoutMs);
  }

  respond(id: RpcId, result: unknown) {
    this.write({ id, result });
  }

  respondError(id: RpcId, code: number, message: string) {
    this.write({ id, error: { code, message } });
  }

  stop() {
    const child = this.child;
    this.child = null;
    this.initialized = null;
    this.rpc.rejectAll(new Error("Codex App Server stopped."));
    if (child && !child.killed) child.kill();
  }

  private handleExit(error: Error, code: number | null = null, signal: NodeJS.Signals | null = null) {
    if (!this.child) return;
    this.child = null;
    this.initialized = null;
    this.rpc.rejectAll(error);
    this.emitLifecycle({ type: "exited", code, signal });
  }

  private emitLifecycle(event: AppServerLifecycle) {
    for (const listener of this.lifecycle) listener(event);
  }
}
