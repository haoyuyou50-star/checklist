import { CLS } from './scenes.js';
import { buildUnified } from './unified.js';

/* ---------------- deterministic helpers ---------------- */
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
export const fract = (x) => x - Math.floor(x);
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash3 = (x, y, z) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
export function vnoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const h = (a, b, c) => hash3(ix + a, iy + b, iz + c);
  const x00 = lerp(h(0, 0, 0), h(1, 0, 0), ux), x10 = lerp(h(0, 1, 0), h(1, 1, 0), ux);
  const x01 = lerp(h(0, 0, 1), h(1, 0, 1), ux), x11 = lerp(h(0, 1, 1), h(1, 1, 1), ux);
  return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz);
}
export const vnoise2 = (x, y) => vnoise3(x, y, 0.5);
export function fbm3(x, y, z, oct = 4) {
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise3(x, y, z); n += a; x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; }
  return s / n;
}
export const fbm2 = (x, y, oct) => fbm3(x, y, 0.37, oct);

export function blur1(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  const n = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let acc = 0; const row = y * W;
    for (let k = -r; k <= r; k++) acc += src[row + clamp(k, 0, W - 1)];
    for (let x = 0; x < W; x++) {
      tmp[row + x] = acc / n;
      acc += src[row + clamp(x + r + 1, 0, W - 1)] - src[row + clamp(x - r, 0, W - 1)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, H - 1) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc / n;
      acc += tmp[clamp(y + r + 1, 0, H - 1) * W + x] - tmp[clamp(y - r, 0, H - 1) * W + x];
    }
  }
  return out;
}
export function blurRGB(rgb, W, H, r) {
  const N = W * H, out = new Float32Array(N * 3);
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(N);
    for (let i = 0; i < N; i++) ch[i] = rgb[i * 3 + c];
    let b = blur1(ch, W, H, r); b = blur1(b, W, H, Math.max(1, r >> 1));
    for (let i = 0; i < N; i++) out[i * 3 + c] = b[i];
  }
  return out;
}

// blur that ignores pixels where mask is 0 (falls back to the plain blur where nothing is left)
export function blurMasked(rgb, mask, fallback, W, H, r) {
  const N = W * H, out = new Float32Array(N * 3);
  const blur2 = (a) => blur1(blur1(a, W, H, r), W, H, Math.max(1, r >> 1));
  const wt = blur2(mask);
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(N);
    for (let i = 0; i < N; i++) ch[i] = rgb[i * 3 + c] * mask[i];
    const b = blur2(ch);
    for (let i = 0; i < N; i++) out[i * 3 + c] = wt[i] > 0.08 ? b[i] / wt[i] : fallback[i * 3 + c];
  }
  return out;
}

/* ---------------- splat buffer ---------------- */
export class Builder {
  constructor(cap) { this.n = 0; this.alloc(cap); }
  alloc(cap) {
    const grow = (old) => { const a = new Float32Array(cap * 4); if (old) a.set(old.subarray(0, this.n * 4)); return a; };
    this.A = grow(this.A); this.B = grow(this.B); this.C = grow(this.C); this.D = grow(this.D); this.E = grow(this.E);
    this.cap = cap;
  }
  add(w, c, axis, minor, col, alpha, cls, hot, flex, delay, ext, seed) {
    if (this.n >= this.cap) this.alloc(this.cap * 2);
    const o = this.n * 4;
    this.A[o] = w[0]; this.A[o + 1] = w[1]; this.A[o + 2] = w[2]; this.A[o + 3] = seed;
    this.B[o] = c[0]; this.B[o + 1] = c[1]; this.B[o + 2] = c[2]; this.B[o + 3] = cls;
    this.C[o] = axis[0]; this.C[o + 1] = axis[1]; this.C[o + 2] = axis[2]; this.C[o + 3] = minor;
    this.D[o] = col[0]; this.D[o + 1] = col[1]; this.D[o + 2] = col[2]; this.D[o + 3] = alpha;
    this.E[o] = hot; this.E[o + 1] = flex; this.E[o + 2] = delay; this.E[o + 3] = ext;
    return this.n++;
  }
}

export const QUALITY = {
  high: { uniAlpha: 0.0059, analysisW: 760, layers: [11, 5.6, 2.9], detail: 2.0, extGround: 90000, extWater: 150000, extSky: 44000, treeDensity: 4.2, nearTree: 15, motes: 900, glints: 1800, shore: 16000 },
  mid: { uniAlpha: 0.006, analysisW: 640, layers: [11, 5.8, 3.1], detail: 2.3, extGround: 60000, extWater: 88000, extSky: 27000, treeDensity: 3.0, nearTree: 11, motes: 600, glints: 1200, shore: 11000 },
  low: { uniAlpha: 0.0071, analysisW: 520, layers: [12, 6.6, 3.6], detail: 2.8, extGround: 34000, extWater: 60000, extSky: 17000, treeDensity: 1.9, nearTree: 8, motes: 500, glints: 700, shore: 6000 },
};

export async function loadImage(src) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  return img;
}

