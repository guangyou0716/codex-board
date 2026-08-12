export const TASK_STATUSES = [
  "Backlog",
  "Ready",
  "Running",
  "Review",
  "Blocked",
  "Done",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type Priority = "Low" | "Medium" | "High" | "Urgent";
export type ReasoningEffort = string;
export type ExecutionProvider = "mock" | "local";
export type CodexStatus =
  | "idle"
  | "queued"
  | "connecting"
  | "running"
  | "waitingApproval"
  | "interrupted"
  | "offline"
  | "completed"
  | "failed"
  | "stopped";
export type ActivityType =
  | "agent"
  | "command"
  | "file"
  | "test"
  | "tool"
  | "approval"
  | "error"
  | "completed";

export interface Repository {
  id: string;
  name: string;
  localPath: string;
  githubRepo: string;
  defaultBranch: string;
  enabled: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  connectionState: "connected" | "unavailable" | "unknown";
  currentBranch?: string | null;
  remote?: string | null;
  dirty?: boolean | null;
  lastCommit?: string | null;
  lastSeen?: string | null;
}

export interface Task {
  id: string;
  displayId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  notes: string;
  status: TaskStatus;
  priority: Priority;
  repositoryId: string;
  modelId: string;
  modelName: string;
  reasoningEffort: ReasoningEffort;
  approvalPolicy: "unlessTrusted" | "onRequest" | "never";
  sandboxMode: "workspaceWrite" | "readOnly";
  networkAccess: "disabled" | "enabled";
  branch: string;
  codexThreadId: string | null;
  codexSessionId: string | null;
  currentTurnId: string | null;
  cwd: string | null;
  forkedFromThreadId: string | null;
  lastActivityAt: string | null;
  codexStatus: CodexStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  sortOrder: number;
  testStatus: string | null;
  prStatus: string | null;
  usage: number | null;
  tags: string[];
}

export interface ActivityEvent {
  id: string;
  taskId: string;
  type: ActivityType;
  timestamp: string;
  summary: string;
  command?: string;
  cwd?: string;
  status?: "running" | "completed" | "failed";
  exitCode?: number;
  fileName?: string;
  additions?: number;
  deletions?: number;
  output?: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  requestId?: string;
  reason?: string;
  availableDecisions?: string[];
  approvalDecision?: string;
}

export interface UsageSnapshot {
  primaryRemaining: number | null;
  secondaryRemaining: number | null;
  primaryReset: string | null;
  secondaryReset: string | null;
  tokensToday: string | null;
  plan: string | null;
  isMock: boolean;
  source: ExecutionProvider;
  primaryUsed?: number | null;
  secondaryUsed?: number | null;
  lifetimeTokens?: string | null;
  peakDailyTokens?: string | null;
  unavailableReason?: string | null;
}

export interface CodexHost {
  id: string;
  name: string;
  status: "connected" | "connecting" | "offline" | "auth_required" | "version_mismatch" | "degraded" | "error";
  version: string | null;
  lastSeen: string | null;
  isMock: boolean;
  bridgeVersion?: string | null;
  codexVersion?: string | null;
  platform?: string | null;
  hostname?: string | null;
  capabilities?: string[];
  approvedRoots?: string[];
  authenticated?: boolean | null;
  accountType?: string | null;
  error?: string | null;
}

export interface Settings {
  approvedRoots: string[];
  theme: "dark" | "light";
  provider: ExecutionProvider;
}

export interface AppState {
  repositories: Repository[];
  tasks: Task[];
  activity: ActivityEvent[];
  host: CodexHost;
  usage: UsageSnapshot;
  settings: Settings;
  updatedAt: string;
}

export interface ModelOption {
  id: string;
  name: string;
  defaultReasoningEffort: ReasoningEffort;
  supportedReasoningEfforts: ReasoningEffort[];
}

export interface DiscoveredRepository {
  name: string;
  localPath: string;
  remote: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  dirty: boolean | null;
  lastCommit: string | null;
  lastSeen: string;
}

const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

const repo = (
  id: string,
  name: string,
  localPath: string,
  githubRepo: string,
  tags: string[]
): Repository => ({
  id,
  name,
  localPath,
  githubRepo,
  defaultBranch: "main",
  enabled: true,
  tags,
  createdAt: ago(4_320),
  updatedAt: ago(12),
  connectionState: "unknown",
});

const task = (input: Partial<Task> & Pick<Task, "id" | "displayId" | "title" | "status" | "priority" | "repositoryId" | "sortOrder">): Task => ({
  description: "Investigate the current behavior, implement the smallest safe fix, and leave the repository ready for review.",
  acceptanceCriteria: [
    "Add coverage for the primary failure path.",
    "Keep the change scoped to the selected repository.",
  ],
  notes: "Mock task seeded for interface evaluation.",
  modelId: "gpt-5.6-sol",
  modelName: "GPT-5.6 Sol",
  reasoningEffort: "High",
  approvalPolicy: "unlessTrusted",
  sandboxMode: "workspaceWrite",
  networkAccess: "disabled",
  branch: "main",
  codexThreadId: null,
  codexSessionId: null,
  currentTurnId: null,
  cwd: null,
  forkedFromThreadId: null,
  lastActivityAt: null,
  codexStatus: "idle",
  createdAt: ago(2_880),
  updatedAt: ago(14),
  startedAt: null,
  completedAt: null,
  testStatus: null,
  prStatus: null,
  usage: null,
  tags: [],
  ...input,
});

export function createSeedState(): AppState {
  const repositories = [
    repo("repo-backend", "backend-api", "/Users/me/Development/backend-api", "company/backend-api", ["services", "auth"]),
    repo("repo-frontend", "frontend-web", "/Users/me/Development/frontend-web", "company/frontend-web", ["web", "checkout"]),
    repo("repo-mobile", "mobile-app", "/Users/me/Work/mobile-app", "company/mobile-app", ["ios", "android"]),
    repo("repo-infra", "infrastructure", "/Users/me/Work/infrastructure", "company/infrastructure", ["deploy", "terraform"]),
  ];

  const tasks = [
    task({
      id: "task-api-128",
      displayId: "API-128",
      title: "Fix refresh-token race condition",
      status: "Ready",
      priority: "High",
      repositoryId: "repo-backend",
      sortOrder: 1,
      branch: "codex/API-128-refresh-token",
      description: "Refresh requests can overlap during a fast burst and invalidate the token that a sibling request just received. Make the refresh path single-flight without changing the public client contract.",
      acceptanceCriteria: ["Concurrent refreshes resolve to one valid token.", "Add a regression test for overlapping requests.", "No changes to token storage outside the auth module."],
      notes: "Reproduce with the existing auth integration harness before editing.",
      testStatus: "42 passed",
      tags: ["auth", "security"],
    }),
    task({
      id: "task-web-52",
      displayId: "WEB-52",
      title: "Improve checkout loading state",
      status: "Ready",
      priority: "High",
      repositoryId: "repo-frontend",
      sortOrder: 2,
      branch: "codex/WEB-52-checkout-loading",
      description: "The checkout page shows a blank frame while the payment session resolves. Add a stable loading state that preserves the page layout and announces progress to assistive technology.",
      acceptanceCriteria: ["Keep the order summary anchored while loading.", "Expose loading progress to screen readers.", "Avoid layout shift on slow networks."],
      tags: ["checkout", "a11y"],
    }),
    task({
      id: "task-mob-31",
      displayId: "MOB-31",
      title: "Fix push notification deep link",
      status: "Ready",
      priority: "High",
      repositoryId: "repo-mobile",
      sortOrder: 3,
      branch: "codex/MOB-31-push-deeplink",
      description: "Tapping a push notification while the app is cold-started opens the home tab instead of the referenced thread. Trace the launch payload through navigation and preserve the intended destination.",
      tags: ["mobile", "notifications"],
    }),
    task({
      id: "task-inf-19",
      displayId: "INF-19",
      title: "Update staging deployment workflow",
      status: "Running",
      priority: "High",
      repositoryId: "repo-infra",
      sortOrder: 4,
      branch: "codex/INF-19-staging-workflow",
      codexThreadId: "thread_mock_inf_19",
      codexSessionId: "session_mock_inf_19",
      codexStatus: "running",
      startedAt: ago(2),
      usage: 22,
      testStatus: "Running",
      tags: ["deploy", "github-actions"],
    }),
    task({
      id: "task-api-142",
      displayId: "API-142",
      title: "Add retry logic to email service",
      status: "Running",
      priority: "Medium",
      repositoryId: "repo-backend",
      sortOrder: 5,
      branch: "codex/API-142-email-retries",
      codexThreadId: "thread_mock_api_142",
      codexSessionId: "session_mock_api_142",
      codexStatus: "running",
      startedAt: ago(18),
      usage: 47,
      testStatus: "Running",
      tags: ["reliability"],
    }),
    task({
      id: "task-api-99",
      displayId: "API-99",
      title: "Optimize database indexes",
      status: "Review",
      priority: "Medium",
      repositoryId: "repo-backend",
      sortOrder: 6,
      branch: "codex/API-99-index-tuning",
      codexThreadId: "thread_mock_api_99",
      codexStatus: "completed",
      completedAt: ago(34),
      usage: 61,
      testStatus: "18 passed",
      tags: ["performance"],
    }),
    task({
      id: "task-web-33",
      displayId: "WEB-33",
      title: "Add skeletons for product cards",
      status: "Review",
      priority: "Low",
      repositoryId: "repo-frontend",
      sortOrder: 7,
      branch: "codex/WEB-33-product-skeletons",
      codexThreadId: "thread_mock_web_33",
      codexStatus: "completed",
      completedAt: ago(49),
      usage: 36,
      testStatus: "24 passed",
      tags: ["loading", "ui"],
    }),
    task({
      id: "task-mob-27",
      displayId: "MOB-27",
      title: "Update onboarding copy",
      status: "Review",
      priority: "Low",
      repositoryId: "repo-mobile",
      sortOrder: 8,
      branch: "codex/MOB-27-onboarding-copy",
      codexThreadId: "thread_mock_mob_27",
      codexStatus: "completed",
      completedAt: ago(73),
      usage: 18,
      testStatus: "12 passed",
      tags: ["content"],
    }),
    task({
      id: "task-api-117",
      displayId: "API-117",
      title: "Investigate S3 upload failure in CI",
      status: "Blocked",
      priority: "High",
      repositoryId: "repo-backend",
      sortOrder: 9,
      branch: "codex/API-117-ci-upload",
      codexStatus: "failed",
      testStatus: "Blocked: Waiting on IAM policy update",
      tags: ["ci", "blocked"],
    }),
    task({
      id: "task-web-61",
      displayId: "WEB-61",
      title: "Fix payment method validation edge case",
      status: "Blocked",
      priority: "Medium",
      repositoryId: "repo-frontend",
      sortOrder: 10,
      branch: "codex/WEB-61-payment-validation",
      codexStatus: "stopped",
      testStatus: "Blocked: External dependency",
      tags: ["payments", "blocked"],
    }),
    task({
      id: "task-api-110",
      displayId: "API-110",
      title: "Add pagination to activity logs",
      status: "Done",
      priority: "Low",
      repositoryId: "repo-backend",
      sortOrder: 11,
      branch: "codex/API-110-activity-pagination",
      codexThreadId: "thread_mock_api_110",
      codexStatus: "completed",
      completedAt: ago(143),
      usage: 31,
      testStatus: "36 passed",
      tags: ["api"],
    }),
    task({
      id: "task-web-47",
      displayId: "WEB-47",
      title: "Fix header overflow on mobile",
      status: "Done",
      priority: "Low",
      repositoryId: "repo-frontend",
      sortOrder: 12,
      branch: "codex/WEB-47-mobile-header",
      codexThreadId: "thread_mock_web_47",
      codexStatus: "completed",
      completedAt: ago(171),
      usage: 26,
      testStatus: "22 passed",
      tags: ["responsive"],
    }),
    task({
      id: "task-mob-22",
      displayId: "MOB-22",
      title: "Resolve crash on app resume",
      status: "Done",
      priority: "Medium",
      repositoryId: "repo-mobile",
      sortOrder: 13,
      branch: "codex/MOB-22-resume-crash",
      codexThreadId: "thread_mock_mob_22",
      codexStatus: "completed",
      completedAt: ago(224),
      usage: 54,
      testStatus: "31 passed",
      tags: ["stability"],
    }),
    task({
      id: "task-inf-7",
      displayId: "INF-7",
      title: "Document local bridge setup",
      status: "Backlog",
      priority: "Low",
      repositoryId: "repo-infra",
      sortOrder: 14,
      tags: ["docs", "bridge"],
    }),
    task({
      id: "task-web-73",
      displayId: "WEB-73",
      title: "Refine empty search results",
      status: "Backlog",
      priority: "Medium",
      repositoryId: "repo-frontend",
      sortOrder: 15,
      tags: ["search", "ui"],
    }),
  ];

  const activity: ActivityEvent[] = [
    { id: "activity-1", taskId: "task-inf-19", type: "agent", timestamp: ago(2), summary: "Inspecting staging workflow dependencies" },
    { id: "activity-2", taskId: "task-api-110", type: "completed", timestamp: ago(25), summary: "Completed pagination changes" },
    { id: "activity-3", taskId: "task-web-47", type: "test", timestamp: ago(34), summary: "22 tests passed" },
    { id: "activity-4", taskId: "task-api-117", type: "approval", timestamp: ago(47), summary: "Approval required for IAM policy change" },
    { id: "activity-5", taskId: "task-api-142", type: "command", timestamp: ago(62), summary: "Running focused email service tests", command: "npm test -- email", cwd: "/Users/me/Development/backend-api", status: "running" },
    { id: "activity-6", taskId: "task-mob-31", type: "agent", timestamp: ago(82), summary: "Ready to start mock execution" },
    { id: "activity-7", taskId: "task-api-99", type: "file", timestamp: ago(95), summary: "2 files changed", fileName: "src/db/indexes.ts", additions: 18, deletions: 6 },
    { id: "activity-8", taskId: "task-web-52", type: "agent", timestamp: ago(121), summary: "Task moved to Ready" },
  ];

  return {
    repositories,
    tasks,
    activity,
    host: {
      id: "host-local",
      name: "Local Codex host",
      status: "offline",
      version: null,
      lastSeen: null,
      isMock: true,
    },
    usage: {
      primaryRemaining: 68,
      secondaryRemaining: 81,
      primaryReset: "2h 14m",
      secondaryReset: "tomorrow 09:00",
      tokensToday: "18.4M",
      plan: "Codex Pro",
      isMock: true,
      source: "mock",
    },
    settings: {
      approvedRoots: ["/Users/me/Development", "/Users/me/Work"],
      theme: "light",
      provider: "mock",
    },
    updatedAt: new Date().toISOString(),
  };
}

export function getRepository(state: AppState, repositoryId: string) {
  return state.repositories.find((repository) => repository.id === repositoryId);
}

export function normalizeAppState(value: AppState): AppState {
  const seed = createSeedState();
  return {
    ...seed,
    ...value,
    host: { ...seed.host, ...value.host },
    usage: { ...seed.usage, ...value.usage, source: value.usage.source ?? (value.usage.isMock ? "mock" : "local") },
    settings: { ...seed.settings, ...value.settings, provider: value.settings.provider ?? "mock" },
    repositories: value.repositories.map((repository) => ({ ...repository })),
    tasks: value.tasks.map((task) => ({
      ...task,
      currentTurnId: task.currentTurnId ?? null,
      cwd: task.cwd ?? null,
      forkedFromThreadId: task.forkedFromThreadId ?? null,
      lastActivityAt: task.lastActivityAt ?? null,
    })),
  };
}
