# 可视化清单

单文件清单网页：勾选核对、多清单目录、本地保存，可选 GitHub Gist 跨设备同步。

## 打开方式

1. **电脑**：浏览器直接打开 `index.html`。
2. **手机**：拷贝文件夹后用本地文件浏览器打开；或放到静态托管后用链接打开。
3. **对话中**：路径 `/workspace/checklist/index.html`，可让助手打开预览。

未配置同步时完全离线可用（数据在浏览器 `localStorage`）。

> 可选：把本目录托管到 **GitHub Pages**（同一仓库），手机/电脑共用一个 URL，再配合下方 Gist 同步勾选状态。本仓库不强制配置 Pages。

## 功能

- **目录**：左上角切换多份清单
- **勾选**：点卡片核对 / 取消；进度条「已核对 X / Y」
- 数量（如 `×1套`）、红色标签、分组色块
- 右上「⋯」：同步设置、立即同步、导出/导入、全部取消勾选、清除已完成
- **新建 / 改内容**：在对话里告诉助手（应用内不提供编辑表单）

## GitHub Gist 同步（手机 ↔ 电脑）

冲突策略：**按每份清单的 `updatedAt` 取较新的一方**（last-write-wins），简单可靠。

### 三步配置

1. **建一个 Secret Gist**  
   打开 [gist.github.com](https://gist.github.com) → 文件名填 `checklist-data.json`，内容先写 `{"version":2,"lists":[]}` → 选 **Create secret gist** → 复制地址里的 Gist ID（一长串十六进制）。

2. **建一个只含 gist 权限的 PAT**  
   GitHub → Settings → Developer settings → Personal access tokens  
   - Fine-grained：给 Gist 权限；或  
   - Classic：勾选 **gist**  
   复制生成的 token（只显示一次）。

3. **在清单页填入**  
   打开 `index.html` → 右上「⋯」→ **同步设置** → 粘贴 Gist ID（或完整链接）和 Token → **保存**。  
   之后每次打开会自动拉取合并；勾选后约 1 秒自动写回 Gist。  
   - **无 Token**：若 Gist 是公开的，仍可只读拉取。  
   - **Token**：每个浏览器各自保存；Gist ID 在各设备填同一个即可。

「立即同步」可手动拉取并合并，必要时再写回。

### 注意

- Token 只存在本机浏览器，勿发到聊天或截图外传。
- 清除站点数据会丢掉本地清单与 Token，请先导出或依赖 Gist。
- `file://` 打开时部分浏览器可能限制跨域请求；若同步失败，可改用本地静态服务器或 GitHub Pages 打开同一页面。

## 导出 / 导入

「⋯」→ 导出当前 / 全部 JSON；导入可选合并或替换。

JSON 根结构：

```json
{
  "version": 2,
  "updatedAt": 0,
  "activeListId": "...",
  "lists": [
    {
      "id": "...",
      "name": "清单名",
      "updatedAt": 0,
      "groups": [
        {
          "id": "...",
          "name": "分组",
          "color": "#1e3a5f",
          "items": [
            { "id": "...", "text": "名称", "qty": "×1", "tag": "", "note": "", "checked": false }
          ]
        }
      ]
    }
  ]
}
```

## 文件

| 文件 | 说明 |
|------|------|
| `index.html` | 完整应用（含样式与同步逻辑） |
| `README.md` | 本说明 |
