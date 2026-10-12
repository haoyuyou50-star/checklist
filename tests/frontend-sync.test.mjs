// The page must not call GitHub itself, and the sync UI is passcode-only.
import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = html.slice(html.indexOf("<script>"));

for (const banned of ["api.github.com", "ghp_", "github_pat_", "gistToken", "gistFile", "GITHUB_TOKEN"]) {
  assert.equal(html.includes(banned), false, "page contains " + banned);
}
assert.equal(/\bPAT\b/.test(script), false, "page script mentions PAT");
assert.match(script, /\/sync/);
assert.match(script, /Authorization/);
assert.match(html, /同步口令/);
assert.match(html, /已同步/);
assert.match(html, /离线，联网后自动同步/);
assert.match(html, /口令不对/);
assert.match(html, /id="bRefresh"/);
assert.match(html, /id="bTop"/);
assert.match(html, /id="bCatalog"/);
assert.match(script, /checklist-share\.haoyuyou50\.workers\.dev/);
assert.equal(html.includes('id="gistId"'), false);
assert.match(script, /c\.gistId\|\|c\.token/);
console.log("frontend sync checks: OK");
