import { CLS } from './scenes.js';

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
const fract = (x) => x - Math.floor(x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash3 = (x, y, z) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
function vnoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const h = (a, b, c) => hash3(ix + a, iy + b, iz + c);
  const x00 = lerp(h(0, 0, 0), h(1, 0, 0), ux), x10 = lerp(h(0, 1, 0), h(1, 1, 0), ux);
  const x01 = lerp(h(0, 0, 1), h(1, 0, 1), ux), x11 = lerp(h(0, 1, 1), h(1, 1, 1), ux);
  return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz);
}
const vnoise2 = (x, y) => vnoise3(x, y, 0.5);
function fbm3(x, y, z, oct = 4) {
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise3(x, y, z); n += a; x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; }
  return s / n;
}
const fbm2 = (x, y, oct) => fbm3(x, y, 0.37, oct);

function blur1(src, W, H, r) {
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
function blurRGB(rgb, W, H, r) {
  const N = W * H, out = new Float32Array(N * 3);
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(N);
    for (let i = 0; i < N; i++) ch[i] = rgb[i * 3 + c];
    let b = blur1(ch, W, H, r); b = blur1(b, W, H, Math.max(1, r >> 1));
    for (let i = 0; i < N; i++) out[i * 3 + c] = b[i];
  }
  return out;
}

/* ---------------- splat buffer ---------------- */
class Builder {
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
  high: { analysisW: 760, layers: [12, 6, 3.0], detail: 2.0, extGround: 90000, extSky: 20000, treeDensity: 3.2, nearTree: 15, motes: 900, glints: 1800, shore: 14000 },
  mid: { analysisW: 640, layers: [12, 6.2, 3.3], detail: 2.3, extGround: 60000, extSky: 14000, treeDensity: 2.2, nearTree: 11, motes: 600, glints: 1200, shore: 9000 },
  low: { analysisW: 520, layers: [13, 7, 3.8], detail: 2.8, extGround: 34000, extSky: 9000, treeDensity: 1.4, nearTree: 8, motes: 500, glints: 700, shore: 5000 },
};

