"""Pieces 11–20."""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter, map_coordinates

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
    paint,
    paint_alpha,
    paper,
    sd_box,
    sd_capsule,
    sd_circle,
    sd_polygon,
    smoother,
    smoothstep,
)

FONT = "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"


def _end(x, y, ang, length):
    return (x + np.cos(ang) * length, y + np.sin(ang) * length)


class Xuansi(Piece):
    index, slug, title = 11, "xuansi", "悬丝"
    poem = "颜色挂在线上，轻轻摆"
    poster = 2.4
    reverb, rev_decay, rev_seconds = 0.28, 2.0, 0.9
    hp, vignette, contrast, sat = 50, 0.05, 1.02, 1.03

    def frame(self, t, img):
        ctx = self.ctx
        fill(img, hexrgb("#f6f5f1"))
        a1 = 0.20 * np.sin(2 * np.pi * t / 3.5)
        a2 = 0.46 * np.sin(2 * np.pi * t / 2.15 + 0.7)
        a3 = 0.40 * np.sin(2 * np.pi * t / 1.65 + 0.3)
        top = (W * 0.50, 36.0)
        joint = _end(*top, np.pi / 2, 520)
        left = _end(*joint, np.pi + a1, 300)
        right = _end(*joint, a1, 220)
        drop = _end(*joint, np.pi + a1, 160)
        black = _end(*drop, np.pi / 2 + a3, 130)
        mid = _end(*right, np.pi / 2, 96)
        blue = _end(*mid, np.pi + a2, 160)
        yellow = _end(*mid, a2, 128)
        red, blue_c, yellow_c, black_c = hexrgb("#e23b2f"), hexrgb("#1f4e9c"), hexrgb("#f0c230"), hexrgb("#171717")
        wires = [(top, joint), (joint, left), (joint, right), (drop, black), (right, mid), (mid, blue), (mid, yellow)]
        discs = [(left, 72, red), (black, 22, black_c), (blue, 50, blue_c), (yellow, 36, yellow_c)]
        ox, oy = 16, 20
        for (a, b) in wires:
            paint(img, sd_capsule(ctx, a[0] + ox, a[1] + oy, b[0] + ox, b[1] + oy, 8), hexrgb("#000000"), feather=7)
        for (p, r, _c) in discs:
            paint(img, sd_circle(ctx, p[0] + ox, p[1] + oy, r), hexrgb("#000000"), feather=10)
        # Shadows are the soft black shapes just drawn; knock them down to a stain.
        img[:] = blend(hexrgb("#f6f5f1"), img, 0.07)
        for (a, b) in wires:
            paint(img, sd_capsule(ctx, a[0], a[1], b[0], b[1], 2.3), black_c, feather=1.2)
        for (p, r, c) in discs:
            paint(img, sd_circle(ctx, p[0], p[1], r), c, feather=1.2)
        # A tiny white hole in the red disc, like the wire passing through.
        paint(img, sd_circle(ctx, left[0], left[1], 5), hexrgb("#f6f5f1"))

    def compose(self, s):
        motif = ["C5", "D5", "E5", "G5", "E5", "D5", "A4", "C5", "G4", "C5"]
        for i, name in enumerate(motif):
            s.tone(hz(name), 0.35 + i * 0.92, 0.7, gain=0.16, decay=6.5, partials=6, attack=0.004, lp=3200, pan=0.2 if i % 2 else -0.15)
            s.noise(0.35 + i * 0.92, 0.03, gain=0.04, hp=1200, lp=5000, attack=0.002, release=0.02, pan=0.1)


