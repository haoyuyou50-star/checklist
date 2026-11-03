import { CLS } from './scenes.js';
import { Builder, blur1, blurMasked, clamp, lerp, loadImage, makeRng, softSeed } from './generator.js';

/*
 * Easter eggs: small painted things beyond the picture (the art team's sprites, tools/make_eggs.py) that change
 * when looked at. Each egg is laid twice in strokes, idle and gazed (stroke B = [egg index, state, threshold]);
 * the shader dissolves one into the other by uEgg[index], which main.js raises while the gaze rests on it.
 *
 * scene.eggs: { id, az°, dist m, w | h (card width or height, m), on: 'water' | 'ground' | 'flat', refl, cloth, fine }
 * - water / ground: a card standing at the waterline / on the ground, facing the eye; refl: a broken mirror image
 *   on the water; cloth: how far the sprite's right side flies in the wind (a flag); fine: finer strokes (x)
 * - flat: lying on the water, as deep as it must be for the eye at the origin to see the sprite as drawn
 */
export const loadEggs = (list = []) => Promise.all(list.map((e) => Promise.all(['idle', 'gaze'].map((s) => loadImage(`assets/eggs/${e.src}_${s}.webp`)))));

function readSprite(img) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, W, H).data;
  const rgb = new Float32Array(W * H * 3), a = new Float32Array(W * H), lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    a[i] = px[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.pow(px[i * 4 + c] / 255, 2.2);
    lum[i] = 0.3 * rgb[i * 3] + 0.59 * rgb[i * 3 + 1] + 0.11 * rgb[i * 3 + 2];
  }
  return { W, H, rgb, a, lum };
}

