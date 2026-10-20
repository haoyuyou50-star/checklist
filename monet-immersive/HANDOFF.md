# 交接文档：莫奈 · 走进画境（高斯泼溅沉浸 Demo）

> 给接手的 Agent / 开发者。先读这一份，再读 `README.md`（面向使用者的说明）。

## 1. 项目背景与目标

- 大项目：以 VR 为核心、MR 增强的艺术家主题体验（生平、博物馆、画作、交互），第一位艺术家是莫奈。
- 本仓库只负责其中的「全景沉浸」模块，当前形态是 **HTML 前期 Demo**，用于**录制演示视频提交**。
- 用户（皓宇，软件工程师）的核心要求：**视觉与审美优先**。交互和技术实现可以简单，但画面必须精致、通透、干净，不能糊、不能脏、不能暗，也不能看出画框的边界。
- 完整流程：画作观赏界面 → 点「进入画境」→ 转场动画（笔触离开画布，世界向四周展开）→ 360° 高斯笔触场景（风吹草浪/水波、发光物件、点击拉近细看）→ 离开画境回到展厅。
- 两幅画：01《罂粟花田》Coquelicots 1873（草地场景）、02《阿让特伊的帆船赛》Régates à Argenteuil c.1872（水面场景）。**用户明确要求优先打磨帆船。**

## 2. 当前状态（截至交接）

| 项 | 状态 |
|---|---|
| 完整流程（展厅 → 转场 → 沉浸 → 热点 → 返回 → 切换第二幅） | ✅ 可用 |
| 帆船场景画面 | ✅ 已做一轮重点打磨：调色、清晰笔触、无缝画框、水面/倒影/岸树/云天 |
| 罂粟场景画面 | 🟡 可用，但打磨少于帆船（近景草地偏碎、偏亮） |
| 演示视频渲染工具 `tools/render.mjs` | ✅ 一条命令出 2:00 成片（含风声） |
| 在线链接 | ✅ githack（见第 3 节） |
| 实时性能 | 🟡 默认 mid 档约 26–29 万个笔触，弱显卡可能卡，可用 `?q=low` |

已交付给用户的产物（云端 artifacts，接手者可能拿不到，仅供参考）：
- 项目压缩包 `monet-immersive.zip`
- 720p 预览视频 `monet_demo_preview_720p.mp4`（2:00）
- 若干截图

## 3. 代码位置与运行

- 仓库：`haoyuyou50-star/checklist`，目录 `monet-immersive/`，分支 `cursor/monet-immersive-demo-21be`，PR：https://github.com/haoyuyou50-star/checklist/pull/2
- 独立分支 `cursor/monet-immersive-standalone-21be`：仓库根目录就是本项目，适合直接迁到新仓库（见第 10 节）。
- 在线打开（需在提示页点一次 "Open the page"）：
  `https://raw.githack.com/haoyuyou50-star/checklist/cursor/monet-immersive-demo-21be/monet-immersive/index.html`
- 本地运行：必须通过 http 服务打开。ES Module 和读取画作像素都不支持 `file://`，代码里有检测，会给出中文提示。
  ```bash
  cd monet-immersive
  python3 -m http.server 8123      # 或双击 start.bat / start.command
  # http://localhost:8123/
  ```
- 地址参数：
  - `?q=high|mid|low`：画质档位，默认桌面 mid、触屏 low
  - `?demo`：自动演示
  - `?capture`：录制模式（同步排序，由 `window.__step` 驱动时钟），默认会自动跑演示，加 `&nodemo` 可关掉
- 无构建步骤，无框架。`vendor/three.module.min.js` 是 Three.js r170，通过 import map 引入。
- `npm install` 只用于工具：`puppeteer-core` 和 `ffmpeg-static`。

## 4. 架构速览