class Qinghua(Piece):
    index, slug, title = 12, "qinghua", "青花"
    poem = "蓝从瓶口流到瓶足"
    poster = 8.4
    reverb, rev_decay, rev_seconds = 0.4, 1.6, 1.5
    hp, vignette, contrast, sat = 50, 0.12, 1.03, 0.98

    def prepare(self):
        self.cx = W * 0.5
        self.y0, self.y1 = H * 0.10, H * 0.90
        self.us = np.array([0.00, 0.035, 0.07, 0.15, 0.26, 0.46, 0.68, 0.84, 0.93, 1.00], np.float32)
        self.rs = np.array([0.34, 0.48, 0.22, 0.18, 0.40, 0.80, 0.66, 0.30, 0.38, 0.30], np.float32)
        self.cobalt = hexrgb("#1a3d86")
        self.cobalt_deep = hexrgb("#122a62")
        self.body = hexrgb("#f7f5f2")
        self.ground = paper(self.ctx, hexrgb("#ddd6cc"), seed=12, fiber=0.015, blot=0.03)

    def _radius(self, u):
        lip = 0.42 * np.exp(-0.5 * (u / 0.045) ** 2)
        neck = 0.17 + 0.05 * smoothstep(0.06, 0.18, u)
        belly = 0.76 * np.exp(-0.5 * ((u - 0.46) / 0.19) ** 2)
        lower = 0.36 + 0.16 * (1.0 - smoothstep(0.64, 0.88, u))
        foot = 0.42 * np.exp(-0.5 * ((u - 0.955) / 0.028) ** 2)
        profile = np.maximum(np.maximum(neck, belly), lower)
        profile = np.maximum(profile, lip)
        profile = np.maximum(profile, foot * (u > 0.90))
        return profile * (W * 0.38)

    def frame(self, t, img):
        ctx = self.ctx
        img[:] = self.ground
        u = np.clip((ctx.Y - self.y0) / (self.y1 - self.y0), 0, 1)
        r = self._radius(u)
        span = (ctx.Y >= self.y0) & (ctx.Y <= self.y1)
        dist = np.abs(ctx.X - self.cx)
        sd = dist - r
        # Ground shadow, then the white body.
        belly_y = self.y0 + 0.58 * (self.y1 - self.y0)
        shadow = np.exp(-0.5 * (((ctx.X - self.cx - 18) / 150) ** 2 + ((ctx.Y - (self.y1 - 8)) / 16) ** 2))
        paint_alpha(img, shadow * 0.28, hexrgb("#b3aa9e"))
        shade = np.clip((self.cx + r * 0.35 - ctx.X) / (r * 1.4 + 1), 0, 1)
        body = blend(hexrgb("#fbfaf7"), hexrgb("#e7eef5"), (1 - shade) * 0.35)
        paint_alpha(img, cover(np.where(span, sd, 40), 1.3), body)
        edge = np.clip(1.4 - np.abs(sd), 0, 1) * span
        paint_alpha(img, edge * 0.85, hexrgb("#8ea0b8"))
        progress = smoother(np.clip((t - 0.2) / 8.2, 0, 1))
        shown = (1.0 - smoothstep(progress - 0.01, progress + 0.025, u)) * span
        ink = np.zeros((H, W), np.float32)
        # Lip: two rings.
        for uu in (0.045, 0.062):
            ink += np.exp(-0.5 * ((u - uu) / 0.004) ** 2)
        # Shoulder waves, sitting where the belly begins.
        ink += self._waves(ctx, self.y0 + 0.30 * (self.y1 - self.y0), self.y0 + 0.40 * (self.y1 - self.y0))
        # Belly peony, line only.
        ink += self._ellipse_ring(ctx, self.cx, belly_y, 34, 30, 0)
        ink += self._ellipse_ring(ctx, self.cx, belly_y, 62, 54, 0)
        for i in range(6):
            a = i * np.pi / 3
            ink += self._ellipse_ring(ctx, self.cx + np.cos(a) * 86, belly_y + np.sin(a) * 48, 20, 16, a)
        # Foot rings and a row of small circles.
        for uu in (0.90, 0.95):
            ink += np.exp(-0.5 * ((u - uu) / 0.0035) ** 2) * 0.9
        foot_y = self.y0 + 0.925 * (self.y1 - self.y0)
        spacing = 24
        mod = np.abs(np.mod(ctx.X - self.cx + spacing * 0.5, spacing) - spacing * 0.5)
        ring = np.exp(-0.5 * ((np.sqrt(mod**2 + (ctx.Y - foot_y) ** 2) - 7) / 1.3) ** 2)
        ink += ring * ((u > 0.90) & (u < 0.96))
        ink = np.clip(ink, 0, 1) * (sd < 0) * shown
        paint_alpha(img, ink * 0.95, self.cobalt)

    def compose(self, s):
        s.bowl(587.3, 0.55, 5.2, gain=0.13, brightness=1.15)
        s.bowl(880.0, 4.4, 4.6, gain=0.07, brightness=1.3, pan=0.22)
        for t0, pan in ((1.15, -0.3), (2.7, 0.25), (5.5, -0.15), (7.3, 0.35)):
            s.bubble(t0, gain=0.09, pan=pan, f0=860, f1=1480, dur=0.15)
        for i, name in enumerate(["D5", "E5", "G5", "A5", "D5", "B4", "A4"]):
            s.tone(hz(name), 0.7 + i * 1.2, 1.4, gain=0.055, decay=1.7, partials=3, lp=3200, pan=0.12 if i % 2 == 0 else -0.18)

    @staticmethod
    def _ellipse_ring(ctx, cx, cy, rx, ry, ang):
        dx, dy = ctx.X - cx, ctx.Y - cy
        ca, sa = np.cos(ang), np.sin(ang)
        xr, yr = ca * dx + sa * dy, -sa * dx + ca * dy
        v = np.sqrt((xr / rx) ** 2 + (yr / ry) ** 2)
        width = 2.6 / min(rx, ry)
        return np.clip(1.0 - np.abs(v - 1.0) / width, 0, 1)

    def _waves(self, ctx, y_top, y_bot):
        radius = 30.0
        row_h = radius * 0.72
        row = np.floor((ctx.Y - y_top) / row_h)
        y_center = y_top + row * row_h + radius * 0.2
        spacing = radius * 1.05
        x_off = np.where(np.mod(row, 2) == 0, 0.0, spacing * 0.5)
        local = np.mod(ctx.X - self.cx - x_off + spacing * 40, spacing)
        dx = local - spacing * 0.5
        d = np.sqrt(dx**2 + (ctx.Y - y_center) ** 2)
        line = np.clip(1.7 - np.abs(d - radius * 0.86), 0, 1)
        band = (ctx.Y >= y_top) & (ctx.Y <= y_bot) & (ctx.Y <= y_center) & (d < radius)
        return line * band


