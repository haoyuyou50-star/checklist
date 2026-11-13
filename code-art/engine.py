"""Shared drawing, color, and synthesis for the code-art videos.

Images are float32 sRGB in 0..1, shape (H, W, 3), y downward.
Sound is synthesized in numpy. Nothing is sampled from a recording.
"""

from __future__ import annotations

import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.signal import lfilter

W, H = 1080, 1920
FPS = 30
SECONDS = 10.0
SR = 44100


def hexrgb(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], np.float32) / 255.0


def clamp01(x):
    return np.clip(x, 0.0, 1.0)


def lerp(a, b, t):
    return a * (1.0 - t) + b * t


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0 + 1e-8), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def ease(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def smoother(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def srgb_to_linear(c):
    c = np.asarray(c, np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(np.asarray(c, np.float64), 0.0, None)
    out = np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)
    return np.clip(out, 0.0, 1.0).astype(np.float32)


def rgb_to_oklab(rgb):
    c = srgb_to_linear(np.asarray(rgb, np.float64))
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = np.cbrt(l), np.cbrt(m), np.cbrt(s)
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    return np.stack([L, A, B], axis=-1)


def oklab_to_rgb(lab):
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    l_ = L + 0.3963377774 * A + 0.2158037573 * B
    m_ = L - 0.1055613458 * A - 0.0638541728 * B
    s_ = L - 0.0894841775 * A - 1.2914855480 * B
    l, m, s = l_**3, m_**3, s_**3
    r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return linear_to_srgb(np.stack([r, g, b], axis=-1))


def mix_ok(c0, c1, t):
    """Blend two sRGB colors in OKLab. t may be a scalar or an array."""
    a = rgb_to_oklab(np.asarray(c0, np.float64))
    b = rgb_to_oklab(np.asarray(c1, np.float64))
    t = np.asarray(t, np.float64)[..., None]
    return oklab_to_rgb(a * (1.0 - t) + b * t)


def blend(c0, c1, t):
    """Linear sRGB blend. Fine for neutrals; use mix_ok when the hue turns."""
    t = np.asarray(t, np.float32)
    if getattr(t, "ndim", 0):
        t = t[..., None]
    return np.asarray(c0, np.float32) * (1.0 - t) + np.asarray(c1, np.float32) * t


def note_hz(name: str) -> float:
    """Scientific pitch, A4 = 440. Accepts C4, F#5, Bb3."""
    acc = 0
    i = 1
    if len(name) > 1 and name[1] in "#b":
        acc = 1 if name[1] == "#" else -1
        i = 2
    octave = int(name[i:])
    sem = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[name[0]] + acc
    midi = (octave + 1) * 12 + sem
    return float(440.0 * 2.0 ** ((midi - 69) / 12.0))


def hz(name: str) -> float:
    return note_hz(name)


class Ctx:
    def __init__(self):
        self.W = W
        self.H = H
        self.fps = FPS
        self.seconds = SECONDS
        ys = np.arange(H, dtype=np.float32)
        xs = np.arange(W, dtype=np.float32)
        self.Y, self.X = np.meshgrid(ys, xs, indexing="ij")
        self.Xn = self.X / W
        self.Yn = self.Y / H
        # Static ordered dither, one LSB, shared so grades don't flicker.
        rng = np.random.default_rng(7)
        self.dither = rng.uniform(-0.5 / 255.0, 0.5 / 255.0, (H, W, 1)).astype(np.float32)
        yy = (self.Y - H * 0.48) / (H * 0.72)
        xx = (self.X - W * 0.5) / (W * 0.62)
        r = np.sqrt(xx * xx + yy * yy)
        self._vig = np.clip(r, 0, 1).astype(np.float32)


def smooth_noise(h, w, seed, sigma):
    rng = np.random.default_rng(seed)
    n = rng.random((h, w)).astype(np.float32)
    n = gaussian_filter(n, sigma, mode="reflect")
    n -= n.min()
    n /= n.max() + 1e-6
    return n


def paper(ctx: Ctx, base, seed=1, fiber=0.018, blot=0.035):
    fine = smooth_noise(ctx.H, ctx.W, seed, 1.1)
    blotch = smooth_noise(ctx.H, ctx.W, seed + 19, 28.0)
    tex = (fine - 0.5) * fiber + (blotch - 0.5) * blot
    col = np.asarray(base, np.float32) + tex[..., None]
    return np.clip(col, 0, 1).astype(np.float32)


def fill(img, color):
    img[...] = np.asarray(color, np.float32)


def paint(img, sd, color, feather=1.15):
    a = np.clip(0.5 - sd / feather, 0.0, 1.0).astype(np.float32)[..., None]
    c = np.asarray(color, np.float32)
    img *= 1.0 - a
    img += c * a


def paint_alpha(img, alpha, color):
    a = np.clip(alpha, 0.0, 1.0).astype(np.float32)
    if a.ndim == 2:
        a = a[..., None]
    c = np.asarray(color, np.float32)
    img *= 1.0 - a
    img += c * a


def sd_circle(ctx, cx, cy, r):
    return np.sqrt((ctx.X - cx) ** 2 + (ctx.Y - cy) ** 2) - r


def sd_box(ctx, cx, cy, hx, hy, rot=0.0):
    dx = ctx.X - cx
    dy = ctx.Y - cy
    if rot:
        ca, sa = np.cos(rot), np.sin(rot)
        dx, dy = ca * dx + sa * dy, -sa * dx + ca * dy
    ax = np.abs(dx) - hx
    ay = np.abs(dy) - hy
    return np.sqrt(np.maximum(ax, 0) ** 2 + np.maximum(ay, 0) ** 2) + np.minimum(
        np.maximum(ax, ay), 0
    )


def sd_capsule(ctx, ax, ay, bx, by, r):
    pax = ctx.X - ax
    pay = ctx.Y - ay
    bax = bx - ax
    bay = by - ay
    h = np.clip((pax * bax + pay * bay) / (bax * bax + bay * bay + 1e-6), 0.0, 1.0)
    dx = pax - bax * h
    dy = pay - bay * h
    return np.sqrt(dx * dx + dy * dy) - r


def sd_polygon(ctx, verts):
    px, py = ctx.X, ctx.Y
    d2 = np.full(px.shape, 1e9, np.float32)
    inside = np.zeros(px.shape, np.bool_)
    n = len(verts)
    for i in range(n):
        ax, ay = verts[i]
        bx, by = verts[(i + 1) % n]
        ex, ey = bx - ax, by - ay
        wx, wy = px - ax, py - ay
        t = np.clip((wx * ex + wy * ey) / (ex * ex + ey * ey + 1e-8), 0.0, 1.0)
        dx, dy = wx - ex * t, wy - ey * t
        d2 = np.minimum(d2, dx * dx + dy * dy)
        cond = ((ay > py) != (by > py)) & (px < (ex * (py - ay) / (ey + 1e-12) + ax))
        inside ^= cond
    return np.sqrt(d2) * np.where(inside, -1.0, 1.0)


def cover(sd, feather=1.15):
    return np.clip(0.5 - sd / feather, 0.0, 1.0).astype(np.float32)


def apply_grade(img, ctx: Ctx, vignette=0.0, contrast=1.0, sat=1.0, bloom=0.0, bloom_thr=0.62):
    x = img.astype(np.float32, copy=True)
    if bloom > 0:
        bright = np.clip(x - bloom_thr, 0, None)
        small = bright[::4, ::4]
        blurred = gaussian_filter(small, sigma=(4.0, 4.0, 0))
        up = np.repeat(np.repeat(blurred, 4, axis=0), 4, axis=1)
        up = up[: x.shape[0], : x.shape[1]]
        x += up * bloom
    if contrast != 1.0:
        x = (x - 0.5) * contrast + 0.5
    if sat != 1.0:
        y = x[..., 0] * 0.2126 + x[..., 1] * 0.7152 + x[..., 2] * 0.0722
        x = y[..., None] + (x - y[..., None]) * sat
    if vignette > 0:
        x *= (1.0 - vignette * np.clip(ctx._vig - 0.35, 0, 1) * 1.4)[..., None]
    np.clip(x, 0.0, 1.0, out=x)
    return x


def to_u8(img, ctx: Ctx):
    return np.clip((img + ctx.dither) * 255.0 + 0.5, 0, 255).astype(np.uint8)


def fft_shape(x, sr, hp=None, lp=None):
    n = len(x)
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, d=1.0 / sr)
    if hp:
        spec *= (f * f) / (f * f + hp * hp + 1e-9)
    if lp:
        spec *= 1.0 / (1.0 + (f / lp) ** 4)
    y = np.fft.irfft(spec, n)
    return y.astype(np.float32)


class Score:
    def __init__(self, sr=SR, seconds=SECONDS, seed=1):
        self.sr = sr
        self.n = int(round(sr * seconds))
        self.L = np.zeros(self.n, np.float32)
        self.R = np.zeros(self.n, np.float32)
        self.rng = np.random.default_rng(seed)

    def place(self, sig, t0, pan=0.0, gain=1.0):
        sig = np.asarray(sig, np.float32).reshape(-1) * np.float32(gain)
        if sig.size == 0 or gain == 0:
            return
        i0 = int(round(t0 * self.sr))
        if i0 >= self.n:
            return
        if i0 < 0:
            sig = sig[-i0:]
            i0 = 0
        i1 = min(self.n, i0 + sig.size)
        seg = sig[: i1 - i0]
        # Constant-power pan, pan in [-1, 1].
        ang = (np.clip(pan, -1, 1) + 1.0) * np.pi / 4.0
        self.L[i0:i1] += seg * np.cos(ang)
        self.R[i0:i1] += seg * np.sin(ang)

    def tone(
        self,
        freq,
        t0,
        dur,
        gain=0.2,
        pan=0.0,
        decay=2.2,
        partials=6,
        attack=0.015,
        release=0.25,
        shape="pluck",
        inharm=0.0,
        lp=None,
        phase=None,
    ):
        n = max(8, int(self.sr * dur))
        tt = np.arange(n, dtype=np.float32) / self.sr
        sig = np.zeros(n, np.float32)
        for k in range(1, partials + 1):
            f = freq * k * np.sqrt(1.0 + inharm * k * k)
            # Higher partials die first.
            dk = decay * (1.0 + 0.22 * (k - 1))
            ph = 0.0 if phase is None else phase * k
            sig += (1.0 / k**1.2) * np.sin(2 * np.pi * f * tt + ph) * np.exp(-tt * dk)
        if shape == "hold":
            a = smoothstep(0, max(attack, 1e-3), tt)
            r = smoothstep(0, max(release, 1e-3), dur - tt)
            env = a * r
        elif shape == "perc":
            env = np.exp(-tt * decay)
            env *= 1.0 - np.exp(-tt / max(attack, 1e-4))
        else:
            env = (1.0 - np.exp(-tt / max(attack, 1e-4))) * np.exp(-tt * decay)
        sig *= env.astype(np.float32)
        if lp:
            sig = fft_shape(sig, self.sr, lp=lp)
        self.place(sig, t0, pan, gain)

    def noise(self, t0, dur, gain=0.1, pan=0.0, hp=200.0, lp=4000.0, attack=0.05, release=0.2):
        n = max(8, int(self.sr * dur))
        x = self.rng.standard_normal(n).astype(np.float32)
        x = fft_shape(x, self.sr, hp=hp, lp=lp)
        tt = np.arange(n, dtype=np.float32) / self.sr
        env = smoothstep(0, max(attack, 1e-3), tt) * smoothstep(0, max(release, 1e-3), dur - tt)
        # Match a mild level before the caller's gain.
        peak = np.max(np.abs(x)) + 1e-6
        self.place(x / peak * env, t0, pan, gain)

    def kick(self, t0, gain=0.7, pan=0.0):
        dur = 0.28
        n = int(self.sr * dur)
        tt = np.arange(n, dtype=np.float32) / self.sr
        f = 48.0 + 110.0 * np.exp(-tt * 16.0)
        ph = 2 * np.pi * np.cumsum(f) / self.sr
        sig = np.sin(ph).astype(np.float32) * np.exp(-tt * 7.5)
        click = self.rng.standard_normal(n).astype(np.float32) * np.exp(-tt * 55.0)
        sig += 0.18 * click
        self.place(sig, t0, pan, gain)

    def snare(self, t0, gain=0.35, pan=0.0):
        dur = 0.18
        n = int(self.sr * dur)
        tt = np.arange(n, dtype=np.float32) / self.sr
        body = np.sin(2 * np.pi * 188.0 * tt) * np.exp(-tt * 28.0)
        noise = self.rng.standard_normal(n).astype(np.float32)
        noise = fft_shape(noise, self.sr, hp=900, lp=6500)
        noise *= np.exp(-tt * 16.0)
        peak = np.max(np.abs(noise)) + 1e-6
        sig = 0.45 * body + 0.7 * noise / peak
        self.place(sig.astype(np.float32), t0, pan, gain)

    def hat(self, t0, gain=0.12, pan=0.15, dur=0.045):
        n = int(self.sr * dur)
        tt = np.arange(n, dtype=np.float32) / self.sr
        noise = self.rng.standard_normal(n).astype(np.float32)
        noise = fft_shape(noise, self.sr, hp=5000, lp=14000)
        noise *= np.exp(-tt * 70.0)
        peak = np.max(np.abs(noise)) + 1e-6
        self.place(noise / peak, t0, pan, gain)

    def bubble(self, t0, gain=0.12, pan=0.0, f0=420.0, f1=1380.0, dur=0.16):
        n = int(self.sr * dur)
        tt = np.arange(n, dtype=np.float32) / self.sr
        f = f0 + (f1 - f0) * (tt / dur) ** 0.6
        ph = 2 * np.pi * np.cumsum(f) / self.sr
        env = (tt / 0.012) * np.exp(-tt * 14.0)
        env = np.clip(env, 0, 1) * np.exp(-tt * 6.0)
        sig = np.sin(ph).astype(np.float32) * env.astype(np.float32)
        self.place(sig, t0, pan, gain)

    def bowl(self, freq, t0, dur, gain=0.2, pan=0.0, brightness=1.0):
        n = max(8, int(self.sr * dur))
        tt = np.arange(n, dtype=np.float32) / self.sr
        partials = [1.0, 2.0, 2.76, 4.07, 5.43, 6.78]
        decays = [0.28, 0.45, 0.85, 1.25, 1.7, 2.2]
        sig = np.zeros(n, np.float32)
        for p, d in zip(partials, decays):
            sig += (1.0 / p**1.15) * np.sin(2 * np.pi * freq * p * tt) * np.exp(-tt * d * brightness)
        sig *= 1.0 - np.exp(-tt / 0.01)
        sig = fft_shape(sig, self.sr, lp=7000)
        self.place(sig, t0, pan, gain)

    def master(self, reverb=0.22, decay=2.6, rev_seconds=1.15, hp=35.0):
        L = self.L.copy()
        R = self.R.copy()
        L = fft_shape(L, self.sr, hp=hp, lp=15000)
        R = fft_shape(R, self.sr, hp=hp, lp=15000)
        if reverb > 0:
            wet_L = _reverb(L, self.sr, decay, rev_seconds, seed=3)
            wet_R = _reverb(R, self.sr, decay, rev_seconds, seed=5)
            L = L * (1.0 - reverb) + wet_L * reverb
            R = R * (1.0 - reverb) + wet_R * reverb
        # Short fades kill boundary clicks.
        fade = int(self.sr * 0.015)
        ramp = np.linspace(0, 1, fade, dtype=np.float32)
        L[:fade] *= ramp
        R[:fade] *= ramp
        L[-fade:] *= ramp[::-1]
        R[-fade:] *= ramp[::-1]
        peak = max(float(np.max(np.abs(L))), float(np.max(np.abs(R))), 1e-6)
        g = 0.9 / peak
        L *= g
        R *= g
        rms = float(np.sqrt(np.mean(0.5 * (L * L + R * R))))
        if rms < 0.05:
            extra = min(0.065 / max(rms, 1e-4), 1.8)
            L *= extra
            R *= extra
            peak = max(float(np.max(np.abs(L))), float(np.max(np.abs(R))), 1e-6)
            if peak > 0.95:
                L *= 0.95 / peak
                R *= 0.95 / peak
        np.clip(L, -0.97, 0.97, out=L)
        np.clip(R, -0.97, 0.97, out=R)
        return np.stack([L, R], axis=1)


def _reverb(x, sr, decay, seconds, seed):
    ir_n = int(sr * seconds)
    rng = np.random.default_rng(seed)
    ir = rng.standard_normal(ir_n).astype(np.float32)
    tt = np.arange(ir_n, dtype=np.float32) / sr
    ir *= np.exp(-tt * decay)
    # Early tap so the room has a body, then a darker tail.
    ir = lfilter([0.2, 0.0], [1.0, -0.65], ir).astype(np.float32)
    ir /= np.sqrt(np.sum(ir * ir) + 1e-8)
    n = len(x) + ir_n
    wet = np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(ir, n), n)[: len(x)]
    wet = wet.astype(np.float32)
    # Level-match the wet signal to the dry peak so `reverb` is a true mix.
    peak_d = float(np.max(np.abs(x))) + 1e-6
    peak_w = float(np.max(np.abs(wet))) + 1e-6
    return wet * (peak_d / peak_w)


class Piece:
    index = 0
    slug = "piece"
    title = ""
    poem = ""
    poster = 5.0
    sequential = False
    reverb = 0.24
    rev_decay = 2.5
    rev_seconds = 1.15
    hp = 36.0
    vignette = 0.18
    contrast = 1.04
    sat = 1.0
    bloom = 0.0
    bloom_thr = 0.62

    def __init__(self, ctx: Ctx):
        self.ctx = ctx
        self.rng = np.random.default_rng(10_000 + self.index * 97)
        self.prepare()

    def prepare(self):
        pass

    def frame(self, t, img):
        raise NotImplementedError

    def compose(self, score: Score):
        raise NotImplementedError

    def reset(self):
        self.prepare()