```
index.html / style.css   DOM 层：#wall 展墙、canvas#gl、#gallery 展厅、#hud 沉浸 HUD、#card 热点卡片、#fx 暗角颗粒、#cursor 演示光标、#loader
src/main.js              状态机 + 时钟/补间 + 相机/投影 + 转场编排 + 交互 + 帧循环 + window.app（给 demo/工具用）
src/scenes.js            每幅画的配置：分类函数 classify、相机 cam、风 wind、调色 grade、热点 hotspots、扩展 ext
src/generator.js         画作像素 → 笔触数据（画内分层采样 + 全景扩展）。QUALITY 档位定义在这里
src/splats.js            渲染：实例化三角形 + 5 张 RGBA32F 数据纹理；顶点着色器做转场/风/各类动效/调色/聚焦；片元着色器画笔触形状
src/sort.js              视锥剔除 + 16 位计数排序（按对数视深，从后往前）
src/sortWorker.js        实时模式下在 Worker 里排序
src/demo.js              自动演示脚本（约 2:00）
src/audio.js             实时 WebAudio 风声
tools/render.mjs         ★ 演示视频渲染（内置服务器 + puppeteer 逐帧 + ffmpeg + 风声合成）
tools/shot.mjs           ★ 画面调试截图：进入指定画作，按朝向截图，或用 --focus 截热点特写
tools/capture.mjs        旧版逐帧导出（被 render.mjs 取代，保留）
tools/wind_audio.py      旧版风声合成（numpy/scipy，被 render.mjs 内置实现取代）
tools/fonts.py           Google Fonts 子集下载 → assets/fonts/
```

### 4.1 核心原理（改代码前务必理解）

1. **视线约束**：画内每个笔触只沿自己的视线 `(u-0.5, -(v-vH)*asp, -f)` 移动。从原点看，构图与原画逐像素一致。
   - DOM 中画作的屏幕矩形与 3D 离轴视锥对齐（`galleryFrustum` → `makePerspective(l,r,t,b)`），所以转场能从 DOM 图片无缝过渡到 3D。
   - **不要**给画内笔触加偏离视线的位移（风、动效除外，它们只在进入沉浸后出现）。
2. **数据布局**（`Builder.add` / 着色器 texelFetch）：
   - A = 世界坐标 + seed
   - B = 画布坐标（转场起点）+ cls
   - C = 长轴向量 + 短轴长度
   - D = 颜色 + alpha
   - E = hot（热点 id）, flex（受风系数）, delay（转场延迟）, ext（0 画内 / 1 扩展）
3. **类别 CLS**（`scenes.js`）：
   - `SKY 0, GRASS 1, FLOWER 2, TREE 3, STATIC 4, FIGURE 5, WATER 6, SAIL 7`
   - `PETAL 8, MOTE 9, HALO 10, GLINT 11`
   - 着色器按类别分支做动效。
4. **分层顺序靠深度**：排序只按视深。画内四层（粗/中/细/细节）在深度上依次错开 1.4%（`depth * (1 + 0.014*(3-li))`），粗底色永远在细笔触后面。这是解决“糊”的关键，不要去掉。
5. **无缝画框**：
   - 画内笔触在边缘 `EDGE_IN` 内随机溶解。
   - 扩展笔触允许进入画内 `EDGE_OUT` 带。
   - `edgeBlend()`：扩展笔触在画框外 `EDGE_M=0.26` 范围内，把颜色向“画中最近的同类像素”（天空/水/岸/帆四族）插值。
6. **调色**：`scenes.js` 的 `grade`（gamma/expo/wb/sat/lift/contrast），在着色器 `grade()` 中按 `uGrade` 混合。
   - 转场时 `S.grade` 从 0 渐变到 1，所以展厅里看到的仍是原画色调。
   - 背景天穹在 JS 里用 `gradeColor` 预先调好。
7. **时钟**：所有动画都走 `main.js` 的单一时钟 `clock` + `tween()`。录制时由外部调用 `window.__step(dt, draw)` 推进，结果完全确定。
   - **坑**：`tween` 用 Promise 串联。如果在**一次** `page.evaluate` 里同步循环调用 `__step`，后续 `await` 不会执行。必须每步之间让出事件循环，见 `tools/shot.mjs` 的 `step()`。