class Moli(Piece):
    index, slug, title = 13, "moli", "墨流"
    poem = "每一圈都还记得那一滴"
    poster = 7.4
    reverb, rev_decay, rev_seconds = 0.38, 1.7, 1.4
    hp, vignette, contrast, sat = 45, 0.08, 1.02, 0.95

    def prepare(self):
        rng = self.rng
        times = [0.15, 1.15, 2.3, 3.55, 4.9, 6.3, 7.7]
        colors = ["#1a1a1a", "#1c365c", "#1a1a1a", "#c4452e", "#1a1a1a", "#243e68", "#141414"]
        self.drops = []
        for i, (t0, col) in enumerate(zip(times, colors)):
            self.drops.append(
                dict(
                    t0=t0,
                    x=float(W * (0.32 + 0.06 * i) + rng.uniform(-30, 50)),
                    y=float(H * (0.30 + 0.055 * i) + rng.uniform(-24, 24)),
                    speed=78 + 10 * (i % 3),
                    rings=5,
                    gap=18,
                    color=hexrgb(col),
                )
            )
        self.sheet = paper(self.ctx, hexrgb("#f6f2ea"), seed=13, fiber=0.02, blot=0.025)

    def frame(self, t, img):
        # Rings are drawn on a half-resolution sheet. The softness suits ink on water,
        # and the warp stays cheap enough to animate.
        hs, ws = H // 2, W // 2
        ys = np.linspace(0, H - 1, hs, dtype=np.float32)
        xs = np.linspace(0, W - 1, ws, dtype=np.float32)
        Y, X = np.meshgrid(ys, xs, indexing="ij")
        field = self.sheet[::2, ::2, :].copy()
        for drop in self.drops:
            if t < drop["t0"]:
                continue
            age = t - drop["t0"]
            radius = 8 + age * drop["speed"]
            dist = np.sqrt((X - drop["x"]) ** 2 + (Y - drop["y"]) ** 2)
            for k in range(drop["rings"]):
                rr = radius - k * drop["gap"]
                if rr < 4:
                    continue
                band = np.exp(-0.5 * ((dist - rr) / 2.4) ** 2)
                paint_alpha(field, np.clip(band, 0, 1) * 0.9, drop["color"])
        amp = 18 + 10 * np.sin(t * 0.35)
        dx = amp * np.sin(Y * 0.011 + t * 0.42) + 6 * np.sin(Y * 0.033 - t * 0.25)
        dy = 9 * np.sin(X * 0.009 + t * 0.3) + 4 * np.sin(X * 0.02)
        coords = np.stack([np.clip((Y + dy) / (H - 1) * (hs - 1), 0, hs - 1), np.clip((X + dx) / (W - 1) * (ws - 1), 0, ws - 1)])
        small = np.empty_like(field)
        for c in range(3):
            small[..., c] = map_coordinates(field[..., c], coords, order=1, mode="reflect")
        up = np.repeat(np.repeat(small, 2, axis=0), 2, axis=1)
        img[:] = up[:H, :W]

    def compose(self, s):
        for drop in self.drops:
            pan = (drop["x"] / W - 0.5) * 1.2
            s.bubble(drop["t0"], gain=0.14, pan=float(np.clip(pan, -0.6, 0.6)), f0=700, f1=260, dur=0.22)
            s.noise(drop["t0"], 0.18, gain=0.04, hp=300, lp=1800, attack=0.005, release=0.12, pan=float(pan))
        s.bowl(528, 1.0, 8.6, gain=0.07, brightness=1.05)
        s.tone(hz("A4"), 2.4, 6.5, gain=0.04, shape="hold", attack=1.5, release=2.0, partials=2, lp=1800)


