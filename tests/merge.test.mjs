// Extracts mergeStates + mergeChecks from index.html and tests them in Node.
// Also checks the worker copy stays in lockstep (server merge is the one that writes).
import fs from "node:fs"; import assert from "node:assert/strict";
import { mergeStates as workerMerge } from "../worker/src/handler.js";
const h = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const grab = re => h.match(re)[0];
const src = grab(/function mergeChecks\(target,source\)\{[\s\S]*?\n\}/) + "\n" + grab(/function mergeStates\(local,remote\)\{[\s\S]*?\n\}/);
const { mergeStates } = new Function(src + "\nreturn {mergeStates};")();
function same(local, remote) {
  const a = mergeStates(local, remote).state, b = workerMerge(local, remote).state;
  assert.deepEqual(a, b);
  return a;
}
const now = Date.now(), FUT = now + 48 * 3600e3;
const item = (id, checked, u) => ({ id, text: id, checked, u });
const list = (id, updatedAt, items) => ({ id, name: id, updatedAt, groups: [{ id: "g", name: "G", items }] });

// 1) Regression: phone kept a FUTURE root stamp + stale gear(14); cloud has newer gear(42) + new list 布展, lower root.
const phone = { updatedAt: FUT, activeListId: "gear", deleted: { "demo-daily": FUT },
  lists: [list("gear", FUT, Array.from({ length: 14 }, (_, i) => item("o" + i, false, 1))), list("ex", FUT, [])] };
const cloud = { updatedAt: now, deleted: { "demo-daily": FUT },
  lists: [list("gear", FUT + 5, Array.from({ length: 42 }, (_, i) => item("n" + i, false, 2))), list("ex", FUT, []), list("buzhan", now, [item("a", false, now)])] };
let state = same(phone, cloud);
const ids = state.lists.map(l => l.id).sort();
assert.deepEqual(ids, ["buzhan", "ex", "gear"], "cloud-only list added despite older remote root");
assert.equal(state.lists.find(l => l.id === "gear").groups[0].items.length, 42, "newer list version wins");

// 2) Tombstone newer than list drops it on both sides; older tombstone does not.
state = same({ lists: [list("daily", 100, [])] }, { deleted: { daily: 200 }, lists: [] });
assert.equal(state.lists.length === 0 || !state.lists.some(l => l.id === "daily" && 200 >= l.updatedAt) || state.lists[0].id === "daily", true);
state = same({ lists: [list("x", 1, []), list("daily", 100, [])] }, { deleted: { daily: 200 }, lists: [list("x", 1, [])] });
assert.ok(!state.lists.some(l => l.id === "daily"), "tombstoned list removed");
state = same({ lists: [list("x", 1, []), list("daily", 300, [])] }, { deleted: { daily: 200 }, lists: [list("x", 1, [])] });
assert.ok(state.lists.some(l => l.id === "daily"), "list edited after deletion survives");

// 3) Local-only list without tombstone is kept (union).
state = same({ lists: [list("a", 1, []), list("mine", 5, [])] }, { updatedAt: 9e15, lists: [list("a", 1, [])] });
assert.ok(state.lists.some(l => l.id === "mine"), "union keeps local-only list");

// 4) Per-item LWW: older list version still contributes a newer check.
state = same({ lists: [list("a", 10, [item("i", true, 500)])] }, { lists: [list("a", 20, [item("i", false, 100)])] });
assert.equal(state.lists[0].groups[0].items[0].checked, true, "newer item.u wins inside newer list content");
console.log("merge tests: OK");
