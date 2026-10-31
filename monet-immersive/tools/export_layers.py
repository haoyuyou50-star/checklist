"""Turn the art team's layer sources into web assets for the layered regatta scene.

  python3 tools/export_layers.py        (needs: pip install psd-tools pillow numpy)

Reads assets/layers/export.psd and the two zips of extra sails / trees, writes assets/regatta/:
  base.jpg        the painting with every element removed (sky, river, far village, grass bank)
  composite.jpg   all layers flattened, shown in the gallery and as the transition's start
  <id>.webp       each element cropped to its solid pixels
  manifest.json   canvas boxes, contact rows and source sizes for src/scenes.js
"""
import io, json, os, zipfile
import numpy as np
from PIL import Image
from psd_tools import PSDImage

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'assets', 'layers')
OUT = os.path.join(ROOT, 'assets', 'regatta')
os.makedirs(OUT, exist_ok=True)

# PSD layer name -> asset id, bottom to top (later layers stand in front of earlier ones)
PSD_IDS = {
    'Rightmost Tall Sailboat': 'sail_r', 'Middle Sailboat': 'sail_m', 'Small Middle Left Sailboat': 'sail_s',
    'Leftmost Sailboat': 'sail_l', '完整大红房子': 'house_big', '莫奈风树丛3': 'grove_back', '完整树丛': 'grove_front',
    '完整小红房子': 'house_small', '完整独立树': 'tree',
}
EXTRA_IDS = {
    '莫奈风单帆侧面.png': 'x_sail_side', '莫奈风单帆侧面帆船.png': 'x_boat_side', '莫奈风单帆斜向帆船.png': 'x_boat_oblique',
    '莫奈风单帆正面.png': 'x_sail_front', '莫奈风双帆侧面帆船.png': 'x_boat_two', '莫奈风帆船透明底1.png': 'x_boat_1',
    '莫奈风帆船透明底2.png': 'x_boat_2', '莫奈风树丛1.png': 'x_grove_1', '莫奈风树丛2.png': 'x_grove_2',
    '莫奈风独立树1.png': 'x_tree_1', '莫奈风独立树2.png': 'x_tree_2',
}


def solid_box(im):
    a = np.array(im)[..., 3]
    ys, xs = np.nonzero(a > 128)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def save_rgba(im, name, max_side):
    s = min(1.0, max_side / max(im.size))
    if s < 1:
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    # faint fringe pixels carry stray colour; the build only trusts clearly solid alpha anyway
    a = np.array(im)
    a[..., 3] = np.where(a[..., 3] < 24, 0, a[..., 3])
    Image.fromarray(a).save(os.path.join(OUT, name + '.webp'), 'WEBP', quality=90, method=6)
    return im.size


psd = PSDImage.open(os.path.join(SRC, 'export.psd'))
W, H = psd.width, psd.height
manifest = {'canvas': [W, H], 'layers': [], 'extras': []}
for layer in psd:
    im = layer.topil().convert('RGBA')
    if layer.name == '无白帆底图':
        im.convert('RGB').save(os.path.join(OUT, 'base.jpg'), quality=90)
        continue
    lid = PSD_IDS[layer.name]
    x0, y0, x1, y1 = solid_box(im)
    crop = im.crop((x0, y0, x1, y1))
    ox, oy = layer.bbox[0] + x0, layer.bbox[1] + y0
    size = save_rgba(crop, lid, 1024)
    manifest['layers'].append({'id': lid, 'name': layer.name, 'box': [ox / W, oy / H, (ox + crop.width) / W, (oy + crop.height) / H], 'size': size})
psd.composite().convert('RGB').save(os.path.join(OUT, 'composite.jpg'), quality=90)

for zname in ('多余白帆素材.zip', '多余树木素材.zip'):
    with zipfile.ZipFile(os.path.join(SRC, zname)) as z:
        for info in z.infolist():
            name = info.filename
            if not info.flag_bits & 0x800:
                name = name.encode('cp437').decode('utf-8', 'replace')
            if name not in EXTRA_IDS:
                continue
            im = Image.open(io.BytesIO(z.read(info))).convert('RGBA')
            crop = im.crop(solid_box(im))
            size = save_rgba(crop, EXTRA_IDS[name], 768)
            manifest['extras'].append({'id': EXTRA_IDS[name], 'name': name, 'size': size})
manifest['extras'].sort(key=lambda e: e['id'])

with open(os.path.join(OUT, 'manifest.json'), 'w') as fp:
    json.dump(manifest, fp, ensure_ascii=False, indent=1)
print(json.dumps(manifest, ensure_ascii=False, indent=1))