class Mengfeisi(Piece):
    index, slug, title = 14, "mengfeisi", "孟菲斯"
    poem = "硬边、圆点、一块水磨石"
    poster = 4.8
    reverb, rev_decay, rev_seconds = 0.16, 2.6, 0.6
    hp, vignette, contrast, sat = 42, 0.0, 1.04, 1.06

    def prepare(self):
        rng = self.rng
        self.chips = []
        for _ in range(46):
            self.chips.append(
                (
                    float(rng.uniform(40, W - 40)),
                    float(rng.uniform(40, H - 40)),
                    float(rng.uniform(5, 16)),
                    float(rng.uniform(4, 14)),
                    float(rng.uniform(-0.6, 0.6)),
                    hexrgb(rng.choice(["#1c1c1c", "#e24b78", "#19a8b8", "#f0c14e", "#2f6f62"])),
                )
            )

    def frame(self, t, img):
        ctx = self.ctx
        bg = hexrgb("#efe6d4")
        fill(img, bg)
        for x, y, hw, hh, rot, col in self.chips:
            paint(img, sd_box(ctx, x, y, hw, hh, rot), col, feather=1.0)
        # Shapes breathe in place. The poster stays a poster.
        bob = np.sin(t * 1.6)
        pink, teal, yellow, black = hexrgb("#e4377a"), hexrgb("#14a3b5"), hexrgb("#f2c84a"), hexrgb("#1a1a1a")
        self._outlined(img, sd_circle(ctx, W * 0.33, H * 0.34 + bob * 10, 168), pink, black)
        # Striped rectangle.
        ang = 0.08 * np.sin(t * 1.1)
        cx, cy = W * 0.70, H * 0.30 - bob * 8
        sd = sd_box(ctx, cx, cy, 120, 90, ang)
        self._outlined(img, sd, yellow, black)
        # Black bars inside the yellow field.
        dx, dy = ctx.X - cx, ctx.Y - cy
        ca, sa = np.cos(ang), np.sin(ang)
        xr, yr = ca * dx + sa * dy, -sa * dx + ca * dy
        bars = (np.abs(np.mod(yr + 90, 28) - 14) < 4) & (sd < -8)
        paint_alpha(img, bars.astype(np.float32), black)
        self._outlined(img, sd_circle(ctx, W * 0.62, H * 0.62 + bob * 12, 70), teal, black)
        # Squiggle.
        sx = W * 0.28
        sy = H * 0.72
        phase = t * 1.4
        curve = sy + 36 * np.sin((ctx.X - sx) * 0.045 + phase)
        tube = np.abs(ctx.Y - curve) - 16
        tube = np.where((ctx.X > sx) & (ctx.X < sx + 280), tube, 80)
        self._outlined(img, tube, hexrgb("#f25a3c"), black)
        # A small triangle, the period at the end of the sentence.
        verts = [(W * 0.78, H * 0.74), (W * 0.90, H * 0.74), (W * 0.84, H * 0.62 + bob * 8)]
        self._outlined(img, sd_polygon(ctx, verts), hexrgb("#1a1a1a"), black)

    def _outlined(self, img, sd, fill_c, line_c):
        paint(img, sd, fill_c, feather=1.15)
        edge = np.clip(1.0 - np.abs(sd) / 5.0, 0, 1) * (np.abs(sd) < 5)
        # Outline sits on the boundary, biased outward so the fill stays flat.
        outer = np.clip(1.0 - np.abs(sd - 3.0) / 3.2, 0, 1)
        paint_alpha(img, outer * (sd > -1), line_c)

    def compose(self, s):
        step = 0.625  # 96 bpm, four bars
        roots = ["C2", "C2", "G2", "A2"] * 4
        for i in range(16):
            t0 = i * step
            if i % 2 == 0:
                s.kick(t0, gain=0.62)
            if i % 2 == 1:
                s.snare(t0, gain=0.28, pan=0.05)
            s.hat(t0, gain=0.07, pan=0.25)
            s.hat(t0 + step * 0.5, gain=0.04, pan=-0.2)
            s.tone(hz(roots[i]), t0, step * 0.9, gain=0.16, decay=3.2, partials=4, lp=220, shape="pluck", attack=0.005)
        for i, name in enumerate(["E4", "G4", "A4", "G4", "E4", "D4", "E4", "C4"]):
            s.tone(hz(name), 0.1 + i * 1.25, 0.4, gain=0.07, decay=6, partials=4, lp=1800, pan=0.15)


class Feitian(Piece):
    index, slug, title = 15, "feitian", "飞天"
    poem = "石青和石绿从壁上飘过去"
    poster = 6.4
    reverb, rev_decay, rev_seconds = 0.44, 1.4, 1.8
    hp, vignette, contrast, sat = 40, 0.22, 1.04, 1.06

    def prepare(self):
        self.wall = paper(self.ctx, hexrgb("#b18458"), seed=15, fiber=0.03, blot=0.06)
        self.wall = blend(self.wall, hexrgb("#8d623c"), 0.18)

    def frame(self, t, img):
        ctx = self.ctx
        img[:] = self.wall
        shade = 0.78 + 0.22 * np.clip(1.05 - np.sqrt(((ctx.Xn - 0.5) / 0.75) ** 2 + ((ctx.Yn - 0.4) / 0.62) ** 2), 0, 1)
        img *= shade[..., None]
        cx, cy = W * 0.50, H * 0.36
        d = np.sqrt((ctx.X - cx) ** 2 + (ctx.Y - cy) ** 2)
        # Flat mineral rings. No airbrushed glow.
        for outer, inner, col in (
            (268, 246, "#1f4e89"),
            (246, 232, "#e3b341"),
            (232, 206, "#c6452f"),
            (206, 194, "#e3b341"),
            (194, 156, "#2e8f62"),
            (156, 142, "#f3e6cf"),
            (96, 0, "#e3b341"),
        ):
            ring = ((d <= outer) & (d >= inner)).astype(np.float32)
            paint_alpha(img, ring, hexrgb(col))
        ribbons = [
            (H * 0.28, 78, 0.0038, 0.2, 30, "#1f4e89", "#3d7eb8"),
            (H * 0.46, 96, 0.0031, 1.5, 38, "#2e8f62", "#7dba6a"),
            (H * 0.60, 70, 0.0044, 2.4, 26, "#c6452f", "#e08a3c"),
            (H * 0.74, 84, 0.0028, 0.7, 32, "#c9843a", "#f3e6cf"),
        ]
        for y0, amp, k, phase, width, ca, cb in ribbons:
            cy_line = y0 + amp * np.sin(k * ctx.X + phase + t * 0.42) + 22 * np.sin(k * 2.4 * ctx.X + phase)
            half = width * (0.82 + 0.18 * np.sin(ctx.X * 0.007 + phase))
            dist = np.abs(ctx.Y - cy_line)
            cov = smoothstep(half, half - 2.4, dist)
            taper = smoothstep(0.0, 0.06, ctx.Xn) * smoothstep(1.0, 0.94, ctx.Xn)
            paint_alpha(img, cov * taper, blend(hexrgb(ca), hexrgb(cb), ctx.Xn))
            edge = (dist > half - 3.2) & (dist < half + 0.8)
            paint_alpha(img, edge.astype(np.float32) * taper * 0.95, hexrgb("#e8c56a"))

    def compose(self, s):
        # Tanpura: root and fifth, re-plucked so the drone never drops out.
        for t0 in np.arange(0.1, 9.6, 0.85):
            s.tone(hz("C3"), t0, 2.4, gain=0.07, decay=0.7, partials=6, lp=900, shape="pluck")
            s.tone(hz("G3"), t0 + 0.18, 2.2, gain=0.05, decay=0.8, partials=5, lp=1100, pan=0.2)
        s.bowl(220, 0.55, 6.5, gain=0.16, brightness=0.7)
        s.bowl(220, 6.3, 3.5, gain=0.12, brightness=0.75, pan=0.15)
        phrase = ["C5", "D5", "F5", "G5", "A5", "G5", "F5", "D5", "C5"]
        for i, name in enumerate(phrase):
            t0 = 2.0 + i * 0.62
            s.tone(hz(name), t0, 0.7, gain=0.07, shape="hold", attack=0.09, release=0.22, partials=2, lp=2800, pan=0.1)
            s.noise(t0, 0.5, gain=0.02, hp=900, lp=2800, attack=0.08, release=0.2, pan=0.1)


