"""Pieces 01–10. Each one is a single motif, a hand-built palette, and a 10s score."""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, zoom

from engine import (
    H,
    W,
    Piece,
    blend,
    cover,
    ease,
    fill,
    hexrgb,
    hz,
    mix_ok,
    note_hz,
    paint,
    paint_alpha,
    paper,
    sd_box,
    sd_circle,
    sd_polygon,
    smoother,
    smoothstep,
)


def _lap(z):
    return (
        0.05 * np.roll(np.roll(z, 1, 0), 1, 1)
        + 0.05 * np.roll(np.roll(z, 1, 0), -1, 1)
        + 0.05 * np.roll(np.roll(z, -1, 0), 1, 1)
        + 0.05 * np.roll(np.roll(z, -1, 0), -1, 1)
        + 0.20 * np.roll(z, 1, 0)
        + 0.20 * np.roll(z, -1, 0)
        + 0.20 * np.roll(z, 1, 1)
        + 0.20 * np.roll(z, -1, 1)
        - z
    )


class Kongshan(Piece):
    index, slug, title = 1, "kongshan", "空山"
    poem = "墨从纸的上端慢慢沉下来"
    poster = 8.2
    reverb, rev_decay, rev_seconds = 0.36, 1.8, 1.5
    hp, vignette, contrast, sat = 40, 0.14, 1.03, 0.9

    def prepare(self):
        self.sheet = paper(self.ctx, hexrgb("#efe6d4"), seed=11, fiber=0.02, blot=0.04)
        self.inks = [
            (hexrgb("#b7b6ac"), hexrgb("#8e9088")),
            (hexrgb("#8a8c84"), hexrgb("#5e615b")),
            (hexrgb("#5c5e58"), hexrgb("#3a3c38")),
            (hexrgb("#3a3834"), hexrgb("#232220")),
            (hexrgb("#2a2724"), hexrgb("#141311")),
        ]
        self.mist = hexrgb("#f6f1e6")
        self.seal = hexrgb("#c23a2e")

    def frame(self, t, img):
        ctx = self.ctx
        img[:] = self.sheet
        # A thin moon, so the empty sky has one quiet accent.
        paint(img, np.abs(sd_circle(ctx, W * 0.27, H * 0.16, 52)) - 1.5, hexrgb("#2c2a26"))
        u = np.linspace(0, 1, W, dtype=np.float32)
        ridges = []
        for i in range(5):
            drift = t * (0.006 + i * 0.002)
            h = 0.33 + i * 0.070
            h += (0.05 - i * 0.004) * np.sin((u * (1.7 + i * 0.37) + drift + i * 0.6) * np.pi * 2)
            h += (0.028 - i * 0.002) * np.sin((u * (3.6 + i * 0.55) - drift + i * 1.3) * np.pi * 2)
            h += 0.075 * np.exp(-0.5 * ((u - (0.22 + i * 0.12)) / 0.10) ** 2)
            h -= 0.04 * np.exp(-0.5 * ((u - (0.68 - i * 0.06)) / 0.07) ** 2)
            ridges.append(h * H)
        for i, (far, near) in enumerate(self.inks):
            depth = ctx.Y - ridges[i][None, :]
            wash = np.clip(depth / 260.0, 0, 1)
            col = blend(far, near, wash * 0.42)
            a = cover(-depth, 1.4)
            paint_alpha(img, a, col)
            if i < 4:
                band_y = ridges[i] + 26 + i * 8
                band = np.exp(-0.5 * ((ctx.Y - band_y[None, :]) / (78 + i * 14)) ** 2)
                paint_alpha(img, band * (0.40 - i * 0.05), self.mist)
        shore = H * 0.80
        wash = smoothstep(shore - 8, shore + 36, ctx.Y)
        paint_alpha(img, wash * 0.78, hexrgb("#e4ddd0"))
        paint_alpha(img, np.exp(-0.5 * ((ctx.Y - shore) / 16) ** 2) * 0.4, hexrgb("#5c5954"))
        for k, yy in enumerate((0.86, 0.905, 0.95)):
            line = np.exp(-0.5 * ((ctx.Y - H * yy) / 1.6) ** 2)
            line *= 0.45 + 0.55 * (0.5 + 0.5 * np.sin(ctx.X * (0.02 + k * 0.008) + t * 0.4))
            paint_alpha(img, line * 0.28, hexrgb("#3c3a36"))
        if t > 5.4:
            a = ease((t - 5.4) / 1.0)
            sx, sy = W * 0.78, H * 0.20
            paint_alpha(img, cover(sd_box(ctx, sx, sy, 40, 40), 1.2) * a, self.seal)
            paint_alpha(img, cover(sd_box(ctx, sx, sy, 27, 27), 1.2) * a, hexrgb("#f3ecdf"))
            paint_alpha(img, cover(sd_circle(ctx, sx, sy - 6, 6), 1.0) * a, self.seal)
            paint_alpha(img, cover(sd_box(ctx, sx, sy + 10, 10, 2.2), 1.0) * a, self.seal)

    def compose(self, s):
        seq = ["D4", "G4", "A4", "E4", "D4", "A3", "B3", "G4", "D4"]
        times = [0.40, 1.45, 2.55, 3.70, 4.90, 6.05, 7.15, 8.15, 9.05]
        pans = [-0.25, 0.15, -0.05, 0.30, -0.2, 0.05, -0.35, 0.2, 0.0]
        for name, t0, pan in zip(seq, times, pans):
            s.tone(hz(name), t0, 2.5, gain=0.16, pan=pan, decay=1.25, partials=7, attack=0.006, lp=3800, inharm=0.00012)
        s.tone(hz("D2"), 0.15, 9.6, gain=0.075, shape="hold", attack=1.6, release=1.3, partials=3, decay=0.35, lp=520)
        s.noise(0.0, 10.0, gain=0.035, hp=500, lp=1600, attack=1.8, release=1.6)


