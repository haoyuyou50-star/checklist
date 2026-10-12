// Pure handler: no Cloudflare-specific APIs, so it can be unit-tested in Node.
// deps: { fetch, now, rateLimit: { maxFails, lockMs } }
// env:  { GITHUB_TOKEN, SHARES_GIST_ID, GIST_ID, SYNC_PASSCODE_HASH, ALLOWED_ORIGIN, ALLOWED_ORIGIN_SUFFIXES }
//
// Secrets stay on the worker. Responses never include the token, gist id, or passcode hash.

const GH = "https://api.github.com/gists/";
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const SYNC_FILE = "checklist-data.json";
const DEFAULT_MAX_FAILS = 5;
const DEFAULT_LOCK_MS = 60 * 1000;

function b64(buf) {
  let s = ""; const a = new Uint8Array(buf);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s);
}
function unb64(s) { const b = atob(s); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }

export async function hashPassword(password, saltB64, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations }, key, 256);
  return b64(bits);
}
function safeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// "pbkdf2$<iterations>$<saltB64>$<hashB64>" — salt and hash live only in the worker secret.
export function parsePasscodeHash(spec) {
  const parts = String(spec || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 2000000) return null;
  if (!parts[2] || !parts[3]) return null;
  return { iterations, salt: parts[2], hash: parts[3] };
}

// Public view of a share record (never return salt/hash)
export function publicList(rec) {
  return { id: rec.id, name: rec.list.name, updatedAt: rec.updatedAt, list: rec.list };
}

// Per-item last-write-wins. changes: [{id, checked, u}]
export function applyChanges(list, changes) {
  const now = Date.now();
  const byId = new Map();
  for (const g of list.groups || []) for (const it of g.items || []) byId.set(it.id, it);
  let changed = 0;
  for (const c of changes || []) {
    const it = byId.get(c && c.id);
    if (!it || typeof c.checked !== "boolean") continue;
    const u = Math.min(Number(c.u) || now, now + 60000); // clamp clients far in the future
    if (u > (Number(it.u) || 0)) {
      if (it.checked !== c.checked || (Number(it.u) || 0) !== u) changed++;
      it.checked = c.checked; it.u = u;
    }
  }
  if (changed) list.updatedAt = now;
  return changed;
}

// Per-item LWW on u. Mutates target. Same rule as index.html mergeChecks.
export function mergeChecks(target, source) {
  const m = new Map();
  (source && source.groups || []).forEach(g => (g.items || []).forEach(i => m.set(i.id, i)));
  let n = 0;
  (target && target.groups || []).forEach(g => (g.items || []).forEach(i => {
    const s = m.get(i.id);
    if (s && (Number(s.u) || 0) > (Number(i.u) || 0)) {
      if (i.checked !== !!s.checked) n++;
      i.checked = !!s.checked;
      i.u = Number(s.u) || 0;
    }
  }));
  return n;
}

/** Union merge: lists = (local ∪ remote) − tombstones.
 *  Tombstone wins only when it is >= the list's updatedAt.
 *  Same list on both sides: newer updatedAt supplies content; per-item checks LWW by item.u.
 *  Root updatedAt never decides which lists exist. */
export function mergeStates(local, remote) {
  if (!remote || !Array.isArray(remote.lists)) return { state: local, changed: false, source: "local" };
  if (!local || !Array.isArray(local.lists)) return { state: remote, changed: true, source: "remote" };
  const deleted = {};
  const addTomb = (k, v) => { const n = Number(v) || 0; if (n > (Number(deleted[k]) || 0)) deleted[k] = n; };
  [local, remote].forEach(s => {
    Object.entries(s.deleted || {}).forEach(([k, v]) => addTomb(k, v));
    (s.deletedListIds || []).forEach(id => { if (!(deleted[id] > 0)) addTomb(id, s.updatedAt || 1); });
  });
  const L = new Map(local.lists.map(l => [l.id, l])), R = new Map(remote.lists.map(l => [l.id, l]));
  const ids = [...new Set([...remote.lists.map(l => l.id), ...local.lists.map(l => l.id)])];
  const lists = []; let changed = false;
  for (const id of ids) {
    const a = L.get(id), b = R.get(id);
    let out;
    if (a && b) {
      const newer = (Number(b.updatedAt) || 0) > (Number(a.updatedAt) || 0) ? b : a, older = newer === a ? b : a;
      out = JSON.parse(JSON.stringify(newer));
      mergeChecks(out, older);
      if (newer === b || JSON.stringify(out) !== JSON.stringify(a)) changed = true;
    } else { out = a || b; if (!a) changed = true; }
    if ((Number(deleted[id]) || 0) >= (Number(out.updatedAt) || 0)) { if (a) changed = true; continue; }
    lists.push(out);
  }
  if (!lists.length && (local.lists[0] || remote.lists[0])) lists.push(remote.lists[0] || local.lists[0]);
  let activeListId = lists.some(l => l.id === local.activeListId) ? local.activeListId : (lists.some(l => l.id === remote.activeListId) ? remote.activeListId : lists[0] && lists[0].id);
  const updatedAt = Math.max(Number(local.updatedAt) || 0, Number(remote.updatedAt) || 0);
  const state = { version: 3, updatedAt, activeListId, lists, sharesGistId: remote.sharesGistId || local.sharesGistId, deleted, deletedListIds: Object.keys(deleted) };
  return { state, changed, source: "union" };
}

