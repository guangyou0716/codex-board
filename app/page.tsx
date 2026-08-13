"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MOCK_MODELS, MockCodexAdapter, LocalCodexAdapter, type CodexAdapter, type CodexStreamEvent } from "./codex-adapter";
import {
  createSeedState,
  getRepository,
  normalizeAppState,
  TASK_STATUSES,
  type ActivityEvent,
  type AppState,
  type CodexThread,
  type DiscoveredRepository,
  type ExecutionProvider,
  type ModelOption,
  type Priority,
  type ReasoningEffort,
  type Task,
  type TaskStatus,
  type UsageSnapshot,
} from "./state";

type View = "Dashboard" | "Board" | "Repositories" | "Codex Threads" | "Usage" | "Settings";
type IconName =
  | "grid"
  | "board"
  | "repo"
  | "threads"
  | "usage"
  | "settings"
  | "search"
  | "plus"
  | "chevron"
  | "close"
  | "more"
  | "play"
  | "stop"
  | "arrow"
  | "file"
  | "command"
  | "test"
  | "agent"
  | "approval"
  | "check"
  | "clock"
  | "external"
  | "trash"
  | "edit"
  | "filter"
  | "send"
  | "copy"
  | "menu"
  | "sun"
  | "moon"
  | "shield";

const NAV_ITEMS: { id: View; label: View; icon: IconName }[] = [
  { id: "Dashboard", label: "Dashboard", icon: "grid" },
  { id: "Board", label: "Board", icon: "board" },
  { id: "Repositories", label: "Repositories", icon: "repo" },
  { id: "Codex Threads", label: "Codex Threads", icon: "threads" },
  { id: "Usage", label: "Usage", icon: "usage" },
  { id: "Settings", label: "Settings", icon: "settings" },
];

const STATUS_COLORS: Record<TaskStatus, string> = {
  Backlog: "neutral",
  Ready: "blue",
  Running: "indigo",
  Review: "violet",
  Blocked: "coral",
  Done: "mint",
};

const timeAgo = (timestamp: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1_440)}d ago`;
};

const idFor = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const formatEffort = (effort: string) => effort.length ? effort[0].toUpperCase() + effort.slice(1).toLowerCase() : "Unavailable";
const formatPlanName = (plan: string | null | undefined) => plan?.toLowerCase() === "plus" ? "ChatGPT Plus" : plan ?? "Codex account";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord => value && typeof value === "object" ? value as JsonRecord : {};
const finiteNumber = (value: unknown) => {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
};
const compactTokens = (value: unknown) => {
  const number = finiteNumber(value);
  return number == null ? null : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(number);
};
const formatReset = (value: unknown) => {
  const resetAt = finiteNumber(value);
  if (resetAt == null) return null;
  const minutes = Math.max(0, Math.ceil((resetAt * 1000 - Date.now()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
};
const formatWindowDuration = (minutes: number | null | undefined) => {
  if (minutes == null) return null;
  if (minutes % 1_440 === 0) return `${minutes / 1_440}-day`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour`;
  return `${minutes}-minute`;
};

const isSeedRepository = (repository: AppState["repositories"][number]) => repository.localPath.startsWith("/Users/me/");
const isSeedTask = (task: Task) => /^task-(api|web|mob|inf)-\d+$/.test(task.id);
const threadTitle = (thread: CodexThread) => thread.name?.trim() || thread.preview?.trim() || `Thread ${thread.id.slice(0, 8)}`;
const pathName = (value: string) => value.split(/[\\/]/).filter(Boolean).pop() ?? value;

function mapUsageSnapshot(rateLimits: unknown, usage: unknown): Partial<UsageSnapshot> {
  const ratePayload = asRecord(rateLimits);
  const snapshots = asRecord(ratePayload.rateLimitsByLimitId);
  const snapshot = asRecord(snapshots.codex ?? ratePayload.rateLimits);
  const primary = asRecord(snapshot.primary);
  const secondary = asRecord(snapshot.secondary);
  const primaryUsed = finiteNumber(primary.usedPercent);
  const secondaryUsed = finiteNumber(secondary.usedPercent);
  const usagePayload = asRecord(usage);
  const summary = asRecord(usagePayload.summary);
  const buckets = Array.isArray(usagePayload.dailyUsageBuckets) ? usagePayload.dailyUsageBuckets.map(asRecord) : [];
  const today = new Date().toISOString().slice(0, 10);
  const todayBucket = buckets.find((bucket) => bucket.startDate === today);
  const hasData = primaryUsed != null || secondaryUsed != null || todayBucket != null || summary.lifetimeTokens != null || summary.peakDailyTokens != null;

  return {
    primaryRemaining: primaryUsed == null ? null : Math.max(0, Math.min(100, 100 - primaryUsed)),
    secondaryRemaining: secondaryUsed == null ? null : Math.max(0, Math.min(100, 100 - secondaryUsed)),
    primaryUsed,
    secondaryUsed,
    primaryReset: formatReset(primary.resetsAt),
    secondaryReset: formatReset(secondary.resetsAt),
    primaryWindowDurationMins: finiteNumber(primary.windowDurationMins),
    secondaryWindowDurationMins: finiteNumber(secondary.windowDurationMins),
    tokensToday: buckets.length > 0 ? compactTokens(todayBucket?.tokens ?? 0) : null,
    lifetimeTokens: compactTokens(summary.lifetimeTokens),
    peakDailyTokens: compactTokens(summary.peakDailyTokens),
    plan: typeof snapshot.planType === "string" ? snapshot.planType : null,
    unavailableReason: hasData ? null : "Usage information unavailable from the connected Codex host.",
  };
}

function activityFromStream(taskId: string, event: CodexStreamEvent): Omit<ActivityEvent, "id" | "taskId" | "timestamp"> {
  const type: ActivityEvent["type"] = event.type === "turn_completed" ? "completed" : event.type === "approval" ? "approval" : event.type === "approval_resolved" ? "completed" : event.type === "command" ? "command" : event.type === "file" || event.type === "diff" ? "file" : event.type === "error" ? "error" : event.type === "tool" ? "tool" : "agent";
  const status = event.status === "inProgress" || event.status === "running" ? "running" : event.status === "failed" ? "failed" : event.status === "completed" ? "completed" : undefined;
  return { type, summary: event.summary ?? "Codex event", command: event.command, cwd: event.cwd, status, exitCode: event.exitCode ?? undefined, fileName: event.fileName, additions: event.additions, deletions: event.deletions, output: event.output, threadId: event.threadId, turnId: event.turnId, itemId: event.itemId, requestId: event.requestId, reason: event.reason, availableDecisions: event.availableDecisions };
}

function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "grid") return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>;
  if (name === "board") return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></svg>;
  if (name === "repo") return <svg {...common}><path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z" /><path d="M4 7.5 12 11l8-3.5M12 11v9" /></svg>;
  if (name === "threads") return <svg {...common}><path d="M6 5.5h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.5 3v-3H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" /><path d="M8 10h8M8 13h5" /></svg>;
  if (name === "usage") return <svg {...common}><path d="M5 19V9M12 19V5M19 19v-7" /><path d="M3 19h18" /></svg>;
  if (name === "settings") return <svg {...common}><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path d="m19.4 15 .1.1a1.8 1.8 0 0 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3.1 1.3v.2a1.8 1.8 0 0 1-3.6 0v-.2a1.8 1.8 0 0 0-3.1-1.3l-.1.1a1.8 1.8 0 0 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-1.3-3.1h-.2a1.8 1.8 0 0 1 0-3.6h.2a1.8 1.8 0 0 0 1.3-3.1l-.1-.1a1.8 1.8 0 0 1 2.5-2.5l.1.1A1.8 1.8 0 0 0 10.2 1h.2a1.8 1.8 0 0 1 3.6 0v.2a1.8 1.8 0 0 0 3.1 1.3l.1-.1a1.8 1.8 0 0 1 2.5 2.5l-.1.1A1.8 1.8 0 0 0 20.9 8h.2a1.8 1.8 0 0 1 0 3.6h-.2a1.8 1.8 0 0 0-1.5 3.4Z" /></svg>;
  if (name === "search") return <svg {...common}><circle cx="10.8" cy="10.8" r="6.5" /><path d="m16 16 4 4" /></svg>;
  if (name === "plus") return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  if (name === "chevron") return <svg {...common}><path d="m8 10 4 4 4-4" /></svg>;
  if (name === "close") return <svg {...common}><path d="m7 7 10 10M17 7 7 17" /></svg>;
  if (name === "more") return <svg {...common} fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>;
  if (name === "play") return <svg {...common} fill="currentColor" stroke="none"><path d="m8 5 11 7-11 7z" /></svg>;
  if (name === "stop") return <svg {...common} fill="currentColor" stroke="none"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>;
  if (name === "arrow") return <svg {...common}><path d="M5 12h13M13 6l6 6-6 6" /></svg>;
  if (name === "file") return <svg {...common}><path d="M6 4h8l4 4v12H6z" /><path d="M14 4v5h4M9 13h6M9 16h4" /></svg>;
  if (name === "command") return <svg {...common}><path d="M6.5 6.5h11v11h-11z" /><path d="M9 9h2v2H9zM13 9h2v2h-2zM9 13h2v2H9zM13 13h2v2h-2z" /></svg>;
  if (name === "test") return <svg {...common}><path d="m7 4 10 0M9 4v5l-4 7a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 16l-4-7V4" /><path d="M8 14h8" /></svg>;
  if (name === "agent") return <svg {...common}><circle cx="12" cy="12" r="7" /><path d="M12 8v4l2.5 2.5" /></svg>;
  if (name === "approval") return <svg {...common}><path d="m12 3 2 2.2 3-.1.8 2.9 2.4 1.7-1.5 2.6.8 2.9-2.7 1.2-1.2 2.7-2.9-.8L12 21l-2.1-2.7-2.9.8-.8-2.9-2.4-1.7 1.5-2.6-.8-2.9 2.7-1.2L8.4 5l2.9.8z" /><path d="m9 12 2 2 4-4" /></svg>;
  if (name === "check") return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
  if (name === "clock") return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></svg>;
  if (name === "external") return <svg {...common}><path d="M14 5h5v5M19 5l-8 8" /><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>;
  if (name === "trash") return <svg {...common}><path d="M5 7h14M10 11v5M14 11v5M9 7V4h6v3M7 7l1 13h8l1-13" /></svg>;
  if (name === "edit") return <svg {...common}><path d="m5 16-.8 3.8L8 19l10-10a2 2 0 0 0-3-3z" /><path d="m13.5 7.5 3 3" /></svg>;
  if (name === "filter") return <svg {...common}><path d="M4 6h16M7 12h10M10 18h4" /></svg>;
  if (name === "send") return <svg {...common}><path d="m4 5 16 7-16 7 3-7z" /><path d="M7 12h13" /></svg>;
  if (name === "copy") return <svg {...common}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>;
  if (name === "menu") return <svg {...common}><path d="M5 7h14M5 12h14M5 17h14" /></svg>;
  if (name === "sun") return <svg {...common}><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
  if (name === "moon") return <svg {...common}><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" /></svg>;
  return <svg {...common}><path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6z" /><path d="m9 12 2 2 4-4" /></svg>;
}

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true">{Array.from({ length: 9 }).map((_, index) => <i key={index} />)}</span>;
}