export async function loadImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/* ============================================================ */
export function buildScene(scene, img, Q) {
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

  const B = new Builder(400000);
  const sC = 3.0 / f;
  const hotAcc = new Map();

  const toWorld = (u, v, depth) => { const s = depth / f; return [(u - 0.5) * s, -(v - vH) * asp * s, -depth]; };
  const frontDir = (() => { const y = -(0.5 - vH) * asp; const l = Math.hypot(y, f); return [0, y / l, -f / l]; })();

  /* ---- painted strokes ---- */
  const layerDefs = [
    { sp: Q.layers[0], maj: [1.5, 2.6], min: [0.6, 0.9], a: 0.95, src: b3 },
    { sp: Q.layers[1], maj: [1.3, 2.3], min: [0.55, 0.85], a: 0.9, src: b2 },
    { sp: Q.layers[2], maj: [1.2, 2.1], min: [0.55, 0.85], a: 0.86, src: b1 },
    { sp: Q.detail, maj: [1.0, 1.9], min: [0.5, 0.8], a: 0.88, src: b1, detail: true },
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
        const c = clsMap[i];
        if (L.detail) {
          let p = clamp(grad[i] * 9 - 0.12, 0, 0.85);
          if (c === CLS.SKY) p *= 0.15;
          if (rand() > p) continue;
          const dl = Math.abs(lum[i] - (0.3 * b2[i * 3] + 0.59 * b2[i * 3 + 1] + 0.11 * b2[i * 3 + 2]));
          if (dl > (c === CLS.SKY ? 0.06 : 0.2)) continue;
        }
        if (c === CLS.SKY && li >= 2 && rand() < 0.3) continue;
        if (li === 0 && !isGround(c)) continue;
        if (c === CLS.SKY && li === 3) continue;

        const k = c === CLS.SKY ? (li === 0 ? b3 : b2) : !isGround(c) && li < 2 ? b1 : L.src;
        const jit = 1 + (rand() - 0.5) * 0.07;
        const col = [
          clamp(k[i * 3] * jit + (rand() - 0.5) * 0.025, 0, 1),
          clamp(k[i * 3 + 1] * jit + (rand() - 0.5) * 0.025, 0, 1),
          clamp(k[i * 3 + 2] * jit + (rand() - 0.5) * 0.025, 0, 1),
        ];

        const sxx = Jxx[i], sxy = Jxy[i], syy = Jyy[i];
        const coh = Math.sqrt((sxx - syy) ** 2 + 4 * sxy * sxy) / (sxx + syy + 1e-6);
        let ang;
        if (rand() < coh * 1.3) ang = 0.5 * Math.atan2(2 * sxy, sxx - syy) + Math.PI / 2;
        else if (c === CLS.SKY) ang = (rand() - 0.5) * 0.6;
        else if (c === CLS.GRASS) ang = Math.PI / 2 + (rand() - 0.5) * 1.1;
        else if (c === CLS.WATER) ang = (rand() - 0.5) * 0.18;
        else if (c === CLS.SAIL) ang = Math.PI / 2 + (rand() - 0.5) * 0.5;
        else ang = rand() * Math.PI;

        let maj = sp * lerp(L.maj[0], L.maj[1], rand());
        let mn = sp * lerp(L.min[0], L.min[1], rand());
        if (c === CLS.WATER) { maj *= 1.35; mn *= 0.85; }
        if (c === CLS.SKY && li === 0) maj *= 1.25;

        const u = x / W, v = y / H, depth = depMap[i];
        const s = depth / f, sc = sC * (1 + 0.004 * (3 - li));
        const w = toWorld(u, v, depth);
        const cpos = [(u - 0.5) * sc, -(v - vH) * asp * sc, -f * sc];
        const unit = s / W;
        const axis = [Math.cos(ang) * maj * unit, -Math.sin(ang) * maj * unit, 0];
        const rad = Math.hypot(u - 0.5, (v - 0.5) * asp) / 0.62;
        const delay = clamp(rad * 0.62 + rand() * 0.38, 0, 1);
        const hot = hotMap[i];
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
  for (let j = 0; j < nPaint; j++) {
    const o = j * 4;
    const cls = B.B[o + 3], hot = B.E[o];
    if (hot > 0 && rand() < 0.16) {
      const col = [lerp(B.D[o], 1.0, 0.55), lerp(B.D[o + 1], 0.84, 0.55), lerp(B.D[o + 2], 0.56, 0.55)];
      B.add([B.A[o], B.A[o + 1], B.A[o + 2]], [B.B[o], B.B[o + 1], B.B[o + 2]],
        [B.C[o] * 2.6, B.C[o + 1] * 2.6, B.C[o + 2] * 2.6], B.C[o + 3] * 3.2, col, 1, CLS.HALO, hot, 0, B.E[o + 2], 0, rand());
    }
    if (scene.ext.petals && cls === CLS.FLOWER && -B.A[o + 2] < 30 && rand() < 0.4) {
      B.add([B.A[o], B.A[o + 1], B.A[o + 2]], [B.A[o], B.A[o + 1], B.A[o + 2]],
        [B.C[o] * 0.7, B.C[o + 1] * 0.7, B.C[o + 2] * 0.7], B.C[o + 3] * 0.8,
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
  const pal = { tree: [], flower: [], stat: [], sail: [] };
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const i = y * W + x, c = clsMap[i];
    const col = [b2[i * 3], b2[i * 3 + 1], b2[i * 3 + 2]];
    if (c === CLS.GRASS) groundBins[binOf(depMap[i])].push(col);
    else if (c === CLS.WATER) { if (col[2] >= col[0] * 0.98 || rand() < 0.08) groundBins[binOf(depMap[i])].push(col); }
    else if (c === CLS.SKY) {
      const yy = -((y + 0.5) / H - vH) * asp, xx = (x + 0.5) / W - 0.5;
      const e = Math.atan2(yy, Math.hypot(xx, f));
      skyBins[clamp(Math.floor((e / topElev) * nSky), 0, nSky - 1)].push(col);
    }
    else if (c === CLS.TREE) pal.tree.push(col);
    else if (c === CLS.FLOWER) pal.flower.push(col);
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
    const e = Math.min(u, 1 - u, v, 1 - v);
    if (e < 0) return true;
    if (e < 0.014) return rand() < (1 - e / 0.014) * 0.55;
    return false;
  };
  const extDelay = (x, y, z) => {
    const l = Math.hypot(x, y, z) || 1;
    const d = (x * frontDir[0] + y * frontDir[1] + z * frontDir[2]) / l;
    return clamp((Math.acos(clamp(d, -1, 1)) - 0.3) / 2.7, 0, 1) * 0.85 + rand() * 0.15;
  };
  const addExt = (w, axis, minor, col, alpha, cls, flex, hot = 0) =>
    B.add(w, w, axis, minor, col, alpha, cls, hot, flex, extDelay(w[0], w[1], w[2]), 1, rand());
  const up = [0, 1, 0];
  const tangentAt = (th) => [Math.cos(th), 0, Math.sin(th)];
  const axisInPlane = (t, a, len) => [(up[0] * Math.cos(a) + t[0] * Math.sin(a)) * len, (up[1] * Math.cos(a)) * len, (up[2] * Math.cos(a) + t[2] * Math.sin(a)) * len];

  const h = cam.h, ext = scene.ext;
  const reflections = [];
  const mirror = (w, axis, minor, col, alpha, waterCol) => {
    if (ext.kind !== 'water') return;
    const yRel = w[1] + h;
    if (yRel < 0.02 || rand() > 0.62) return;
    const wm = [w[0] + (rand() - 0.5) * 0.4, -h - yRel * 0.95, w[2]];
    const th = Math.atan2(w[0], -w[2]);
    const t = tangentAt(th);
    const len = Math.hypot(axis[0], axis[1], axis[2]) * 1.4;
    const c = [lerp(col[0] * 0.8, waterCol[0], 0.38), lerp(col[1] * 0.8, waterCol[1], 0.38), lerp(col[2] * 0.82, waterCol[2], 0.38)];
    reflections.push([wm, [t[0] * len, 0, t[2] * len], minor * 0.7, c, alpha * 0.6]);
  };
  const waterColAt = (d) => pick(groundBins[binOf(d)]);

  // ground plane: grass field or river surface
  const shoreR = (th) => {
    let d = (th * 180) / Math.PI; d = ((d + 540) % 360) - 180;
    if (d >= 0) return 30 + 88 * smooth(55, 150, d);
    return 118;
  };
  const shoreMul = (th) => { let d = (th * 180) / Math.PI; d = ((d + 540) % 360) - 180; return d < 0 ? smooth(35, 95, -d) : 1; };

  const nG = Q.extGround;
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
      let col = pick(groundBins[binOf(r)]), cls = CLS.GRASS;
      const s = 0.05 * Math.pow(r, 0.62);
      let maj = s * lerp(1.0, 2.0, rand()), mn = s * lerp(0.35, 0.62, rand());
      if (ext.flowers) {
        const n = fbm2(x * 0.06 + 3.1, z * 0.06 - 1.7, 3);
        if (n > 0.56 && rand() < (n - 0.56) * 3.2 && pal.flower.length) { col = pick(pal.flower); cls = CLS.FLOWER; maj *= 0.6; mn *= 0.85; }
      }
      const a = rand() < 0.65 ? (rand() - 0.5) * 0.9 : rand() * Math.PI;
      const idx = addExt([x, y, z], axisInPlane(t, a, maj), mn, jitterCol(col), 0.86, cls, 0.35 + rand() * 0.65);
      if (cls === CLS.FLOWER && ext.petals && r < 26 && rand() < 0.35) {
        addExt([x, y, z], axisInPlane(t, rand() * 3, maj * 0.7), mn * 0.8, [Math.min(1, col[0] * 1.1), col[1], col[2]], 0.95, CLS.PETAL, 1);
      }
      void idx;
    } else {
      const wc = pick(groundBins[binOf(r)]), hz = pickQ(skyBins[1], 0.3 + rand() * 0.6);
      const kf = smooth(22, 100, r) * 0.6;
      const col = jitterCol([lerp(wc[0], hz[0], kf), lerp(wc[1], hz[1], kf), lerp(wc[2], hz[2], kf)], 0.06);
      const s = 0.07 * Math.pow(r, 0.64);
      const maj = s * lerp(1.2, 2.6, rand()), mn = maj * lerp(0.16, 0.3, rand());
      const a = Math.PI / 2 + (rand() - 0.5) * 0.16;
      addExt([x, y, z], axisInPlane(t, a, maj), mn, col, 0.85, CLS.WATER, 0.5 + rand() * 0.5);
    }
  }

  // sky dome
  const R = cam.sky;
  const topBlue = mean(skyBins[nSky - 1].slice(0, Math.max(1, skyBins[nSky - 1].length >> 2)));
  for (let k = 0; k < Q.extSky * 1.3; k++) {
    const sinE = lerp(Math.sin(-0.06), 1, rand());
    const e = Math.asin(sinE), th = rand() * Math.PI * 2;
    const dir = [Math.cos(e) * Math.sin(th), sinE, -Math.cos(e) * Math.cos(th)];
    const w = [dir[0] * R, dir[1] * R, dir[2] * R];
    if (!keep(w[0], w[1], w[2])) continue;
    const n = fbm3(dir[0] * 2.4 + 5.2, dir[1] * 3.2, dir[2] * 2.4 - 1.3, 4);
    let bin = Math.floor((Math.max(e, 0) / topElev) * nSky);
    if (bin >= nSky) bin = nSky - 1 - Math.floor(rand() * 4);
    const arr = skyBins[clamp(bin, 0, nSky - 1)];
    const q = clamp(n * 1.45 - 0.12 + (rand() - 0.5) * 0.3, 0, 0.999);
    let col = pickQ(arr, q);
    const zen = smooth(topElev, 1.45, e) * (1 - q) * 0.45;
    col = [lerp(col[0], topBlue[0] * 0.92, zen), lerp(col[1], topBlue[1] * 0.96, zen), lerp(col[2], Math.min(1, topBlue[2] * 1.04), zen)];
    const t = tangentAt(th);
    const rot = (n - 0.5) * 1.5 + (rand() - 0.5) * 0.45;
    const maj = R * lerp(0.045, 0.1, rand()) * (e > 1.0 ? 1.3 : 1);
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const axis = [(t[0] * ca) * maj, sa * maj * Math.cos(e), (t[2] * ca) * maj];
    addExt(w, axis, maj * lerp(0.3, 0.5, rand()), jitterCol(col, 0.04), 0.82, CLS.SKY, 0);
  }

  // tree clumps (shared by distant ring, riverbank and near trees)
  const treeClump = (cx, cz, baseY, Hh, Wd, density, opts = {}) => {
    const n = Math.floor(Hh * Wd * density * 1.6);
    const th = Math.atan2(cx, -cz), t = tangentAt(th);
    const rdir = [Math.sin(th), 0, -Math.cos(th)];
    const depthR = opts.round ? Wd * 0.5 : Wd * 0.18;
    const pTree = pal.tree.length ? pal.tree : [[0.25, 0.35, 0.22]];
    for (let k = 0; k < n; k++) {
      let a, b, c;
      do { a = rand() * 2 - 1; b = rand() * 2 - 1; c = rand() * 2 - 1; } while (a * a + b * b + c * c > 1);
      const hy = baseY + Hh * (opts.crownBase ?? 0.5) + b * Hh * (1 - (opts.crownBase ?? 0.5));
      const x = cx + t[0] * a * Wd * 0.5 + rdir[0] * c * depthR;
      const z = cz + t[2] * a * Wd * 0.5 + rdir[2] * c * depthR;
      const light = clamp(0.22 + (b * 0.5 + 0.5) * 0.42 - a * 0.14 - c * 0.12 + (rand() - 0.5) * 0.36, 0, 0.98);
      const col = jitterCol(pickQ(pTree, light), 0.08);
      const maj = Hh * lerp(0.035, 0.08, rand());
      const axis = axisInPlane(t, rand() * Math.PI, maj);
      const w = [x, hy, z];
      if (!keep(x, hy, z)) continue;
      addExt(w, axis, maj * lerp(0.45, 0.7, rand()), col, 0.9, CLS.TREE, clamp((hy - baseY) / Hh, 0, 1));
      mirror(w, axis, maj * 0.5, col, 0.9, waterColAt(Math.hypot(x, z)));
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
      addExt([x, y, z], axis, maj * 0.55, col, 0.95, CLS.STATIC, 0);
      mirror([x, y, z], axis, maj * 0.5, col, 0.95, waterColAt(Math.hypot(x, z)));
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
      const col = jitterCol(pickQ(pal.tree, 0.3 + rand() * 0.6), 0.08);
      const maj = lerp(0.5, 1.3, rand()) * (r / 40) ** 0.5;
      const axis = axisInPlane(tangentAt(th), Math.PI / 2 + (rand() - 0.5) * 0.8, maj);
      addExt([x, y, z], axis, maj * 0.4, col, 0.9, CLS.TREE, 0.3);
      mirror([x, y, z], axis, maj * 0.4, col, 0.9, waterColAt(r));
    }
    const K = 70;
    for (let k = 0; k < K; k++) {
      const th = ((k + rand() * 0.7) / K) * Math.PI * 2, m = shoreMul(th);
      if (m < 0.3 || vnoise2(Math.cos(th) * 2.6 + 1, Math.sin(th) * 2.6 + 6) < 0.4) continue;
      const r = shoreR(th) + 2 + rand() * 6;
      const Hh = lerp(5, 13, rand()) * m * Math.min(1, r / 45 + 0.35);
      const cx = r * Math.sin(th), cz = -r * Math.cos(th);
      if (!keep(cx, -h + Hh * 0.5, cz)) continue;
      treeClump(cx, cz, -h + 0.6, Hh, Hh * lerp(0.4, 0.9, rand()), Q.treeDensity, { crownBase: 0.35 });
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
        const col = rand() < 0.55 ? jitterCol(pickQ(sailPal, 0.3), 0.06) : [0.22, 0.24, 0.3];
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
