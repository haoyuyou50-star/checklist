"""Merge the two painted panoramas of the water-lily pond into one full sphere, and render the gallery picture.

  python3 tools/make_pano.py BAND.jpg DOME.jpg

BAND covers 360 x 90 degrees (horizon at mid-height), DOME 360 x 144 degrees with more sky and pond. The band
paints the eye-level ring, the dome the sky and the pond above and below it; the zenith and nadir that neither
reaches are tiled from the dome's own sky and lilies by position (so no seam converges on the poles). Each
picture's left/right seam is closed by mirror-continuing both edges and switching along a ragged line, and the
generator's watermark is painted over from the rows above it.

Writes assets/bridge_pano/sphere.jpg (equirectangular, azimuth 0 = the bridge at the centre column) and
assets/bridge_pano/view.jpg (the gallery picture: the same sphere seen through the scene's pinhole camera).
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

OUT = 'assets/bridge_pano'
OW, OH = 4096, 2048
# the bridge's centre column in each picture (azimuth 0)
BAND_X0, DOME_X0 = 0.54, 0.596
# gallery camera (keep in step with the scene's cam): rays (u - 0.5, -(v - vH) * asp, -f)
VIEW_W, VIEW_H, VIEW_F, VIEW_VH = 1600, 1200, 0.5, 0.45

rng = np.random.default_rng(7)


def load(p):
    return np.asarray(Image.open(p).convert('RGB'), dtype=np.float32) / 255.0


def unmark(img, x0, y0, x1, y1):
    """Paint over a rectangle with the rows mirrored from just above it, feathered at the edges."""
    H, W, _ = img.shape
    X0, Y0, X1, Y1 = int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)
    m = 12
    X0, Y0, X1, Y1 = max(0, X0 - m), max(0, Y0 - m), min(W, X1 + m), min(H, Y1 + m)
    out = img.copy()
    for y in range(Y0, Y1):
        out[y, X0:X1] = img[max(0, 2 * Y0 - y - 1), X0:X1]
    mask = np.zeros((H, W), np.float32)
    mask[Y0 + m // 2:Y1 - m // 2, X0 + m // 2:X1 - m // 2] = 1
    mask = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(m / 2)), np.float32)[..., None] / 255
    return img * (1 - mask) + out * mask


def noise(shape, cells, seed):
    """Smooth value noise in [0, 1] (bicubic-upsampled random grid), periodic in x."""
    r = np.random.default_rng(seed).random((cells[1], cells[0])).astype(np.float32)
    r = np.concatenate([r, r, r], axis=1)
    im = Image.fromarray((r * 255).astype(np.uint8)).resize((shape[1] * 3, shape[0]), Image.BICUBIC)
    return np.asarray(im, np.float32)[:, shape[1]:2 * shape[1]] / 255


def bilinear(img, x, y):
    H, W, _ = img.shape
    fx = np.clip(x * W - 0.5, 0, W - 1.001)
    fy = np.clip(y * H - 0.5, 0, H - 1.001)
    x0, y0 = fx.astype(np.int32), fy.astype(np.int32)
    tx, ty = (fx - x0)[..., None], (fy - y0)[..., None]
    a, b = img[y0, x0], img[y0, x0 + 1]
    c, d = img[y0 + 1, x0], img[y0 + 1, x0 + 1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def seamless(img, x, y, n, w=0.05, e=0.006):
    """Sample img at x (wrapping) with its left/right seam closed: both edges run on mirrored and the
    picture switches from one to the other along a ragged line (n: noise in [0, 1])."""
    x = np.mod(x, 1.0)
    s = np.mod(x + 0.5, 1.0) - 0.5
    xl, xr = 1 - np.abs(s), np.abs(s)
    left = smooth(e, -e, s + (n - 0.5) * 2 * (w - e))[..., None]
    return bilinear(img, xl, y) * left + bilinear(img, xr, y) * (1 - left)


def main(band_p, dome_p):
    band = unmark(load(band_p), 0.952, 0.94, 0.997, 0.988)
    dome = unmark(load(dome_p), 0.926, 0.94, 0.994, 0.986)

    xs = (np.arange(OW, dtype=np.float32) + 0.5) / OW
    ys = (np.arange(OH, dtype=np.float32) + 0.5) / OH
    X, Y = np.meshgrid(xs, ys)
    az = (X - 0.5) * 2 * np.pi
    el = (0.5 - Y) * np.pi
    eld = np.degrees(el)

    nA = noise((OH, OW), (24, 12), 1)
    nB = noise((OH, OW), (40, 20), 2)
    nC = noise((OH, OW), (16, 8), 3)

    # band: 90 degrees tall, horizon at mid-height
    Bc = seamless(band, BAND_X0 + az / (2 * np.pi), 0.5 - el / (np.pi / 2), nA)
    # dome: 144 degrees tall
    Dc = seamless(dome, DOME_X0 + az / (2 * np.pi), 0.5 - el / (0.8 * np.pi), nB)

    # the band paints eye level; above and below, the dome takes over along a ragged edge
    jag = (nC - 0.5) * 9 + (nB - 0.5) * 4
    wB = smooth(40, 33, eld + jag) * smooth(-41, -33, eld - jag)
    col = Dc * (1 - wB[..., None]) + Bc * wB[..., None]

    # poles: the dome's own sky (top rows, clear of the left-hand tree) and lilies tiled by position
    tri = lambda v: 1 - np.abs(np.mod(v, 2) - 1)
    cot = 1 / np.tan(np.maximum(np.abs(el), 0.05))
    px, pz = cot * np.sin(az), cot * np.cos(az)
    # noise by position on the sky/ground plane (by azimuth it would pinch into a star at the pole)
    grid = noise((1024, 1024), (16, 16), 4)
    pn = lambda a, b, s: grid[(np.mod(b * s, 1) * 1023).astype(np.int32), (np.mod(a * s, 1) * 1023).astype(np.int32)] - 0.5
    wn = pn(px, pz, 0.3) + 0.25 * pn(px + 3.1, pz - 1.7, 0.7)

    def tile(x0, xw, y0, yh, k, ox, oz):
        # k: source radians per radian of view; the window repeats mirrored
        su = tri((px * k / (2 * np.pi) + 0.04 * wn) / xw + ox)
        sv = tri((pz * k / (0.8 * np.pi) - 0.02 * wn) / yh + oz)
        return bilinear(dome, x0 + su * xw, y0 + sv * yh)

    zen = tile(0.3, 0.62, 0.005, 0.14, 1.3, 0.5, 0.3)
    # underfoot: the pond in front, the grassy bank the eye stands on behind, split by a ragged shoreline
    # placed so the pond spans the same arc (azimuth -140..76 degrees) as the pictures' lowest rows
    pond = tile(0.22, 0.5, 0.78, 0.12, 1.0, 0.4, 0.2)
    grass = tile(0.82, 0.1, 0.76, 0.14, 1.0, 0.3, 0.6)
    ca = np.radians(-32)
    shore = px * np.sin(ca) + pz * np.cos(ca) + 0.22 + 0.25 * wn
    wP = smooth(-0.04, 0.04, shore)[..., None]
    nad = pond * wP + grass * (1 - wP)
    wZ = smooth(54, 64, eld + jag * 0.6)[..., None]
    wN = smooth(-53, -62, eld - jag * 0.6)[..., None]
    col = col * (1 - wZ) + zen * wZ
    col = col * (1 - wN) + nad * wN

    sphere = np.clip(col * 255 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(sphere).save(f'{OUT}/sphere.jpg', quality=88, optimize=True)

    # gallery picture: the same sphere through the scene's pinhole camera
    asp = VIEW_H / VIEW_W
    u = (np.arange(VIEW_W, dtype=np.float32) + 0.5) / VIEW_W
    v = (np.arange(VIEW_H, dtype=np.float32) + 0.5) / VIEW_H
    U, V = np.meshgrid(u, v)
    dx, dy, dz = U - 0.5, -(V - VIEW_VH) * asp, -np.full_like(U, VIEW_F)
    l = np.sqrt(dx * dx + dy * dy + dz * dz)
    vaz = np.arctan2(dx, -dz)
    vel = np.arcsin(dy / l)
    view = bilinear(col, vaz / (2 * np.pi) + 0.5, 0.5 - vel / np.pi)
    Image.fromarray(np.clip(view * 255 + 0.5, 0, 255).astype(np.uint8)).save(f'{OUT}/view.jpg', quality=90, optimize=True)
    print('sphere', sphere.shape, 'view', view.shape)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
