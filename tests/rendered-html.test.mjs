import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

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
  assert.match(page, /\/api\/state/);
  assert.match(adapter, /class LocalCodexAdapter/);
  assert.match(adapter, /provider = "local"/);
  assert.match(route, /ensureDatabase/);
  assert.match(schema, /board_state/);
  assert.match(css, /--bg:\s*#fdf6e3/);
  assert.match(css, /--accent:\s*#268bd2/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(page, /SkeletonPreview|react-loading-skeleton|_sites-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", projectRoot)));
  await assert.rejects(access(new URL("app/_sites-preview/preview.css", projectRoot)));
});
