import { buildUnified } from './unified.js';
import { buildPano } from './pano.js';
import { makeLayerEmitter } from './layered.js';

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

/*
 * What is resolved and what stays broad, by view direction: focus.foci = [[azimuth°, elevation°, radius across°,
 * radius up°, weight], ...] over focus.floor. Azimuth 0 is straight ahead, positive to the right. Tabulated every
 * half degree (the passes ask it millions of times). at(az, el) in radians, dir(d) for a unit direction.
 */
export function makeImportance(focus) {
  const IW = 720, IH = 360, T = new Float32Array(IW * IH), sp = focus.spread || 1;
  for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) {
    const vaz = (x + 0.5) / 2 - 180, vel = 90 - (y + 0.5) / 2;
    let m = focus.floor;
    for (const [a, e, ra, re, w] of focus.foci) {
      const da = ((((vaz - a) % 360) + 540) % 360) - 180;
      m = Math.max(m, w * Math.exp(-((da / (ra * sp)) ** 2 + ((vel - e) / (re * sp)) ** 2)));
    }
    T[y * IW + x] = m;
  }
  // the max of the foci leaves creases where two meet: blur them out (radius in degrees, wrapping in azimuth)
  if (focus.blur) {
    const r = Math.round(focus.blur * 2), tmp = new Float32Array(IW * IH);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += T[y * IW + (x + k + IW) % IW];
        tmp[y * IW + x] = s / (2 * r + 1);
      }
      for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += tmp[clamp(y + k, 0, IH - 1) * IW + x];
        T[y * IW + x] = s / (2 * r + 1);
      }
    }
  }
  const at = (vaz, vel) => T[clamp(Math.floor((0.5 - vel / Math.PI) * IH), 0, IH - 1) * IW + clamp(Math.floor((vaz / (2 * Math.PI) + 0.5) * IW), 0, IW - 1)];
  return { at, dir: (d) => at(Math.atan2(d[0], -d[2]), Math.asin(clamp(d[1], -1, 1))) };
}
// a stroke's seed with its edge softness (0 hard .. 1 soft) in the integer part, unpacked by the shader
export const softSeed = (soft, r) => Math.round(clamp(soft, 0, 1) * 7) + r * 0.999;

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
  high: { tier: 'high', uniAlpha: 0.0059, analysisW: 760, motes: 900, glints: 1800 },
  mid: { tier: 'mid', uniAlpha: 0.006, analysisW: 640, motes: 600, glints: 1200 },
  low: { tier: 'low', uniAlpha: 0.0071, analysisW: 520, motes: 500, glints: 700 },
};

export async function loadImage(src) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  return img;
}

export function buildScene(scene, img, Q, layerSet = null, panoExt = null) {
  if (scene.pano) return buildPano(scene, layerSet, Q);
  return buildUnified(scene, layerSet ? layerSet.base : img, Q, layerSet ? makeLayerEmitter(layerSet, Q) : null, panoExt);
}
