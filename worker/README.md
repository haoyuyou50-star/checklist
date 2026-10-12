# 清单分享 Worker（Cloudflare，免费额度即可）

作用：持有 GitHub Token（作为 secret），让「链接 + 口令」的访客只读写**一份**被分享的清单；访客拿不到 Token，也看不到其他清单。

## 接口
- `GET  /sync`                   头 `Authorization: Bearer <同步口令>` → 读取 Gist 里的 `checklist-data.json`
- `PUT  /sync`                   头同上，body 为本地清单 → 服务端按 tombstone / `deletedListIds` 合并后写回，避免覆盖
- `GET  /api/share/<id>`        头 `X-Share-Pass: <口令>` → 返回该清单
- `POST /api/share/<id>/check`  头同上，body `{"changes":[{"id":"<itemId>","checked":true,"u":<毫秒时间戳>}]}` → 按条目 `u` 后写者胜，返回最新清单
- 同步口令以 PBKDF2-SHA256 哈希存在 secret `SYNC_PASSCODE_HASH`（见 `DEPLOY.md`）；分享口令仍是每条记录自己的盐和哈希。明文不落盘。CORS 只放行 Pages 上的两个站点及其预览子域
- GitHub PAT（`GITHUB_TOKEN`）和清单 Gist ID（`GIST_ID`）只在 Worker 上，不返回给网页

## 部署
分享库 `SHARES_GIST_ID` 已在 `wrangler.toml`。网页里的 Worker 地址已是 `https://checklist-share.haoyuyou50.workers.dev`。

这次要额外设置 `GIST_ID` 和 `SYNC_PASSCODE_HASH`，步骤写在 `DEPLOY.md`。没有 Cloudflare 登录态时不要在这里执行 `wrangler deploy`。

## 测试
`npm test`（`handler.test.mjs` 与 `sync.test.mjs`，本地假 GitHub，无网络、无 Token）