class Goucheng(Piece):
    index, slug, title = 2, "goucheng", "构成"
    poem = "三种形状终于对齐格子"
    poster = 8.4
    reverb, rev_decay, rev_seconds = 0.12, 3.2, 0.55
    hp, vignette, contrast, sat = 50, 0.04, 1.02, 1.04

    def frame(self, t, img):
        ctx = self.ctx
        bg = hexrgb("#f3f0e7")
        red, blue, yellow, black = hexrgb("#d62828"), hexrgb("#0d3b8e"), hexrgb("#f0c431"), hexrgb("#161616")
        fill(img, bg)
        gap = 180
        for x in range(gap, W, gap):
            paint(img, np.abs(ctx.X - x) - 0.7, black, feather=1.0)
        for y in range(gap, H, gap):
            paint(img, np.abs(ctx.Y - y) - 0.7, black, feather=1.0)
        # Knock the grid back so it is a guide, not a subject.
        img[:] = blend(bg, img, 0.10)
        u = smoother(np.clip((t - 0.15) / 7.4, 0, 1))
        # Start scattered and rotated, resolve to a poster.
        rcx = blend(-40, W * 0.31, u)
        rcy = blend(H * 0.22, H * 0.36, u)
        paint(img, sd_circle(ctx, rcx, rcy, 132), red)
        rot = blend(0.55, 0.0, u)
        scx = blend(W * 0.78, W * 0.67, u)
        scy = blend(-30, H * 0.40, u)
        paint(img, sd_box(ctx, scx, scy, 112, 112, rot=rot), blue)
        tang = blend(-0.4, 0.0, u)
        tx = blend(W * 0.20, W * 0.40, u)
        ty = blend(H + 40, H * 0.69, u)
        ca, sa = np.cos(tang), np.sin(tang)
        verts = []
        for px, py in ((0, -150), (140, 92), (-140, 92)):
            verts.append((tx + ca * px + sa * py, ty - sa * px + ca * py))
        paint(img, sd_polygon(ctx, verts), yellow)
        # The bar arrives last and locks the three shapes into one poster.
        bar = smoother(np.clip((t - 5.2) / 2.2, 0, 1))
        if bar > 0:
            yb = H * 0.52
            hw = 40 + bar * (W * 0.30)
            paint(img, sd_box(ctx, W * 0.5, yb, hw, 7), black)
        bcx = blend(W + 30, W * 0.73, u)
        bcy = blend(H * 0.80, H * 0.73, u)
        paint(img, sd_circle(ctx, bcx, bcy, 24), black)

    def compose(self, s):
        motif = ["E4", "G4", "A4", "G4", "E4", "D4", "E4", "G4", "A4", "B4", "A4", "G4", "E4", "G4", "D4", "E4"]
        step = 0.625
        for i, name in enumerate(motif):
            t0 = 0.06 + i * step
            pan = -0.2 if i % 2 == 0 else 0.22
            s.tone(hz(name), t0, 0.48, gain=0.15, pan=pan, decay=4.8, partials=5, attack=0.004, lp=2600, inharm=0.0007)
            s.tone(1400 if i % 4 else hz("C6"), t0, 0.04, gain=0.045 if i % 4 else 0.07, decay=48, partials=2, shape="perc", lp=4200)
            if i % 4 == 0:
                s.tone(hz("C3"), t0, 0.32, gain=0.11, decay=7, partials=3, lp=380, shape="pluck")


class Raodong(Piece):
    index, slug, title = 3, "raodong", "扰动"
    poem = "线条先安静，再失衡，再安静"
    poster = 5.0
    reverb, rev_decay, rev_seconds = 0.08, 3.5, 0.4
    hp, vignette, contrast, sat = 30, 0.0, 1.06, 1.0

    def frame(self, t, img):
        ctx = self.ctx
        period = 20.0
        amp_env = np.sin(np.pi * np.clip(t / 10.0, 0, 1)) ** 1.05
        cx = (0.16 + 0.68 * (t / 10.0)) * W
        bulge = np.exp(-0.5 * ((ctx.X - cx) / (W * 0.15)) ** 2)
        amp = amp_env * 42.0 * bulge
        yy = ctx.Y + amp * np.sin(ctx.X * 0.018 + t * 0.55)
        yy = yy + amp_env * 10.0 * np.sin(ctx.X * 0.007 - t * 0.35)
        s = np.sin(yy * (2 * np.pi / period))
        dy = np.abs(np.gradient(yy.astype(np.float32), axis=0))
        fw = np.clip(dy * (np.pi / period), 0.09, 1.4)
        cov = np.clip(0.5 + s / (2.4 * fw), 0, 1).astype(np.float32)
        black = hexrgb("#121212")
        ivory = hexrgb("#f4f1ea")
        img[:] = ivory * (1 - cov[..., None]) + black * cov[..., None]

    def compose(self, s):
        t = np.arange(s.n, dtype=np.float32) / s.sr
        env = np.sin(np.pi * np.clip(t / 10.0, 0, 1)) ** 1.05
        f2 = 196.0 + 0.45 + 4.2 * env
        ph2 = 2 * np.pi * np.cumsum(f2) / s.sr
        left = np.sin(2 * np.pi * 196.0 * t) * (0.5 + 0.5 * env)
        right = np.sin(ph2)
        amp = (0.16 * (0.4 + 0.6 * env) * smoothstep(0, 0.35, t)).astype(np.float32)
        s.place(left.astype(np.float32) * amp, 0.0, pan=-0.45, gain=0.85)
        s.place(right.astype(np.float32) * amp, 0.0, pan=0.45, gain=0.85)
        s.place(np.sin(2 * np.pi * 98.0 * t).astype(np.float32) * (0.05 + 0.06 * env), 0.0, 0.0, 0.7)