function bearer(req) {
  const a = req.headers.get("Authorization") || "";
  const m = /^Bearer\s+(\S.*)$/i.exec(a);
  if (!m) return "";
  const raw = m[1].trim();
  if (!raw.startsWith("base64:")) return raw;
  try {
    const bin = atob(raw.slice(7));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes).trim();
  } catch {
    return "";
  }
}

export function createHandler(deps = {}) {
  const doFetch = deps.fetch || ((...a) => fetch(...a));
  const now = deps.now || (() => Date.now());
  const maxFails = (deps.rateLimit && deps.rateLimit.maxFails) || DEFAULT_MAX_FAILS;
  const lockMs = (deps.rateLimit && deps.rateLimit.lockMs) || DEFAULT_LOCK_MS;
  const failures = new Map();

  function cors(env, req) {
    const allowed = String(env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
    const suffixes = String(env.ALLOWED_ORIGIN_SUFFIXES || "").split(",").map(s => s.trim()).filter(Boolean);
    const origin = req.headers.get("Origin") || "";
    const h = {
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Share-Pass, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    const ok = allowed.includes("*") || allowed.includes(origin) || suffixes.some(suf => origin.endsWith(suf) && origin.startsWith("https://"));
    if (ok && origin) h["Access-Control-Allow-Origin"] = origin;
    else if (allowed.includes("*")) h["Access-Control-Allow-Origin"] = "*";
    return h;
  }
  const json = (obj, status, headers) => new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

  function clientKey(req) {
    return req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For") || "local";
  }
  function rateState(req) {
    const key = clientKey(req);
    let rec = failures.get(key);
    if (!rec) { rec = { count: 0, lockedUntil: 0 }; failures.set(key, rec); }
    if (failures.size > 500) {
      for (const [k, v] of failures) if (v.lockedUntil <= now() && v.count === 0) failures.delete(k);
    }
    return { key, rec };
  }

  function ghHeaders(env, hasBody) {
    return {
      Authorization: "Bearer " + env.GITHUB_TOKEN,
      Accept: "application/vnd.github+json",
      "User-Agent": "checklist-share-worker",
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    };
  }
  async function gh(env, gistId, method, body) {
    const res = await doFetch(GH + gistId, {
      method,
      headers: ghHeaders(env, !!body),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error("github " + res.status);
    return res.json();
  }
  async function fileText(env, file) {
    if (!file) return null;
    if (file.truncated && file.raw_url) {
      const r = await doFetch(file.raw_url, { headers: { Authorization: "Bearer " + env.GITHUB_TOKEN, "User-Agent": "checklist-share-worker" } });
      if (!r.ok) throw new Error("github " + r.status);
      return r.text();
    }
    return file.content == null ? null : file.content;
  }
  async function readRecord(env, id) {
    const gist = await gh(env, env.SHARES_GIST_ID, "GET");
    const f = gist.files && gist.files["share-" + id + ".json"];
    if (!f) return null;
    return JSON.parse(await fileText(env, f));
  }
  async function writeRecord(env, rec) {
    await gh(env, env.SHARES_GIST_ID, "PATCH", { files: { ["share-" + rec.id + ".json"]: { content: JSON.stringify(rec, null, 2) } } });
  }
  async function authed(env, req, id) {
    const rec = await readRecord(env, id);
    if (!rec || rec.disabled) return { error: json({ error: "not_found" }, 404, cors(env, req)) };
    const pass = req.headers.get("X-Share-Pass") || "";
    const h = pass ? await hashPassword(pass, rec.salt, rec.iter || 100000) : "";
    if (!safeEq(h, rec.hash)) return { error: json({ error: "bad_password", name: rec.list && rec.list.name }, 401, cors(env, req)) };
    return { rec };
  }

  async function readChecklist(env) {
    const gist = await gh(env, env.GIST_ID, "GET");
    const f = gist.files && gist.files[SYNC_FILE];
    if (!f) return null;
    const text = await fileText(env, f);
    if (text == null || text === "") return null;
    return JSON.parse(text);
  }
  async function writeChecklist(env, state) {
    await gh(env, env.GIST_ID, "PATCH", { files: { [SYNC_FILE]: { content: JSON.stringify(state, null, 2) } } });
  }

  // Owner ↔ share-link checks. Gist ids come only from env, never from the request.
  async function reconcileShares(env, state) {
    const gistId = env.SHARES_GIST_ID;
    if (!gistId || !state || !Array.isArray(state.lists)) return false;
    const shared = state.lists.filter(l => l.share && ID_RE.test(l.share.id || "") && !l.share.disabled);
    if (!shared.length) return false;
    let gist;
    try { gist = await gh(env, gistId, "GET"); } catch { return false; }
    const files = gist.files || {};
    const out = {};
    let ownerChanged = false;
    for (const l of shared) {
      const fn = "share-" + l.share.id + ".json";
      const f = files[fn];
      if (!f) continue;
      let rec;
      try { rec = JSON.parse(await fileText(env, f)); } catch { continue; }
      if (!rec || !rec.list) continue;
      if (mergeChecks(l, rec.list)) { ownerChanged = true; l.updatedAt = Date.now(); }
      if (mergeChecks(rec.list, l)) {
        rec.updatedAt = Date.now();
        if (rec.list) rec.list.updatedAt = rec.updatedAt;
        out[fn] = { content: JSON.stringify(rec, null, 2) };
      }
    }
    if (Object.keys(out).length) await gh(env, gistId, "PATCH", { files: out });
    if (ownerChanged) state.updatedAt = Math.max(Number(state.updatedAt) || 0, Date.now());
    return ownerChanged || Object.keys(out).length > 0;
  }

  function scrub(state) {
    if (!state || typeof state !== "object") return state;
    const out = JSON.parse(JSON.stringify(state));
    delete out.empty;
    return out;
  }

  async function syncAuth(env, req, headers) {
    const { rec } = rateState(req);
    if (rec.lockedUntil > now()) {
      const retry = Math.max(1, Math.ceil((rec.lockedUntil - now()) / 1000));
      return { error: json({ error: "rate_limited" }, 429, { ...headers, "Retry-After": String(retry) }) };
    }
    const spec = parsePasscodeHash(env.SYNC_PASSCODE_HASH);
    const pass = bearer(req);
    if (!spec || !pass || pass.length > 128) {
      rec.count += 1;
      if (rec.count >= maxFails) { rec.lockedUntil = now() + lockMs; rec.count = 0; }
      return { error: json({ error: "unauthorized" }, 401, headers) };
    }
    let got = "";
    try { got = await hashPassword(pass, spec.salt, spec.iterations); } catch { got = ""; }
    if (!safeEq(got, spec.hash)) {
      rec.count += 1;
      if (rec.count >= maxFails) { rec.lockedUntil = now() + lockMs; rec.count = 0; }
      return { error: json({ error: "unauthorized" }, 401, headers) };
    }
    rec.count = 0;
    rec.lockedUntil = 0;
    return { ok: true };
  }

  async function handleSync(req, env) {
    const headers = cors(env, req);
    if (!env.GIST_ID || !env.GITHUB_TOKEN) return json({ error: "upstream" }, 502, headers);
    const auth = await syncAuth(env, req, headers);
    if (auth.error) return auth.error;
    try {
      if (req.method === "GET") {
        const stored = await readChecklist(env);
        if (!stored || !Array.isArray(stored.lists)) return json({ empty: true }, 200, headers);
        const state = scrub(stored);
        const wrote = await reconcileShares(env, state);
        if (wrote) await writeChecklist(env, state);
        return json(state, 200, headers);
      }
      if (req.method === "PUT") {
        let incoming;
        let text;
        try { text = await req.text(); } catch { return json({ error: "bad_json" }, 400, headers); }
        if (text.length > 1500000) return json({ error: "too_large" }, 413, headers);
        try { incoming = JSON.parse(text); } catch { return json({ error: "bad_json" }, 400, headers); }
        if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.lists)) return json({ error: "bad_json" }, 400, headers);
        let merged;
        for (let attempt = 0; attempt < 2; attempt++) {
          const stored = await readChecklist(env);
          const base = stored && Array.isArray(stored.lists) ? stored : null;
          merged = scrub(mergeStates(incoming, base).state);
          await reconcileShares(env, merged);
          try { await writeChecklist(env, merged); break; }
          catch (e) { if (attempt) throw e; }
        }
        return json(merged, 200, headers);
      }
      return json({ error: "method_not_allowed" }, 405, headers);
    } catch (e) {
      return json({ error: "upstream", detail: String(e.message || e) }, 502, headers);
    }
  }

  return async function handle(req, env) {
    const url = new URL(req.url);
    const h = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (url.pathname === "/sync") return handleSync(req, env);
    const m = url.pathname.match(/^\/api\/share\/([^/]+)(\/check)?$/);
    if (!m || !ID_RE.test(m[1])) return json({ error: "not_found" }, 404, h);
    const id = m[1];
    try {
      if (req.method === "GET" && !m[2]) {
        const r = await authed(env, req, id); if (r.error) return r.error;
        return json(publicList(r.rec), 200, h);
      }
      if (req.method === "POST" && m[2]) {
        let body; try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400, h); }
        const changes = Array.isArray(body && body.changes) ? body.changes.slice(0, 500) : [];
        for (let attempt = 0; attempt < 2; attempt++) {
          const r = await authed(env, req, id); if (r.error) return r.error;
          const n = applyChanges(r.rec.list, changes);
          if (!n) return json(publicList(r.rec), 200, h);
          r.rec.updatedAt = Date.now();
          try { await writeRecord(env, r.rec); return json(publicList(r.rec), 200, h); }
          catch (e) { if (attempt) throw e; }
        }
      }
      return json({ error: "method_not_allowed" }, 405, h);
    } catch (e) {
      return json({ error: "upstream", detail: String(e.message || e) }, 502, h);
    }
  };
}
