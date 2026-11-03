"""The regatta's world beyond the frame, from the art team's panorama (art_deliveries/full-v001/regatta).

    python3 tools/make_pano_ext.py <art_deliveries/full-v001>

The panorama is painted brighter and bluer than Monet's picture: its sky, river and banks are each moved to the
painting's own colour statistics (mean and spread per channel, regions from the art team's sky and water masks,
which are only roughly right but good enough for statistics), STRENGTH of the way. Writes
assets/regatta/pano_ext.jpg (equirectangular, azimuth 0 at the middle) and pano_ext_cls.png, 1024 x 512: what each
pixel is (R sky, G river, B bank), so a sky stroke never takes a tree's colour and a bank stroke never the sky's.
"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter

SRC = sys.argv[1] if len(sys.argv) > 1 else 'art_deliveries/full-v001'
ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'assets', 'regatta', 'pano_ext.jpg')
OUT_CLS = os.path.join(ROOT, 'assets', 'regatta', 'pano_ext_cls.png')
STRENGTH = 0.85

pano = Image.open(os.path.join(SRC, 'regatta', 'panorama.png')).convert('RGB')
W, H = pano.size
P = np.asarray(pano, np.float32) / 255
def mask(name):
    m = Image.open(os.path.join(SRC, 'regatta', 'masks', name)).convert('L').resize((W, H), Image.BILINEAR)
    return np.asarray(m.filter(ImageFilter.GaussianBlur(4)), np.float32) / 255
el = (0.5 - (np.arange(H) + 0.5) / H)[:, None] * 180 * np.ones((1, W))
sky = mask('sky.png') * (el > 2)
water = mask('water_base.png') * (el < -1.5) * (el > -40)
land = np.clip(1 - sky - water, 0, 1) * (el > -3) * (el < 14)

art = np.asarray(Image.open(os.path.join(ROOT, 'assets', 'regatta', 'composite.jpg')).convert('RGB'), np.float32) / 255
ah, aw = art.shape[:2]
regions = {
    'sky': (art[: int(ah * 0.28)].reshape(-1, 3), sky),
    'water': (art[int(ah * 0.72):].reshape(-1, 3), water),
    'land': (art[int(ah * 0.36): int(ah * 0.5), int(aw * 0.5):].reshape(-1, 3), land),
}
out = np.zeros_like(P)
wsum = np.zeros((H, W, 1), np.float32)
for name, (ref, m) in regions.items():
    sel = P[m > 0.5]
    mu_p, sd_p = sel.mean(0), sel.std(0) + 1e-4
    mu_a, sd_a = ref.mean(0), ref.std(0)
    T = (P - mu_p) / sd_p * sd_a + mu_a
    # each region's mapping applies where it was measured (soft weights); elsewhere the sky's above the horizon
    # and the river's below it
    base = (el > 0) if name == 'sky' else (el <= 0) if name == 'water' else np.zeros_like(el)
    wk = (m + 0.02 * base)[:, :, None] + 1e-4
    out += T * wk
    wsum += wk
    print(f'{name}: pano mean {np.round(mu_p, 3)} -> painting {np.round(mu_a, 3)}')
out = out / wsum
res = P + (np.clip(out, 0, 1) - P) * STRENGTH
Image.fromarray((np.clip(res, 0, 1) * 255).astype(np.uint8)).save(OUT, quality=90)
print('wrote', os.path.normpath(OUT), (W, H))
skyM, waterM = mask('sky.png'), mask('water_base.png') * (el < 0)
cls = np.stack([skyM, waterM, np.clip(1 - skyM - waterM, 0, 1)], -1)
Image.fromarray((cls * 255).astype(np.uint8)).resize((1024, 512), Image.BILINEAR).save(OUT_CLS, optimize=True)
print('wrote', os.path.normpath(OUT_CLS))
