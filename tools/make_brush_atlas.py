"""Pack the art team's brush scans (art_deliveries/full-v001/brushes) into assets/brushes/atlas.png.

    python3 tools/make_brush_atlas.py <dir with the brush PNGs>

4x4 cells of 128 px, one brush per cell, grey = paint height (black: no paint). Each brush is cropped to its
paint, turned so its drag runs along x (the stroke's major axis) and stretched over the middle 90% of its cell:
the stroke maps its cell onto the ellipse it is drawn in, so the paint fills about what the plain ellipse did.
Cell order (the shader picks by family = index / 3): short dab 0-2, horizontal drag 3-5, vertical trail 6-8,
wide flat 9-11, dry bristle 12-14; cell 15 stays empty.
"""
import sys, os
import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else 'art_deliveries/full-v001/brushes'
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'brushes', 'atlas.png')
CELL, FILL = 128, 0.9
# (file, quarter turns): the vertical trails and the first wide flat (its bristle lines run up and down) are turned
BRUSHES = [('short_dab_%d', 0)] * 3 + [('horizontal_drag_%d', 0)] * 3 + [('vertical_trail_%d', 1)] * 3 \
    + [('wide_flat_%d', 0)] * 3 + [('dry_bristle_%d', 0)] * 3

atlas = np.zeros((CELL * 4, CELL * 4), np.float32)
for k, (name, turns) in enumerate(BRUSHES):
    fn = name % (k % 3 + 1)
    if fn == 'wide_flat_1':
        turns = 1
    a = np.asarray(Image.open(os.path.join(SRC, fn + '.png')).convert('L'), np.float32) / 255
    a = np.rot90(a, turns)
    ys, xs = np.where(a > 0.12)
    y0, y1 = np.percentile(ys, [0.3, 99.7]).astype(int)
    x0, x1 = np.percentile(xs, [0.3, 99.7]).astype(int)
    crop = Image.fromarray((a[y0:y1, x0:x1] * 255).astype(np.uint8))
    side = int(CELL * FILL)
    b = np.asarray(crop.resize((side, side), Image.LANCZOS), np.float32) / 255
    cx, cy = (k % 4) * CELL + (CELL - side) // 2, (k // 4) * CELL + (CELL - side) // 2
    atlas[cy:cy + side, cx:cx + side] = b

os.makedirs(os.path.dirname(OUT), exist_ok=True)
Image.fromarray((np.clip(atlas, 0, 1) * 255).astype(np.uint8)).save(OUT, optimize=True)
print('wrote', os.path.normpath(OUT), atlas.shape)
