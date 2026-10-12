#!/usr/bin/env node
// Print a SYNC_PASSCODE_HASH value for `wrangler secret put`.
// Format: pbkdf2$<iterations>$<salt base64>$<hash base64>
// The passcode itself is not stored and is not printed.
import { pbkdf2Sync, randomBytes } from "node:crypto";

const pw = process.argv[2];
if (!pw || pw.length < 4 || pw.length > 128) {
  console.error("usage: node scripts/hash-passcode.mjs <口令>");
  console.error("口令长度 4–128。输出的是哈希，填进 Worker secret SYNC_PASSCODE_HASH。");
  process.exit(1);
}
const iter = 100000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(pw, salt, iter, 32, "sha256");
process.stdout.write(["pbkdf2", String(iter), salt.toString("base64"), hash.toString("base64")].join("$") + "\n");
