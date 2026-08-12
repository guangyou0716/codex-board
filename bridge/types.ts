export type BridgeConnectionStatus = "offline" | "connecting" | "online" | "degraded" | "error";

export interface BridgeModel {
  id: string;
  name: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: string[];
}

export interface BridgeRepository {
  name: string;
  localPath: string;
  remote: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  dirty: boolean | null;
  lastCommit: string | null;
  lastSeen: string;
}

export interface BridgeDiagnostics {
  status: BridgeConnectionStatus;
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

export interface BridgeEvent {
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
  payload?: unknown;
  timestamp: string;
}

export interface BridgeTaskConfig {
  cwd: string;
  model: string;
  effort: string;
  approvalPolicy: "unlessTrusted" | "onRequest" | "never";
  sandboxMode: "workspaceWrite" | "readOnly";
  networkAccess: "disabled" | "enabled";
}