### 4.2 帆船场景扩展（generator.js `ext.kind === 'water'`）

- **水面**：颜色取自 `pal.water`（只保留原画水区中偏蓝的像素，b1 精度），再按掠射角叠加天空反射，并做边缘融合。
  - 笔触是水平短笔。着色器对扩展水面按掠射角压扁短轴（`graze`）。
- **倒影 `mirror()`**：把物体镜像点投影到水面上（`k = h/(h+yRel)`），放在比水面笔触略近的位置，这样能画在水面之上。
  - 倒影是加长的水平色块，饱和度更高、颜色略暗。
- **岸**：
  - 灌木带 `Q.shore`
  - 显式岸树 `ext.bankTrees`（`[角度°, 距离, 高, 宽]`，右岸接续画面）
  - 远岸树林带（K=150 个团块）
  - 房屋 `ext.houses`、帆船 `ext.boats`
- **树 `treeClump()`**：多团块树冠，左上方受光；约 16% 的概率加深色大底笔，填住空隙。
- **天空**：晴空渐变（`horizCol → clearCol`）加水平拉伸的云层带（fbm 噪声做遮罩，`cloudLo/cloudHi` 着色）。天空笔触的边缘更柔（着色器里 `vPx` 乘 0.3）。
- **大气透视**：`addExt` 对树/房/帆/草按水平距离 30–150 m 向 `horizCol` 混色，最多混 50%。

## 5. 调画面的工作流（强烈推荐）

```bash
python3 -m http.server 8123 &                                  # 在 monet-immersive 目录下
node tools/shot.mjs --scene 1 --yaws 0,0.55,-0.6,3.1 --out /tmp/s --mid 3.2   # 多朝向截图 + 转场中途截图
node tools/shot.mjs --scene 1 --yaws 3.1 --pitch 0.25 --out /tmp/s            # 抬头看天空
node tools/shot.mjs --scene 1 --focus 1,2,4 --out /tmp/s                      # 热点特写
node tools/shot.mjs --scene 0 --yaws 0,2.4 --tag p_ --out /tmp/s              # 罂粟场景
```

- yaw 为正是向左看，为负是向右看。帆船画面右侧（右岸）大约在 `--yaws -0.6`。
- 没有 GPU 的机器（SwiftShader）截一组图大约 10 秒。实时运行或完整录制会很慢，约 2 秒一帧。
- 调参的主要位置：
  - **色调**：`scenes.js` 的 `grade`
  - **笔触数量**：`generator.js` 的 `QUALITY`
  - **扩展布局**：`scenes.js` 的 `ext`
  - **各类颜色和尺寸**：`generator.js` 中对应的段落
  - **笔触形状**：`splats.js` 片元着色器（`rim`、`streak`）

## 6. 演示视频

```bash
npm install
node tools/render.mjs              # 1920x1080·30fps·high → monet_demo.mp4（弹出浏览器窗口，用真显卡）
node tools/render.mjs --preview    # 1280x720·24fps·mid
node tools/render.mjs --dry        # 只测演示时长（几秒）
node tools/render.mjs --headless   # 无窗口（软件渲染，云端约 1 小时）
```

- 用户的要求是演示视频**约 2 分钟**。当前 `--dry` 测得 120.9 秒。修改 `src/demo.js` 后一定要用 `--dry` 复核时长。
- 演示脚本：罂粟（环顾 → 卡米耶与让 → 调高风力）→ 回到展厅 → 切到帆船 → 环顾 → 白帆 → 碎裂的倒影 → 阵风 → 回到展厅。
- 风声：按每帧的 `S.windLevel` 合成棕噪声并滤波（`render.mjs` 里的 `windWav`）。

## 7. 已踩过的坑（别再踩）

