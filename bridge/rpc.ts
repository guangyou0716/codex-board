export type RpcId = number | string;

export interface RpcMessage {
  id?: RpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RpcRequestManager {
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();

  request<T>(write: (message: RpcMessage) => void, method: string, params: unknown, timeoutMs = 30_000) {
    const id = this.nextId++;
    const key = String(id);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`Codex App Server request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(key, { resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(key);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  handle(message: RpcMessage) {
    if (message.id === undefined || (message.result === undefined && message.error === undefined)) return false;
    const key = String(message.id);
    const pending = this.pending.get(key);
    if (!pending) return false;
    this.pending.delete(key);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? "Codex App Server request failed."));
    } else {
      pending.resolve(message.result);
    }
    return true;
  }

  rejectAll(error: Error) {
    for (const [key, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(key);
    }
  }

  get size() {
    return this.pending.size;
  }
}
