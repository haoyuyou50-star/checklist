# 代码艺术短片

二十条竖屏短片，每条 10 秒。画面和声音都由这个目录里的 Python 生成。清单应用在上一级，这里不改它。

```bash
cd code-art
python3 render.py --stills          # 每条一张海报帧
python3 render.py --stills --only 01 07
python3 render.py --video           # 全部 mp4，写入 renders/
python3 render.py --video --only 20
```

成片在 `renders/`，海报帧在 `stills/`。用浏览器打开 `index.html` 可以连着看。

依赖：numpy、Pillow、SciPy、ffmpeg。
