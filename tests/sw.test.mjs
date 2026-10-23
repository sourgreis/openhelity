import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const web = new URL("../web/", import.meta.url).pathname;
const source = readFileSync(join(web, "sw.js"), "utf8");
const listed = [...source.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/"\.\/([^"]*)"/g)]
  .map(([, path]) => path)
  .filter(Boolean);

test("service worker: every page file is precached", () => {
  const onDisk = ["js", "css", "icons"].flatMap((dir) =>
    readdirSync(join(web, dir)).map((name) => `${dir}/${name}`));
  for (const path of onDisk) assert.ok(listed.includes(path), `${path} is not in ASSETS`);
});

test("service worker: every precached file exists", () => {
  for (const path of listed.filter((entry) => !entry.startsWith("pkg/"))) {
    assert.ok(existsSync(join(web, path)), `${path} is listed but missing`);
  }
});

test("service worker: the cache name is the one the deploy stamps", () => {
  assert.match(source, /const CACHE = "openhelity-dev";/);
});

test("service worker: activation deletes only this app's old caches", async () => {
  const handlers = {};
  const deleted = [];
  const caches = {
    keys: async () => ["openhelity-dev", "openhelity-0123456789ab", "other-site-v1", "workbox-precache"],
    delete: async (name) => { deleted.push(name); return true; },
  };
  const self = { addEventListener: (type, handler) => { handlers[type] = handler; }, clients: { claim: async () => {} } };
  new Function("self", "caches", source)(self, caches);
  let done;
  handlers.activate({ waitUntil: (promise) => { done = promise; } });
  await done;
  assert.deepEqual(deleted, ["openhelity-0123456789ab"]);
});
