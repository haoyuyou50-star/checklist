import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { createHandler, hashPassword, mergeStates, parsePasscodeHash } from "../src/handler.js";

const TOKEN = "test-token";
const GIST = "gist-secret-id";
const SALT = Buffer.from("0123456789abcdef").toString("base64");
const PASS = "open-sesame";
const ITER = 1000;
const HASH = await hashPassword(PASS, SALT, ITER);
const NODE_HASH = pbkdf2Sync(PASS, Buffer.from("0123456789abcdef"), ITER, 32, "sha256").toString("base64");
assert.equal(NODE_HASH, HASH, "node pbkdf2 matches worker WebCrypto");
assert.equal(parsePasscodeHash(`pbkdf2$${ITER}$${SALT}$${HASH}`).hash, HASH);

const item = (id, checked, u) => ({ id, text: id, checked, u });
const list = (id, updatedAt, items) => ({ id, name: id, updatedAt, groups: [{ id: "g", name: "G", items }] });

const gists = {};
function resetGists() {
  for (const k of Object.keys(gists)) delete gists[k];
  gists[GIST] = { files: {} };
  gists.REG = { files: {} };
}
resetGists();

async function fakeFetch(url, opts = {}) {
  assert.equal(opts.headers.Authorization, "Bearer " + TOKEN, "github calls use the worker token");
  assert.ok(!JSON.stringify(opts.headers).includes(PASS), "passcode is not sent to GitHub");
  const u = String(url);
  if (!u.includes("/gists/")) return new Response("no", { status: 404 });
  const id = u.split("/gists/")[1];
  const g = gists[id];
  if (!g) return new Response("nf", { status: 404 });
  if ((opts.method || "GET") === "GET") {
    return Response.json({ files: Object.fromEntries(Object.entries(g.files).map(([k, v]) => [k, { content: v, truncated: false }])) });
  }
  if (opts.method === "PATCH") {
    const b = JSON.parse(opts.body);
    for (const [k, v] of Object.entries(b.files)) {
      if (v === null) delete g.files[k];
      else g.files[k] = v.content;
    }
    return Response.json({});
  }
  return new Response("no", { status: 405 });
}

let clock = 0;
const env = {
  GITHUB_TOKEN: TOKEN,
  GIST_ID: GIST,
  SHARES_GIST_ID: "REG",
  SYNC_PASSCODE_HASH: `pbkdf2$${ITER}$${SALT}$${HASH}`,
  ALLOWED_ORIGIN: "https://haoyuyou50-star.github.io,https://checklist-2wu.pages.dev",
  ALLOWED_ORIGIN_SUFFIXES: ".checklist-2wu.pages.dev",
};
const handle = createHandler({ fetch: fakeFetch, now: () => clock, rateLimit: { maxFails: 3, lockMs: 60_000 } });
const ORIGIN = "https://haoyuyou50-star.github.io";

function req(path, { method = "GET", pass, body, origin = ORIGIN, rawAuth } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (rawAuth != null) headers.Authorization = rawAuth;
  else if (pass != null) headers.Authorization = "Bearer " + pass;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return new Request("https://w.example" + path, { method, headers, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) });
}
const stored = () => gists[GIST].files["checklist-data.json"] ? JSON.parse(gists[GIST].files["checklist-data.json"]) : null;

let r = await handle(req("/sync", { method: "OPTIONS" }), env);
assert.equal(r.status, 204);
assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
assert.match(r.headers.get("Access-Control-Allow-Headers"), /Authorization/);
assert.match(r.headers.get("Access-Control-Allow-Methods"), /PUT/);

for (const origin of ["https://haoyuyou50-star.github.io", "https://checklist-2wu.pages.dev", "https://pr-9.checklist-2wu.pages.dev"]) {
  r = await handle(req("/sync", { origin, pass: PASS }), env);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), origin, origin);
}
for (const origin of ["https://evil.example", "https://evilchecklist-2wu.pages.dev", "http://checklist-2wu.pages.dev", "https://checklist-2wu.pages.dev.evil.com"]) {
  r = await handle(req("/sync", { origin, pass: PASS }), env);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), null, origin);
}
r = await handle(req("/sync", { origin: "", pass: PASS }), env);
assert.equal(r.status, 200, "no-origin clients (curl) still work");
assert.deepEqual(await r.json(), { empty: true });