class Seyu(Piece):
    index, slug, title = 16, "seyu", "色域"
    poem = "两种颜色互相看着"
    poster = 1.8
    reverb, rev_decay, rev_seconds = 0.36, 1.5, 1.9
    hp, vignette, contrast, sat = 55, 0.0, 1.0, 1.0

    def prepare(self):
        rng = np.random.default_rng(16)
        stain = gaussian_filter(rng.random((H, W)).astype(np.float32), 36)
        fine = gaussian_filter(rng.random((H, W)).astype(np.float32), 3.0)
        self.stain = (stain - 0.5) * 0.14 + (fine - 0.5) * 0.03

    def frame(self, t, img):
        ctx = self.ctx
        # Two Rothko fields. The boundary breathes; the hues crossfade once.
        u = smoother(np.clip((t - 3.6) / 2.8, 0, 1))
        top_a, top_b = hexrgb("#e07040"), hexrgb("#f0d3b4")
        bot_a, bot_b = hexrgb("#6e2430"), hexrgb("#243e6e")
        top = mix_ok(top_a, top_b, u)
        bot = mix_ok(bot_a, bot_b, u)
        split = H * (0.44 + 0.008 * np.sin(t * 0.6))
        feather = 78.0
        m = smoothstep(split - feather, split + feather, ctx.Y + 14 * np.sin(ctx.X * 0.0035 + t * 0.25))
        col = blend(top, bot, m)
        # Stain lives in luminance so the fields feel brushed.
        col = np.clip(col * (1.0 + self.stain[..., None]), 0, 1)
        img[:] = col

    def compose(self, s):
        t = np.arange(s.n, dtype=np.float32) / s.sr
        u = smoother(np.clip((t - 3.6) / 2.8, 0, 1))
        # Just intonation: major, then minor, on the same root.
        major = [220.0, 275.0, 330.0, 440.0]
        minor = [220.0, 264.0, 330.0, 440.0]
        breath = 0.85 + 0.15 * np.sin(2 * np.pi * t / 10.0)
        for i, (fm, fn) in enumerate(zip(major, minor)):
            # Crossfade by rendering both and weighting. Continuous phase per oscillator.
            sig_m = np.sin(2 * np.pi * fm * t)
            sig_n = np.sin(2 * np.pi * fn * t)
            sig = sig_m * (1 - u) + sig_n * u
            env = smoothstep(0, 1.6, t) * smoothstep(0, 1.4, 10 - t) * breath
            gain = 0.07 if i else 0.09
            s.place((sig * env).astype(np.float32), 0.0, pan=(i - 1.5) * 0.25, gain=gain)