function HostBadge({ state }: { state: AppState }) {
  const online = state.settings.provider === "local" && state.host.status === "connected";
  const label = state.settings.provider === "mock" ? "Mock adapter" : online ? "Local host connected" : state.host.status === "auth_required" ? "Codex authentication required" : "Local host offline";
  return <span className="host-badge"><span className={`status-dot ${online ? "is-mint" : "is-amber"}`} />{label}</span>;
}

function Sidebar({ view, onView, state, onAddTask }: { view: View; onView: (view: View) => void; state: AppState; onAddTask: () => void }) {
  return <aside className="sidebar">
    <div className="sidebar-brand"><BrandMark /><span>Codex Board</span></div>
    <nav className="sidebar-nav" aria-label="Primary navigation">
      {NAV_ITEMS.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? "is-active" : ""}`} onClick={() => onView(item.id)}><Icon name={item.icon} /><span>{item.label}</span></button>)}
    </nav>
    <div className="sidebar-bottom">
      <div className="offline-card"><HostBadge state={state} /><span>{state.settings.provider === "mock" ? "Mock execution data" : state.host.error ?? "Bridge diagnostics"}</span></div>
      <div className="account-card"><div><span className="account-avatar">CP</span><span>{formatPlanName(state.usage.plan)}</span></div><strong>{state.usage.primaryRemaining ?? "—"}% <small>remaining</small></strong><div className="mini-progress"><span style={{ width: `${state.usage.primaryRemaining ?? 0}%` }} /></div></div>
      <button className="sidebar-add" onClick={onAddTask}><Icon name="plus" size={15} />Add task <kbd>N</kbd></button>
    </div>
  </aside>;
}

function TopBar({ state, view, onAddTask, onView }: { state: AppState; view: View; onAddTask: () => void; onView: (view: View) => void }) {
  return <header className="topbar">
    <div className="mobile-brand"><BrandMark /><span>Codex Board</span></div>
    <div className="topbar-context"><span className="topbar-eyebrow">Workspace</span><strong>{view}</strong></div>
    <div className="topbar-actions"><HostBadge state={state} /><span className="account-pill"><span className="account-avatar">CP</span><span>{formatPlanName(state.usage.plan)}</span><Icon name="chevron" size={14} /></span><button className="topbar-add pressable" onClick={onAddTask}><Icon name="plus" size={16} /><span>Add task</span></button></div>
    <button className="mobile-menu" aria-label="Open navigation" onClick={() => onView(view === "Board" ? "Dashboard" : "Board")}><Icon name="menu" /></button>
  </header>;
}

function BottomNav({ view, onView }: { view: View; onView: (view: View) => void }) {
  const items = NAV_ITEMS.filter((item) => ["Board", "Repositories", "Codex Threads", "Usage"].includes(item.id));
  return <nav className="bottom-nav" aria-label="Mobile navigation">{items.map((item) => <button key={item.id} className={view === item.id ? "is-active" : ""} onClick={() => onView(item.id)}><Icon name={item.icon} size={17} /><span>{item.id === "Codex Threads" ? "Threads" : item.id === "Repositories" ? "Repos" : item.id}</span></button>)}</nav>;
}

function SelectField({ label, value, onChange, children, className = "" }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode; className?: string }) {
  return <label className={`field ${className}`}><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select><Icon name="chevron" size={14} /></label>;
}

function OfflineBanner({ state }: { state: AppState }) {
  const mock = state.settings.provider === "mock";
  return <div className="offline-banner"><span className={`status-dot ${mock ? "is-indigo" : state.host.status === "connected" ? "is-mint" : "is-amber"}`} /><span>{mock ? "Local Codex bridge is not selected. Task management is still available." : state.host.status === "connected" ? "Local Codex host connected. Computer-backed actions are available." : "Local Codex host offline. Task management is still available."}</span><span className="offline-banner__mock">{mock ? "Mock adapter active" : state.host.status === "connected" ? "Local adapter active" : "Start the bridge"}</span></div>;
}

function TaskCard({ task, repository, selected, onSelect, onDragStart, onDrop }: { task: Task; repository?: AppState["repositories"][number]; selected: boolean; onSelect: () => void; onDragStart: () => void; onDrop: () => void }) {
  const running = task.status === "Running" || task.codexStatus === "running";
  return <button className={`task-card ${selected ? "is-selected" : ""} ${running ? "is-running" : ""} ${task.status === "Blocked" ? "is-blocked" : ""}`} draggable onDragStart={onDragStart} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(); }} onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }}>
    <span className="task-card__top"><span className="task-id">{task.displayId}</span><span className={`priority-dot priority-${task.priority.toLowerCase()}`} /></span>
    <strong className="task-card__title">{task.title}</strong>
    <span className="task-card__repo">{repository?.name ?? "Unknown repo"}</span>
    <span className="task-card__meta"><span>{task.modelName}</span><span className={`priority-label priority-${task.priority.toLowerCase()}`}>{task.priority}</span></span>
    <span className="task-card__footer">{running ? <><span className="running-label"><span className="running-pulse" />Running {task.startedAt ? timeAgo(task.startedAt).replace(" ago", "") : "now"}</span><span className="card-thread-icon"><Icon name="agent" size={13} /></span></> : task.testStatus ? <span className={task.status === "Blocked" ? "test-failed" : "test-passed"}>{task.testStatus}</span> : <span className="card-muted">{task.tags[0] ?? "No test run"}</span>}<span className="card-avatar">CP</span></span>
  </button>;
}

function BoardPage({ state, tasks, filters, onFilters, onSelectTask, selectedTaskId, onAddTask, onDragStart, onDrop }: { state: AppState; tasks: Task[]; filters: { search: string; repo: string; status: string; priority: string; model: string; effort: string; execution: string }; onFilters: (next: Partial<{ search: string; repo: string; status: string; priority: string; model: string; effort: string; execution: string }>) => void; onSelectTask: (id: string) => void; selectedTaskId: string | null; onAddTask: () => void; onDragStart: (id: string) => void; onDrop: (status: TaskStatus, beforeId?: string) => void }) {
  const [moreFilters, setMoreFilters] = useState(false);
  return <section className="board-page page-section">
    <OfflineBanner state={state} />
    <div className="page-heading-row"><div><h1>Board</h1><span className="save-status">{state.updatedAt ? "Saved to Site storage" : "Demo state"}</span></div><div className="shortcut-hint"><kbd>/</kbd> search <kbd>R</kbd> run selected</div></div>
    <div className="board-toolbar">
      <label className="search-field"><Icon name="search" size={18} /><input data-search placeholder="Search tasks" value={filters.search} onChange={(event) => onFilters({ search: event.target.value })} /><kbd>/</kbd></label>
      <SelectField label="Repository" value={filters.repo} onChange={(value) => onFilters({ repo: value })} className="toolbar-select"><option value="all">All repos</option>{state.repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.name}</option>)}</SelectField>
      <SelectField label="Status" value={filters.status} onChange={(value) => onFilters({ status: value })} className="toolbar-select"><option value="all">Any status</option>{TASK_STATUSES.map((status) => <option key={status}>{status}</option>)}</SelectField>
      <SelectField label="Priority" value={filters.priority} onChange={(value) => onFilters({ priority: value })} className="toolbar-select"><option value="all">Any priority</option>{["Urgent", "High", "Medium", "Low"].map((priority) => <option key={priority}>{priority}</option>)}</SelectField>
      <button className={`filter-button ${moreFilters ? "is-active" : ""}`} onClick={() => setMoreFilters((current) => !current)}><Icon name="filter" size={16} />More filters</button>
      <button className="primary-button pressable toolbar-add" onClick={onAddTask}><Icon name="plus" size={16} />Add task</button>
      {moreFilters && <div className="filter-popover"><div className="filter-popover__header"><strong>Filter board</strong><button aria-label="Close filters" onClick={() => setMoreFilters(false)}><Icon name="close" size={15} /></button></div><SelectField label="Model" value={filters.model} onChange={(value) => onFilters({ model: value })}><option value="all">Any model</option>{MOCK_MODELS.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</SelectField><SelectField label="Reasoning" value={filters.effort} onChange={(value) => onFilters({ effort: value })}><option value="all">Any effort</option>{["Minimal", "Low", "Medium", "High"].map((effort) => <option key={effort}>{effort}</option>)}</SelectField><SelectField label="Execution" value={filters.execution} onChange={(value) => onFilters({ execution: value })}><option value="all">Any state</option>{["idle", "queued", "running", "completed", "failed", "stopped"].map((status) => <option key={status}>{status}</option>)}</SelectField></div>}
    </div>
    <div className="board-scroll"><div className="board-grid">{TASK_STATUSES.map((status) => { const columnTasks = tasks.filter((task) => task.status === status).sort((a, b) => a.sortOrder - b.sortOrder); return <div className={`board-column column-${STATUS_COLORS[status]}`} key={status} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(status); }}><div className="column-header"><div><span className="column-dot" /><h2>{status}</h2><span className="column-count">{columnTasks.length}</span></div><button aria-label={`More ${status} options`}><Icon name="more" size={17} /></button></div><div className="column-cards">{columnTasks.map((task) => <TaskCard key={task.id} task={task} repository={getRepository(state, task.repositoryId)} selected={selectedTaskId === task.id} onSelect={() => onSelectTask(task.id)} onDragStart={() => onDragStart(task.id)} onDrop={() => onDrop(status, task.id)} />)}</div><button className="column-add" onClick={onAddTask}><Icon name="plus" size={15} />Add task</button></div>; })}</div></div>
    <ActivityStrip state={state} onSelectTask={onSelectTask} />
  </section>;
}

function ActivityStrip({ state, onSelectTask }: { state: AppState; onSelectTask: (id: string) => void }) {
  return <section className="activity-strip"><div className="section-title-row"><h2>Recent activity</h2><button onClick={() => onSelectTask(state.activity[0]?.taskId ?? state.tasks[0]?.id)}>View all <Icon name="external" size={13} /></button></div><div className="activity-grid">{state.activity.slice(0, 6).map((event) => { const task = state.tasks.find((candidate) => candidate.id === event.taskId); return <button className="activity-row" key={event.id} onClick={() => task && onSelectTask(task.id)}><span className={`activity-icon activity-${event.type}`}><Icon name={event.type === "command" ? "command" : event.type === "test" ? "test" : event.type === "file" ? "file" : event.type === "approval" ? "approval" : event.type === "completed" ? "check" : "agent"} size={14} /></span><span className="activity-copy"><strong>{task?.displayId}</strong><span>{event.summary}</span></span><span className={`activity-status ${task?.status.toLowerCase()}`}>{task?.status}</span><span className="activity-time">{timeAgo(event.timestamp)}</span></button>; })}</div></section>;
}

function DashboardPage({ state, onView, onSelectTask }: { state: AppState; onView: (view: View) => void; onSelectTask: (id: string) => void }) {
  const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, state.tasks.filter((task) => task.status === status).length]));
  const activeThreads = state.tasks.filter((task) => task.codexStatus === "running").length;
  const dirtyRepos = state.repositories.filter((repo) => state.tasks.some((task) => task.repositoryId === repo.id && task.status !== "Done")).length;
  const primaryWindow = formatWindowDuration(state.usage.primaryWindowDurationMins);
  return <section className="page-section dashboard-page"><div className="page-heading-row"><div><h1>Dashboard</h1><span className="save-status">Your local work, in one view</span></div><button className="ghost-button" onClick={() => onView("Board")}>Open board <Icon name="arrow" size={15} /></button></div><OfflineBanner state={state} /><div className="metric-grid"><button onClick={() => onView("Board")}><span>Ready</span><strong>{counts.Ready}</strong><small>tasks waiting</small></button><button onClick={() => onView("Board")}><span>Running</span><strong className="metric-indigo">{counts.Running}</strong><small>{activeThreads} active Codex threads</small></button><button onClick={() => onView("Board")}><span>Review</span><strong className="metric-violet">{counts.Review}</strong><small>awaiting your eyes</small></button><button onClick={() => onView("Board")}><span>Blocked</span><strong className="metric-coral">{counts.Blocked}</strong><small>need attention</small></button></div><div className="dashboard-grid"><section className="panel"><div className="section-title-row"><h2>Repositories</h2><button onClick={() => onView("Repositories")}>Manage <Icon name="arrow" size={13} /></button></div><div className="repo-summary-list">{state.repositories.map((repo) => <button key={repo.id} onClick={() => onView("Repositories")}><span className="repo-symbol">{repo.name.slice(0, 1).toUpperCase()}</span><span><strong>{repo.name}</strong><small>{repo.githubRepo}</small></span><span className="repo-summary-count">{state.tasks.filter((task) => task.repositoryId === repo.id).length} tasks</span></button>)}</div></section><section className="panel usage-summary"><div className="section-title-row"><h2>Usage</h2><button onClick={() => onView("Usage")}>Details <Icon name="arrow" size={13} /></button></div><div className="usage-ring-row"><div className="usage-ring" style={{ "--usage": `${state.usage.primaryRemaining ?? 0}%` } as React.CSSProperties}><strong>{state.usage.primaryRemaining ?? "—"}%</strong><span>remaining</span></div><div><strong>{formatPlanName(state.usage.plan)}</strong><span>{primaryWindow ? `${primaryWindow} window` : "Rate-limit window"}</span><small>Reset {state.usage.primaryReset ?? "unavailable"}</small></div></div><div className="usage-bar"><span style={{ width: `${state.usage.primaryRemaining ?? 0}%` }} /></div></section></div><section className="panel dashboard-activity"><div className="section-title-row"><h2>Recent activity</h2><span className="section-muted">{dirtyRepos} repos with active work</span></div><div className="activity-list">{state.activity.slice(0, 5).map((event) => { const task = state.tasks.find((candidate) => candidate.id === event.taskId); return <button key={event.id} onClick={() => task && onSelectTask(task.id)}><span className={`activity-icon activity-${event.type}`}><Icon name={event.type === "test" ? "test" : event.type === "approval" ? "approval" : event.type === "completed" ? "check" : "agent"} size={14} /></span><span><strong>{task?.displayId}</strong>{event.summary}</span><time>{timeAgo(event.timestamp)}</time></button>; })}</div></section></section>;
}

function RepositoryPage({ state, onAddRepository, onToggleRepository, onDiscover, discoveredRepositories, onAddDiscovered }: { state: AppState; onAddRepository: () => void; onToggleRepository: (id: string) => void; onDiscover: () => void; discoveredRepositories: DiscoveredRepository[]; onAddDiscovered: (repository: DiscoveredRepository) => void }) {
  return <section className="page-section repository-page"><div className="page-heading-row"><div><h1>Repositories</h1><span className="save-status">{state.repositories.length} local repositories</span></div><div className="page-actions"><button className="secondary-button pressable" onClick={onDiscover}><Icon name="search" size={15} />Discover</button><button className="primary-button pressable" onClick={onAddRepository}><Icon name="plus" size={16} />Add repository</button></div></div><div className="security-callout"><Icon name="shield" size={17} /><span><strong>Approved roots only.</strong> The local bridge validates every path before it can read or write a repository.</span><button>Review settings <Icon name="arrow" size={13} /></button></div>{discoveredRepositories.length > 0 && <section className="panel discovered-panel"><div className="section-title-row"><h2>Discovered locally</h2><span className="section-muted">Nothing is added automatically</span></div><div className="discovered-list">{discoveredRepositories.map((repository) => <div key={repository.localPath}><span><strong>{repository.name}</strong><code>{repository.localPath}</code></span><button className="secondary-button pressable" onClick={() => onAddDiscovered(repository)}>Add to board</button></div>)}</div></section>}<div className="repo-table panel">{state.repositories.map((repo) => <div className="repo-row" key={repo.id}><span className="repo-symbol repo-symbol--large">{repo.name.slice(0, 1).toUpperCase()}</span><span className="repo-name"><strong>{repo.name}</strong><small className="repo-path">{repo.localPath}</small></span><span className="repo-github">{repo.githubRepo || "No remote linked"}</span><span className="repo-branch"><span className="branch-dot" />{repo.currentBranch ?? repo.defaultBranch}</span><span className="repo-tags">{repo.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}</span><span className={`repo-state ${repo.enabled ? "is-enabled" : "is-disabled"}`}><span className="status-dot" />{repo.enabled ? "Enabled" : "Disabled"}</span><button className="row-more" aria-label={`Toggle ${repo.name}`} onClick={() => onToggleRepository(repo.id)}><Icon name="more" size={17} /></button></div>)}</div><div className="repo-footnote"><Icon name="clock" size={14} />{state.settings.provider === "local" ? "Repository data comes from the local bridge when available." : "Select the local bridge to discover repositories on this computer."}</div></section>;
}

function ThreadsPage({ state, threads, threadsLoading, threadsError, onSelectTask, onContinue, onRefresh }: { state: AppState; threads: CodexThread[]; threadsLoading: boolean; threadsError: string | null; onSelectTask: (id: string) => void; onContinue: (id: string) => void; onRefresh: () => void }) {
  const local = state.settings.provider === "local";
  const taskThreads = state.tasks.filter((task) => task.codexThreadId);
  return <section className="page-section threads-page"><div className="page-heading-row"><div><h1>Codex Threads</h1><span className="save-status">{local ? "Live threads from the local Codex runtime" : "One primary thread per task"}</span></div>{local ? <button className="secondary-button pressable" onClick={onRefresh}><Icon name="clock" size={15} />Refresh</button> : <span className="mock-label">Mock adapter</span>}</div>{local && threadsError && <div className="bridge-inline-error" role="status"><span className="status-dot is-amber" />{threadsError}</div>}<div className="threads-table panel"><div className="thread-table-head"><span>Task</span><span>Repository</span><span>Thread</span><span>Model</span><span>Reasoning</span><span>Status</span><span>Last activity</span><span /></div>{local ? threads.map((thread) => { const task = state.tasks.find((candidate) => candidate.codexThreadId === thread.id); const repository = state.repositories.find((candidate) => candidate.localPath === thread.cwd); const status = thread.status === "error" ? "failed" : thread.status; return <div className="thread-row" key={thread.id}><span className={`thread-task thread-task--plain ${task ? "is-linked" : ""}`}>{task ? <button className="thread-task" onClick={() => onSelectTask(task.id)}><strong>{task.displayId}</strong><span>{task.title}</span></button> : <><strong>THREAD</strong><span>{threadTitle(thread)}</span></>}</span><span>{repository?.name ?? pathName(thread.cwd)}</span><code>{thread.id}</code><span>{task?.modelName ?? thread.modelProvider}</span><span>{task ? formatEffort(task.reasoningEffort) : "—"}</span><span className={`thread-status status-${status}`}><span className="status-dot" />{status}</span><span>{timeAgo(thread.updatedAt)}</span>{task ? <button className="icon-button" aria-label={`Continue ${task.displayId}`} onClick={() => onContinue(task.id)}><Icon name="arrow" size={15} /></button> : <span className="thread-unlinked">—</span>}</div>; }) : taskThreads.map((task) => <div className="thread-row" key={task.id}><button className="thread-task" onClick={() => onSelectTask(task.id)}><strong>{task.displayId}</strong><span>{task.title}</span></button><span>{getRepository(state, task.repositoryId)?.name}</span><code>{task.codexThreadId}</code><span>{task.modelName}</span><span>{formatEffort(task.reasoningEffort)}</span><span className={`thread-status status-${task.codexStatus}`}><span className="status-dot" />{task.codexStatus}</span><span>{timeAgo(task.lastActivityAt ?? task.updatedAt)}</span><button className="icon-button" aria-label={`Continue ${task.displayId}`} onClick={() => onContinue(task.id)}><Icon name="arrow" size={15} /></button></div>)}</div>{local && threadsLoading ? <div className="empty-state panel"><Icon name="threads" size={24} /><strong>Loading live Codex threads</strong><span>Reading thread metadata from the connected local runtime.</span></div> : local && threads.length === 0 && !threadsError ? <div className="empty-state panel"><Icon name="threads" size={24} /><strong>No persisted Codex threads in the approved roots</strong><span>Run a task to create a real thread, or use the refresh action after opening Codex elsewhere.</span></div> : !local && taskThreads.length === 0 ? <div className="empty-state panel"><Icon name="threads" size={24} /><strong>No Codex threads yet</strong><span>Run a task to create its first persistent thread association.</span></div> : null}</section>;
}

function UsagePage({ state }: { state: AppState }) {
  const usage = state.usage;
  const usageUnavailable = usage.primaryRemaining == null && usage.secondaryRemaining == null && !usage.tokensToday;
  const usagePending = state.settings.provider === "local" && state.host.status === "connecting";
  const primaryWindow = formatWindowDuration(usage.primaryWindowDurationMins);
  const secondaryWindow = formatWindowDuration(usage.secondaryWindowDurationMins);
  return <section className="page-section usage-page"><div className="page-heading-row"><div><h1>Usage</h1><span className="save-status">Account and rate-limit snapshots</span></div><span className="mock-label">{usage.isMock ? "Mock usage snapshot" : "Connected host"}</span></div>{usageUnavailable ? <div className="empty-state panel"><Icon name="usage" size={24} /><strong>{usagePending ? "Waiting for local Codex usage data" : usage.unavailableReason ?? "Usage information unavailable from the connected Codex host."}</strong><span>{usagePending ? "The connected host will populate this view when its snapshot is ready." : "Check the bridge connection in Settings and try again."}</span></div> : <><div className="usage-hero panel"><div><span className="usage-overline">Codex</span><h2>{formatPlanName(usage.plan)}</h2><p>{usage.isMock ? "Mock rate-limit data is shown for offline UI development." : "Only values returned by the connected Codex host are shown."}</p></div><div className="usage-hero-value"><strong>{usage.primaryRemaining ?? "—"}%</strong><span>primary remaining</span></div></div><div className="usage-window-grid"><UsageWindow label={primaryWindow ? `${primaryWindow} primary window` : "Primary window"} remaining={usage.primaryRemaining} reset={usage.primaryReset} /><UsageWindow label={secondaryWindow ? `${secondaryWindow} secondary window` : "Secondary window"} remaining={usage.secondaryRemaining} reset={usage.secondaryReset} /></div><div className="usage-stat-grid"><div className="panel"><span>Today</span><strong>{usage.tokensToday ?? "—"}</strong><small>tokens used</small></div><div className="panel"><span>Lifetime</span><strong>{usage.lifetimeTokens ?? "—"}</strong><small>tokens used</small></div><div className="panel"><span>Peak day</span><strong>{usage.peakDailyTokens ?? "—"}</strong><small>tokens used</small></div></div></>}</section>;
}

function UsageWindow({ label, remaining, reset }: { label: string; remaining: number | null; reset: string | null }) {
  return <section className="usage-window panel"><div className="section-title-row"><h2>{label}</h2><strong>{remaining ?? "—"}% remaining</strong></div><div className="segmented-progress">{Array.from({ length: 10 }).map((_, index) => <i key={index} className={remaining != null && index < Math.round(remaining / 10) ? "is-filled" : ""} />)}</div><span>Reset: {reset ?? "unavailable"}</span></section>;
}

function SettingsPage({ state, theme, onTheme, onProvider, onApprovedRoots, onAddRoot, onRefreshBridge, onDiscover, discoveredRepositories, onAddDiscovered }: { state: AppState; theme: "dark" | "light"; onTheme: () => void; onProvider: (provider: ExecutionProvider) => void; onApprovedRoots: (roots: string[]) => void; onAddRoot: (root: string) => void; onRefreshBridge: () => void; onDiscover: () => void; discoveredRepositories: DiscoveredRepository[]; onAddDiscovered: (repository: DiscoveredRepository) => void }) {
  const [root, setRoot] = useState("");
  const hostOnline = state.settings.provider === "local" && state.host.status === "connected";
  const hostLabel = state.host.status === "auth_required" ? "Auth required" : hostOnline ? "Online" : state.host.status === "connecting" ? "Connecting" : "Offline";
  const approvedRoots = state.settings.provider === "local" ? state.host.approvedRoots ?? [] : state.settings.approvedRoots;
  return <section className="page-section settings-page"><div className="page-heading-row"><div><h1>Settings</h1><span className="save-status">Private workspace configuration</span></div></div><div className="settings-grid"><section className="panel settings-panel"><div className="section-title-row"><div><h2>Codex provider</h2><p>Choose the execution boundary for this workspace.</p></div><span className={`settings-status ${hostOnline ? "is-online" : ""}`}><span className={`status-dot ${hostOnline ? "is-mint" : "is-amber"}`} />{state.settings.provider === "mock" ? "Mock" : hostLabel}</span></div><div className="provider-options"><label><input aria-label="Mock adapter" type="radio" name="provider" checked={state.settings.provider === "mock"} onChange={() => onProvider("mock")} /><span><strong>Mock adapter</strong><small>Offline UI development with demo events.</small></span></label><label><input aria-label="Local Codex bridge" type="radio" name="provider" checked={state.settings.provider === "local"} onChange={() => onProvider("local")} /><span><strong>Local Codex bridge</strong><small>Uses localhost only and the installed Codex App Server.</small></span></label></div><div className="settings-host"><div className="host-illustration"><Icon name="shield" size={24} /></div><div><strong>{state.settings.provider === "mock" ? "Mock execution is active" : hostOnline ? "Local Codex host online" : state.host.status === "auth_required" ? "Codex authentication required" : "Local Codex host offline"}</strong><span>{state.settings.provider === "mock" ? "No computer access is claimed. Switch providers when the local bridge is running." : state.host.error ?? (state.host.status === "auth_required" ? "Sign in to the local Codex runtime on this computer." : "Start the local bridge on this computer to enable model discovery, runs, Git status, and diff refresh.")}</span></div></div><div className="settings-detail-row"><span>Bridge</span><code>{state.host.bridgeVersion ?? "Not detected"}</code></div><div className="settings-detail-row"><span>Codex</span><span>{state.host.codexVersion ?? "Not detected"}</span></div><div className="settings-detail-row"><span>Host</span><span>{state.host.hostname ?? "Local machine"}</span></div><button className="secondary-button pressable" onClick={onRefreshBridge}><Icon name="clock" size={15} />Check connection</button></section><section className="panel settings-panel"><div className="section-title-row"><div><h2>Approved roots</h2><p>Only these folders may be exposed to the local bridge.</p></div><Icon name="shield" size={18} /></div><div className="root-list">{approvedRoots.map((approvedRoot) => <div key={approvedRoot}><code>{approvedRoot}</code><button aria-label={`Remove ${approvedRoot}`} onClick={() => onApprovedRoots(state.settings.approvedRoots.filter((candidate) => candidate !== approvedRoot))}><Icon name="close" size={15} /></button></div>)}</div><form className="inline-form" onSubmit={(event) => { event.preventDefault(); if (root.trim()) { onAddRoot(root.trim()); setRoot(""); } }}><input value={root} onChange={(event) => setRoot(event.target.value)} placeholder="C:\\Users\\me\\Development" aria-label="Add approved root" disabled={state.settings.provider === "local"} /><button className="secondary-button pressable" type="submit" disabled={state.settings.provider === "local"}><Icon name="plus" size={15} />Add root</button></form><small className="field-hint">{state.settings.provider === "local" ? "The local bridge reads CODEX_APPROVED_ROOTS at startup; reported roots appear here after connection." : "The bridge canonicalizes every path and rejects traversal, symlink escape, credential, system, and unapproved directories."}</small></section><section className="panel settings-panel"><div className="section-title-row"><div><h2>Repository discovery</h2><p>Scan approved roots only. Nothing is added automatically.</p></div><button className="secondary-button pressable" onClick={onDiscover}><Icon name="search" size={15} />Discover</button></div>{discoveredRepositories.length === 0 ? <div className="timeline-empty">No discovered repositories yet.</div> : <div className="discovered-list">{discoveredRepositories.slice(0, 6).map((repository) => <div key={repository.localPath}><div><strong>{repository.name}</strong><code>{repository.localPath}</code></div><button className="secondary-button pressable" onClick={() => onAddDiscovered(repository)}>Add</button></div>)}</div>}</section><section className="panel settings-panel settings-preferences"><div className="section-title-row"><div><h2>Appearance</h2><p>Theme preference is saved with this private workspace.</p></div><button className="theme-toggle" onClick={onTheme} aria-label="Toggle theme">{theme === "dark" ? <Icon name="moon" size={16} /> : <Icon name="sun" size={16} />}<span>{theme === "dark" ? "Dark" : "Solarized Light"}</span></button></div><div className="keyboard-shortcuts"><span><kbd>N</kbd> new task</span><span><kbd>/</kbd> search</span><span><kbd>R</kbd> run selected</span><span><kbd>Esc</kbd> close panel</span></div></section></div></section>;
}

function TaskDrawer({ state, task, repository, models, diff, onClose, onUpdate, onRun, onContinue, onStop, onFork, onArchive, onDelete, onShowDiff, onCloseDiff, onFeedback, onSendMessage, onApproval, onToast }: { state: AppState; task: Task; repository?: AppState["repositories"][number]; models: ModelOption[]; diff: { fileName: string; additions: number; deletions: number; lines: string[] }[] | null; onClose: () => void; onUpdate: (updates: Partial<Task>) => void; onRun: () => void; onContinue: () => void; onStop: () => void; onFork: () => void; onArchive: () => void; onDelete: () => void; onShowDiff: () => void; onCloseDiff: () => void; onFeedback: (message: string) => void; onSendMessage: (message: string) => void; onApproval: (requestId: string, decision: string) => void; onToast: (message: string) => void }) {
  const [message, setMessage] = useState("");
  const events = state.activity.filter((event) => event.taskId === task.id).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const selectedModel = models.find((model) => model.id === task.modelId) ?? models[0];
  const efforts = selectedModel?.supportedReasoningEfforts ?? ["Low", "Medium", "High"];
  const running = task.codexStatus === "running";
  const timelineIcon = (event: ActivityEvent) => event.type === "command" ? "command" : event.type === "test" ? "test" : event.type === "file" ? "file" : event.type === "approval" ? "approval" : event.type === "completed" ? "check" : event.type === "error" ? "close" : "agent";
  return <aside className="task-drawer" aria-label={`Task details for ${task.displayId}`}><div className="drawer-header"><div><span className="task-id">{task.displayId}</span><span className="drawer-thread-state"><span className={`status-dot ${running ? "is-indigo" : task.codexThreadId ? "is-mint" : "is-muted"}`} />{task.codexThreadId ? (running ? "Thread running" : "Thread saved") : "No thread yet"}</span></div><button className="icon-button" aria-label="Close task details" onClick={onClose}><Icon name="close" size={18} /></button></div><div className="drawer-scroll"><div className="drawer-title-row"><h2>{task.title}</h2><button className="icon-button" aria-label="Edit task title" onClick={() => onToast("Inline fields are editable below") }><Icon name="edit" size={15} /></button></div><div className="drawer-meta-grid"><span>Repository<strong>{repository?.name}</strong></span><span>Model<strong>{task.modelName}</strong></span><span>Priority<strong className={`priority-label priority-${task.priority.toLowerCase()}`}>{task.priority}</strong></span><span>Status<strong>{task.status}</strong></span><span>Tests<strong className={task.testStatus?.startsWith("Blocked") ? "test-failed" : "test-passed"}>{task.testStatus ?? "Not run"}</strong></span><span>Thread<strong className="thread-value">{task.codexThreadId ?? "Created on run"}</strong></span></div><div className="drawer-actions">{running ? <button className="danger-button pressable" onClick={onStop}><Icon name="stop" size={15} />Stop current turn</button> : task.codexThreadId ? <button className="primary-button pressable" onClick={onContinue}><Icon name="arrow" size={15} />Continue with Codex</button> : <button className="primary-button pressable" onClick={onRun}><Icon name="play" size={15} />Run with Codex</button>}<button className="secondary-button pressable" onClick={onShowDiff} disabled={!task.codexThreadId}><Icon name="file" size={15} />Diff</button><button className="icon-button" aria-label="Open in Codex" title="Open in Codex is available when the local bridge is connected" onClick={() => onToast("Local Codex host offline. The thread ID is preserved on this task.")}><Icon name="external" size={15} /></button></div><section className="drawer-section"><div className="drawer-section-heading"><h3>Task</h3><span className="section-muted">Editable</span></div><label className="detail-field"><span>Title</span><input defaultValue={task.title} onBlur={(event) => event.target.value !== task.title && onUpdate({ title: event.target.value })} /></label><label className="detail-field"><span>Description</span><textarea defaultValue={task.description} rows={4} onBlur={(event) => event.target.value !== task.description && onUpdate({ description: event.target.value })} /></label><label className="detail-field"><span>Acceptance criteria</span><textarea defaultValue={task.acceptanceCriteria.join("\n")} rows={3} onBlur={(event) => onUpdate({ acceptanceCriteria: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) })} /></label><div className="detail-inline-fields"><SelectField label="Priority" value={task.priority} onChange={(value) => onUpdate({ priority: value as Priority })}>{["Urgent", "High", "Medium", "Low"].map((priority) => <option key={priority}>{priority}</option>)}</SelectField><SelectField label="Status" value={task.status} onChange={(value) => onUpdate({ status: value as TaskStatus })}>{TASK_STATUSES.map((status) => <option key={status}>{status}</option>)}</SelectField></div><div className="tag-row">{task.tags.map((tag) => <span key={tag}>{tag}</span>)}<button onClick={() => onToast("Add tags from the task editor in the next iteration")}><Icon name="plus" size={12} />Tag</button></div></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Repository</h3><span className="repo-connected"><span className="status-dot is-muted" />Bridge offline</span></div><div className="repo-detail"><div><span>Name</span><strong>{repository?.name}</strong></div><div><span>Local path</span><code className="detail-path">{repository?.localPath}</code></div><div><span>Branch</span><strong>{task.branch}</strong></div><div><span>Default branch</span><strong>{repository?.defaultBranch}</strong></div></div></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Codex configuration</h3><span className="section-muted">{state.settings.provider === "local" ? "Local bridge" : "Mock adapter"}</span></div><div className="detail-inline-fields"><SelectField label="Model" value={task.modelId} onChange={(value) => { const model = models.find((candidate) => candidate.id === value); onUpdate({ modelId: value, modelName: model?.name ?? task.modelName, reasoningEffort: model?.defaultReasoningEffort ?? task.reasoningEffort }); }}>{models.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</SelectField><SelectField label="Reasoning" value={task.reasoningEffort} onChange={(value) => onUpdate({ reasoningEffort: value as ReasoningEffort })}>{efforts.map((effort) => <option key={effort}>{effort}</option>)}</SelectField></div><div className="config-grid"><span>Approval policy<strong>{task.approvalPolicy}</strong></span><span>Sandbox<strong>{task.sandboxMode}</strong></span><span>Network<strong>{task.networkAccess}</strong></span><span>Writable root<strong>{repository?.name ?? "Selected repo"}</strong></span></div></section><section className="drawer-section activity-timeline"><div className="drawer-section-heading"><h3>Activity</h3><span className="section-muted">{events.length} events</span></div>{events.length === 0 ? <div className="timeline-empty">No activity yet. Run this task to start a Codex turn.</div> : events.map((event) => <div className="timeline-event" key={event.id}><span className={`timeline-icon timeline-${event.type}`}><Icon name={timelineIcon(event) as IconName} size={14} /></span><div><div className="timeline-summary"><strong>{event.type}</strong><span>{event.summary}</span><time>{timeAgo(event.timestamp)}</time></div>{event.type === "command" && <details><summary>{event.command}</summary><code>{event.cwd}</code><pre>{event.output ?? "$ waiting for mock output"}</pre></details>}{event.type === "approval" && event.requestId && <div className="approval-actions"><span>{event.reason ?? "Approval required"}</span><button className="secondary-button pressable" onClick={() => onApproval(event.requestId!, "accept")}>Allow once</button>{event.availableDecisions?.includes("acceptForSession") && <button className="secondary-button pressable" onClick={() => onApproval(event.requestId!, "acceptForSession")}>Allow for session</button>}<button className="text-button text-danger" onClick={() => onApproval(event.requestId!, "decline")}>Deny</button></div>}{event.type === "file" && <div className="file-change"><code>{event.fileName}</code><span className="additions">+{event.additions ?? 0}</span><span className="deletions">-{event.deletions ?? 0}</span><button onClick={onShowDiff}>View diff</button></div>}</div></div>)}</section>{task.codexThreadId && <section className="composer"><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Send a follow-up instruction…" rows={2} /><button className="primary-button pressable" disabled={!message.trim()} onClick={() => { onSendMessage(message.trim()); setMessage(""); }}><Icon name="send" size={15} />Send</button></section>}{diff && <DiffPanel diff={diff} onFeedback={onFeedback} onClose={onCloseDiff} />}</div><div className="drawer-footer"><button className="text-button" onClick={onFork}><Icon name="copy" size={14} />Fork thread</button><button className="text-button" onClick={onArchive}>Archive task</button><button className="text-button text-danger" onClick={onDelete}><Icon name="trash" size={14} />Delete</button></div></aside>;
}

function DiffPanel({ diff, onFeedback, onClose }: { diff: { fileName: string; additions: number; deletions: number; lines: string[] }[]; onFeedback: (message: string) => void; onClose: () => void }) {
  return <section className="diff-panel"><div className="drawer-section-heading"><div><h3>Diff</h3><span className="section-muted">Review before accepting</span></div><button className="icon-button" aria-label="Close diff" onClick={onClose}><Icon name="close" size={15} /></button></div>{diff.map((file) => <div className="diff-file" key={file.fileName}><div className="diff-file-head"><code>{file.fileName}</code><span className="additions">+{file.additions}</span><span className="deletions">-{file.deletions}</span></div><pre>{file.lines.map((line, index) => <span className={line.startsWith("+") ? "diff-add" : line.startsWith("-") ? "diff-delete" : ""} key={`${line}-${index}`}>{line}</span>)}</pre></div>)}<div className="diff-actions"><button className="secondary-button pressable" onClick={() => onFeedback("Request changes sent to the mock thread")}>Request changes</button><button className="primary-button pressable" onClick={() => onFeedback("Diff accepted for review; no commit or push was created")}><Icon name="check" size={15} />Accept</button></div></section>;
}

function TaskModal({ repositories, models, instant, onClose, onCreate }: { repositories: AppState["repositories"]; models: ModelOption[]; instant?: boolean; onClose: () => void; onCreate: (draft: { displayId: string; title: string; description: string; criteria: string; notes: string; repositoryId: string; priority: Priority; modelId: string; effort: ReasoningEffort; branch: string; tags: string }) => void }) {
  const [form, setForm] = useState({ displayId: "NEW-1", title: "", description: "", criteria: "", notes: "", repositoryId: repositories[0]?.id ?? "", priority: "Medium" as Priority, modelId: models[0]?.id ?? "gpt-5.6-sol", effort: models[0]?.defaultReasoningEffort ?? "High" as ReasoningEffort, branch: "main", tags: "" });
  const model = models.find((candidate) => candidate.id === form.modelId) ?? models[0];
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className={`modal-card ${instant ? "is-instant" : ""}`} role="dialog" aria-modal="true" aria-labelledby="new-task-title"><div className="modal-header"><div><span className="modal-overline">New work item</span><h2 id="new-task-title">Add task</h2></div><button className="icon-button" aria-label="Close add task" onClick={onClose}><Icon name="close" size={18} /></button></div><form onSubmit={(event) => { event.preventDefault(); if (form.title.trim()) onCreate(form); }}><div className="modal-grid"><label className="detail-field"><span>Task ID</span><input value={form.displayId} onChange={(event) => set("displayId", event.target.value)} /></label><label className="detail-field modal-span-2"><span>Title</span><input required value={form.title} onChange={(event) => set("title", event.target.value)} placeholder="What needs to change?" /></label><label className="detail-field modal-span-3"><span>Description</span><textarea value={form.description} onChange={(event) => set("description", event.target.value)} placeholder="Give Codex enough context to make a safe first pass." rows={4} /></label><label className="detail-field modal-span-3"><span>Acceptance criteria <small>one item per line</small></span><textarea value={form.criteria} onChange={(event) => set("criteria", event.target.value)} placeholder="Tests cover the failure path\nKeep the change scoped" rows={3} /></label><SelectField label="Repository" value={form.repositoryId} onChange={(value) => set("repositoryId", value)} className="modal-span-2">{repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.name}</option>)}</SelectField><SelectField label="Priority" value={form.priority} onChange={(value) => set("priority", value)}>{["Urgent", "High", "Medium", "Low"].map((priority) => <option key={priority}>{priority}</option>)}</SelectField><SelectField label="Model" value={form.modelId} onChange={(value) => { const next = models.find((candidate) => candidate.id === value); setForm((current) => ({ ...current, modelId: value, effort: next?.defaultReasoningEffort ?? current.effort })); }} className="modal-span-2">{models.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</SelectField><SelectField label="Reasoning" value={form.effort} onChange={(value) => set("effort", value)}>{(model?.supportedReasoningEfforts ?? ["Low", "Medium", "High"]).map((effort) => <option key={effort}>{effort}</option>)}</SelectField><label className="detail-field"><span>Branch</span><input value={form.branch} onChange={(event) => set("branch", event.target.value)} /></label><label className="detail-field modal-span-2"><span>Tags <small>comma separated</small></span><input value={form.tags} onChange={(event) => set("tags", event.target.value)} placeholder="auth, security" /></label><label className="detail-field modal-span-3"><span>Notes</span><input value={form.notes} onChange={(event) => set("notes", event.target.value)} placeholder="Optional context for future turns" /></label></div><div className="modal-footer"><span className="modal-hint"><Icon name="shield" size={14} />Writes stay inside the selected repository root.</span><div><button type="button" className="secondary-button pressable" onClick={onClose}>Cancel</button><button type="submit" className="primary-button pressable" disabled={!form.title.trim()}><Icon name="plus" size={15} />Create task</button></div></div></form></section></div>;
}

function RepositoryModal({ onClose, onCreate }: { onClose: () => void; onCreate: (draft: { name: string; localPath: string; githubRepo: string; defaultBranch: string; tags: string[] }) => void }) {
  const [form, setForm] = useState({ name: "", localPath: "/Users/me/Development/", githubRepo: "", defaultBranch: "main", tags: "" });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="new-repo-title"><div className="modal-header"><div><span className="modal-overline">Local source</span><h2 id="new-repo-title">Add repository</h2></div><button className="icon-button" aria-label="Close add repository" onClick={onClose}><Icon name="close" size={18} /></button></div><form onSubmit={(event) => { event.preventDefault(); if (form.name.trim() && form.localPath.trim()) onCreate({ ...form, tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean) }); }}><div className="modal-grid"><label className="detail-field modal-span-3"><span>Name</span><input required value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="backend-api" /></label><label className="detail-field modal-span-3"><span>Local path</span><input required value={form.localPath} onChange={(event) => set("localPath", event.target.value)} /></label><label className="detail-field modal-span-2"><span>GitHub owner/repository</span><input value={form.githubRepo} onChange={(event) => set("githubRepo", event.target.value)} placeholder="company/backend-api" /></label><label className="detail-field"><span>Default branch</span><input value={form.defaultBranch} onChange={(event) => set("defaultBranch", event.target.value)} /></label><label className="detail-field modal-span-3"><span>Tags <small>comma separated</small></span><input value={form.tags} onChange={(event) => set("tags", event.target.value)} placeholder="services, auth" /></label></div><div className="modal-footer"><span className="modal-hint"><Icon name="shield" size={14} />The bridge will verify this path against approved roots.</span><div><button type="button" className="secondary-button pressable" onClick={onClose}>Cancel</button><button type="submit" className="primary-button pressable"><Icon name="plus" size={15} />Add repository</button></div></div></form></section></div>;
}

export default function Home() {
  const [state, setState] = useState<AppState>(() => createSeedState());
  const stateRef = useRef(state);
  const adapters = useMemo<Record<ExecutionProvider, CodexAdapter>>(() => ({ mock: new MockCodexAdapter(), local: new LocalCodexAdapter() }), []);
  const adaptersRef = useRef(adapters);
  const adapterRef = useRef<CodexAdapter>(adapters.mock);
  const timersRef = useRef<Record<string, number[]>>({});
  const runTaskRef = useRef<(taskId: string) => void>(() => {});
  const [view, setView] = useState<View>("Board");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filters, setFilters] = useState({ search: "", repo: "all", status: "all", priority: "all", model: "all", effort: "all", execution: "all" });
  const [models, setModels] = useState<ModelOption[]>(MOCK_MODELS);
  const [codexThreads, setCodexThreads] = useState<CodexThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [discoveredRepositories, setDiscoveredRepositories] = useState<DiscoveredRepository[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [storageStatus, setStorageStatus] = useState<"saving" | "saved" | "demo">("saved");
  const [toast, setToast] = useState<string | null>(null);
  const [taskModal, setTaskModal] = useState(false);
  const [repositoryModal, setRepositoryModal] = useState(false);
  const [modalInstant, setModalInstant] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [diff, setDiff] = useState<{ taskId: string; files: { fileName: string; additions: number; deletions: number; lines: string[] }[] } | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? null : current), 3_200);
  };

  const persist = async (next: AppState) => {
    setStorageStatus("saving");
    try {
      const response = await fetch("/api/state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: next }) });
      if (!response.ok) throw new Error("Persistence unavailable");
      setStorageStatus("saved");
    } catch {
      setStorageStatus("demo");
    }
  };

  const commit = (updater: (current: AppState) => AppState, message?: string) => {
    const next = updater(stateRef.current);
    stateRef.current = next;
    setState(next);
    void persist(next);
    if (message) notify(message);
  };

  const selectProvider = (provider: ExecutionProvider) => {
    adapterRef.current = adaptersRef.current[provider];
    if (provider === "mock") {
      setCodexThreads([]);
      setThreadsError(null);
    }
    commit((current) => ({
      ...current,
      settings: { ...current.settings, provider },
      host: provider === "mock" ? { ...current.host, status: "offline", isMock: true, error: null } : { ...current.host, status: "connecting", isMock: false },
      usage: provider === "mock" ? { ...current.usage, source: "mock", isMock: true } : { ...current.usage, source: "local", isMock: false, primaryRemaining: null, secondaryRemaining: null, primaryReset: null, secondaryReset: null, primaryWindowDurationMins: null, secondaryWindowDurationMins: null, tokensToday: null, plan: null, unavailableReason: "Usage information unavailable until the local Codex bridge connects." },
      updatedAt: new Date().toISOString(),
    }), provider === "mock" ? "Mock adapter selected" : "Local Codex bridge selected");
    if (provider === "local") void refreshLocalBridge();
  };

  const syncLocalRepositories = async () => {
    const discovered = await adaptersRef.current.local.listRepositories();
    const current = stateRef.current;
    const existingByPath = new Map(current.repositories.map((repository) => [repository.localPath, repository]));
    const discoveredPaths = new Set(discovered.map((repository) => repository.localPath));
    const repositories = discovered.map((repository) => {
      const existing = existingByPath.get(repository.localPath);
      const now = new Date().toISOString();
      return {
        id: existing?.id ?? idFor("repo"),
        name: repository.name,
        localPath: repository.localPath,
        githubRepo: repository.remote ?? "",
        defaultBranch: repository.defaultBranch ?? repository.currentBranch ?? "main",
        enabled: existing?.enabled ?? true,
        tags: existing?.tags ?? [],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        connectionState: "connected" as const,
        currentBranch: repository.currentBranch,
        remote: repository.remote,
        dirty: repository.dirty,
        lastCommit: repository.lastCommit,
        lastSeen: repository.lastSeen,
      };
    });
    const retainedRepositories = current.repositories.filter((repository) => !isSeedRepository(repository) && !discoveredPaths.has(repository.localPath));
    const nextRepositories = [...repositories, ...retainedRepositories];
    const repositoryIds = new Set(nextRepositories.map((repository) => repository.id));
    const nextTasks = current.tasks.filter((task) => !isSeedTask(task) && repositoryIds.has(task.repositoryId));
    const taskIds = new Set(nextTasks.map((task) => task.id));
    const next = { ...current, repositories: nextRepositories, tasks: nextTasks, activity: current.activity.filter((event) => taskIds.has(event.taskId)), updatedAt: new Date().toISOString() };
    stateRef.current = next;
    setState(next);
    void persist(next);
    setDiscoveredRepositories([]);
    return discovered;
  };

  const refreshLocalThreads = async () => {
    if (stateRef.current.settings.provider !== "local") return;
    setThreadsLoading(true);
    setThreadsError(null);
    try {
      setCodexThreads(await adaptersRef.current.local.listThreads());
    } catch (error) {
      setThreadsError(error instanceof Error ? error.message : "Live Codex threads are unavailable from the local bridge.");
    } finally {
      setThreadsLoading(false);
    }
  };

  const refreshLocalBridge = async () => {
    if (stateRef.current.settings.provider !== "local") return notify("Select Local Codex bridge first");
    try {
      const health = await adaptersRef.current.local.connect();
      if (!health) throw new Error("Local bridge did not return diagnostics.");
      commit((current) => ({ ...current, host: { ...current.host, status: health.status === "online" ? "connected" : health.status === "degraded" && health.authenticated === false ? "auth_required" : health.status, isMock: false, version: health.codexVersion, bridgeVersion: health.bridgeVersion, codexVersion: health.codexVersion, platform: health.platform, hostname: health.hostname, lastSeen: health.lastSeenAt, capabilities: health.capabilities, approvedRoots: health.approvedRoots, authenticated: health.authenticated, accountType: health.accountType, error: health.error }, updatedAt: new Date().toISOString() }), health.status === "online" ? "Local Codex host connected" : health.error ?? "Local Codex host needs attention");
      try {
        const localModels = await adaptersRef.current.local.getModels();
        setModels(localModels);
        commit((current) => ({ ...current, host: { ...current.host, status: current.host.status, error: null }, updatedAt: new Date().toISOString() }));
      } catch (error) {
        notify(error instanceof Error ? error.message : "Model discovery unavailable");
      }
      try {
        const account = await adaptersRef.current.local.getAccount();
        commit((current) => ({ ...current, host: { ...current.host, authenticated: account.authenticated ?? null, accountType: account.accountType ?? null, status: account.authenticated === false ? "auth_required" : current.host.status }, usage: { ...current.usage, plan: account.plan, source: "local", isMock: false }, updatedAt: new Date().toISOString() }));
      } catch {
        // Diagnostics remain useful when account data is unavailable.
      }
      try {
        const [rateLimits, usage] = await Promise.all([adaptersRef.current.local.getRateLimits(), adaptersRef.current.local.getUsage()]);
        const mappedUsage = mapUsageSnapshot(rateLimits, usage);
        commit((current) => ({ ...current, usage: { ...current.usage, ...mappedUsage, source: "local", isMock: false }, updatedAt: new Date().toISOString() }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Usage data unavailable from the local Codex bridge.";
        commit((current) => ({ ...current, usage: { ...current.usage, source: "local", isMock: false, unavailableReason: message }, updatedAt: new Date().toISOString() }));
        notify(message);
      }
      try {
        await syncLocalRepositories();
      } catch (error) {
        notify(error instanceof Error ? error.message : "Repository discovery unavailable");
      }
      await refreshLocalThreads();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Local Codex bridge is unavailable.";
      commit((current) => ({ ...current, host: { ...current.host, status: "offline", isMock: false, error: message }, updatedAt: new Date().toISOString() }));
      notify(message);
    }
  };

  const discoverRepositories = async () => {
    if (stateRef.current.settings.provider !== "local") return notify("Select Local Codex bridge to discover repositories");
    try {
      const discovered = await syncLocalRepositories();
      notify(`${discovered.length} repositories synced from the local bridge`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Repository discovery unavailable");
    }
  };

  const addDiscoveredRepository = (discovered: DiscoveredRepository) => {
    const existing = stateRef.current.repositories.find((repository) => repository.localPath === discovered.localPath);
    if (existing) return notify(`${existing.name} is already on Codex Board`);
    const now = new Date().toISOString();
    const repository = { id: idFor("repo"), name: discovered.name, localPath: discovered.localPath, githubRepo: discovered.remote ?? "", defaultBranch: discovered.defaultBranch ?? discovered.currentBranch ?? "main", enabled: true, tags: [], createdAt: now, updatedAt: now, connectionState: "connected" as const, currentBranch: discovered.currentBranch, remote: discovered.remote, dirty: discovered.dirty, lastCommit: discovered.lastCommit, lastSeen: discovered.lastSeen };
    commit((current) => ({ ...current, repositories: [...current.repositories, repository], updatedAt: now }), `${repository.name} added to Codex Board`);
  };

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const response = await fetch("/api/state");
        if (!response.ok) throw new Error("State unavailable");
        const payload = (await response.json()) as { state: AppState };
        if (mounted && payload.state) {
          const loaded = normalizeAppState(payload.state);
          stateRef.current = loaded;
          setState(loaded);
          setTheme(loaded.settings.theme);
          adapterRef.current = adaptersRef.current[loaded.settings.provider];
          if (loaded.settings.provider === "local") void refreshLocalBridge();
          if (loaded.settings.provider === "mock" && loaded.repositories.some(isSeedRepository)) {
            try {
              const health = await adaptersRef.current.local.connect();
              if (mounted && stateRef.current.settings.provider === "mock" && health?.status === "online") selectProvider("local");
            } catch {
              // Keep the mock fallback when no local bridge is available.
            }
          }
        }
      } catch {
        if (mounted) setStorageStatus("demo");
      } finally {
        if (mounted) setHydrated(true);
      }
    })();
    void adaptersRef.current.mock.getModels().then(setModels);
    const activeTimers = timersRef.current;
    return () => { mounted = false; Object.values(activeTimers).flat().forEach((timer) => window.clearTimeout(timer)); };
  }, []);

  useEffect(() => {
    if (!hydrated || state.settings.provider !== "local") return;
    let cancelled = false;
    void (async () => {
      try {
        for await (const event of adapterRef.current.streamThreadEvents()) {
          if (cancelled) break;
          const task = event.threadId ? stateRef.current.tasks.find((candidate) => candidate.codexThreadId === event.threadId) : undefined;
          if (!task) continue;
          const now = new Date().toISOString();
          const activity = activityFromStream(task.id, event);
          commit((current) => ({ ...current, tasks: current.tasks.map((candidate) => candidate.id === task.id ? { ...candidate, currentTurnId: event.turnId ?? candidate.currentTurnId, codexStatus: event.type === "approval" ? "waitingApproval" : event.type === "turn_completed" ? (event.status === "failed" ? "failed" : event.status === "interrupted" ? "interrupted" : "completed") : event.type === "error" ? "failed" : event.type === "turn_started" || event.type === "command" || event.type === "agent" || event.type === "file" ? "running" : candidate.codexStatus, status: event.type === "turn_completed" && event.status !== "failed" && event.status !== "interrupted" ? "Review" : candidate.status, lastActivityAt: now, updatedAt: now } : candidate), activity: [...current.activity, { ...activity, id: event.id, taskId: task.id, timestamp: event.timestamp }], updatedAt: now }));
          if (event.type === "thread_started" || event.type === "turn_completed") void refreshLocalThreads();
        }
      } catch (error) {
        if (!cancelled) notify(error instanceof Error ? error.message : "Local Codex event stream ended");
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated, state.settings.provider]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT";
      if (event.key === "Escape") { setSelectedTaskId(null); setTaskModal(false); setRepositoryModal(false); setDiff(null); return; }
      if (isEditing) return;
      if (event.key.toLowerCase() === "n") { event.preventDefault(); setModalInstant(true); setTaskModal(true); }
      if (event.key === "/") { event.preventDefault(); document.querySelector<HTMLInputElement>("[data-search]")?.focus(); }
      if (event.key.toLowerCase() === "r" && selectedTaskId) { event.preventDefault(); runTaskRef.current(selectedTaskId); }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [selectedTaskId]);

  const selectedTask = state.tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedRepository = selectedTask ? getRepository(state, selectedTask.repositoryId) : undefined;

  const filteredTasks = useMemo(() => state.tasks.filter((task) => {
    const repository = getRepository(state, task.repositoryId);
    const haystack = `${task.displayId} ${task.title} ${task.description} ${repository?.name ?? ""}`.toLowerCase();
    return (!filters.search || haystack.includes(filters.search.toLowerCase())) && (filters.repo === "all" || task.repositoryId === filters.repo) && (filters.status === "all" || task.status === filters.status) && (filters.priority === "all" || task.priority === filters.priority) && (filters.model === "all" || task.modelId === filters.model) && (filters.effort === "all" || task.reasoningEffort === filters.effort) && (filters.execution === "all" || task.codexStatus === filters.execution);
  }), [filters, state]);

  const updateTask = (taskId: string, updates: Partial<Task>, message?: string) => commit((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, ...updates, updatedAt: new Date().toISOString() } : task), updatedAt: new Date().toISOString() }), message);

  const appendActivity = (taskId: string, event: Omit<ActivityEvent, "id" | "taskId" | "timestamp">) => commit((current) => ({ ...current, activity: [...current.activity, { ...event, id: idFor("activity"), taskId, timestamp: new Date().toISOString() }], updatedAt: new Date().toISOString() }));

  const runTask = async (taskId: string) => {
    const task = stateRef.current.tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    if (task.codexThreadId && task.codexStatus === "running") return notify("This Codex turn is already running");
    const repository = getRepository(stateRef.current, task.repositoryId);
    if (!repository || !repository.enabled) return notify("Select an enabled repository before running this task");
    if (!repository.localPath) return notify("The selected repository has no local path");
    const config = { cwd: repository.localPath, model: task.modelId, effort: task.reasoningEffort, approvalPolicy: task.approvalPolicy, sandboxMode: task.sandboxMode, networkAccess: task.networkAccess };
    if (stateRef.current.settings.provider === "local" && stateRef.current.host.status !== "connected") return notify(stateRef.current.host.error ?? "Local Codex host offline. Start the bridge before running a task.");
    let thread: { threadId: string; sessionId: string };
    try {
      if (task.codexThreadId) {
        await adapterRef.current.resumeThread(task.codexThreadId, config);
        thread = { threadId: task.codexThreadId, sessionId: task.codexSessionId ?? "" };
      } else {
        thread = await adapterRef.current.startThread(config);
      }
    } catch (error) {
      return notify(error instanceof Error ? error.message : "Codex thread could not be started");
    }
    const startedAt = new Date().toISOString();
    commit((current) => ({ ...current, tasks: current.tasks.map((candidate) => candidate.id === taskId ? { ...candidate, status: "Running", codexStatus: "running", codexThreadId: thread.threadId, codexSessionId: thread.sessionId || candidate.codexSessionId, cwd: repository.localPath, startedAt, completedAt: null, currentTurnId: null, lastActivityAt: startedAt, testStatus: "Running", usage: stateRef.current.settings.provider === "mock" ? candidate.usage ?? 4 : candidate.usage, updatedAt: startedAt } : candidate), activity: [...current.activity, { id: idFor("activity"), taskId, type: "agent", timestamp: startedAt, threadId: thread.threadId, summary: task.codexThreadId ? "Resuming the saved Codex thread" : "Created persistent Codex thread" }], updatedAt: startedAt }), stateRef.current.settings.provider === "mock" ? "Mock Codex turn started" : "Codex turn started");
    if (stateRef.current.settings.provider === "local") {
      try {
        const turn = await adapterRef.current.startTurn(thread.threadId, config, `${task.description}\n\nAcceptance criteria:\n${task.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`);
        if (turn.turnId) updateTask(taskId, { currentTurnId: turn.turnId, lastActivityAt: new Date().toISOString() });
        void refreshLocalThreads();
      } catch (error) {
        updateTask(taskId, { status: "Blocked", codexStatus: "failed", testStatus: "Failed to start turn" });
        appendActivity(taskId, { type: "error", summary: error instanceof Error ? error.message : "Codex turn could not be started" });
        return;
      }
      return;
    }
    const timers: number[] = [];
    timers.push(window.setTimeout(() => appendActivity(taskId, { type: "command", summary: "Inspecting repository status", command: "git status --short", cwd: repository.localPath, status: "completed", exitCode: 0, output: "Working tree clean" }), 900));
    timers.push(window.setTimeout(() => appendActivity(taskId, { type: "file", summary: "src/auth/refresh-token.ts modified", fileName: "src/auth/refresh-token.ts", additions: 18, deletions: 6 }), 1_700));
    timers.push(window.setTimeout(() => appendActivity(taskId, { type: "test", summary: "42 tests passed", command: "npm test -- auth", cwd: repository.localPath, status: "completed", exitCode: 0 }), 2_500));
    timers.push(window.setTimeout(() => { updateTask(taskId, { status: "Review", codexStatus: "completed", completedAt: new Date().toISOString(), testStatus: "42 passed", usage: Math.min(100, (stateRef.current.tasks.find((candidate) => candidate.id === taskId)?.usage ?? 4) + 18) }, "Mock Codex turn completed"); appendActivity(taskId, { type: "completed", summary: "Ready for review" }); }, 3_350));
    timersRef.current[taskId] = timers;
  };

  // runTask reads current data from refs, so the keyboard bridge can stay stable.
  useEffect(() => {
    runTaskRef.current = (taskId) => { void runTask(taskId); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const continueTask = async (taskId: string) => {
    const task = stateRef.current.tasks.find((candidate) => candidate.id === taskId);
    if (!task?.codexThreadId) return runTask(taskId);
    await runTask(taskId);
  };

  const stopTask = async (taskId: string) => {
    const task = stateRef.current.tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    if (task.codexThreadId) {
      try {
        await adapterRef.current.interruptTurn(task.codexThreadId, task.currentTurnId ?? undefined);
      } catch (error) {
        return notify(error instanceof Error ? error.message : "Codex turn could not be interrupted");
      }
    }
    (timersRef.current[taskId] ?? []).forEach((timer) => window.clearTimeout(timer));
    updateTask(taskId, { status: "Ready", codexStatus: stateRef.current.settings.provider === "local" ? "interrupted" : "stopped", testStatus: "Stopped", currentTurnId: null }, "Codex turn stopped");
    appendActivity(taskId, { type: "error", summary: "Turn stopped by user" });
  };

  const forkTask = async (taskId: string) => {
    const source = stateRef.current.tasks.find((candidate) => candidate.id === taskId);
    if (!source || !source.codexThreadId) return notify("Run this task before forking its Codex thread");
    let forkedThread: { threadId: string; sessionId: string; forkedFromId: string | null } | null = null;
    if (stateRef.current.settings.provider === "local") {
      const repository = getRepository(stateRef.current, source.repositoryId);
      if (!repository) return notify("Select a repository before forking this thread");
      try {
        forkedThread = await adapterRef.current.forkThread(source.codexThreadId, { cwd: repository.localPath, model: source.modelId, effort: source.reasoningEffort, approvalPolicy: source.approvalPolicy, sandboxMode: source.sandboxMode, networkAccess: source.networkAccess });
      } catch (error) {
        return notify(error instanceof Error ? error.message : "Codex thread fork failed");
      }
    } else {
      const suffix = Math.random().toString(36).slice(2, 8);
      forkedThread = { threadId: `thread_mock_${suffix}`, sessionId: `session_mock_${suffix}`, forkedFromId: source.codexThreadId };
    }
    const fork: Task = { ...source, id: idFor("task"), displayId: `${source.displayId}-F`, title: `${source.title} (fork)`, status: "Ready", codexThreadId: forkedThread.threadId, codexSessionId: forkedThread.sessionId, currentTurnId: null, forkedFromThreadId: forkedThread.forkedFromId ?? source.codexThreadId, codexStatus: "idle", startedAt: null, completedAt: null, testStatus: null, usage: null, sortOrder: Math.max(...stateRef.current.tasks.map((task) => task.sortOrder), 0) + 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    commit((current) => ({ ...current, tasks: [...current.tasks, fork], updatedAt: new Date().toISOString() }), "Forked task without changing the primary thread");
    if (stateRef.current.settings.provider === "local") void refreshLocalThreads();
    setSelectedTaskId(fork.id);
  };

  const moveTask = (status: TaskStatus, beforeId?: string) => {
    if (!dragTaskId) return;
    const movingId = dragTaskId;
    commit((current) => {
      const moving = current.tasks.find((task) => task.id === movingId);
      if (!moving) return current;
      const targetStatus = beforeId ? current.tasks.find((task) => task.id === beforeId)?.status ?? status : status;
      const nextTasks = current.tasks.map((task) => task.id === movingId ? { ...task, status: targetStatus, updatedAt: new Date().toISOString() } : task);
      const group = nextTasks.filter((task) => task.status === targetStatus).sort((a, b) => a.sortOrder - b.sortOrder).filter((task) => task.id !== movingId);
      const insertAt = beforeId ? Math.max(0, group.findIndex((task) => task.id === beforeId)) : group.length;
      group.splice(insertAt < 0 ? group.length : insertAt, 0, nextTasks.find((task) => task.id === movingId)!);
      const orderMap = new Map(group.map((task, index) => [task.id, index]));
      return { ...current, tasks: nextTasks.map((task) => orderMap.has(task.id) ? { ...task, sortOrder: orderMap.get(task.id)! } : task), updatedAt: new Date().toISOString() };
    }, beforeId ? "Task reordered" : `Moved task to ${status}`);
    setDragTaskId(null);
  };

  const createTask = (draft: { displayId: string; title: string; description: string; criteria: string; notes: string; repositoryId: string; priority: Priority; modelId: string; effort: ReasoningEffort; branch: string; tags: string }) => {
    const model = models.find((candidate) => candidate.id === draft.modelId) ?? models[0];
    const now = new Date().toISOString();
    const next: Task = { id: idFor("task"), displayId: draft.displayId.trim().toUpperCase() || "NEW-1", title: draft.title.trim(), description: draft.description.trim() || "No description provided yet.", acceptanceCriteria: draft.criteria.split("\n").map((line) => line.trim()).filter(Boolean), notes: draft.notes.trim(), status: "Backlog", priority: draft.priority, repositoryId: draft.repositoryId, modelId: draft.modelId, modelName: model?.name ?? "Codex model", reasoningEffort: draft.effort, approvalPolicy: "unlessTrusted", sandboxMode: "workspaceWrite", networkAccess: "disabled", branch: draft.branch.trim() || "main", codexThreadId: null, codexSessionId: null, currentTurnId: null, cwd: null, forkedFromThreadId: null, lastActivityAt: null, codexStatus: "idle", createdAt: now, updatedAt: now, startedAt: null, completedAt: null, sortOrder: Math.max(...stateRef.current.tasks.map((task) => task.sortOrder), 0) + 1, testStatus: null, prStatus: null, usage: null, tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean) };
    commit((current) => ({ ...current, tasks: [...current.tasks, next], updatedAt: now }), "Task created");
    setTaskModal(false);
    setSelectedTaskId(next.id);
  };

  const createRepository = (draft: { name: string; localPath: string; githubRepo: string; defaultBranch: string; tags: string[] }) => {
    const now = new Date().toISOString();
    const next = { id: idFor("repo"), name: draft.name.trim(), localPath: draft.localPath.trim(), githubRepo: draft.githubRepo.trim(), defaultBranch: draft.defaultBranch.trim() || "main", tags: draft.tags, enabled: true, createdAt: now, updatedAt: now, connectionState: "unknown" as const };
    commit((current) => ({ ...current, repositories: [...current.repositories, next], updatedAt: now }), "Repository added");
    setRepositoryModal(false);
  };

  const updateRoots = (roots: string[]) => commit((current) => ({ ...current, settings: { ...current.settings, approvedRoots: roots }, updatedAt: new Date().toISOString() }), "Approved roots updated");
  const addRoot = (root: string) => {
    if (root.includes("..") || /\.ssh|[\\/]etc|[\\/]System|Windows/i.test(root)) return notify("That path is not an approved root");
    if (stateRef.current.settings.approvedRoots.includes(root)) return notify("That root is already approved");
    updateRoots([...stateRef.current.settings.approvedRoots, root]);
  };

  const openDiff = async (task: Task) => {
    if (!task.codexThreadId) return notify("Run the task first to create a thread diff");
    try { setDiff({ taskId: task.id, files: await adapterRef.current.getDiff({ ...task, cwd: task.cwd ?? getRepository(stateRef.current, task.repositoryId)?.localPath ?? null }) }); } catch (error) { notify(error instanceof Error ? error.message : "Diff unavailable while the local host is offline"); }
  };

  const deleteTask = (taskId: string) => {
    if (!window.confirm("Delete this task and its activity history?")) return;
    commit((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== taskId), activity: current.activity.filter((event) => event.taskId !== taskId), updatedAt: new Date().toISOString() }), "Task deleted");
    setSelectedTaskId(null);
  };

  const archiveTask = (taskId: string) => {
    if (!window.confirm("Archive this task? It will be moved to Done and stay in Site storage.")) return;
    updateTask(taskId, { status: "Done", codexStatus: "stopped" }, "Task archived");
  };

  const sendMessage = async (taskId: string, message: string) => {
    const task = stateRef.current.tasks.find((candidate) => candidate.id === taskId);
    if (!task?.codexThreadId) return;
    const config = { cwd: selectedRepository?.localPath ?? task.cwd ?? "selected repository", model: task.modelId, effort: task.reasoningEffort, approvalPolicy: task.approvalPolicy, sandboxMode: task.sandboxMode, networkAccess: task.networkAccess };
    try {
      const result = await adapterRef.current.startTurn(task.codexThreadId, config, message);
      result.events.forEach((event) => appendActivity(taskId, event));
      updateTask(taskId, { status: "Running", codexStatus: "running", currentTurnId: result.turnId, lastActivityAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, stateRef.current.settings.provider === "mock" ? "Follow-up sent to mock thread" : "Follow-up sent to Codex thread");
      if (stateRef.current.settings.provider === "local") void refreshLocalThreads();
      if (stateRef.current.settings.provider === "mock") window.setTimeout(() => { updateTask(taskId, { status: "Review", codexStatus: "completed", currentTurnId: null, testStatus: "Follow-up complete" }); appendActivity(taskId, { type: "completed", summary: "Follow-up turn complete" }); }, 1_900);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Follow-up turn failed");
    }
  };

  const respondToApproval = async (taskId: string, requestId: string, decision: string) => {
    try {
      await adapterRef.current.respondToApproval(requestId, decision);
      appendActivity(taskId, { type: "approval", summary: `Approval ${decision}`, requestId, approvalDecision: decision });
      updateTask(taskId, { codexStatus: "running", lastActivityAt: new Date().toISOString() }, "Approval response sent");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Approval response failed");
    }
  };

  const renderView = () => {
    if (view === "Dashboard") return <DashboardPage state={state} onView={setView} onSelectTask={setSelectedTaskId} />;
    if (view === "Repositories") return <RepositoryPage state={state} onAddRepository={() => setRepositoryModal(true)} onToggleRepository={(id) => commit((current) => ({ ...current, repositories: current.repositories.map((repository) => repository.id === id ? { ...repository, enabled: !repository.enabled, updatedAt: new Date().toISOString() } : repository), updatedAt: new Date().toISOString() }), "Repository state updated")} onDiscover={() => void discoverRepositories()} discoveredRepositories={discoveredRepositories} onAddDiscovered={addDiscoveredRepository} />;
    if (view === "Codex Threads") return <ThreadsPage state={state} threads={codexThreads} threadsLoading={threadsLoading} threadsError={threadsError} onSelectTask={setSelectedTaskId} onContinue={continueTask} onRefresh={() => void refreshLocalThreads()} />;
    if (view === "Usage") return <UsagePage state={state} />;
    if (view === "Settings") return <SettingsPage state={state} theme={theme} onTheme={() => { const nextTheme = theme === "dark" ? "light" : "dark"; setTheme(nextTheme); commit((current) => ({ ...current, settings: { ...current.settings, theme: nextTheme }, updatedAt: new Date().toISOString() }), "Theme preference updated"); }} onProvider={selectProvider} onApprovedRoots={updateRoots} onAddRoot={addRoot} onRefreshBridge={() => void refreshLocalBridge()} onDiscover={() => void discoverRepositories()} discoveredRepositories={discoveredRepositories} onAddDiscovered={addDiscoveredRepository} />;
    return <BoardPage state={state} tasks={filteredTasks} filters={filters} onFilters={(next) => setFilters((current) => ({ ...current, ...next }))} onSelectTask={setSelectedTaskId} selectedTaskId={selectedTaskId} onAddTask={() => { setModalInstant(false); setTaskModal(true); }} onDragStart={setDragTaskId} onDrop={moveTask} />;
  };

  return <div className={`app-shell ${hydrated ? "is-hydrated" : ""} ${theme === "light" ? "theme-light" : ""}`}><Sidebar view={view} onView={setView} state={state} onAddTask={() => { setModalInstant(false); setTaskModal(true); }} /><div className="app-frame"><TopBar state={state} view={view} onAddTask={() => { setModalInstant(false); setTaskModal(true); }} onView={setView} /><main className="main-content">{renderView()}</main></div><BottomNav view={view} onView={setView} />{selectedTask && <TaskDrawer state={state} task={selectedTask} repository={selectedRepository} models={models} diff={diff?.taskId === selectedTask.id ? diff.files : null} onClose={() => { setSelectedTaskId(null); setDiff(null); }} onUpdate={(updates) => updateTask(selectedTask.id, updates, "Task updated")} onRun={() => void runTask(selectedTask.id)} onContinue={() => void continueTask(selectedTask.id)} onStop={() => void stopTask(selectedTask.id)} onFork={() => forkTask(selectedTask.id)} onArchive={() => archiveTask(selectedTask.id)} onDelete={() => deleteTask(selectedTask.id)} onShowDiff={() => void openDiff(selectedTask)} onCloseDiff={() => setDiff(null)} onFeedback={(message) => { appendActivity(selectedTask.id, { type: "agent", summary: message }); notify(message); }} onSendMessage={(message) => void sendMessage(selectedTask.id, message)} onApproval={(requestId, decision) => void respondToApproval(selectedTask.id, requestId, decision)} onToast={notify} />}{taskModal && <TaskModal repositories={state.repositories} models={models} instant={modalInstant} onClose={() => setTaskModal(false)} onCreate={createTask} />}{repositoryModal && <RepositoryModal onClose={() => setRepositoryModal(false)} onCreate={createRepository} />}{toast && <div className="toast" role="status"><span className="status-dot is-mint" />{toast}</div>}<div className="save-indicator" aria-live="polite"><span className={`status-dot ${storageStatus === "demo" ? "is-amber" : storageStatus === "saving" ? "is-indigo" : "is-mint"}`} />{storageStatus === "demo" ? "Demo state" : storageStatus === "saving" ? "Saving" : "Saved"}</div></div>;
}