r = await handle(req("/sync"), env);
assert.equal(r.status, 401);
r = await handle(req("/sync", { pass: "wrong" }), env);
assert.equal(r.status, 401);
assert.equal((await r.json()).error, "unauthorized");
assert.equal(stored(), null, "wrong passcode does not write");
r = await handle(req("/sync", { pass: "wrong" }), env);
assert.equal(r.status, 401, "third failure still 401 and arms the lock");
r = await handle(req("/sync", { pass: PASS }), env);
assert.equal(r.status, 429, "locked even if the next passcode is right");
assert.equal(r.headers.get("Retry-After"), "60");
clock = 60_000;
r = await handle(req("/sync", { pass: PASS }), env);
assert.equal(r.status, 200, "lock expires");

const b64 = "base64:" + Buffer.from(PASS, "utf8").toString("base64");
r = await handle(req("/sync", { rawAuth: "Bearer " + b64 }), env);
assert.equal(r.status, 200, "base64 bearer decodes to the same passcode");

const base = {
  version: 3, updatedAt: 20, activeListId: "a",
  lists: [list("a", 20, [item("i", false, 100), item("j", false, 1)]), list("server-only", 50, [item("s", false, 1)])],
  deleted: { daily: 200 },
};
gists[GIST].files["checklist-data.json"] = JSON.stringify(base);
const incoming = {
  version: 3, updatedAt: 30, activeListId: "a",
  lists: [list("a", 10, [item("i", true, 500), item("j", false, 1)]), list("phone-only", 40, [item("p", true, 9)]), list("daily", 100, [])],
};
r = await handle(req("/sync", { method: "PUT", pass: PASS, body: incoming }), env);
assert.equal(r.status, 200);
let j = await r.json();
assert.deepEqual(j.lists.map(l => l.id).sort(), ["a", "phone-only", "server-only"]);
assert.equal(j.lists.find(l => l.id === "a").groups[0].items.find(i => i.id === "i").checked, true, "newer item.u survives older list content");
assert.equal(j.deleted.daily, 200);
const bodyText = JSON.stringify(j);
assert.ok(!bodyText.includes(TOKEN), "token not in response");
assert.ok(!bodyText.includes(GIST), "gist id not in response");
assert.ok(!bodyText.includes(HASH), "passcode hash not in response");
assert.ok(!bodyText.includes(PASS), "passcode not in response");
const after = stored();
assert.ok(after.lists.some(l => l.id === "server-only"), "server-only list kept");
assert.ok(after.lists.some(l => l.id === "phone-only"), "phone-only list kept");
assert.ok(!after.lists.some(l => l.id === "daily"), "tombstone not overwritten");

r = await handle(req("/sync", { pass: PASS }), env);
j = await r.json();
assert.equal(j.lists.find(l => l.id === "a").groups[0].items.find(i => i.id === "i").checked, true, "other client sees the edit");

r = await handle(req("/sync", { method: "PUT", pass: "nope", body: { lists: [] } }), env);
assert.equal(r.status, 401);
assert.ok(stored().lists.some(l => l.id === "server-only"), "rejected write leaves gist intact");

r = await handle(req("/sync", { method: "PUT", pass: PASS, body: "{}" }), env);
assert.equal(r.status, 400);
r = await handle(req("/sync", { method: "POST", pass: PASS, body: { lists: [] } }), env);
assert.equal(r.status, 405);

// direct merge matches the cases the page tests lock in
const phone = { updatedAt: Date.now() + 48 * 3600e3, activeListId: "gear", deleted: { "demo-daily": Date.now() + 48 * 3600e3 },
  lists: [list("gear", Date.now() + 48 * 3600e3, Array.from({ length: 14 }, (_, i) => item("o" + i, false, 1))), list("ex", Date.now() + 48 * 3600e3, [])] };
const cloud = { updatedAt: 10, deleted: { "demo-daily": Date.now() + 48 * 3600e3 },
  lists: [list("gear", Date.now() + 48 * 3600e3 + 5, Array.from({ length: 42 }, (_, i) => item("n" + i, false, 2))), list("ex", Date.now() + 48 * 3600e3, []), list("buzhan", 10, [item("a", false, 10)])] };
let { state } = mergeStates(phone, cloud);
assert.deepEqual(state.lists.map(l => l.id).sort(), ["buzhan", "ex", "gear"]);
assert.equal(state.lists.find(l => l.id === "gear").groups[0].items.length, 42);

console.log("sync tests: OK");