export function appendEggs(data, list, imgs, Q) {
  if (!list || !list.length) return data;
  const rand = makeRng(9127);
  const B = new Builder(40000);
  const h = data.h;
  const fr = data.front;
  const delayOf = (P) => {
    const l = Math.hypot(P[0], P[1], P[2]) || 1;
    return clamp((Math.acos(clamp((P[0] * fr[0] + P[1] * fr[1] + P[2] * fr[2]) / l, -1, 1)) - 0.3) / 2.7, 0, 1) * 0.85 + rand() * 0.15;
  };
  const scale = { low: 0.8, mid: 1, high: 1.2 }[Q.tier] || 1;
  const eggs = [];

  list.forEach((e, k) => {
    const az = (e.az * Math.PI) / 180, fwd = [Math.sin(az), 0, -Math.cos(az)], R = [Math.cos(az), 0, Math.sin(az)];
    const sp0 = readSprite(imgs[k][0]);
    const asp = sp0.H / sp0.W;
    const w = e.w || e.h / asp, ht = e.h || e.w * asp;
    const flat = e.on === 'flat';
    const yBase = -h + (e.on === 'ground' ? 0 : 0.005);
    const base = [fwd[0] * e.dist, yBase, fwd[2] * e.dist];
    // flat: the sprite's up runs away over the water, far enough that it subtends what it does on the card
    const depth = flat ? ht / Math.sin(Math.atan2(h, e.dist)) : 0;
    const place = (u, v) => (flat
      ? [base[0] + R[0] * (u - 0.5) * w + fwd[0] * (v - 0.5) * depth, yBase + 0.01, base[2] + R[2] * (u - 0.5) * w + fwd[2] * (v - 0.5) * depth]
      : [base[0] + R[0] * (u - 0.5) * w, yBase + v * ht, base[2] + R[2] * (u - 0.5) * w]);
    const upV = flat ? [fwd[0] * depth, 0, fwd[2] * depth] : [0, ht, 0];
    const center = place(0.5, 0.5);
    const cd = Math.hypot(...center);
    eggs.push({ id: e.id, center, radius: Math.max(0.35 * Math.hypot(w, flat ? depth * Math.sin(Math.atan2(h, e.dist)) : ht), 0.25) * 1.35 / cd });

    [0, 1].forEach((state) => {
      const S = state ? readSprite(imgs[k][1]) : sp0;
      const { W, H, rgb, a, lum } = S;
      const mask = a.map((x) => (x > 0.5 ? 1 : 0));
      const inner = blur1(blur1(mask, W, H, 3), W, H, 2);
      const lb = blur1(lum, W, H, 2);
      // three passes coarse to fine (cell size in sprite px); the finest only where the sprite has detail
      const fi = e.fine || 1;
      const passes = [{ c: W / 18 / fi, maj: [1.6, 2.4], min: [0.7, 0.9], need: 0.85 }, { c: W / 34 / fi, maj: [1.5, 2.3], min: [0.6, 0.8], need: 0.6 },
        { c: W / 64 / fi / scale, maj: [1.4, 2.2], min: [0.5, 0.7], need: 0.3, detail: true }];
      passes.forEach((p) => {
        const col = blurMasked(rgb, mask, rgb, W, H, Math.max(1, Math.round(p.c * 0.35)));
        for (let y = p.c * 0.5; y < H; y += p.c * 0.8) {
          for (let x = rand() * p.c; x < W; x += p.c * 0.8) {
            const xi = clamp(Math.round(x + (rand() - 0.5) * p.c * 0.6), 1, W - 2), yi = clamp(Math.round(y + (rand() - 0.5) * p.c * 0.6), 1, H - 2);
            const i = yi * W + xi;
            if (!mask[i] || inner[i] < p.need) continue;
            const gx = lb[i + 1] - lb[i - 1], gy = lb[i + W] - lb[i - W], gm = Math.hypot(gx, gy);
            if (p.detail && rand() > clamp(gm * 30 + (1 - inner[i]) * 2, 0.15, 1)) continue;
            // along the drawing's edges where there are some, otherwise loosely level
            const ang = gm > 0.012 ? Math.atan2(gy, gx) + Math.PI / 2 : (rand() - 0.5) * 0.8;
            const u = xi / W, v = 1 - yi / H;
            const P = place(u, v);
            const pxW = w / W;
            const maj = p.c * pxW * lerp(p.maj[0], p.maj[1], rand()) * (0.6 + 0.4 * inner[i]);
            const mn = p.c * pxW * lerp(p.min[0], p.min[1], rand()) * (0.7 + 0.3 * inner[i]);
            const ca = Math.cos(ang), sa = -Math.sin(ang);
            const ax = [0, 1, 2].map((j) => R[j] * ca * maj + (upV[j] / ht) * sa * maj);
            const c = [0, 1, 2].map((j) => clamp(Math.pow(col[i * 3 + j], 1 / 2.2) * (1 + (rand() - 0.5) * 0.06), 0, 1));
            const flex = e.cloth ? clamp((u - 0.12) / 0.88, 0, 1) * e.cloth : e.on === 'water' ? 0.15 : 0;
            const th = rand();
            B.add(P, [k, state, th], ax, mn, c, 0.96, CLS.EGG, 0, flex, delayOf(P), 1, softSeed(0, rand()));
            // its broken image on the water: level dashes under the waterline, thinner further down (flex = -m:
            // the shader keeps it under its object for any eye, as it does the river's reflections)
            if (e.refl && !flat && v < 0.6 && rand() < 0.55) {
              const yRel = P[1] + h, kk = h / (h + yRel);
              const M = [P[0] * kk + (rand() - 0.5) * maj * 0.6, -h + 0.008, P[2] * kk];
              const q = clamp(yRel / ht, 0, 1);
              const rc = c.map((x, j) => lerp(x, [0.55, 0.66, 0.78][j], 0.35 + 0.35 * q) * 0.92);
              const len = maj * lerp(1.4, 2.2, rand()) * kk;
              B.add(M, [k, state, th], [R[0] * len, 0, R[2] * len], mn * kk * 0.8, rc, 0.6 * (1 - 0.6 * q), CLS.EGG, 0, -1 / kk, delayOf(M), 1, softSeed(0.3, rand()));
            }
          }
        }
      });
    });
  });

  const n = data.count, m = B.n;
  const cat = (a, b) => { const o = new Float32Array((n + m) * 4); o.set(a.subarray(0, n * 4)); o.set(b.subarray(0, m * 4), n * 4); return o; };
  console.log(`[monet] eggs ${list.map((e) => e.id).join(', ')}: ${m} strokes`);
  return { ...data, count: n + m, A: cat(data.A, B.A), B: cat(data.B, B.B), C: cat(data.C, B.C), D: cat(data.D, B.D), E: cat(data.E, B.E), eggs };
}