class Juan(Piece):
    index, slug, title = 17, "juan", "绢"
    poem = "光在褶皱里走路"
    poster = 4.5
    reverb, rev_decay, rev_seconds = 0.3, 1.9, 1.2
    hp, vignette, contrast, sat = 50, 0.2, 1.04, 1.02

    def frame(self, t, img):
        ctx = self.ctx
        x, y = ctx.X, ctx.Y
        yn = ctx.Yn
        pleat = np.sin(x * 0.016 + 0.55 * np.sin(y * 0.0035 + t * 0.55) + t * 0.35)
        z = (16.0 + 34.0 * yn) * pleat + 7.0 * np.sin(x * 0.045 - t * 1.1 + y * 0.008)
        dzdx = np.gradient(z, axis=1)
        dzdy = np.gradient(z, axis=0)
        nlen = np.sqrt(dzdx**2 + dzdy**2 + 1.0)
        nx, ny, nz = -dzdx / nlen, -dzdy / nlen, 1.0 / nlen
        lx, ly, lz = -0.35, -0.55, 0.75
        ndotl = np.clip(nx * lx + ny * ly + nz * lz, 0, 1)
        hx, hy, hz = lx, ly, lz + 1
        hlen = np.sqrt(hx * hx + hy * hy + hz * hz)
        spec = np.clip(nx * hx / hlen + ny * hy / hlen + nz * hz / hlen, 0, 1) ** 24
        shadow, mid, light = hexrgb("#6a403f"), hexrgb("#f0cfc6"), hexrgb("#fff8f3")
        lit = np.clip(ndotl ** 0.85, 0, 1)
        col = blend(shadow, mid, np.clip(lit * 1.15, 0, 1))
        col = blend(col, light, np.clip(spec * 1.3, 0, 1))
        col = blend(col, hexrgb("#d9efe6"), np.clip(spec * (0.35 + 0.4 * nx), 0, 0.28))
        gather = np.clip(1.0 - yn * 4.5, 0, 1)
        col = blend(col, hexrgb("#6e4a48"), gather * 0.55)
        img[:] = col

    def compose(self, s):
        for k, g in enumerate((0.05, 0.04, 0.03, 0.02, 0.015, 0.01)):
            s.tone(hz("C5") * (k + 1), 0.2, 9.5, gain=g, shape="hold", attack=1.8, release=1.6, partials=1, lp=6000, pan=(k - 2.5) * 0.12)
        s.noise(0.0, 10, gain=0.045, hp=1800, lp=7000, attack=0.8, release=1.2)
        # The rustle swells twice, with the light.
        s.noise(1.5, 2.2, gain=0.03, hp=2000, lp=6000, attack=0.6, release=0.8, pan=-0.3)
        s.noise(5.8, 2.4, gain=0.03, hp=2000, lp=6000, attack=0.6, release=0.8, pan=0.3)


class Raoji(Piece):
    index, slug, title = 18, "raoji", "绕极"
    poem = "所有的星绕着同一点"
    poster = 8.5
    sequential = True
    reverb, rev_decay, rev_seconds = 0.42, 1.4, 1.9
    hp, vignette, contrast, sat, bloom, bloom_thr = 30, 0.25, 1.05, 1.02, 0.35, 0.55

    def prepare(self):
        rng = self.rng
        self.n = 210
        self.r = (rng.random(self.n) ** 0.55) * (W * 0.92)
        self.a0 = rng.random(self.n) * 2 * np.pi
        mag = rng.random(self.n)
        self.bright = np.where(mag > 0.88, 1.0, np.where(mag > 0.45, 0.28, 0.07)).astype(np.float32)
        warm = rng.random(self.n).astype(np.float32)
        self.col = hexrgb("#ffe1b5") * warm[:, None] + hexrgb("#d5e2ff") * (1 - warm[:, None])
        self.polex, self.poley = W * 0.64, H * 0.33
        self.omega = np.deg2rad(62.0) / 10.0
        u = np.linspace(0, 1, W, dtype=np.float32)
        ridge = H * (0.74 + 0.035 * np.sin(u * np.pi * 2.0) + 0.045 * np.sin(u * np.pi * 3.1 + 0.5))
        ridge -= H * 0.09 * np.exp(-0.5 * ((u - 0.22) / 0.07) ** 2)
        ridge -= H * 0.045 * np.exp(-0.5 * ((u - 0.62) / 0.1) ** 2)
        self.ridge = ridge.astype(np.float32)
        self.acc = np.zeros((H, W, 3), np.float32)
        self.t_done = -0.85

    def frame(self, t, img):
        ctx = self.ctx
        if t + 1e-3 < self.t_done:
            self.prepare()
        dt = 1.0 / 30.0
        while self.t_done < t - 1e-4:
            self.t_done += dt
            ang = self.a0 + self.omega * self.t_done
            x = self.polex + self.r * np.cos(ang)
            y = self.poley + self.r * np.sin(ang)
            xi = np.rint(x).astype(np.int32)
            yi = np.rint(y).astype(np.int32)
            m = (xi >= 1) & (xi < W - 1) & (yi >= 1) & (yi < H - 1)
            m &= yi < self.ridge[np.clip(xi, 0, W - 1)]
            w = self.bright * 1.05
            for c in range(3):
                np.add.at(self.acc[..., c], (yi[m], xi[m]), self.col[m, c] * w[m])
        sky = mix_ok(hexrgb("#05060e"), hexrgb("#1a1d2c"), np.clip(ctx.Yn, 0, 1) ** 0.9)
        above = self.ridge[None, :] - ctx.Y
        air = np.exp(-0.5 * (above / 26) ** 2) * (above > 0)
        sky = np.clip(sky + air[..., None] * hexrgb("#1c4034") * 0.38, 0, 1)
        trails = self.acc / (1.0 + self.acc)
        show = ctx.Y < self.ridge[None, :]
        img[:] = sky
        img[show] = np.clip(sky[show] + trails[show] * 1.15, 0, 1)
        # Star heads, so the trails have a source.
        ang = self.a0 + self.omega * t
        x = self.polex + self.r * np.cos(ang)
        y = self.poley + self.r * np.sin(ang)
        xi = np.rint(x).astype(np.int32)
        yi = np.rint(y).astype(np.int32)
        m = (xi >= 1) & (xi < W - 1) & (yi >= 1) & (yi < H - 1)
        m &= yi < self.ridge[np.clip(xi, 0, W - 1)]
        heads = np.clip(self.col * np.clip(self.bright * 1.45, 0, 1)[:, None], 0, 1)
        img[yi[m], xi[m]] = np.maximum(img[yi[m], xi[m]], heads[m])
        bright = m & (self.bright > 0.9)
        img[yi[bright], np.clip(xi[bright] + 1, 0, W - 1)] = np.maximum(
            img[yi[bright], np.clip(xi[bright] + 1, 0, W - 1)], heads[bright] * 0.7
        )
        ground = ctx.Y >= self.ridge[None, :]
        img[ground] = hexrgb("#07080c")
        rim = (np.abs(ctx.Y - self.ridge[None, :]) < 1.6) & (ctx.Y < self.ridge[None, :] + 2)
        paint_alpha(img, rim.astype(np.float32) * 0.8, hexrgb("#3a3128"))

    def compose(self, s):
        s.tone(55.0, 0.2, 9.6, gain=0.12, shape="hold", attack=2.0, release=1.6, partials=3, decay=0.25, lp=180)
        s.tone(82.5, 0.8, 8.8, gain=0.06, shape="hold", attack=2.4, release=1.6, partials=2, lp=240, pan=0.25)
        s.tone(56.4, 0.2, 9.6, gain=0.05, shape="hold", attack=2.0, release=1.6, partials=2, lp=180, pan=-0.35)
        for t0, freq in ((2.2, 1568.0), (5.15, 2093.0), (8.05, 1760.0)):
            s.bowl(freq, t0, 2.6, gain=0.05, brightness=1.5, pan=0.2 if t0 < 5 else -0.25)


