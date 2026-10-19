# 莫奈 · 走进画境 — 高斯泼溅沉浸 Demo

VR 艺术家项目「全景沉浸」模块的 HTML 前期演示。流程：**画作观赏界面 → 点击「进入画境」→ 笔触离开画布、世界向四周展开的转场 → 可交互的 360° 高斯泼溅场景（风吹草浪 / 水波、发光物件、点击拉近） → 离开画境回到展厅**。

当前收录两幅奥赛博物馆藏品：

| | 画作 | 动态 | 可交互物件 |
|---|---|---|---|
| 01 | 《罂粟花田》Coquelicots, 1873 | 草浪、罂粟花瓣随阵风飞起、树冠摇曳、云层呼吸、光尘 | 卡米耶与让、坡顶的树、罂粟花、远处的农舍 |
| 02 | 《阿让特伊的帆船赛》Régates à Argenteuil, c.1872 | 水面波纹与倒影拉伸、帆随风倾、水面闪光 | 白帆、红顶房屋、岸边的树、碎裂的倒影 |

## 运行

需要通过本地静态服务器打开（ES Module 与读取画作像素都不支持 `file://`）：

```bash
cd monet-immersive
python3 -m http.server 8123
# 浏览器打开 http://localhost:8123/
```

| 地址参数 | 作用 |
|---|---|
| `?demo` | 自动演示：带虚拟光标，自动走完两幅画的完整流程（约 2 分钟），**适合直接录屏** |
| `?q=high` / `mid` / `low` | 画质档位（笔触数量约 29 万 / 19 万 / 11 万）。默认电脑 high、触屏设备 low |

交互：拖动环顾（带惯性）、滚轮缩放视野、点击发光标记走近细看、底部滑杆调风力、「掀起一阵风」触发一道扫过全场的阵风、`Esc` 返回。

## 技术思路

纯前端，无构建步骤，仅依赖 `vendor/three.module.min.js`（Three.js r170）。

1. **由画作生成高斯笔触**（`src/generator.js`）
   - 读取画作像素，按「粗底色 → 中笔触 → 细笔触 → 边缘细节」四层采样，共约 10 万个各向异性高斯椭圆。
   - 每个椭圆的长轴沿局部笔触方向（图像结构张量），颜色带轻微的「色彩分割」抖动，所以静止时也像一幅在空间里展开的油画。
2. **深度与语义**（`src/scenes.js`）
   - 每幅画手工标注地平线、树线、人物、帆、房屋等分层；地面/水面用「眼高 + 地面平面投影」求深度。
   - 关键约束：**每个笔触只沿自己的视线滑动**，所以从原视点看，构图与原画逐像素一致。这是转场能无缝衔接 DOM 画作的原因。
3. **全景扩展**：画框之外的 300° 由程序生成——草地/河面、天空穹顶、树林带、农舍、额外的帆船与倒影。颜色全部从原画「同一深度带 / 同一仰角带」的像素中取样，与画内部分自然衔接。
4. **渲染**（`src/splats.js`）
   - 实例化三角形 + 数据纹理，预乘 Alpha 从后往前混合。
   - Web Worker 里做视锥剔除和 16 位基数排序（`src/sort.js`）。
   - 转场、风场、发光都在顶点着色器里完成：
     - 转场：笔触从画布平面沿视线飞到深度位置，途中有一道金色的展开波；扩展世界从画框边缘向外铺开。
     - 风场：沿风向传播的波 + 噪声阵风 + 可触发的阵风前沿。草被吹弯、沿风向拉长，浪尖提亮。
     - 发光与聚焦：热点笔触呼吸发光并带金色光晕；聚焦时其余部分降饱和、压暗。
5. **观赏界面与转场编排**（`src/main.js`）
   - 3D 相机的视锥与 DOM 中画作的屏幕矩形精确对齐（离轴投影）。动画过程中视锥插值回正常透视，并配合推镜。
   - 所有动画由同一个时钟驱动，所以既能实时运行，也能逐帧确定性录制。
6. 风声：WebAudio 实时合成，音量和音色随风力、阵风变化。

## 录制视频

在有 GPU 的电脑上，最简单的方式是打开 `http://localhost:8123/?demo` 后直接录屏。

也可以离线逐帧录制（不受实时帧率影响，输出绝对流畅；软件渲染下每帧约 1~3 秒）：

```bash
npm install                                   # 安装 puppeteer-core（使用本机 Chrome）
node tools/capture.mjs --out frames --fps 30 --size 1920x1080
python3 tools/wind_audio.py frames/wind.json wind.wav     # 依赖 numpy、scipy
ffmpeg -framerate 30 -i frames/f_%05d.jpg -i wind.wav -c:v libx264 -pix_fmt yuv420p -crf 17 -c:a aac -shortest monet_demo.mp4
```

`node tools/capture.mjs --shots 10,20,30 --out shots` 可快速导出指定时间点的静帧。`--chrome` 可指定 Chrome 路径。

## 目录

```
index.html / style.css        观赏界面、HUD、信息卡片
src/main.js                   状态机、转场编排、相机、交互
src/scenes.js                 两幅画的分层/深度/热点/导览文案
src/generator.js              画作 → 高斯笔触；全景扩展
src/splats.js                 高斯渲染着色器（转场、风、发光）与背景天穹
src/sort.js, sortWorker.js    视锥剔除 + 深度排序
src/demo.js                   自动演示脚本
src/audio.js                  实时风声
tools/                        逐帧录制、风声合成、字体子集生成
assets/paintings/             画作（Wikimedia Commons，公有领域）
assets/fonts/                 思源宋体 / Cormorant Garamond 子集
```

## 后续可扩展

- 深度：用 Depth Anything 等单目深度估计替换手工分层，拉开近景视差。
- 资产：渲染层接口与 Spark（Three.js 3DGS 渲染器）对齐，可换成 World Labs Marble 等生成的真实 `.spz` 场景。
- MR / VR：接入 WebXR，把风改成手势挥动触发，热点改成凝视加捏合。
- 内容：每位艺术家只需新增一个 `scenes.js` 配置（分层、热点、文案）。

## 素材与致谢

画作图片来自 Wikimedia Commons（Google Art Project 扫描，公有领域）。字体为 Noto Serif SC 与 Cormorant Garamond（SIL Open Font License）。