class Shenhai(Piece):
    index, slug, title = 4, "shenhai", "深海"
    poem = "光是活的，而且很慢"
    poster = 5.4
    reverb, rev_decay, rev_seconds = 0.4, 1.5, 1.7
    hp, vignette, contrast, sat, bloom, bloom_thr = 28, 0.42, 1.05, 1.08, 0.7, 0.4

    def prepare(self):
        rng = self.rng
        self.jellies = []
        for i in range(12):
            self.jellies.append(
                dict(
                    x=float(rng.uniform(0.16 * W, 0.84 * W)),
                    y0=float(rng.uniform(-0.15, 1.15)),
                    speed=float(rng.uniform(0.018, 0.04)),
                    scale=float(rng.choice([0.55, 0.75, 0.95, 1.25, 1.7])),
                    phase=float(rng.uniform(0, 6.28)),
                    hue=float(rng.uniform(0.15, 0.95)),
                )
            )
        n = 420
        self.px = rng.uniform(0, W, n).astype(np.float32)
        self.py = rng.uniform(0, H, n).astype(np.float32)
        self.ps = rng.uniform(10, 36, n).astype(np.float32)
        self.pb = (rng.random(n) ** 2).astype(np.float32)
        self.pp = rng.uniform(0, 6.28, n).astype(np.float32)

    def frame(self, t, img):
        ctx = self.ctx
        img[:] = mix_ok(hexrgb("#03050b"), hexrgb("#0b2236"), ctx.Yn**1.35)
        dust = np.zeros((H, W), np.float32)
        y = np.mod(self.py - t * self.ps, H)
        x = self.px + np.sin(t * 0.45 + self.pp) * 18
        xi = np.clip(np.rint(x).astype(np.int32), 0, W - 1)
        yi = np.clip(np.rint(y).astype(np.int32), 0, H - 1)
        np.add.at(dust, (yi, xi), self.pb)
        dust = gaussian_filter(dust, 1.5)
        img += dust[..., None] * hexrgb("#c8fff4") * 1.15
        for spec in self.jellies:
            cy = ((spec["y0"] - t * spec["speed"]) % 1.35 - 0.18) * H
            self._jelly(img, spec["x"], cy, spec["scale"], spec["phase"], t, spec["hue"])
        np.clip(img, 0, 1, out=img)

    def _jelly(self, img, cx, cy, scale, phase, t, hue):
        r = int(86 * scale)
        x0, x1 = int(cx) - r, int(cx) + r
        y0, y1 = int(cy) - int(r * 0.85), int(cy) + int(r * 0.55)
        xa0, ya0 = max(0, x0), max(0, y0)
        xa1, ya1 = min(W, x1), min(H, y1)
        if xa1 <= xa0 or ya1 <= ya0:
            return
        yy, xx = np.mgrid[ya0:ya1, xa0:xa1]
        nx = (xx - cx) / (72 * scale)
        ny = (yy - cy) / (64 * scale)
        dome = nx**2 + (ny + 0.02) ** 2 * 1.45
        bell = np.clip(1.15 - dome, 0, 1) * np.clip(0.58 - ny, 0, 1) * np.clip(ny + 0.92, 0, 1)
        rim = np.exp(-0.5 * ((dome - 0.78) / 0.07) ** 2) * np.clip(0.45 - ny, 0, 1)
        col = mix_ok(hexrgb("#7ddec8"), hexrgb("#e7fff8"), hue)
        a = np.clip(bell * 0.5 + rim * 0.85, 0, 1).astype(np.float32)
        sub = img[ya0:ya1, xa0:xa1]
        sub = sub * (1 - a[..., None]) + col * a[..., None]
        sub = np.clip(sub + col * (rim[..., None] * 0.35), 0, 1)
        img[ya0:ya1, xa0:xa1] = sub
        length = int((90 + 40 * scale) * scale)
        ys = np.arange(length, dtype=np.float32)
        for k in range(7):
            xoff = (k - 3) * 8.5 * scale
            xs = cx + xoff + np.sin(ys * 0.055 + phase + t * 1.3 + k) * (4 + 2.5 * scale)
            yy = np.rint(cy + 6 * scale + ys).astype(np.int32)
            xx = np.rint(xs).astype(np.int32)
            m = (xx >= 0) & (xx < W) & (yy >= 0) & (yy < H)
            if not np.any(m):
                continue
            alpha = (np.clip(1.0 - ys / length, 0, 1) * 0.45).astype(np.float32)
            img[yy[m], xx[m]] = img[yy[m], xx[m]] * (1 - alpha[m, None]) + col * alpha[m, None]

    def compose(self, s):
        s.tone(41.0, 0.0, 10.0, gain=0.2, shape="hold", attack=1.8, release=1.4, partials=2, decay=0.2, lp=110)
        s.tone(61.5, 1.2, 8.2, gain=0.06, shape="hold", attack=2.0, release=1.6, partials=2, lp=160)
        s.noise(0.0, 10.0, gain=0.04, hp=250, lp=800, attack=1.5, release=1.8)
        pans = [-0.45, 0.25, -0.1, 0.4, -0.3, 0.15, -0.5, 0.05, 0.35]
        for i, pan in enumerate(pans):
            s.bubble(0.45 + i * 1.02, gain=0.11, pan=pan, f0=480 + 40 * i, f1=1500 + 30 * i, dur=0.18)
        for name, t0, pan in (("B5", 2.3, 0.35), ("E6", 5.5, -0.25), ("G5", 8.0, 0.1)):
            s.tone(hz(name), t0, 2.4, gain=0.055, decay=1.15, partials=4, lp=5200, pan=pan)


