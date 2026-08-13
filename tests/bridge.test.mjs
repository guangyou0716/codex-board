import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { ApprovedRoots, PathSecurityError, isPathInside } = await import("../bridge/path-security.ts");
const { RpcRequestManager } = await import("../bridge/rpc.ts");
const { parseNumstat, parseUnifiedDiff } = await import("../bridge/git.ts");
const { CodexAppServerClient, normalizeNotification, normalizeThread } = await import("../bridge/codex-client.ts");

test("approved roots canonicalize and reject escape paths", async () => {
  const root = await mkdtemp(path.join(process.cwd(), "work", "codex-board-approved-"));
  const repo = path.join(root, "repo");
  await mkdir(path.join(repo, ".git"), { recursive: true });
  try {
    const approved = await ApprovedRoots.from([root]);
    assert.equal(await approved.resolve(repo), await import("node:fs/promises").then(({ realpath }) => realpath(repo)));
    await assert.rejects(approved.resolve(path.join(root, "..")), PathSecurityError);
    assert.equal(isPathInside(root, repo), true);
    assert.equal(isPathInside(root, path.join(root, "..")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("filesystem roots and home are not approved project roots", async () => {
  await assert.rejects(ApprovedRoots.from([path.parse(process.cwd()).root]), PathSecurityError);
  await assert.rejects(ApprovedRoots.from([os.homedir()]), PathSecurityError);
});

test("RPC responses correlate and unknown ids do not disturb pending work", async () => {
  const manager = new RpcRequestManager();
  const writes = [];
  const pending = manager.request((message) => writes.push(message), "model/list", {});
  assert.equal(writes[0].id, 1);
  assert.equal(manager.handle({ id: 999, result: {} }), false);
  assert.equal(manager.handle({ id: 1, result: { data: [] } }), true);
  assert.deepEqual(await pending, { data: [] });
  assert.equal(manager.size, 0);
});

test("Git diff parsing preserves file counts and unified lines", () => {
  const counts = parseNumstat("4\t2\tsrc/auth.ts\n-\t-\tbinary.png");
  const files = parseUnifiedDiff("diff --git a/src/auth.ts b/src/auth.ts\nindex 1..2 100644\n--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1 +1,2 @@\n-old\n+new\n", counts);
  assert.deepEqual(counts.get("src/auth.ts"), { additions: 4, deletions: 2 });
  assert.equal(files[0].fileName, "src/auth.ts");
  assert.equal(files[0].additions, 4);
  assert.equal(files[0].deletions, 2);
  assert.ok(files[0].lines.includes("+new"));
});

test("App Server notifications normalize without breaking on unknown methods", () => {
  const completed = normalizeNotification({ method: "turn/completed", params: { threadId: "thread-a", turn: { id: "turn-a", status: "completed" } } });
  const unknown = normalizeNotification({ method: "future/event", params: { threadId: "thread-a", extra: true } });
  assert.equal(completed?.type, "turn_completed");
  assert.equal(completed?.threadId, "thread-a");
  assert.equal(unknown?.type, "unknown");
});

test("Codex thread metadata normalizes to a safe dashboard snapshot", () => {
  const thread = normalizeThread({
    id: "019abc",
    extra: null,
    sessionId: "session-1",
    forkedFromId: null,
    parentThreadId: null,
    preview: "Inspect the bridge",
    ephemeral: false,
    isPinned: false,
    historyMode: "normal",
    modelProvider: "openai",
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_120,
    recencyAt: 1_700_000_120,
    status: { type: "active", activeFlags: [] },
    path: null,
    cwd: "C:\\approved\\repo",
    cliVersion: "0.146.0",
    source: "appServer",
    canAcceptDirectInput: true,
    threadSource: "codex-board",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  });

  assert.equal(thread.id, "019abc");
  assert.equal(thread.status, "running");
  assert.equal(thread.cwd, "C:\\approved\\repo");
  assert.equal(thread.updatedAt, "2023-11-14T22:15:20.000Z");
});

test("fast service tier reaches every Codex execution request", async () => {
  const requests = [];
  const client = new CodexAppServerClient({
    request: async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/start") return { thread: { id: "thread-1", sessionId: "session-1" }, cwd: "C:\\approved\\repo", model: "gpt-5.6-sol", reasoningEffort: "low" };
      if (method === "thread/resume") return { thread: { id: "thread-1", sessionId: "session-1" }, cwd: "C:\\approved\\repo", model: "gpt-5.6-sol", reasoningEffort: "low" };
      if (method === "thread/fork") return { thread: { id: "thread-2", sessionId: "session-2", forkedFromId: "thread-1" }, cwd: "C:\\approved\\repo", model: "gpt-5.6-sol", reasoningEffort: "low" };
      return { turn: { id: "turn-1" } };
    },
  });
  const config = { cwd: "C:\\approved\\repo", model: "gpt-5.6-sol", effort: "low", serviceTier: "fast", approvalPolicy: "unlessTrusted", sandboxMode: "workspaceWrite", networkAccess: "disabled" };

  await client.startThread(config);
  await client.resumeThread("thread-1", config);
  await client.forkThread("thread-1", config);
  await client.startTurn("thread-1", config, "Inspect the task");

  assert.deepEqual(requests.map(({ method, params }) => [method, params.serviceTier]), [
    ["thread/start", "fast"],
    ["thread/resume", "fast"],
    ["thread/fork", "fast"],
    ["turn/start", "fast"],
  ]);
});
