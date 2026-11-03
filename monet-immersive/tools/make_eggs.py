"""Crop the art team's easter-egg sprites (art_deliveries/full-v001/<scene>/easter_eggs) into assets/eggs.

    python3 tools/make_eggs.py <art_deliveries/full-v001>

Both states of an egg are cropped to the union of their paint, so they stay registered, and scaled to at most
MAX px. Writes assets/eggs/<scene>_<egg>_{idle,gaze}.webp (RGBA).
"""
import sys, os
import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else 'art_deliveries/full-v001'
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'eggs')
MAX = 360
# (the oar wake and ripple sprites are not used: they read as blue glass on the painted water)
EGGS = [('regatta', 'waterbird'), ('regatta', 'flag'), ('bridge', 'lily_bloom'), ('bridge', 'dragonfly')]

os.makedirs(OUT, exist_ok=True)
for scene, egg in EGGS:
    ims = [Image.open(os.path.join(SRC, scene, 'easter_eggs', f'{egg}_{s}.png')).convert('RGBA') for s in ('idle', 'gaze')]
    m = np.zeros(ims[0].size[::-1], bool)
    for im in ims:
        m |= np.asarray(im)[:, :, 3] > 24
    ys, xs = np.where(m)
    pad = 6
    box = (max(xs.min() - pad, 0), max(ys.min() - pad, 0), min(xs.max() + pad, m.shape[1]), min(ys.max() + pad, m.shape[0]))
    w, h = box[2] - box[0], box[3] - box[1]
    s = MAX / max(w, h)
    for im, st in zip(ims, ('idle', 'gaze')):
        out = im.crop(box).resize((round(w * s), round(h * s)), Image.LANCZOS)
        out.save(os.path.join(OUT, f'{scene}_{egg}_{st}.webp'), lossless=False, quality=92)
    print(scene, egg, 'crop', box, '->', round(w * s), 'x', round(h * s))
