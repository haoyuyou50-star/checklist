# 部署同步 Worker（需要你或清单 Bot 来做）

页面不再保存 GitHub Token 和 Gist ID。这两样以及同步口令的哈希只放在 Cloudflare Worker 的 secret 里。这个环境没有 Cloudflare 登录态，下面的命令需要你在自己的机器上执行。

线上 Worker：`https://checklist-share.haoyuyou50.workers.dev`  
允许的网页来源：`https://haoyuyou50-star.github.io`、`https://checklist-2wu.pages.dev`，以及 `*.checklist-2wu.pages.dev` 预览域名。

## 1. 生成口令哈希

口令明文不要写进仓库。在仓库根目录执行（把口令换成你要给手机和电脑用的那一个，长度 4–128）：

```bash
node scripts/hash-passcode.mjs '你的短口令'
```

输出一行，形如：

```text
pbkdf2$100000$<盐，base64>$<哈希，base64>
```

这就是 `SYNC_PASSCODE_HASH`。算法是 PBKDF2-SHA256、10 万次、16 字节随机盐，和分享口令同一套，方便核对。

## 2. 写入 secret 并部署

```bash
cd worker
npx wrangler login

npx wrangler secret put GITHUB_TOKEN
# 粘贴带 gist 权限的 PAT（Fine-grained 的 Gist 权限，或 classic 的 gist scope）

npx wrangler secret put GIST_ID
# 粘贴清单 Gist 的 ID（文件名固定为 checklist-data.json，不要把 ID 写进网页）

npx wrangler secret put SYNC_PASSCODE_HASH
# 粘贴上一步整行 pbkdf2$...

npx wrangler deploy
```

`GITHUB_TOKEN` 如果以前已经设过，而且仍有效，可以不重新 put。`GIST_ID` 和 `SYNC_PASSCODE_HASH` 是这次新增的。

`wrangler.toml` 里原有的 `SHARES_GIST_ID`（分享库）保持不变。不要把 PAT、Gist ID、口令哈希写进 toml 或提交到 git。

## 3. 顺序

1. 先部署 Worker（旧页面仍直接访问 Gist，不受影响）。
2. 再合并并发布这个网页到 GitHub Pages / Cloudflare Pages。
3. 每台设备打开新页面：如果以前存过 Gist ID 或 PAT，会被清掉，并提示输入一次口令。之后自动同步。

## 4. 接口（给排查用）

- `GET /sync`、`PUT /sync`
- 请求头：`Authorization: Bearer <口令>`，或 `Authorization: Bearer base64:<口令的 UTF-8 base64>`（网页用后一种，避免非英文口令）
- 口令错误：HTTP 401，正文 `{"error":"unauthorized"}`。同一实例上连续错 5 次后锁定约 60 秒，返回 429（计数在 Worker 实例内存里，用来挡住连试，不是全局账号锁定）
- 成功时只返回清单 JSON。响应里不会带 Token、Gist ID 或口令哈希
- `PUT` 在服务端按 tombstone / `deletedListIds` 做并集合并（同一清单取较新的 `updatedAt`，条目勾选按 `u` 后写者胜），不会用一边的数据整份覆盖另一边

本地测试（不访问 GitHub、不需要 secret）：

```bash
cd worker && npm test
node ../tests/merge.test.mjs
node ../tests/frontend-sync.test.mjs
python3 ../scripts/test_share.py
```