class Jinshan(Piece):
    index, slug, title = 5, "jinshan", "金缮"
    poem = "裂开的地方变成金"
    poster = 8.2
    reverb, rev_decay, rev_seconds = 0.42, 1.35, 1.8
    hp, vignette, contrast, sat, bloom, bloom_thr = 40, 0.28, 1.04, 1.0, 0.12, 0.62

    def prepare(self):
        rng = self.rng
        self.cx, self.cy = W * 0.5, H * 0.47
        self.rx, self.ry = W * 0.36, W * 0.33
        self.cracks = []

        def branch(p0, p1, depth, jag):
            if depth == 0 or np.hypot(*(p1 - p0)) < 18:
                return [p0, p1]
            mid = (p0 + p1) * 0.5
            d = p1 - p0
            dist = np.hypot(d[0], d[1]) + 1e-6
            nrm = np.array([-d[1], d[0]]) / dist
            mid = mid + nrm * rng.normal(0, jag * dist)
            return branch(p0, mid, depth - 1, jag)[:-1] + branch(mid, p1, depth - 1, jag)

        for i in range(4):
            ang = rng.uniform(0, 2 * np.pi)
            p0 = np.array(
                [self.cx + np.cos(ang) * self.rx * 0.92, self.cy + np.sin(ang) * self.ry * 0.92],
                np.float32,
            )
            p1 = np.array(
                [self.cx + rng.normal(0, 18), self.cy + rng.normal(0, 14)],
                np.float32,
            )
            pts = np.array(branch(p0, p1, 4, 0.16), np.float32)
            self.cracks.append(pts)
            if i < 2 and len(pts) > 6:
                mid = pts[len(pts) // 3]
                ang2 = ang + rng.choice([-1.0, 1.0]) * rng.uniform(0.7, 1.2)
                q = mid + np.array([np.cos(ang2), np.sin(ang2)], np.float32) * rng.uniform(50, 110)
                self.cracks.append(np.array(branch(mid, q, 3, 0.14), np.float32))
        self.gold = hexrgb("#e4b45a")
        self.gold_hot = hexrgb("#fff0c8")

    def frame(self, t, img):
        ctx = self.ctx
        fill(img, hexrgb("#100e0c"))
        nx = (ctx.X - self.cx) / self.rx
        ny = (ctx.Y - self.cy) / self.ry
        d = np.sqrt(nx**2 + ny**2)
        sd = (d - 1.0) * self.rx
        shade = np.clip(1.0 - d, 0, 1) ** 0.65
        light = np.clip(0.35 + 0.65 * (0.55 + 0.45 * nx * 0.85 - 0.1 * ny), 0, 1)
        col = blend(hexrgb("#2a241e"), hexrgb("#6a5c50"), shade * light)
        speck = 0.97 + 0.03 * np.sin(ctx.X * 0.37 + ctx.Y * 0.21)
        paint_alpha(img, cover(sd, 1.3), col * speck[..., None])
        rim = np.exp(-0.5 * ((d - 0.985) / 0.018) ** 2) * (d < 1.05)
        paint_alpha(img, rim * 0.55, self.gold)
        u = smoother(np.clip((t - 0.35) / 7.6, 0, 1))
        mask = Image.new("L", (W, H), 0)
        dr = ImageDraw.Draw(mask)
        hot = Image.new("L", (W, H), 0)
        hdr = ImageDraw.Draw(hot)
        for pts in self.cracks:
            k = max(2, int(u * len(pts)))
            kept = []
            for p in pts[:k]:
                nx = (p[0] - self.cx) / self.rx
                ny = (p[1] - self.cy) / self.ry
                if nx * nx + ny * ny <= 0.88:
                    kept.append((float(p[0]), float(p[1])))
                elif len(kept) >= 2:
                    dr.line(kept, fill=255, width=4)
                    hdr.line(kept, fill=255, width=1)
                    kept = []
                else:
                    kept = []
            if len(kept) >= 2:
                dr.line(kept, fill=255, width=4)
                hdr.line(kept, fill=255, width=1)
        m = gaussian_filter(np.asarray(mask, np.float32) / 255.0, 0.8)
        h = gaussian_filter(np.asarray(hot, np.float32) / 255.0, 0.4)
        # Keep the gold on the plate.
        on = (d <= 0.97).astype(np.float32)
        paint_alpha(img, m * on * 0.95, self.gold)
        paint_alpha(img, h * on, self.gold_hot)
        sweep = np.exp(-0.5 * ((nx * 1.2 + ny * 0.3 - (-0.8 + 1.6 * t / 10)) / 0.18) ** 2)
        paint_alpha(img, sweep * np.clip(1 - d, 0, 1) * 0.18, hexrgb("#fffaf0"))

    def compose(self, s):
        s.tone(86, 0.12, 0.35, gain=0.22, decay=9, partials=3, lp=320, shape="perc")
        s.noise(0.12, 0.16, gain=0.16, hp=90, lp=500, attack=0.004, release=0.1)
        s.bowl(174.6, 0.45, 9.2, gain=0.24, pan=-0.08, brightness=0.8)
        s.bowl(349.2, 3.6, 6.0, gain=0.08, pan=0.25, brightness=1.15)
        s.bowl(523.2, 7.4, 2.4, gain=0.04, pan=-0.2, brightness=1.4)


class Bafang(Piece):
    index, slug, title = 6, "bafang", "八方"
    poem = "一朵星从圆心画到边"
    poster = 8.6
    reverb, rev_decay, rev_seconds = 0.46, 1.45, 1.85
    hp, vignette, contrast, sat = 45, 0.28, 1.04, 1.05

    def prepare(self):
        self.cx, self.cy = W * 0.5, H * 0.46
        R = W * 0.30
        segs = []
        segs += self._squares(self.cx, self.cy, R * 0.62)
        # Outer ring of eight small stars, drawn before the center in time
        # so the eye finishes in the middle. Stored center-last.
        outer = []
        for i in range(8):
            a = i * np.pi / 4 + np.pi / 8
            ox = self.cx + np.cos(a) * R * 1.15
            oy = self.cy + np.sin(a) * R * 1.15
            outer += self._squares(ox, oy, R * 0.20)
        ring = []
        for i in range(160):
            a0 = i / 48 * 2 * np.pi
            a1 = (i + 1) / 48 * 2 * np.pi
            ring.append(
                (
                    (self.cx + np.cos(a0) * R * 1.42, self.cy + np.sin(a0) * R * 1.42),
                    (self.cx + np.cos(a1) * R * 1.42, self.cy + np.sin(a1) * R * 1.42),
                )
            )
        self.segs = ring + outer + segs
        self.center_from = len(ring) + len(outer)
        self.bg = hexrgb("#0c1c33")
        self.incised = hexrgb("#1a3c62")
        self.gold = hexrgb("#e6c56e")
        self.jewel = hexrgb("#15756c")
        self.R = R

    @staticmethod
    def _squares(cx, cy, r):
        segs = []
        for rot in (np.pi / 4, 0.0):
            corners = []
            for i in range(4):
                a = rot + np.pi / 4 + i * np.pi / 2
                corners.append((cx + r * np.cos(a), cy + r * np.sin(a)))
            for i in range(4):
                segs.append((corners[i], corners[(i + 1) % 4]))
        return segs

    def _mask(self, segs, width):
        im = Image.new("L", (W, H), 0)
        dr = ImageDraw.Draw(im)
        for a, b in segs:
            dr.line([a, b], fill=255, width=width)
        return gaussian_filter(np.asarray(im, np.float32) / 255.0, 0.6)

    def frame(self, t, img):
        ctx = self.ctx
        fill(img, self.bg)
        faint = self._mask(self.segs, 3)
        paint_alpha(img, faint * 0.9, self.incised)
        u = smoother(np.clip((t - 0.25) / 8.0, 0, 1))
        n = max(1, int(u * len(self.segs)))
        gold = self._mask(self.segs[:n], 4)
        paint_alpha(img, gold, self.gold)
        if u > 0.78:
            a = ease((u - 0.78) / 0.22)
            paint_alpha(img, cover(sd_circle(ctx, self.cx, self.cy, self.R * 0.22), 2.0) * a, self.jewel)
            # The jewel sits under the star, so redraw only the lines already gilded.
            drawn = self.segs[self.center_from : n]
            if drawn:
                top = self._mask(drawn, 4)
                paint_alpha(img, top, self.gold)

    def compose(self, s):
        s.tone(hz("A2"), 0.0, 10, gain=0.11, shape="hold", attack=0.9, release=1.3, partials=4, decay=0.3, lp=480)
        s.tone(hz("E3"), 0.3, 9.4, gain=0.07, shape="hold", attack=1.3, release=1.4, partials=3, decay=0.35, lp=700)
        seq = ["A3", "Bb3", "C#4", "D4", "E4", "F4", "E4", "D4", "C#4", "Bb3", "A3", "E4", "A3"]
        times = [0.45, 1.1, 1.65, 2.45, 3.25, 3.7, 4.55, 5.35, 6.15, 6.95, 7.65, 8.45, 9.15]
        for i, (name, t0) in enumerate(zip(seq, times)):
            s.tone(
                hz(name),
                t0,
                1.15,
                gain=0.13,
                decay=3.4,
                partials=4,
                attack=0.004,
                lp=2300,
                inharm=0.00035,
                pan=(-0.35 if i % 2 == 0 else 0.3),
            )


class Fengji(Piece):
    index, slug, title = 7, "fengji", "风迹"
    poem = "色带沿着同一阵风"
    poster = 8.3
    reverb, rev_decay, rev_seconds = 0.34, 1.7, 1.45
    hp, vignette, contrast, sat = 40, 0.12, 1.03, 1.0

    def prepare(self):
        rng = self.rng
        palette = [
            hexrgb("#1e1a17"),
            hexrgb("#c4492c"),
            hexrgb("#e0a23a"),
            hexrgb("#f0d3bf"),
            hexrgb("#3e6f62"),
            hexrgb("#214e73"),
            hexrgb("#8c3a4b"),
            hexrgb("#ddc7ad"),
        ]
        weights = np.array([0.16, 0.13, 0.12, 0.13, 0.12, 0.11, 0.09, 0.14], np.float64)
        weights /= weights.sum()

        # Mostly downward, with a wave small enough that the ribbons reach the bottom.
        self.ribbons = []
        xs = np.linspace(120, W - 120, 16)
        for i, x0 in enumerate(xs):
            if rng.random() < 0.12:
                continue
            x, y = float(x0 + rng.uniform(-10, 10)), 86.0
            pts = []
            for _ in range(280):
                pts.append((x, y))
                a = np.pi / 2 + 0.55 * np.sin(x * 0.0036 + i * 0.35) + 0.18 * np.sin(y * 0.0025 + i)
                x += float(np.cos(a) * 7.2)
                y += float(np.sin(a) * 7.2)
                if y > H - 90 or x < 70 or x > W - 70:
                    break
            if len(pts) < 36:
                continue
            arr = np.array(pts, np.float32)
            color = palette[int(rng.choice(len(palette), p=weights))]
            width = float(rng.uniform(28, 58))
            self.ribbons.append(
                dict(
                    pts=arr,
                    color=color,
                    width=width,
                    outline=bool(rng.random() < 0.34),
                    delay=float(i % 4) * 0.18,
                )
            )
        self.bg = hexrgb("#f3ecdf")
        self.fiber = paper(self.ctx, np.array([1, 1, 1], np.float32), seed=21, fiber=0.0, blot=0.0)
        # paper() returns a color image; rebuild a soft fiber from its luminance noise via another call
        self.grain = 0.985 + 0.03 * (paper(self.ctx, hexrgb("#808080"), seed=23, fiber=0.5, blot=0.2)[..., 0] - 0.5)

    def frame(self, t, img):
        bg = tuple(int(c * 255) for c in self.bg)
        im = Image.new("RGB", (W, H), bg)
        dr = ImageDraw.Draw(im)
        ink = (32, 27, 24)
        for rib in self.ribbons:
            u = smoother(np.clip((t - rib["delay"]) / 6.6, 0, 1))
            k = max(0, int(u * len(rib["pts"])))
            if k < 2:
                continue
            pts = rib["pts"][:k]
            step = max(1, int(rib["width"] * 0.32 / 7.2))
            r = rib["width"] * 0.5
            col = tuple(int(np.clip(c, 0, 1) * 255) for c in rib["color"])
            if rib["outline"]:
                ro = r + 5
                for x, y in pts[::step]:
                    dr.ellipse((x - ro, y - ro, x + ro, y + ro), fill=ink)
            for x, y in pts[::step]:
                dr.ellipse((x - r, y - r, x + r, y + r), fill=col)
        arr = np.asarray(im, np.float32) / 255.0
        img[:] = np.clip(arr * self.grain[..., None], 0, 1)

    def compose(self, s):
        for i, name in enumerate(["D2", "F2", "A2", "C3", "E3"]):
            s.tone(
                hz(name),
                0.12 + i * 0.28,
                9.5,
                gain=0.055,
                shape="hold",
                attack=1.7,
                release=1.5,
                partials=5,
                decay=0.22,
                lp=880,
                pan=(i - 2) * 0.2,
            )
        mel = ["D4", "F4", "A4", "C5", "A4", "G4", "F4", "E4", "D4", "A4", "D4"]
        for i, name in enumerate(mel):
            s.tone(hz(name), 1.15 + i * 0.72, 1.35, gain=0.085, decay=1.7, partials=4, lp=2600, pan=0.18 if i % 2 == 0 else -0.22)


class Shengwen(Piece):
    index, slug, title = 8, "shengwen", "生纹"
    poem = "纹路从一点里长出来"
    poster = 8.8
    sequential = True
    reverb, rev_decay, rev_seconds = 0.32, 1.9, 1.3
    hp, vignette, contrast, sat = 35, 0.16, 1.04, 1.02

    def prepare(self):
        self.sh, self.sw = 384, 216
        rng = self.rng
        self.U = np.ones((self.sh, self.sw), np.float32)
        self.V = np.zeros((self.sh, self.sw), np.float32)
        yy, xx = np.mgrid[0 : self.sh, 0 : self.sw]
        disk = (yy - self.sh / 2) ** 2 + (xx - self.sw / 2) ** 2 < 16**2
        self.V[disk] = rng.random((self.sh, self.sw))[disk].astype(np.float32) * 0.4
        self.U[disk] = 0.50
        self.steps = 0
        self.t_done = 0.0

    def frame(self, t, img):
        if t + 1e-3 < self.t_done:
            self.prepare()
        target = int(max(t, 0) * 220)
        U, V = self.U, self.V
        F, K = 0.030, 0.057
        while self.steps < target:
            Lu, Lv = _lap(U), _lap(V)
            uvv = U * V * V
            U += Lu - uvv + F * (1 - U)
            V += 0.5 * Lv + uvv - (F + K) * V
            self.steps += 1
        np.clip(U, 0, 1, out=U)
        np.clip(V, 0, 1, out=V)
        self.t_done = t
        up = zoom(V, (H / self.sh, W / self.sw), order=1)
        if up.shape[0] < H or up.shape[1] < W:
            up = np.pad(up, ((0, H - up.shape[0]), (0, W - up.shape[1])), mode="edge")
        up = up[:H, :W]
        tone = np.clip(up / 0.36, 0, 1).astype(np.float32)
        c0, c1, c2 = hexrgb("#f6f0e6"), hexrgb("#e07a5f"), hexrgb("#1c3d44")
        a = np.clip(tone / 0.55, 0, 1)
        b = np.clip((tone - 0.55) / 0.45, 0, 1)
        col = blend(c0, c1, a)
        col = np.where(tone[..., None] >= 0.55, blend(c1, c2, b), col)
        img[:] = col

    def compose(self, s):
        t0, step = 0.28, 0.26
        i = 0
        while t0 < 9.5:
            pan = float(np.sin(i * 0.9))
            s.bubble(t0, gain=0.08, pan=pan, f0=160, f1=380 + 60 * pan, dur=0.24)
            root = hz("A2") if i % 3 else hz("D3")
            s.tone(root, t0, 0.45, gain=0.05, decay=6, partials=3, lp=420, shape="perc", pan=pan * 0.4)
            t0 += step
            step *= 1.04
            i += 1
        s.noise(0.0, 10, gain=0.05, hp=450, lp=1800, attack=2.0, release=2.0)
        s.tone(hz("F3"), 1.8, 7.6, gain=0.05, shape="hold", attack=2.2, release=1.8, partials=3, lp=640)


class Weimu(Piece):
    index, slug, title = 9, "weimu", "帷幕"
    poem = "夜空被拉开几道绿与品红"
    poster = 6.2
    reverb, rev_decay, rev_seconds = 0.4, 1.55, 1.7
    hp, vignette, contrast, sat, bloom, bloom_thr = 35, 0.34, 1.04, 1.1, 0.45, 0.5

    def prepare(self):
        rng = self.rng
        self.n = 160
        self.sx = rng.uniform(0, W, self.n).astype(np.float32)
        self.sy = rng.uniform(0, H * 0.92, self.n).astype(np.float32)
        self.sb = (rng.random(self.n) ** 3).astype(np.float32)
        self.sp = rng.uniform(0, 6.28, self.n).astype(np.float32)
        self.milky = gaussian_filter(rng.random((H, W)).astype(np.float32), 18)

    def frame(self, t, img):
        ctx = self.ctx
        img[:] = mix_ok(hexrgb("#03050d"), hexrgb("#12182c"), np.clip(ctx.Yn, 0, 1) ** 0.8)
        band = np.exp(-0.5 * ((ctx.X * 0.62 + ctx.Y - H * 0.22) / 170) ** 2)
        img += (band * self.milky * 0.16)[..., None] * hexrgb("#d5d8f2")
        tw = 0.55 + 0.45 * np.sin(t * 1.6 + self.sp)
        xi = self.sx.astype(np.int32)
        yi = np.clip(self.sy.astype(np.int32), 0, H - 1)
        val = np.clip(self.sb * tw, 0, 1)
        img[yi, xi] = np.maximum(img[yi, xi], (hexrgb("#f7f4ea") * val[:, None]))
        curtains = [
            (0.16, hexrgb("#3ee08a")),
            (0.34, hexrgb("#b388ff")),
            (0.50, hexrgb("#7dffe0")),
            (0.66, hexrgb("#e7a0ff")),
            (0.82, hexrgb("#8dffc4")),
        ]
        for k, (base, col) in enumerate(curtains):
            sway = 46 * np.sin(ctx.Y * 0.0036 + t * 0.28 + k * 1.2) + 16 * np.sin(ctx.Y * 0.011 - t * 0.4 + k)
            cx = base * W + sway
            width = 12 + 28 * (0.5 + 0.5 * np.sin(ctx.Y * 0.0055 + t * 0.35 + k))
            inten = np.exp(-0.5 * ((ctx.X - cx) / np.maximum(width, 8)) ** 2)
            vert = np.clip(0.45 + 0.55 * np.sin(ctx.Y * 0.009 + k * 2.0 + t * 0.25), 0, 1)
            fade = np.sin(np.clip(ctx.Yn, 0, 1) * np.pi) ** 0.7
            a = inten * vert * fade * 0.42
            img += a[..., None] * col
        np.clip(img, 0, 1, out=img)

    def compose(self, s):
        for i, name in enumerate(["G3", "B3", "D4", "G4"]):
            for det, pan in ((-0.5, -0.45), (0.0, 0.0), (0.5, 0.45)):
                s.tone(
                    hz(name) + det,
                    0.15,
                    9.6,
                    gain=0.026,
                    shape="hold",
                    attack=2.4,
                    release=1.6,
                    partials=3,
                    decay=0.12,
                    lp=1700,
                    pan=pan,
                )
        s.noise(0.0, 10, gain=0.05, hp=700, lp=2400, attack=1.6, release=2.0)


class Zhouri(Piece):
    index, slug, title = 10, "zhouri", "周日"
    poem = "河岸是一点一点亮起来的"
    poster = 8.6
    reverb, rev_decay, rev_seconds = 0.48, 1.55, 1.6
    hp, vignette, contrast, sat = 40, 0.1, 1.03, 1.04

    def prepare(self):
        ctx = self.ctx
        paint = mix_ok(hexrgb("#f8e0bf"), hexrgb("#e7a57c"), np.clip(ctx.Yn * 1.15, 0, 1))
        sun = cover(sd_circle(ctx, W * 0.30, H * 0.22, 96), 2.0)
        paint = paint * (1 - sun[..., None]) + hexrgb("#ffe6a6") * sun[..., None]
        halo = np.exp(-0.5 * (((ctx.X - W * 0.30) / 240) ** 2 + ((ctx.Y - H * 0.22) / 200) ** 2))
        paint = np.clip(paint + halo[..., None] * hexrgb("#ffd0a4") * 0.22, 0, 1)
        u = np.linspace(0, 1, W, dtype=np.float32)
        bank = H * (0.455 + 0.028 * np.sin(u * np.pi * 2.1) + 0.016 * np.sin(u * 5.5 + 0.6))
        shore = H * 0.50
        far = (ctx.Y > bank[None, :]) & (ctx.Y < shore)
        paint[far] = hexrgb("#3d4c6c")
        water = ctx.Y >= shore
        stripe = 0.5 + 0.5 * np.sin(ctx.Y * 0.075 + ctx.X * 0.012)
        wcol = blend(hexrgb("#6e90b0"), hexrgb("#d18a60"), stripe)
        depth = np.clip((ctx.Y - shore) / (H * 0.42), 0, 1)
        wcol = blend(wcol, hexrgb("#2c4460"), depth * 0.85)
        paint[water] = wcol[water]
        near = ctx.Y > H * 0.86
        bank_col = blend(hexrgb("#241e18"), hexrgb("#3a4630"), ctx.Xn)
        paint[near] = bank_col[near]
        for rx in (0.18, 0.24, 0.33, 0.71, 0.78, 0.86):
            x = W * rx
            reed = (np.abs(ctx.X - x) < 2.0) & (ctx.Y > H * 0.80) & (ctx.Y < H * 0.90)
            paint[reed] = hexrgb("#1c2418")
        hx, hy = W * 0.62, H * 0.64
        hull = ((ctx.X - hx) / 36) ** 2 + ((ctx.Y - hy) / 9) ** 2 <= 1
        paint[hull] = hexrgb("#241c16")
        mast = (np.abs(ctx.X - (hx - 4)) < 1.7) & (ctx.Y > hy - 52) & (ctx.Y < hy)
        paint[mast] = hexrgb("#241c16")
        sail = sd_polygon(ctx, [(hx - 2, hy - 8), (hx - 2, hy - 50), (hx + 30, hy - 10)])
        paint[sail < 0] = hexrgb("#2a231c")
        self.paint = np.clip(paint, 0, 1).astype(np.float32)
        gy, gx = np.gradient(self.paint.mean(axis=2))
        mag = np.sqrt(gx * gx + gy * gy)
        edge = mag > np.percentile(mag, 72)
        edge_idx = np.flatnonzero(edge)
        flat_idx = np.flatnonzero(~edge)
        edge_part = self.rng.choice(edge_idx, 240000, replace=True)
        flat_part = self.rng.choice(flat_idx, 200000, replace=True)
        self.samples = np.concatenate([edge_part, flat_part])
        self.sheet = hexrgb("#f7f2e8")

    def frame(self, t, img):
        u = smoother(np.clip(t / 9.3, 0, 1))
        n = int(12000 + u * (len(self.samples) - 12000))
        sel = self.samples[:n]
        ys = sel // W
        xs = sel % W
        img[:] = self.sheet * 0.78 + self.paint * 0.22
        cols = self.paint[ys, xs]
        # Optical mix: each dot is a little off its local color, the way Seurat's touches are.
        jitter = 0.93 + 0.14 * ((sel % 7) / 6.0)
        cols = np.clip(cols * jitter[:, None], 0, 1)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                yy = np.clip(ys + dy, 0, H - 1)
                xx = np.clip(xs + dx, 0, W - 1)
                img[yy, xx] = cols

    def compose(self, s):
        chords = [
            (0.2, ["D4", "F#4", "A4", "C#5", "E5"]),
            (3.45, ["Bb3", "D4", "F4", "A4", "C5"]),
            (6.65, ["G3", "B3", "D4", "F#4", "A4"]),
        ]
        for t0, names in chords:
            for i, name in enumerate(names):
                s.tone(
                    hz(name),
                    t0 + i * 0.04,
                    3.3,
                    gain=0.062,
                    decay=0.85,
                    partials=6,
                    inharm=0.00032,
                    lp=3400,
                    attack=0.006,
                    pan=(i - 2) * 0.16,
                )
        spark = ["A6", "G6", "E6", "D6", "B5", "A5", "D6", "E6", "G6", "A6"]
        for i, name in enumerate(spark):
            s.tone(hz(name), 0.9 + i * 0.85, 1.25, gain=0.03, decay=2.5, partials=3, lp=4800, pan=float(np.sin(i)) * 0.45)


PIECES = [Kongshan, Goucheng, Raodong, Shenhai, Jinshan, Bafang, Fengji, Shengwen, Weimu, Zhouri]