class Taose(Piece):
    index, slug, title = 19, "taose", "套色"
    poem = "三块颜色没有对准"
    poster = 4.2
    reverb, rev_decay, rev_seconds = 0.14, 2.8, 0.45
    hp, vignette, contrast, sat = 38, 0.06, 1.05, 1.08

    def prepare(self):
        self.sheet = paper(self.ctx, hexrgb("#f4efe4"), seed=19, fiber=0.02, blot=0.02)

    def frame(self, t, img):
        ctx = self.ctx
        img[:] = self.sheet
        layers = [
            (W * 0.34, H * 0.34, 340, 10 * np.sin(t * 0.55), 6 * np.cos(t * 0.4), hexrgb("#ff3d86")),
            (W * 0.66, H * 0.62, 360, -16 + 8 * np.sin(t * 0.42 + 1), 10 * np.cos(t * 0.48), hexrgb("#2a52ff")),
            (W * 0.48, H * 0.50, 230, 8 * np.cos(t * 0.5), -14 + 6 * np.sin(t * 0.46), hexrgb("#ffe14d")),
        ]
        pigment = np.zeros((H, W, 3), np.float32)
        for cx, cy, rad, dx, dy, ink in layers:
            d = np.sqrt((ctx.X - cx - dx) ** 2 + (ctx.Y - cy - dy) ** 2)
            inside = smoothstep(rad, rad - 14, d)
            Xs, Ys = ctx.X - dx, ctx.Y - dy
            screen = 0.5 + 0.5 * np.sin(Xs * (2 * np.pi / 8.0)) * np.sin(Ys * (2 * np.pi / 8.0))
            dots = inside * np.clip((screen - 0.18) / 0.16, 0, 1)
            pigment += (1.0 - ink) * dots[..., None]
        printed = np.clip(img * (1.0 - np.clip(pigment, 0, 1)), 0, 1)
        img[:] = printed
        mark = hexrgb("#2a2926")
        for x, y, dx, dy in (
            (110, 150, 1, 1),
            (W - 110, 150, -1, 1),
            (110, H - 220, 1, -1),
            (W - 110, H - 220, -1, -1),
        ):
            paint(img, sd_box(ctx, x + dx * 18, y, 16, 1.1), mark)
            paint(img, sd_box(ctx, x, y + dy * 18, 1.1, 16), mark)

    def compose(self, s):
        step = 0.625
        roots = ["C2", "C2", "F2", "G2"] * 4
        for i in range(16):
            t0 = 0.04 + i * step
            if i % 4 in (0, 2):
                s.kick(t0, gain=0.55)
            if i % 4 in (1, 3):
                s.snare(t0, gain=0.26)
            s.hat(t0 + step * 0.5, gain=0.06, pan=0.3)
            # Tape wobble: the bass drifts a few cents.
            wob = 1.0 + 0.006 * np.sin(2 * np.pi * 0.35 * t0)
            s.tone(hz(roots[i]) * wob, t0, step * 0.92, gain=0.15, decay=2.8, partials=4, lp=240, attack=0.006)
        for i, name in enumerate(["G4", "Bb4", "C5", "Bb4"]):
            s.tone(hz(name), 0.3 + i * 2.5, 0.7, gain=0.06, decay=3.5, partials=3, lp=1600, pan=-0.1)


