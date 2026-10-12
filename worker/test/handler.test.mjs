import assert from "node:assert/strict";
import { createHandler, hashPassword } from "../src/handler.js";

// In-memory fake GitHub gist API
const gists = { REG: { files: {} } };
let ghCalls = 0;
async function fakeFetch(url, opts = {}) {
  ghCalls++;
  assert.equal(opts.headers.Authorization, "Bearer test-token");
  const id = url.split("/gists/")[1];
  const g = gists[id]; if (!g) return new Response("nf", { status: 404 });
  if ((opts.method || "GET") === "GET") return Response.json({ files: Object.fromEntries(Object.entries(g.files).map(([k, v]) => [k, { content: v, truncated: false }])) });
  if (opts.method === "PATCH") { const b = JSON.parse(opts.body); for (const [k, v] of Object.entries(b.files)) g.files[k] = v.content; return Response.json({}); }
}
const env = { GITHUB_TOKEN: "test-token", SHARES_GIST_ID: "REG", ALLOWED_ORIGIN: "https://haoyuyou50-star.github.io,https://checklist-2wu.pages.dev", ALLOWED_ORIGIN_SUFFIXES: ".checklist-2wu.pages.dev" };
const handle = createHandler({ fetch: fakeFetch });
const ORIGIN = "https://haoyuyou50-star.github.io";
const req = (path, { method = "GET", pass, body, origin = ORIGIN } = {}) => new Request("https://w.example" + path, {
  method, headers: { Origin: origin, ...(pass != null ? { "X-Share-Pass": pass } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });

// seed record exactly as share.py writes it (python pbkdf2 must match)
const salt = Buffer.from("0123456789abcdef").toString("base64");
const rec = { version: 1, id: "abc123XYZ", listId: "demo-gear", salt, iter: 100000, hash: await hashPassword("8866", salt, 100000), updatedAt: 1,
  list: { id: "demo-gear", name: "器材", groups: [{ id: "g", name: "G", color: "#000", items: [{ id: "i1", text: "A", checked: false, u: 10 }, { id: "i2", text: "B", checked: true, u: 10 }] }] } };
gists.REG.files["share-abc123XYZ.json"] = JSON.stringify(rec);
gists.REG.files["share-other.json"] = JSON.stringify({ ...rec, id: "other" });

// python-compatible hash check (value computed by hashlib in test runner, see scripts/test_share.py)
if (process.env.PY_HASH) assert.equal(await hashPassword("8866", salt, 100000), process.env.PY_HASH);

let r = await handle(req("/api/share/abc123XYZ", { method: "OPTIONS" }), env);
assert.equal(r.status, 204); assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
r = await handle(req("/api/share/abc123XYZ", { origin: "https://evil.example", pass: "8866" }), env);
assert.equal(r.headers.get("Access-Control-Allow-Origin"), null, "no CORS for other origins");

r = await handle(req("/api/share/abc123XYZ"), env); assert.equal(r.status, 401);
r = await handle(req("/api/share/abc123XYZ", { pass: "wrong" }), env); assert.equal(r.status, 401);
r = await handle(req("/api/share/nope000", { pass: "8866" }), env); assert.equal(r.status, 404);
r = await handle(req("/api/share/../x", { pass: "8866" }), env); assert.equal(r.status, 404);

r = await handle(req("/api/share/abc123XYZ", { pass: "8866" }), env); assert.equal(r.status, 200);
let j = await r.json();
assert.equal(j.list.name, "器材"); assert.equal(j.salt, undefined); assert.equal(j.hash, undefined);
assert.ok(!JSON.stringify(j).includes(rec.hash), "hash never returned");

// check i1 (newer) and try stale uncheck of i2 (older u) -> ignored
r = await handle(req("/api/share/abc123XYZ/check", { method: "POST", pass: "8866", body: { changes: [{ id: "i1", checked: true, u: 20 }, { id: "i2", checked: false, u: 5 }, { id: "ghost", checked: true, u: 99 }] } }), env);
j = await r.json(); assert.equal(r.status, 200);
const items = j.list.groups[0].items;
assert.equal(items[0].checked, true); assert.equal(items[0].u, 20);
assert.equal(items[1].checked, true, "stale change ignored");
const stored = JSON.parse(gists.REG.files["share-abc123XYZ.json"]);
assert.equal(stored.list.groups[0].items[0].checked, true, "persisted to gist");
assert.equal(stored.hash, rec.hash, "hash preserved");
r = await handle(req("/api/share/abc123XYZ/check", { method: "POST", pass: "bad", body: { changes: [] } }), env); assert.equal(r.status, 401);
r = await handle(req("/api/share/abc123XYZ/check", { method: "POST", pass: "8866", body: "x" }), env); // string json ok but no changes
assert.equal(r.status, 200);
console.log("worker handler tests: OK (" + ghCalls + " fake GitHub calls)");