| 现象 | 原因 / 修复 |
|---|---|
| 展厅里点画作切换没反应 | `#hud` 透明时其子元素 `pointer-events:auto` 挡住了点击。现在只在 `#hud.on`（沉浸态）时可交互 |
| 画面糊 | 粗底色与细笔触同深度，排序后粗的盖在细的上面。修复方式：分层深度偏移（4.1 第 4 条）+ 硬边笔触 |
| 水面大片交叉的“碎刀片” | 画内水面笔触沿结构张量方向画成了竖向。现在 WATER 类强制水平 |
| 扩展水面发土黄/橄榄色 | 水色取到了倒影里的绿/棕。现在只取偏蓝像素 |
| 倒影看不见 | 倒影点原来放在水面以下，被更近的水面笔触盖住。现在投影到水面上，并稍微靠近相机 |
| 天空脏、斑驳 | 随机亮度分位取色太碎。现在用“晴空渐变 + 云层遮罩”结构化着色，并用柔边 |
| 聚焦时出现矩形亮块、四周发暗发灰 | 原来按热点 id 压暗，标注区域是矩形。现在以热点中心做径向柔和衰减，压暗幅度也降低了 |
| CDN 打开时报错 canvas tainted | 图片跨域。`loadImage` 设置了 `crossOrigin='anonymous'` |
| 截图脚本看到的还是展厅 | ① `?capture` 默认会自动跑演示，需要加 `&nodemo`；② 见 4.1 第 7 条（要让出事件循环） |
| 用户电脑卡到打不开 | 默认画质从 high 改成 mid；启动时只生成第一幅画，第二幅在切换时才生成 |

## 8. 待办 / 建议的下一步（按优先级）

1. **罂粟场景打磨**（参照帆船的做法）：
   - 近景扩展草地笔触偏碎、偏亮，可以考虑减小风的“浪尖提亮”，并按距离调整笔触尺寸和颜色。
   - 天空顶部还有少量深蓝短笔。
   - 远处树林可以做得更连续，并加大气透视（已有通用实现）。
2. **帆船天空**：画内上缘的天空原画偏灰。扩展天空和画内天空交界处的质感可以再统一一些。云的形态可以更“莫奈”（更大笔、更多奶油白）。
3. **热点卡片**：`#card` 是深橄榄色毛玻璃，和明亮的画面对比偏重，可以考虑改浅，或做成半透明暖白。
4. **性能**：
   - 弱显卡可以考虑按设备自动降档（测首帧耗时后切到 low）。
   - 或者把扩展区的远景天空和水面合并成更少、更大的笔触。
5. **后续路线**（见 README「后续可扩展」）：
   - 用单目深度估计替代手工分层
   - 接入 WebXR（VR/MR）
   - 加载真实 3DGS 资产（Spark / `.spz`）
   - 每位艺术家只需新增一个 `scenes.js` 配置

## 9. 约定

- 代码风格：原生 ES Module，无构建，注释很少，只写代码本身表达不了的约束。
- 资产：画作来自 Wikimedia Commons（公有领域，2048px）；字体是子集化的 Noto Serif SC 和 Cormorant Garamond（OFL）。新增中文文案后需要重新生成字体子集：`python3 tools/fonts.py`。
- 画面验收标准：明亮通透、偏冷、有笔触感但不脏，看不到画框边界；转场时画面与原画完全对齐。

## 10. 目标仓库：haoyuyou50-star/MR

用户希望项目放在 https://github.com/haoyuyou50-star/MR ，放在子目录 `monet-immersive/` 下，给团队其他模块留位置。截至交接时，Cursor 的 GitHub 应用还没有该仓库的写权限，需要用户在本机执行一次：

```bash
git clone https://github.com/haoyuyou50-star/MR.git
cd MR
git subtree add --prefix=monet-immersive https://github.com/haoyuyou50-star/checklist.git cursor/monet-immersive-standalone-21be
git push origin main
```

- 这样会保留全部提交历史，也不会覆盖 MR 原有的 README。
- 迁移之后，在 MR 仓库的 `monet-immersive/` 里继续开发即可。
- 如果用户给 Cursor 的 GitHub 应用开通了 MR 仓库的权限，接手的 agent 可以自己执行上面的命令。
- 分支 `cursor/monet-immersive-standalone-21be` 的根目录就是本项目（由 `git subtree split` 生成）。