class Yuanxiang(Piece):
    index, slug, title = 20, "yuanxiang", "圆相"
    poem = "一笔，留一口，再盖印"
    poster = 8.7
    reverb, rev_decay, rev_seconds = 0.34, 1.7, 1.3
    hp, vignette, contrast, sat = 45, 0.08, 1.02, 0.92

    def prepare(self):
        self.sheet = paper(self.ctx, hexrgb("#f4f0e6"), seed=20, fiber=0.022, blot=0.03)
        self.cx, self.cy = W * 0.50, H * 0.44
        self.n = 640
        u = np.linspace(0, 1, self.n, dtype=np.float32)
        # Gap sits at the top. Angle 0 is screen-right, and increasing angle travels clockwise.
        theta0 = np.deg2rad(278)
        theta = theta0 + u * np.deg2rad(336)
        radius = 300 + 18 * np.sin(theta * 2.0) + 7 * np.sin(theta * 5.0)
        self.px = self.cx + np.cos(theta) * radius
        self.py = self.cy + np.sin(theta) * radius
        wave = np.clip(np.sin(np.pi * np.clip(u, 0, 1)), 0, None)
        pressure = 0.46 + 0.54 * wave**0.8
        tail = np.clip((u - 0.9) / 0.1, 0, 1)
        self.pressure = pressure * (1.0 - 0.72 * tail)
        self.u = u
        self.skip = self.rng.random(self.n) < (tail * 0.62)
        self.ink = hexrgb("#1c1b18")
        self.seal = self._seal()

    def _seal(self):
        side = 168
        im = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        dr = ImageDraw.Draw(im)
        red = (194, 55, 46, 255)
        dr.rounded_rectangle((4, 4, side - 5, side - 5), radius=6, fill=red)
        dr.rounded_rectangle((22, 22, side - 23, side - 23), radius=4, outline=(243, 236, 223, 255), width=6)
        font = ImageFont.truetype(FONT, 92)
        # One character, knocked out of the cinnabar. Micro Hei is blunt; the seal is meant to be blunt.
        ch = "圆"
        box = dr.textbbox((0, 0), ch, font=font)
        tw, th = box[2] - box[0], box[3] - box[1]
        dr.text(((side - tw) / 2 - box[0], (side - th) / 2 - box[1] - 4), ch, font=font, fill=(243, 236, 223, 255))
        arr = np.asarray(im).astype(np.float32) / 255.0
        return arr

    def frame(self, t, img):
        ctx = self.ctx
        img[:] = self.sheet
        # Open mid-thought: a short mark is already down, so the first frame is not blank paper.
        u = np.clip((t - 0.05) / 6.4, 0.04, 1.0)
        if t < 0.05:
            u = 0.04
        n = int(u * self.n)
        ink = Image.new("L", (W, H), 0)
        dr = ImageDraw.Draw(ink)
        for i in range(n):
            if self.skip[i]:
                continue
            r = 7 + 30 * float(self.pressure[i])
            x, y = float(self.px[i]), float(self.py[i])
            dr.ellipse((x - r, y - r, x + r, y + r), fill=255)
        mask = np.asarray(ink, np.float32) / 255.0
        mask = gaussian_filter(mask, 0.7)
        paint_alpha(img, np.clip(mask, 0, 1) * 0.94, self.ink)
        if t > 7.5:
            a = ease((t - 7.5) / 0.8)
            self._stamp_seal(img, a)

    def _stamp_seal(self, img, alpha):
        seal = self.seal
        sh, sw = seal.shape[:2]
        # Below the circle, in the empty paper, clear of the bottom interface.
        x0 = int(self.cx - sw * 0.2)
        y0 = int(self.cy + 300 + 86)
        x1, y1 = x0 + sw, y0 + sh
        if x0 < 0 or y0 < 0 or x1 > W or y1 > H:
            return
        a = seal[..., 3:4] * alpha
        src = seal[..., :3]
        sub = img[y0:y1, x0:x1]
        img[y0:y1, x0:x1] = sub * (1 - a) + src * a

    def compose(self, s):
        n = int(s.sr * 6.3)
        tt = np.arange(n, dtype=np.float32) / s.sr
        # Breath: noise living around one pitch, then the pitch itself.
        noise = s.rng.standard_normal(n).astype(np.float32)
        f0 = 392.0 + 18.0 * np.sin(2 * np.pi * 0.25 * tt)
        spec = np.fft.rfft(noise)
        freq = np.fft.rfftfreq(n, d=1.0 / s.sr)
        # A moving bell-shaped band. The center is fixed; the vibrato is in the sine.
        spec *= np.exp(-0.5 * ((freq - 392.0) / 28.0) ** 2)
        breath = np.fft.irfft(spec, n).astype(np.float32)
        breath /= np.max(np.abs(breath)) + 1e-6
        env = smoothstep(0, 0.45, tt) * smoothstep(0, 1.15, 6.3 - tt)
        env = env * (0.85 + 0.15 * np.sin(2 * np.pi * 3.2 * tt))
        tone = np.sin(2 * np.pi * np.cumsum(f0) / s.sr).astype(np.float32)
        tone *= smoothstep(0.4, 1.3, tt) * smoothstep(0, 1.0, 6.0 - tt)
        sig = breath * 0.65 * env + tone * 0.35 * env
        s.place(sig, 0.15, pan=-0.05, gain=0.55)
        s.bowl(1046.5, 8.15, 1.6, gain=0.06, brightness=1.7, pan=0.15)


PIECES = [Xuansi, Qinghua, Moli, Mengfeisi, Feitian, Seyu, Juan, Raoji, Taose, Yuanxiang]