/* ============================================================ */
export function buildScene(scene, img, Q) {
  if (scene.unified) return buildUnified(scene, img, Q);
  const rand = makeRng(scene.id.length * 7919 + 1873);
  const asp = img.naturalHeight / img.naturalWidth;
  scene.asp = asp;
  const cam = scene.cam, f = cam.f, vH = cam.vH;
  const W = Q.analysisW, H = Math.round(W * asp), N = W * H;

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const rgb = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { rgb[i * 3] = px[i * 4] / 255; rgb[i * 3 + 1] = px[i * 4 + 1] / 255; rgb[i * 3 + 2] = px[i * 4 + 2] / 255; }
  const b1 = blurRGB(rgb, W, H, 1), b2 = blurRGB(rgb, W, H, 3), b3 = blurRGB(rgb, W, H, 6);

  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) lum[i] = 0.3 * b1[i * 3] + 0.59 * b1[i * 3 + 1] + 0.11 * b1[i * 3 + 2];
  const gx = new Float32Array(N), gy = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    gx[i] = (lum[i - W + 1] + 2 * lum[i + 1] + lum[i + W + 1]) - (lum[i - W - 1] + 2 * lum[i - 1] + lum[i + W - 1]);
    gy[i] = (lum[i + W - 1] + 2 * lum[i + W] + lum[i + W + 1]) - (lum[i - W - 1] + 2 * lum[i - W] + lum[i - W + 1]);
  }
  const jxx = new Float32Array(N), jxy = new Float32Array(N), jyy = new Float32Array(N), grad = new Float32Array(N);
  for (let i = 0; i < N; i++) { jxx[i] = gx[i] * gx[i]; jxy[i] = gx[i] * gy[i]; jyy[i] = gy[i] * gy[i]; grad[i] = Math.hypot(gx[i], gy[i]); }
  const Jxx = blur1(jxx, W, H, 4), Jxy = blur1(jxy, W, H, 4), Jyy = blur1(jyy, W, H, 4);

  /* ---- semantic + depth map ---- */
  const clsMap = new Uint8Array(N), depMap = new Float32Array(N), hotMap = new Uint8Array(N), flexMap = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const c = scene.classify((x + 0.5) / W, (y + 0.5) / H, b1[i * 3], b1[i * 3 + 1], b1[i * 3 + 2], rand);
    clsMap[i] = c.cls; depMap[i] = c.depth; hotMap[i] = c.hot; flexMap[i] = clamp(c.flex, 0, 1);
  }
  // underpainting for the meadow without the poppies, so red only arrives as crisp dabs in the fine layers
  const noFlower = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const reddish = rgb[i * 3] > rgb[i * 3 + 1] * 1.08;
    noFlower[i] = clsMap[i] === CLS.GRASS && !reddish ? 1 : 0;
  }
  const hasFlowers = clsMap.some((c) => c === CLS.FLOWER);
  const g2 = hasFlowers ? blurMasked(rgb, noFlower, b2, W, H, 3) : b2;
  const g3 = hasFlowers ? blurMasked(rgb, noFlower, b3, W, H, 6) : b3;

  const B = new Builder(400000);
  const EDGE_IN = 0.024, EDGE_OUT = 0.05;
  const sC = 3.0 / f;
  const hotAcc = new Map();

  const toWorld = (u, v, depth) => { const s = depth / f; return [(u - 0.5) * s, -(v - vH) * asp * s, -depth]; };
  const frontDir = (() => { const y = -(0.5 - vH) * asp; const l = Math.hypot(y, f); return [0, y / l, -f / l]; })();

  /* ---- painted strokes ---- */
  const layerDefs = [
    { sp: Q.layers[0], maj: [1.3, 2.2], min: [0.6, 0.85], a: 0.97, src: b3 },
    { sp: Q.layers[1], maj: [1.2, 2.1], min: [0.5, 0.75], a: 0.97, src: b2 },
    { sp: Q.layers[2], maj: [1.1, 2.0], min: [0.45, 0.7], a: 0.97, src: b1 },
    { sp: Q.detail, maj: [1.0, 1.8], min: [0.42, 0.66], a: 0.96, src: b1, detail: true },
    // extra-fine pass on figures and hotspot objects so close-ups stay crisp
    { sp: Q.detail * 0.62, maj: [1.0, 1.7], min: [0.45, 0.7], a: 0.95, src: rgb, fine: true },
  ];
  const isGround = (c) => c === CLS.SKY || c === CLS.GRASS || c === CLS.WATER || c === CLS.FLOWER;
  layerDefs.forEach((L, li) => {
    const sp = L.sp, rowH = sp * 0.866;
    let row = 0;
    for (let gy0 = rowH * 0.5; gy0 < H; gy0 += rowH, row++) {
      for (let gx0 = (row & 1 ? sp * 0.5 : 0) + sp * 0.25; gx0 < W; gx0 += sp) {
        const x = clamp(gx0 + (rand() - 0.5) * sp * 0.9, 0, W - 1);
        const y = clamp(gy0 + (rand() - 0.5) * sp * 0.9, 0, H - 1);
        const i = (y | 0) * W + (x | 0);
        let c = clsMap[i], dep = depMap[i], hot = hotMap[i];
        const eEdge = Math.min(x / W, 1 - x / W, (y / H) * asp, (1 - y / H) * asp);
        if (eEdge < EDGE_IN && rand() < (1 - eEdge / EDGE_IN) * 0.7) continue;
        if (L.fine && (isGround(c) || (c !== CLS.FIGURE && !hotMap[i]) || rand() > 0.75)) continue;
        if (L.detail) {
          let p = clamp(grad[i] * 9 - 0.12, 0, 0.85);
          if (c === CLS.SKY) p *= 0.15;
          if (rand() > p) continue;
          const dl = Math.abs(lum[i] - (0.3 * b2[i * 3] + 0.59 * b2[i * 3 + 1] + 0.11 * b2[i * 3 + 2]));
          if (dl > (c === CLS.SKY ? 0.06 : 0.2)) continue;
        }
        if (c === CLS.SKY && li >= 2 && rand() < 0.3) continue;
        if (li === 0 && !isGround(c)) {
          // meadow behind standing figures, revealed by parallax once the camera moves in
          const gy = -((y / H) - vH) * asp;
          if (!(scene.ext.kind === 'field' && c === CLS.FIGURE && gy < -1e-3)) continue;
          c = CLS.GRASS; dep = Math.min(cam.maxD, (cam.h * f) / -gy); hot = 0;
        }
        if (c === CLS.SKY && li === 3) continue;

        const meadow = (c === CLS.GRASS || c === CLS.FLOWER) && li < 2;
        const k = c === CLS.SKY ? (li === 0 ? b3 : b2) : meadow ? (li === 0 ? g3 : g2) : !isGround(c) && li < 2 ? b1 : L.src;
        const jit = 1 + (rand() - 0.5) * 0.07;
        const col = [
          clamp(k[i * 3] * jit + (rand() - 0.5) * 0.025, 0, 1),
          clamp(k[i * 3 + 1] * jit + (rand() - 0.5) * 0.025, 0, 1),
          clamp(k[i * 3 + 2] * jit + (rand() - 0.5) * 0.025, 0, 1),
        ];

        const sxx = Jxx[i], sxy = Jxy[i], syy = Jyy[i];
        const coh = Math.sqrt((sxx - syy) ** 2 + 4 * sxy * sxy) / (sxx + syy + 1e-6);
        let ang;
        if (c === CLS.WATER) ang = (rand() - 0.5) * 0.2;
        else if (rand() < coh * 1.3) ang = 0.5 * Math.atan2(2 * sxy, sxx - syy) + Math.PI / 2;
        else if (c === CLS.SKY) ang = (rand() - 0.5) * 0.6;
        else if (c === CLS.GRASS) ang = Math.PI / 2 + (rand() - 0.5) * 1.1;
        else if (c === CLS.WATER) ang = (rand() - 0.5) * 0.18;
        else if (c === CLS.SAIL) ang = Math.PI / 2 + (rand() - 0.5) * 0.5;
        else ang = rand() * Math.PI;

        let maj = sp * lerp(L.maj[0], L.maj[1], rand());
        let mn = sp * lerp(L.min[0], L.min[1], rand());
        if (c === CLS.WATER) { maj *= li === 0 ? 0.9 : 1.1; mn *= 0.72; }
        if (c === CLS.SKY && li === 0) maj *= 1.25;
        const dab = c === CLS.FLOWER && li >= 2;
        if (dab) mn = Math.max(mn, maj * 0.62);

        const u = x / W, v = y / H, depth = dep * (1 + 0.014 * (3 - li)) * (dab ? 0.996 : 1);
        const s = depth / f, sc = sC * (1 + 0.004 * (3 - li));
        const w = toWorld(u, v, depth);
        const cpos = [(u - 0.5) * sc, -(v - vH) * asp * sc, -f * sc];
        const unit = s / W;
        const axis = [Math.cos(ang) * maj * unit, -Math.sin(ang) * maj * unit, 0];
        const rad = Math.hypot(u - 0.5, (v - 0.5) * asp) / 0.62;
        const delay = clamp(rad * 0.62 + rand() * 0.38, 0, 1);
        B.add(w, cpos, axis, mn * unit, col, L.a, c, hot, flexMap[i], delay, 0, rand());
        if (hot) {
          let h = hotAcc.get(hot);
          if (!h) { h = { n: 0, x: 0, y: 0, z: 0, pts: [] }; hotAcc.set(hot, h); }
          h.n++; h.x += w[0]; h.y += w[1]; h.z += w[2];
          if (rand() < 0.2) h.pts.push(w);
        }
      }
    }
  });

  /* ---- glow halos & petals duplicated from painted strokes ---- */
  const nPaint = B.n;
  // large hotspots (a whole poppy slope) would otherwise drown in halo haze
  const haloP = new Map([...hotAcc].map(([id, a]) => [id, Math.min(0.16, 700 / a.n)]));
  for (let j = 0; j < nPaint; j++) {
    const o = j * 4;
    const cls = B.B[o + 3], hot = B.E[o];
    if (hot > 0 && rand() < haloP.get(hot)) {
      const col = [lerp(B.D[o], 1.0, 0.55), lerp(B.D[o + 1], 0.84, 0.55), lerp(B.D[o + 2], 0.56, 0.55)];
      B.add([B.A[o], B.A[o + 1], B.A[o + 2]], [B.B[o], B.B[o + 1], B.B[o + 2]],
        [B.C[o] * 2.6, B.C[o + 1] * 2.6, B.C[o + 2] * 2.6], B.C[o + 3] * 3.2, col, 1, CLS.HALO, hot, 0, B.E[o + 2], 0, rand());
    }
    if (scene.ext.petals && cls === CLS.FLOWER && -B.A[o + 2] < 30 && rand() < 0.4) {
      B.add([B.A[o], B.A[o + 1], B.A[o + 2]], [B.A[o], B.A[o + 1], B.A[o + 2]],
        [B.C[o] * 0.45, B.C[o + 1] * 0.45, B.C[o + 2] * 0.45], B.C[o + 3] * 0.55,
        [Math.min(1, B.D[o] * 1.1), B.D[o + 1] * 0.95, B.D[o + 2] * 0.95], 0.95, CLS.PETAL, 0, 1, 0.15, 1, rand());
    }
  }

  /* ---- palettes sampled from the painting ---- */
  const nBins = 28, dMin = 1.0, dMax = cam.maxD;
  const binOf = (d) => clamp(Math.floor((Math.log(Math.max(d, dMin)) - Math.log(dMin)) / (Math.log(dMax) - Math.log(dMin)) * nBins), 0, nBins - 1);
  const groundBins = Array.from({ length: nBins }, () => []);
  const topElev = Math.atan2(vH * asp, f);
  const nSky = 18;
  const skyBins = Array.from({ length: nSky }, () => []);
  const pal = { tree: [], flower: [], stat: [], sail: [], water: [] };
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const i = y * W + x, c = clsMap[i];
    const col = [b2[i * 3], b2[i * 3 + 1], b2[i * 3 + 2]];
    if (c === CLS.WATER && b1[i * 3 + 2] > b1[i * 3] * 1.04 && b1[i * 3 + 2] >= b1[i * 3 + 1] * 0.97) pal.water.push([b1[i * 3], b1[i * 3 + 1], b1[i * 3 + 2]]);
    if (c === CLS.GRASS) { if (b1[i * 3 + 1] >= b1[i * 3] * 0.97) groundBins[binOf(depMap[i])].push([b1[i * 3], b1[i * 3 + 1], b1[i * 3 + 2]]); }
    else if (c === CLS.WATER) { if (col[2] >= col[0] * 0.98 || rand() < 0.08) groundBins[binOf(depMap[i])].push(col); }
    else if (c === CLS.SKY) {
      if (scene.ext.kind === 'water' && (col[2] < col[0] * 0.97 || col[0] * 0.3 + col[1] * 0.59 + col[2] * 0.11 < 0.42)) continue;
      const yy = -((y + 0.5) / H - vH) * asp, xx = (x + 0.5) / W - 0.5;
      const e = Math.atan2(yy, Math.hypot(xx, f));
      skyBins[clamp(Math.floor((e / topElev) * nSky), 0, nSky - 1)].push(col);
    }
    else if (c === CLS.TREE) pal.tree.push(col);
    else if (c === CLS.FLOWER) { if (rgb[i * 3] > rgb[i * 3 + 1] * 1.7) pal.flower.push([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]); }
    else if (c === CLS.STATIC) pal.stat.push(col);
    else if (c === CLS.SAIL) pal.sail.push(col);
  }
  for (let b = 0; b < nBins; b++) if (!groundBins[b].length) {
    for (let d = 1; d < nBins; d++) {
      if (groundBins[b - d]?.length) { groundBins[b] = groundBins[b - d]; break; }
      if (groundBins[b + d]?.length) { groundBins[b] = groundBins[b + d]; break; }
    }
  }
  const byLum = (a, b) => (a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11) - (b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11);
  new Set(groundBins).forEach((g) => g.sort(byLum));
  for (let b = 0; b < nSky; b++) {
    if (!skyBins[b].length) skyBins[b] = skyBins[b - 1] || [];
    skyBins[b].sort(byLum);
    const n = skyBins[b].length;
    if (n > 20) skyBins[b] = skyBins[b].slice(Math.floor(n * 0.12), Math.ceil(n * 0.985));
  }
  for (let b = nSky - 1; b >= 0; b--) if (!skyBins[b].length) skyBins[b] = skyBins[b + 1];
  Object.values(pal).forEach((p) => p.sort(byLum));
  const pick = (arr) => arr[Math.floor(rand() * arr.length)] || [0.5, 0.5, 0.5];
  const pickQ = (arr, q) => arr[clamp(Math.floor(q * arr.length), 0, arr.length - 1)] || [0.5, 0.5, 0.5];
  const jitterCol = (c, amt = 0.05) => { const j = 1 + (rand() - 0.5) * amt; return [clamp(c[0] * j + (rand() - 0.5) * 0.02, 0, 1), clamp(c[1] * j + (rand() - 0.5) * 0.02, 0, 1), clamp(c[2] * j + (rand() - 0.5) * 0.02, 0, 1)]; };
  const mean = (arr) => { const m = [0, 0, 0]; arr.forEach((c) => { m[0] += c[0]; m[1] += c[1]; m[2] += c[2]; }); const n = Math.max(1, arr.length); return [m[0] / n, m[1] / n, m[2] / n]; };

  /* ---- world extension around the painting ---- */
  const keep = (x, y, z) => {
    if (z >= -1e-3) return true;
    const u = (x / -z) * f + 0.5, v = vH - ((y / -z) * f) / asp;
    const e = Math.min(u, 1 - u, v * asp, (1 - v) * asp);
    if (e < 0) return true;
    if (e < EDGE_OUT) return rand() < (1 - e / EDGE_OUT) * 0.8;
    return false;
  };
  // Pull extension colours toward the painting near its border, sampling the nearest pixel of the same kind.
  const fam = (c) => (c === CLS.SKY ? 0 : c === CLS.WATER ? 1 : c === CLS.SAIL ? 3 : 2);
  const EDGE_M = 0.26;
  const edgeBlend = (w, col, family, maxK = 0.88) => {
    const z = w[2];
    if (z >= -0.5) return col;
    const u = (w[0] / -z) * f + 0.5, v = vH - ((w[1] / -z) * f) / asp;
    const cu = clamp(u, 0, 1), cv = clamp(v, 0, 1);
    const d = Math.hypot(u - cu, (v - cv) * asp);
    if (d >= EDGE_M) return col;
    let dx = 0.5 - cu, dy = (0.5 - cv) * asp;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;
    const along = (rand() - 0.5) * 16;
    const px = cu * (W - 1) - dy * along, py = cv * (H - 1) + dx * along;
    const s0 = 2 + rand() * 16;
    for (let s = s0; s < s0 + 90; s += 3) {
      const xi = clamp(Math.round(px + dx * s), 0, W - 1), yi = clamp(Math.round(py + dy * s), 0, H - 1);
      const i = yi * W + xi;
      if (fam(clsMap[i]) !== family) continue;
      const k = Math.pow(1 - d / EDGE_M, 1.5) * maxK;
      return [lerp(col[0], b2[i * 3], k), lerp(col[1], b2[i * 3 + 1], k), lerp(col[2], b2[i * 3 + 2], k)];
    }
    return col;
  };
  const extDelay = (x, y, z) => {
    const l = Math.hypot(x, y, z) || 1;
    const d = (x * frontDir[0] + y * frontDir[1] + z * frontDir[2]) / l;
    return clamp((Math.acos(clamp(d, -1, 1)) - 0.3) / 2.7, 0, 1) * 0.85 + rand() * 0.15;
  };
  const allSky = skyBins.flat().sort(byLum), nAS = allSky.length;
  const horizCol = mean(skyBins[0].concat(skyBins[1] || []));
  const cloudHi = lerp3(mean(allSky.slice(Math.floor(nAS * 0.9))), [1, 0.98, 0.94], 0.25);
  const cloudLo = mean(allSky.slice(Math.floor(nAS * 0.5), Math.floor(nAS * 0.72)));
  const clearCol = mean([...allSky].sort((a, b) => (b[2] - b[0]) - (a[2] - a[0])).slice(0, Math.max(1, Math.floor(nAS * 0.12))));
  const HAZY = new Set([CLS.TREE, CLS.STATIC, CLS.SAIL, CLS.GRASS, CLS.FLOWER]);
  const addExt = (w, axis, minor, col, alpha, cls, flex, hot = 0) => {
    if (HAZY.has(cls)) {
      const k = smooth(30, 150, Math.hypot(w[0], w[2])) * 0.5;
      if (k > 0) col = [lerp(col[0], horizCol[0], k), lerp(col[1], horizCol[1], k), lerp(col[2], horizCol[2], k)];
    }
    return B.add(w, w, axis, minor, col, alpha, cls, hot, flex, extDelay(w[0], w[1], w[2]), 1, rand());
  };
  const up = [0, 1, 0];
  const tangentAt = (th) => [Math.cos(th), 0, Math.sin(th)];
  const axisInPlane = (t, a, len) => [(up[0] * Math.cos(a) + t[0] * Math.sin(a)) * len, (up[1] * Math.cos(a)) * len, (up[2] * Math.cos(a) + t[2] * Math.sin(a)) * len];

  const h = cam.h, ext = scene.ext;
  const reflections = [];
  const mirror = (w, axis, minor, col, alpha, waterCol) => {
    if (ext.kind !== 'water') return;
    const yRel = w[1] + h;
    if (yRel < 0.02 || rand() > 0.42) return;
    // where the ray to the mirrored point meets the water surface
    const k = (h / (h + yRel * 0.95)) * 0.995;
    const wm = [(w[0] + (rand() - 0.5) * 0.4) * k, -h + 0.01, w[2] * k];
    const th = Math.atan2(w[0], -w[2]);
    const t = tangentAt(th);
    const len = Math.hypot(axis[0], axis[1], axis[2]) * lerp(2.2, 3.6, rand()) * k;
    minor *= k * 4.2;
    const cl = (col[0] + col[1] + col[2]) / 3;
    const c = [0, 1, 2].map((j) => clamp(lerp(cl + (col[j] - cl) * 1.35, waterCol[j], 0.14) * 0.84, 0, 1));
    reflections.push([wm, [t[0] * len, 0, t[2] * len], minor * 0.8, c, Math.min(1, alpha * 1.02)]);
  };
  const waterColAt = (d) => (ext.kind === 'water' && pal.water.length > 40 ? pickQ(pal.water, 0.35 + rand() * 0.6) : pick(groundBins[binOf(d)]));

  // ground plane: grass field or river surface
  const shoreR = (th) => {
    let d = (th * 180) / Math.PI; d = ((d + 540) % 360) - 180;
    if (d >= 0) return 30 + 88 * smooth(55, 150, d);
    return 118;
  };
  const shoreMul = (th) => { let d = (th * 180) / Math.PI; d = ((d + 540) % 360) - 180; return d < 0 ? smooth(35, 95, -d) : 1; };

  const nG = ext.kind === 'water' ? Q.extWater : Q.extGround;
  const wp = pal.water.length > 40 ? pal.water.sort(byLum) : groundBins[Math.floor(nBins * 0.6)];
  for (let k = 0; k < nG * 1.35; k++) {
    const th = rand() * Math.PI * 2;
    const rMax = ext.kind === 'water' ? shoreR(th) + 2 : ext.ring[1] + 6;
    const r0 = ext.kind === 'water' ? 1.2 : 0.7;
    const r = r0 * Math.pow(rMax / r0, Math.pow(rand(), 0.85));
    const x = r * Math.sin(th), z = -r * Math.cos(th);
    const y = -h + (ext.kind === 'field' ? rand() * 0.22 : 0);
    if (!keep(x, y, z)) continue;
    const t = tangentAt(th);
    if (ext.kind === 'field') {
      // broad tonal patches like the painting's meadow instead of per-stroke noise; shaded base, lit tips
      const zone = fbm2(x * 0.03 + 1.3, z * 0.03 - 4.2, 4), fine = fbm2(x * 0.2 - 2.7, z * 0.2 + 0.4, 2);
      const base = r < 45 && rand() < 0.2;
      const yy = base ? -h + rand() * 0.05 : y;
      const tip = (yy + h) / 0.22;
      const accent = !base && r < 30 && rand() < 0.07;
      const q = clamp(0.5 + (zone - 0.5) * 2.4 + (fine - 0.5) * 0.6 + tip * 0.12 + (rand() - 0.5) * 0.22, 0.03, 0.97) * (base ? 0.5 : accent ? 0.22 : 1);
      let col = pickQ(groundBins[binOf(r)], q), cls = CLS.GRASS;
      const s = 0.05 * Math.pow(r, 0.62);
      let maj = s * lerp(1.1, 2.1, rand()) * (base ? 1.5 : 1), mn = s * lerp(0.3, 0.5, rand()) * (base ? 1.6 : 1);
      let a = rand() < 0.85 ? 0.12 + (rand() - 0.5) * 0.5 : (rand() - 0.5) * 2.4;
      let yF = yy;
      if (ext.flowers && !base && pal.flower.length) {
        const n = fbm2(x * 0.06 + 3.1, z * 0.06 - 1.7, 3);
        // round dabs, none right under the viewer, thinning out towards the horizon so they don't line up
        const fade = smooth(2.5, 5, r) * (1 - 0.85 * smooth(22, 70, r));
        if (n > 0.53 && rand() < (n - 0.53) * 3.6 * fade) {
          const fc = pickQ(pal.flower, 0.12 + rand() * 0.7), fl = fc[0] * 0.3 + fc[1] * 0.59 + fc[2] * 0.11;
          col = fc.map((v) => clamp(fl + (v - fl) * 1.25, 0, 1)); cls = CLS.FLOWER;
          maj *= 0.42; mn = maj * lerp(0.78, 0.95, rand()); a = rand() * Math.PI; yF = -h + 0.12 + rand() * 0.18;
        }
      }
      if (cls === CLS.GRASS) col = edgeBlend([x, yF, z], col, 2, 0.8);
      const pd = base ? 1.015 : 1;
      addExt([x * pd, yF, z * pd], axisInPlane(t, a, maj), mn, jitterCol(col, 0.04), base ? 0.98 : 0.96, cls, base ? 0.15 : 0.35 + rand() * 0.65);
      if (cls === CLS.FLOWER && ext.petals && r < 26 && rand() < 0.35) {
        addExt([x, yF, z], axisInPlane(t, rand() * 3, maj * 0.45), mn * 0.55, [Math.min(1, col[0] * 1.1), col[1], col[2]], 0.95, CLS.PETAL, 1);
      }
    } else {
      const n = fbm2(r * 0.32 + 7.3, th * 16 + 2.1, 3);
      const wc = pickQ(wp, clamp(0.2 + (n - 0.5) * 1.6 + 0.35 + (rand() - 0.5) * 0.4, 0, 0.999));
      const elev = Math.atan2(h, r);
      const hz = pickQ(skyBins[clamp(Math.floor((elev / topElev) * nSky * 2.2), 0, nSky - 1)], 0.4 + rand() * 0.55);
      const kf = 0.22 + 0.5 * smooth(6, 80, r);
      let col = [lerp(wc[0], hz[0], kf), lerp(wc[1], hz[1], kf), lerp(wc[2], hz[2], kf)];
      col = jitterCol(edgeBlend([x, y, z], col, 1, 0.92), 0.05);
      const s = 0.042 * Math.pow(r, 0.72);
      const maj = s * lerp(1.0, 2.3, rand()), mn = maj * lerp(0.32, 0.5, rand());
      const a = Math.PI / 2 + (rand() - 0.5) * 0.12;
      addExt([x, y, z], axisInPlane(t, a, maj), mn, col, 0.93, CLS.WATER, 0.5 + rand() * 0.5);
    }
  }

  // sky dome
  const R = cam.sky;
  const topBlue = mean(skyBins[nSky - 1].slice(0, Math.max(1, skyBins[nSky - 1].length >> 2)));
  for (let k = 0; k < Q.extSky * 1.3; k++) {
    const sinE = lerp(Math.sin(-0.06), 1, Math.pow(rand(), 1.5));
    const e = Math.asin(sinE), th = rand() * Math.PI * 2;
    const dir = [Math.cos(e) * Math.sin(th), sinE, -Math.cos(e) * Math.cos(th)];
    const w = [dir[0] * R, dir[1] * R, dir[2] * R];
    if (!keep(w[0], w[1], w[2])) continue;
    // clear sky gradient + horizontally stretched cloud banks, lit from above
    const n = fbm3(dir[0] * 1.5 + 5.2, dir[1] * 4.2, dir[2] * 1.5 - 1.3, 5);
    const n2 = fbm3(dir[0] * 6 + 1.7, dir[1] * 12, dir[2] * 6 - 4.1, 3);
    const mask = smooth(0.5, 0.62, n + (n2 - 0.5) * 0.12) * (1 - 0.6 * smooth(1.0, 1.45, e));
    const base = lerp3(horizCol, clearCol, smooth(-0.02, 0.55, e));
    const zen = smooth(0.8, 1.5, e) * 0.18;
    const sky = [base[0] * (1 - zen * 0.6), base[1] * (1 - zen * 0.35), Math.min(1, base[2] * (1 + zen * 0.1))];
    const lit = clamp(0.45 + (n2 - 0.5) * 1.5 + (n - 0.58) * 2.2, 0, 1);
    let col = lerp3(sky, lerp3(cloudLo, cloudHi, lit), mask);
    if (rand() < 0.05) col = lerp3(col, rand() < 0.5 ? [1, 0.9, 0.86] : [0.8, 0.81, 0.95], 0.1);
    col = edgeBlend(w, col, 0, 0.92);
    const t = tangentAt(th);
    const rot = (n2 - 0.5) * 0.7 + mask * (n - 0.55) * 1.4 + (rand() - 0.5) * 0.22;
    const angF = Math.acos(clamp(dir[0] * frontDir[0] + dir[1] * frontDir[1] + dir[2] * frontDir[2], -1, 1));
    const maj = R * lerp(0.026, 0.05, rand()) * (1 + 0.6 * smooth(0.6, 2.4, angF)) * (e > 1.0 ? 1.3 : 1);
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const axis = [(t[0] * ca) * maj, sa * maj * Math.cos(e), (t[2] * ca) * maj];
    addExt(w, axis, maj * lerp(0.36, 0.55, rand()), jitterCol(col, 0.015), 0.92, CLS.SKY, 0);
  }

  const sunLeaf = ext.kind === 'field' && pal.tree.length
    ? lerp3(mean(pal.tree.slice(Math.floor(pal.tree.length * 0.92))), mean(groundBins[Math.floor(nBins * 0.5)].slice(-20)), 0.5)
    : null;
  // tree clumps (shared by distant ring, riverbank and near trees)
  const treeClump = (cx, cz, baseY, Hh, Wd, density, opts = {}) => {
    const fineLeaf = opts.round ? 0.75 : 1;
    const n = Math.floor((Hh * Wd * density * 3.2) / (fineLeaf * fineLeaf));
    const th = Math.atan2(cx, -cz), t = tangentAt(th);
    const rdir = [Math.sin(th), 0, -Math.cos(th)];
    const depthR = opts.round ? 0.5 : 0.2;
    const pTree = pal.tree.length ? pal.tree : [[0.25, 0.35, 0.22]];
    const cb = opts.crownBase ?? 0.5;
    // crown = a few overlapping lobes, lit from the upper left
    const round = !!opts.round;
    const lobes = Array.from({ length: (round ? 6 : 3) + Math.floor(rand() * 4) }, (_, j) => {
      const top = j === 0;
      return {
        a: top ? (rand() - 0.5) * 0.2 : (rand() - 0.5) * (round ? 1.0 : 0.75),
        b: top ? (round ? 0.35 : 0.55) : lerp(round ? -0.35 : -0.5, round ? 0.3 : 0.45, rand()),
        r: top ? lerp(0.42, 0.55, rand()) : lerp(0.3, 0.48, rand()),
        tone: (rand() - 0.5) * 0.22,
      };
    });
    for (let k = 0; k < n; k++) {
      const L = lobes[Math.floor(rand() * lobes.length)];
      let a, b, c;
      do { a = rand() * 2 - 1; b = rand() * 2 - 1; c = rand() * 2 - 1; } while (a * a + b * b + c * c > 1);
      const la = L.a + a * L.r, lb = L.b + b * L.r * 1.1;
      const hy = baseY + Hh * cb + lb * Hh * (1 - cb);
      const x = cx + t[0] * la * Wd * 0.6 + rdir[0] * c * L.r * Wd * depthR * 2;
      const z = cz + t[2] * la * Wd * 0.6 + rdir[2] * c * L.r * Wd * depthR * 2;
      const rim = Math.hypot(a, b);
      const light = clamp(0.3 + b * 0.24 - a * 0.16 + lb * 0.2 - c * 0.1 + L.tone + (rim > 0.75 && b > 0 ? 0.12 : 0) + (rand() - 0.5) * 0.24, 0, 0.98);
      let col = jitterCol(pickQ(pTree, light), 0.06);
      if (sunLeaf) col = lerp3(col, sunLeaf, clamp((light - 0.5) * 1.2, 0, 0.45));
      const w = [x, hy, z];
      if (!keep(x, hy, z)) continue;
      col = edgeBlend(w, col, 2, 0.6);
      const maj = Hh * lerp(0.017, 0.036, rand()) * fineLeaf;
      const axis = axisInPlane(t, rand() < 0.6 ? lerp(0.3, 1.2, rand()) : rand() * Math.PI, maj);
      addExt(w, axis, maj * lerp(0.45, 0.68, rand()), col, 0.95, CLS.TREE, clamp((hy - baseY) / Hh, 0, 1));
      mirror(w, axis, maj * 0.5, col, 0.9, waterColAt(Math.hypot(x, z)));
      if (rand() < 0.16 && rim < 0.8) {
        const d = 1.012, uc = pickQ(pTree, light * 0.75);
        const um = maj * lerp(2.0, 2.8, rand());
        addExt([x * d, hy, z * d], axisInPlane(t, rand() * Math.PI, um), um * 0.6, edgeBlend(w, uc, 2, 0.5), 0.97, CLS.TREE, clamp((hy - baseY) / Hh, 0, 1) * 0.6);
      }
    }
    if (opts.trunk) {
      for (let k = 0; k < 90; k++) {
        const hy = baseY + rand() * Hh * 0.55;
        const x = cx + t[0] * (rand() - 0.5) * Hh * 0.035, z = cz + t[2] * (rand() - 0.5) * Hh * 0.035;
        const d = pickQ(pTree, rand() * 0.12);
        const col = [d[0] * 0.75 + 0.06, d[1] * 0.6 + 0.04, d[2] * 0.5 + 0.03];
        addExt([x, hy, z], [0, Hh * 0.05, 0], Hh * 0.012, col, 0.95, CLS.STATIC, 0);
      }
    }
  };

  const house = (cx, cz, baseY, w, hgt, wallPal, roofCol) => {
    const th = Math.atan2(cx, -cz), t = tangentAt(th);
    const n = Math.floor(w * hgt * 14);
    for (let k = 0; k < n; k++) {
      const a = rand() - 0.5, b = rand();
      const roof = b > 0.66;
      const span = roof ? (1 - (b - 0.66) / 0.34 * 0.7) : 1;
      const x = cx + t[0] * a * w * span, z = cz + t[2] * a * w * span;
      const y = baseY + b * hgt * 1.4;
      if (!keep(x, y, z)) continue;
      const rc = pickQ(wallPal, 0.15 + rand() * 0.35);
      const col = roof ? jitterCol([lerp(rc[0], roofCol[0], 0.35) * 0.9, lerp(rc[1], roofCol[1], 0.35) * 0.9, lerp(rc[2], roofCol[2], 0.35) * 0.9], 0.08) : jitterCol(pickQ(wallPal, 0.45 + rand() * 0.55), 0.06);
      const maj = hgt * lerp(0.06, 0.12, rand());
      const axis = roof ? [t[0] * maj, 0, t[2] * maj] : axisInPlane(t, rand() < 0.5 ? 0 : Math.PI / 2, maj);
      const ec = edgeBlend([x, y, z], col, 2, 0.4);
      addExt([x, y, z], axis, maj * 0.55, ec, 0.95, CLS.STATIC, 0);
      mirror([x, y, z], axis, maj * 0.5, ec, 0.95, waterColAt(Math.hypot(x, z)));
    }
  };

  if (ext.kind === 'field') {
    const K = 96;
    for (let k = 0; k < K; k++) {
      const th = ((k + rand() * 0.7) / K) * Math.PI * 2;
      if (vnoise2(Math.cos(th) * 2.2 + 4, Math.sin(th) * 2.2) < 0.34) continue;
      const r = lerp(ext.ring[0], ext.ring[1], rand());
      const Hh = lerp(5, 15, vnoise2(Math.cos(th) * 3.3 + 9, Math.sin(th) * 3.3 + 2)) * (0.7 + 0.6 * rand());
      const cx = r * Math.sin(th), cz = -r * Math.cos(th);
      if (!keep(cx, -h + Hh * 0.5, cz)) continue;
      treeClump(cx, cz, -h, Hh, Hh * lerp(0.6, 1.1, rand()), Q.treeDensity, { crownBase: 0.45 });
    }
    // hedgerow between the clumps
    for (let k = 0; k < 4200 * (Q.treeDensity / 3.2); k++) {
      const th = rand() * Math.PI * 2, r = lerp(ext.ring[0], ext.ring[1], rand());
      const x = r * Math.sin(th), z = -r * Math.cos(th);
      const y = -h + rand() * (1 + 3 * vnoise2(Math.cos(th) * 6, Math.sin(th) * 6));
      if (!keep(x, y, z)) continue;
      const col = jitterCol(pickQ(pal.tree, rand() * 0.55), 0.08);
      const maj = lerp(0.6, 1.4, rand());
      addExt([x, y, z], axisInPlane(tangentAt(th), rand() * Math.PI, maj), maj * 0.5, col, 0.9, CLS.TREE, 0.3);
    }
    ext.nearTrees.forEach(([deg, d, Hh]) => {
      const th = (deg * Math.PI) / 180;
      treeClump(d * Math.sin(th), -d * Math.cos(th), -h, Hh, Hh * 0.85, Q.nearTree, { round: true, trunk: true, crownBase: 0.58 });
    });
    const wallPal = pal.stat.length ? pal.stat : [[0.85, 0.8, 0.75]];
    ext.houses.forEach(([deg, d]) => {
      const th = (deg * Math.PI) / 180;
      house(d * Math.sin(th), -d * Math.cos(th), -h, 9, 4.5, wallPal, [0.72, 0.5, 0.44]);
    });
  } else {
    // riverbank wrapping around the viewer
    for (let k = 0; k < Q.shore; k++) {
      const th = rand() * Math.PI * 2, m = shoreMul(th);
      if (m < 0.02) continue;
      const r = shoreR(th) + rand() * 5;
      const x = r * Math.sin(th), z = -r * Math.cos(th);
      const y = -h + rand() * (0.9 + 1.6 * vnoise2(Math.cos(th) * 7, Math.sin(th) * 7)) * m;
      if (!keep(x, y, z)) continue;
      const col = edgeBlend([x, y, z], jitterCol(pickQ(pal.tree, 0.3 + rand() * 0.6), 0.07), 2, 0.75);
      const maj = lerp(0.4, 1.0, rand()) * (r / 40) ** 0.5;
      const axis = axisInPlane(tangentAt(th), Math.PI / 2 + (rand() - 0.5) * 0.8, maj);
      addExt([x, y, z], axis, maj * 0.42, col, 0.95, CLS.TREE, 0.3);
      mirror([x, y, z], axis, maj * 0.4, col, 0.9, waterColAt(r));
    }
    (ext.bankTrees || []).forEach(([deg, r, Hh, Wd]) => {
      const th = (deg * Math.PI) / 180;
      treeClump(r * Math.sin(th), -r * Math.cos(th), -h + 0.5, Hh, Wd, Q.treeDensity * 1.3, { crownBase: 0.3 });
    });
    const K = 150;
    for (let k = 0; k < K; k++) {
      const th = ((k + rand() * 0.8) / K) * Math.PI * 2, m = shoreMul(th);
      if (m < 0.3 || vnoise2(Math.cos(th) * 2.6 + 1, Math.sin(th) * 2.6 + 6) < 0.28) continue;
      const r = shoreR(th) + 2 + rand() * 8;
      const Hh = lerp(4, 11, vnoise2(Math.cos(th) * 5 + 3, Math.sin(th) * 5) * 0.6 + rand() * 0.4) * m * Math.min(1, r / 45 + 0.35);
      const cx = r * Math.sin(th), cz = -r * Math.cos(th);
      if (!keep(cx, -h + Hh * 0.5, cz)) continue;
      treeClump(cx, cz, -h + 0.6, Hh, Hh * lerp(0.9, 1.7, rand()), Q.treeDensity * 0.6, { crownBase: 0.3 });
    }
    const wallPal = pal.stat.filter((c) => c[0] > c[2] * 1.15);
    ext.houses.forEach(([deg]) => {
      const th = (deg * Math.PI) / 180, r = shoreR(th) + 5;
      house(r * Math.sin(th), -r * Math.cos(th), -h + 0.8, 7, 4, wallPal.length ? wallPal : [[0.8, 0.45, 0.3]], [0.66, 0.42, 0.32]);
    });
    // extra regatta boats
    const sailPal = pal.sail.length ? pal.sail : [[0.93, 0.9, 0.8]];
    ext.boats.forEach(([deg, d, Hh]) => {
      const th = (deg * Math.PI) / 180;
      const cx = d * Math.sin(th), cz = -d * Math.cos(th);
      const t = tangentAt(th + (rand() - 0.5) * 0.6);
      const L = Hh * 0.6, base = -h + 0.35;
      const at = (s, y) => [cx + t[0] * s, base + y, cz + t[2] * s];
      const wc = waterColAt(d);
      for (let k = 0; k < 140; k++) {
        const s = (rand() - 0.5) * L, y = rand() * 0.45 * (1 - Math.abs(s / L) * 1.2);
        const w = at(s, y);
        if (!keep(w[0], w[1], w[2])) continue;
        const col = rand() < 0.6 ? jitterCol(pickQ(sailPal, 0.3 + rand() * 0.4), 0.06) : jitterCol([0.42, 0.47, 0.58], 0.1);
        const axis = [t[0] * L * 0.12, 0, t[2] * L * 0.12];
        addExt(w, axis, 0.18, col, 0.95, CLS.SAIL, 0.05);
        mirror(w, axis, 0.18, col, 0.95, wc);
      }
      const tri = (A, Bp, Cp, n, shade) => {
        for (let k = 0; k < n; k++) {
          let a = rand(), b = rand();
          if (a + b > 1) { a = 1 - a; b = 1 - b; }
          const s = A[0] + (Bp[0] - A[0]) * a + (Cp[0] - A[0]) * b;
          const y = A[1] + (Bp[1] - A[1]) * a + (Cp[1] - A[1]) * b;
          const w = at(s, y);
          if (!keep(w[0], w[1], w[2])) continue;
          const q = clamp(0.35 + rand() * 0.6 - shade * (0.5 - b) * 0.6, 0, 0.99);
          const col = jitterCol(pickQ(sailPal, q), 0.05);
          const maj = Hh * lerp(0.05, 0.1, rand());
          const axis = [0, maj, 0];
          addExt(w, axis, maj * 0.5, col, 0.95, CLS.SAIL, clamp(y / Hh, 0, 1));
          mirror(w, axis, maj * 0.5, col, 0.95, wc);
        }
      };
      tri([0, 0.5], [0, Hh], [-L * 0.5, 0.55], Math.floor(Hh * Hh * 4.5), 1);
      tri([0.05, Hh * 0.92], [L * 0.42, 0.5], [0.05, 0.5], Math.floor(Hh * Hh * 3), 0.5);
      for (let k = 0; k < 30; k++) {
        const w = at(0, 0.4 + rand() * Hh);
        if (keep(w[0], w[1], w[2])) addExt(w, [0, Hh * 0.05, 0], 0.035, [0.25, 0.22, 0.2], 0.9, CLS.SAIL, w[1] / Hh);
      }
    });
    // sparkle on the river
    for (let k = 0; k < Q.glints; k++) {
      const th = rand() * Math.PI * 2, r = 2 + Math.pow(rand(), 1.6) * Math.min(48, shoreR(th) - 2);
      const x = r * Math.sin(th), z = -r * Math.cos(th);
      const s = 0.016 * Math.pow(r, 0.8);
      addExt([x, -h + 0.02, z], [Math.cos(th) * s * 2.5, 0, Math.sin(th) * s * 2.5], s * 0.6, [1, 0.97, 0.86], 0.9, CLS.GLINT, 1);
    }
  }
  reflections.forEach(([w, axis, minor, col, alpha]) => addExt(w, axis, minor, col, alpha, CLS.WATER, 1));

  // drifting motes of light
  for (let k = 0; k < (ext.kind === 'water' ? Q.motes * 0.45 : Q.motes); k++) {
    const x = (rand() - 0.5) * 36, y = -h + 0.25 + Math.pow(rand(), 1.5) * 3.2, z = (rand() - 0.5) * 36;
    const s = 0.016 + rand() * 0.022;
    addExt([x, y, z], [s, 0, 0], s * 0.85, [1, 0.84, 0.55], 0.55, CLS.MOTE, 0);
  }

  /* ---- hotspot anchors ---- */
  const hotspots = scene.hotspots.map((hs) => {
    const a = hotAcc.get(hs.id);
    if (!a) return { ...hs, center: [0, 0, -10], radius: 2 };
    const c = [a.x / a.n, a.y / a.n, a.z / a.n];
    const ds = a.pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])).sort((x, y) => x - y);
    const radius = ds[Math.floor(ds.length * 0.8)] || 2;
    return { ...hs, center: c, radius };
  });

  const horizon = mean(skyBins[0].concat(skyBins[1] || []));
  const zenith = topBlue;
  const ground = mean(groundBins[nBins - 1].concat(groundBins[nBins - 2]));
  const near = mean(groundBins[Math.floor(nBins * 0.45)]);

  return {
    count: B.n, A: B.A.subarray(0, B.n * 4), B: B.B.subarray(0, B.n * 4), C: B.C.subarray(0, B.n * 4),
    D: B.D.subarray(0, B.n * 4), E: B.E.subarray(0, B.n * 4),
    hotspots, front: frontDir, bg: { horizon, zenith, ground, near },
    paint: { f, vH, asp, xL: -0.5 / f, yT: (vH * asp) / f, yB: (-(1 - vH) * asp) / f },
  };
}
