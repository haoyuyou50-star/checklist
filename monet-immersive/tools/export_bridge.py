"""Turn the art team's layer split of the water-lily bridge into web assets.

  python3 tools/export_bridge.py        (needs: pip install psd-tools pillow numpy)

Reads the two PSDs in assets/layers/ (same 27 element layers, different pond under them) and writes
assets/bridge/:
  base.jpg / base_green.jpg            the clean plate (sky, far bank, empty pond) of each version
  composite.jpg / composite_green.jpg  all layers flattened; the blue one is the gallery picture
  <id>.webp                            each element cropped to its solid pixels
  manifest.json                        canvas boxes and source sizes for src/scenes.js
"""
import json, os
import numpy as np
from PIL import Image
from psd_tools import PSDImage

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'assets', 'layers')
OUT = os.path.join(ROOT, 'assets', 'bridge')
os.makedirs(OUT, exist_ok=True)
BLUE, GREEN = '莲花桥蓝色底图版本图层(1).psd', '莲花桥绿色底图版本图层(1).psd'

# element layers bottom to top; some PSD names repeat, so ids go by position
IDS = [
    'willow_far_r', 'willow_l', 'bush_l', 'willow_c2', 'willow_r', 'willow_big', 'willow_l2', 'willow_weep',
    'lily_3', 'lily_7a', 'lily_5', 'lily_4a', 'lily_2', 'lily_6a', 'lily_7b', 'lily_6b',
    'bridge', 'bush_r', 'willow_soft', 'lily_4b', 'bush_lm', 'flowers_3', 'flowers_l', 'flowers_4', 'flowers_2', 'flowers_1', 'grass_br',
]


def solid_box(im):
    a = np.array(im)[..., 3]
    ys, xs = np.nonzero(a > 128)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def save_rgba(im, name, max_side=1024):
    s = min(1.0, max_side / max(im.size))
    if s < 1:
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    a = np.array(im)
    a[..., 3] = np.where(a[..., 3] < 24, 0, a[..., 3])
    Image.fromarray(a).save(os.path.join(OUT, name + '.webp'), 'WEBP', quality=90, method=6)
    return im.size


blue, green = PSDImage.open(os.path.join(SRC, BLUE)), PSDImage.open(os.path.join(SRC, GREEN))
# the green file is 3 px shorter; both share the top-left origin, so the blue canvas is the reference
W, H = blue.width, blue.height


def plate(psd, name):
    im = Image.new('RGBA', (W, H))
    base = list(psd)[0]
    im.alpha_composite(base.topil().convert('RGBA'), (base.bbox[0], base.bbox[1]))
    # the plate is a few pixels short of the canvas on some edges: mirror its border in (repeating the
    # edge row would smear it into streaks)
    a = np.array(im)
    m = a[..., 3] > 0
    ys, xs = np.nonzero(m)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    a = a[y0:y1 + 1, x0:x1 + 1]
    a = np.pad(a, ((y0, H - 1 - y1), (x0, W - 1 - x1), (0, 0)), mode='symmetric')
    Image.fromarray(a).convert('RGB').save(os.path.join(OUT, name), quality=90)
    return Image.fromarray(a).convert('RGBA')


def composite(psd, base, name):
    im = base.copy()
    for layer in list(psd)[1:]:
        im.alpha_composite(layer.topil().convert('RGBA'), (layer.bbox[0], layer.bbox[1]))
    im.convert('RGB').save(os.path.join(OUT, name), quality=90)


pb, pg = plate(blue, 'base.jpg'), plate(green, 'base_green.jpg')
composite(blue, pb, 'composite.jpg')
composite(green, pg, 'composite_green.jpg')

manifest = {'canvas': [W, H], 'layers': []}
for lid, layer in zip(IDS, list(blue)[1:]):
    im = layer.topil().convert('RGBA')
    x0, y0, x1, y1 = solid_box(im)
    crop = im.crop((x0, y0, x1, y1))
    ox, oy = layer.bbox[0] + x0, layer.bbox[1] + y0
    size = save_rgba(crop, lid)
    manifest['layers'].append({'id': lid, 'name': layer.name, 'box': [round(ox / W, 4), round(oy / H, 4), round((ox + crop.width) / W, 4), round((oy + crop.height) / H, 4)], 'size': size})

with open(os.path.join(OUT, 'manifest.json'), 'w') as fp:
    json.dump(manifest, fp, ensure_ascii=False, indent=1)
print(json.dumps(manifest, ensure_ascii=False))
