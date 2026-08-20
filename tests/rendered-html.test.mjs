import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const { createLatestSnapshotQueue, reorderTasks } = await import("../app/board-utils.ts");
const { createSeedState } = await import("../app/state.ts");

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders Codex Board", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Codex Board<\/title>/i);
  assert.match(html, /Mock adapter/);
  assert.match(html, /API-128/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the private dashboard boundary explicit", async () => {
  const [page, layout, css, adapter, route, schema, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/layout.tsx", projectRoot), "utf8"),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
    readFile(new URL("app/codex-adapter.ts", projectRoot), "utf8"),
    readFile(new URL("app/api/state/route.ts", projectRoot), "utf8"),
    readFile(new URL("db/schema.ts", projectRoot), "utf8"),
    readFile(new URL("package.json", projectRoot), "utf8"),
  ]);

  assert.match(layout, /title: "Codex Board"/);
  assert.match(page, /MockCodexAdapter/);
  assert.match(page, /FastModeToggle/);
  assert.match(page, /serviceTier/);
  assert.match(page, /\/api\/state/);
  assert.match(adapter, /class LocalCodexAdapter/);
  assert.match(adapter, /provider = "local"/);
  assert.match(route, /ensureDatabase/);
  assert.match(schema, /board_state/);
  assert.match(css, /--bg:\s*#090c13/);
  assert.match(css, /--accent:\s*#79a8ff/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(page, /SkeletonPreview|react-loading-skeleton|_sites-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", projectRoot)));
  await assert.rejects(access(new URL("app/_sites-preview/preview.css", projectRoot)));
});

test("keeps only the newest pending save and supports keyboard task reorder", async () => {
  const writes = [];
  const releases = [];
  const idle = [];
  const queue = createLatestSnapshotQueue(async (snapshot) => {
    writes.push(snapshot);
    await new Promise((resolve) => releases.push(resolve));
  }, (error) => { throw error; }, () => idle.push("saved"));

  queue.enqueue("first");
  queue.enqueue("newest");
  assert.deepEqual(writes, ["first"]);
  assert.deepEqual(idle, []);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ["first", "newest"]);
  assert.deepEqual(idle, []);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(idle, ["saved"]);

  const failureWrites = [];
  const errors = [];
  const recovered = [];
  let rejectOlder;
  let resolveNewer;
  const failureQueue = createLatestSnapshotQueue(async (snapshot) => {
    failureWrites.push(snapshot);
    if (snapshot === "older") {
      await new Promise((resolve, reject) => { rejectOlder = reject; });
      return;
    }
    await new Promise((resolve) => { resolveNewer = resolve; });
  }, (error) => errors.push(error.message), () => recovered.push("saved"));

  failureQueue.enqueue("older");
  failureQueue.enqueue("newer");
  rejectOlder(new Error("older failed"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(failureWrites, ["older", "newer"]);
  assert.deepEqual(errors, ["older failed"]);
  assert.deepEqual(recovered, []);
  resolveNewer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(recovered, ["saved"]);

  const tasks = createSeedState().tasks;
  const ready = tasks.filter((task) => task.status === "Ready").sort((a, b) => a.sortOrder - b.sortOrder);
  const reordered = reorderTasks(tasks, ready[1].id, "Ready", ready[0].id);
  assert.equal(reordered.filter((task) => task.status === "Ready").sort((a, b) => a.sortOrder - b.sortOrder)[0].id, ready[1].id);
});
