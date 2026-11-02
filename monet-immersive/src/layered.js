import { CLS } from './scenes.js';
import { clamp, lerp, smooth, blur1, blurMasked, fbm2, softSeed } from './generator.js';

/*
 * Element cards from the art team's layer split.
 *
 * The unified field paints the clean plate (sky, river, far village, grass bank). Every PSD element then
 * stands on its own card at the distance where it meets the bank or the river, stacked in PSD order, so
 * a moving eye sees the layers slide past one another and the plate behind them is already clean.
 * The extra sails and trees are staged around the viewer beyond the frame. Strokes on elements are
 * finer than on the plate, never straddle an element's silhouette, and take colour only from the
 * element's own pixels.
 */

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

export async function loadLayerSet(spec, loadImage) {
  const [base, dabs, ...imgs] = await Promise.all([spec.base, spec.dabs ? spec.dabs.src : spec.base, ...spec.cards.map((c) => c.src), ...spec.extras.map((e) => e.src)].map(loadImage));
  const n = spec.cards.length;
  return { spec, base, dabs, cards: imgs.slice(0, n), extras: imgs.slice(n) };
}

// a sprite: an element image read at a working resolution, with masked colour levels and edge maps
function readSprite(img, w, rgbOut = true) {
  w = Math.max(8, Math.round(w));
  const h = Math.max(8, Math.round((w * (img.naturalHeight || img.height)) / (img.naturalWidth || img.width))), N = w * h;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, w, h);
  const px = cx.getImageData(0, 0, w, h).data;
  const rgb = new Float32Array(N * 3), a = new Float32Array(N), m = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    a[i] = px[i * 4 + 3] / 255; m[i] = a[i] > 0.5 ? 1 : 0;
    for (let j = 0; j < 3; j++) rgb[i * 3 + j] = px[i * 4 + j] / 255;
  }
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) lum[i] = 0.3 * rgb[i * 3] + 0.59 * rgb[i * 3 + 1] + 0.11 * rgb[i * 3 + 2];
  const jxx = new Float32Array(N), jxy = new Float32Array(N), jyy = new Float32Array(N), grad = new Float32Array(N);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = (lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1]) - (lum[i - w - 1] + 2 * lum[i - 1] + lum[i + w - 1]);
    const gy = (lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1]) - (lum[i - w - 1] + 2 * lum[i - w] + lum[i - w + 1]);
    jxx[i] = gx * gx; jxy[i] = gx * gy; jyy[i] = gy * gy; grad[i] = Math.hypot(gx, gy) * m[i];
  }
  const r = Math.max(1, Math.round(w / 220));
  return { w, h, rgb, a, m, lum, grad, Jxx: blur1(jxx, w, h, r * 2), Jxy: blur1(jxy, w, h, r * 2), Jyy: blur1(jyy, w, h, r * 2), lv: new Map(), am: new Map() };
}
// colour blurred only among the element's own pixels, so nothing bleeds in from the transparent surround
const level = (s, r) => {
  r = Math.max(0, Math.round(r));
  if (!s.lv.has(r)) s.lv.set(r, r === 0 ? s.rgb : blurMasked(s.rgb, s.m, s.rgb, s.w, s.h, r));
  return s.lv.get(r);
};
// how solidly a disc of radius r around each pixel lies inside the silhouette
const solid = (s, r) => {
  r = Math.max(1, Math.round(r));
  if (!s.am.has(r)) s.am.set(r, blur1(blur1(s.m, s.w, s.h, r), s.w, s.h, Math.max(1, r >> 1)));
  return s.am.get(r);
};

const pixels = (img) => {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  return { w, h, d: cx.getImageData(0, 0, w, h).data };
};

/*
 * A band of shrubs in front of the bank elements, painted from a grove layer's own pixels. It hides where
 * the tree and the houses meet the ground, so their cards never show a hard foot when the eye moves.
 * hd: { src, box: [u0, v0, u1, v1] (frame coords), depth, seed }; the band fills the box below a lumpy top
 * edge and tapers at both ends. W x H is the canvas size in pixels.
 */
function makeHedge(src, hd, W, H) {
  const G = pixels(src), seed = hd.seed ?? 1;
  const rows = [];
  for (let y = 0; y < G.h; y++) { const r = []; for (let x = 0; x < G.w; x++) if (G.d[(y * G.w + x) * 4 + 3] > 160) r.push(x); rows.push(r); }
  const g0 = Math.floor(G.h * 0.35), g1 = Math.floor(G.h * 0.95);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ox = out.getContext('2d');
  const od = ox.createImageData(W, H);
  const s = 7 / W;
  for (let X = 0; X < W; X++) {
    const fx = X / (W - 1), end = Math.min(fx, 1 - fx);
    // bushy crowns along the top, lower towards the ends
    const crown = 0.08 + 0.42 * (1 - fbm2(X * s * 1.6 + seed * 3.1, seed, 3)) * smooth(0, 0.12, end) + 0.5 * (1 - smooth(0, 0.12, end));
    const top = H * crown;
    for (let Y = Math.max(0, Math.floor(top)); Y < H; Y++) {
      const gy = clamp(Math.round(g0 + (fbm2(X * s + 7.7, Y * s + seed, 2) * 1.6 - 0.3) * (g1 - g0)), g0, g1);
      const r = rows[gy];
      if (!r.length) continue;
      // the source column wanders with height too, or each column repeats one grove column straight down and
      // the band reads as vertical streaks
      const want = ((((fx * 0.8 + 0.1 + seed * 0.137 + (fbm2(X * s * 4 + 3.3, Y * s * 4 + seed * 5.1, 3) - 0.5) * 0.5) % 1) + 1) % 1) * G.w;
      let gx = r[0];
      for (const q of r) if (Math.abs(q - want) < Math.abs(gx - want)) gx = q;
      const gi = (gy * G.w + gx) * 4, oi = (Y * W + X) * 4;
      const lit = 1 + 0.1 * smooth(0.12, 0, (Y - top) / H);
      for (let j = 0; j < 3; j++) od.data[oi + j] = clamp(G.d[gi + j] * lit, 0, 255);
      od.data[oi + 3] = 255;
    }
  }
  ox.putImageData(od, 0, 0);
  return out;
}

/*
 * The canopy above the frame for an element cut by the frame's top edge: its own top rows mirrored upward,
 * under a ragged crown line that is tallest where the element meets the edge most solidly and falls away
 * where it does not. G: the element's pixels; W x H the crown (H px = the crown's height above the edge);
 * ratio: element height / crown height.
 */
function makeCrown(G, W, H, ratio, seed) {
  const solidTop = new Float32Array(W);
  for (let X = 0; X < W; X++) {
    const gx = Math.min(G.w - 1, Math.floor((X / W) * G.w));
    let s = 0;
    for (let y = 0; y < Math.min(G.h, 4); y++) s += G.d[(y * G.w + gx) * 4 + 3] > 128 ? 0.25 : 0;
    solidTop[X] = s;
  }
  const run = blur1(blur1(solidTop, W, 1, Math.max(2, W >> 5)), W, 1, Math.max(2, W >> 6));
  const hash = (k) => { const x = Math.sin(k * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x); };
  const trees = [];
  for (let c = -0.05 * W, k = 0; c < 1.05 * W; k++) {
    const w = W * (0.1 + 0.12 * hash(k));
    trees.push({ c, w, h: 0.35 + 0.65 * hash(k + 50) });
    c += w * (0.9 + 0.5 * hash(k + 99));
  }
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ox = out.getContext('2d');
  const od = ox.createImageData(W, H);
  for (let X = 0; X < W; X++) {
    // a row of separate rounded tree crowns of different heights, ragged at the rim, never a level line
    let dome = 0;
    for (const t of trees) { const q = (X - t.c) / t.w; if (Math.abs(q) < 1) dome = Math.max(dome, t.h * Math.sqrt(1 - q * q)); }
    const rag = 0.88 + 0.24 * fbm2(X * (18 / W) + seed * 3.7, seed * 1.3, 3), tips = Math.pow(fbm2(X * (45 / W) + seed, seed * 2.1 + 5, 2), 3);
    const hc = H * smooth(0.25, 0.9, run[X]) * Math.min(1, dome * rag + 0.25 * tips);
    const gx = Math.min(G.w - 1, Math.floor((X / W) * G.w));
    for (let k = 0; k < hc; k++) {
      const gy = Math.min(G.h - 1, Math.floor((k / H) * (G.h / ratio)));
      const gi = (gy * G.w + gx) * 4;
      if (G.d[gi + 3] <= 128) continue;
      const oi = ((H - 1 - k) * W + X) * 4;
      for (let j = 0; j < 3; j++) od.data[oi + j] = G.d[gi + j];
      od.data[oi + 3] = 255;
    }
  }
  ox.putImageData(od, 0, 0);
  return out;
}

export function makeLayerEmitter(set, Q) {
  const spec = set.spec;
  let occMap = null;
  const pixCache = new Map();
  const pix = (j) => { if (!pixCache.has(j)) pixCache.set(j, pixels(set.cards[j])); return pixCache.get(j); };

  return {
    // the plate's bank behind an element steps back behind that element's card
    occlude({ W, H, cls, depZ, groundZ, wl, f }) {
      occMap = new Float32Array(W * H);
      spec.cards.forEach((c, k) => {
        if (c.kind === 'sail' || c.kind === 'lily') return;
        const [u0, v0, u1, v1] = c.box;
        const s = readSprite(set.cards[k], Math.max(8, (u1 - u0) * W), false);
        for (let y = Math.floor(v0 * H); y < Math.ceil(v1 * H); y++) for (let x = Math.floor(u0 * W); x < Math.ceil(u1 * W); x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const sx = Math.floor(((x + 0.5) / W - u0) / (u1 - u0) * s.w), sy = Math.floor(((y + 0.5) / H - v0) / (v1 - v0) * s.h);
          if (sx < 0 || sy < 0 || sx >= s.w || sy >= s.h || s.a[sy * s.w + sx] < 0.3) continue;
          const i = y * W + x;
          occMap[i] = Math.max(occMap[i], depthAt(c, (x + 0.5) / W, (y + 0.5) / H, groundZ, wl));
        }
      });
      // plate water too: a foot painted below the plate's own water line must not sink under the pond
      for (let i = 0; i < W * H; i++) if (occMap[i] > 0 && cls[i] !== CLS.SKY) depZ[i] = Math.max(depZ[i], occMap[i] * 1.12);
      // plate pixels so far inside the cards that no eye position (spec.hideShift) can see them
      const shift = spec.hideShift ?? 0;
      if (!shift) return null;
      const hid = new Uint8Array(W * H);
      const cov = (x, y) => x >= 0 && y >= 0 && x < W && y < H && occMap[y * W + x] > 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, dc = occMap[i];
        if (!(dc > 0) || cls[i] === CLS.SKY) continue;
        const m = Math.ceil((shift * (1 / dc - 1 / depZ[i]) * f + 0.006) * W);
        if (cov(x - m, y) && cov(x + m, y) && cov(x, y - m) && cov(x, y + m)) hid[i] = 1;
      }
      return hid;
    },

    emit(ctx) {
      const { B, rand, f, vH, asp, h, groundZ, wl, alpha0, layers, extDelay, proj, inRect, sC, hotAcc, shoreS, baseWater, imp } = ctx;
      // focus (the plate's importance by direction): elements in minor places lose their finer passes and soften
      const softOf = (li, im) => (li === 0 ? 0.2 + 0.55 * (1 - im) : li === 1 ? 0.1 + 0.45 * (1 - im) : li === 2 ? 0.3 * (1 - im) : 0);
      const gate = spec.focusPasses;
      const stats = [];
      const fine = spec.fine;

      // one element: place(sx, sy) -> world point on its card; frame = { R, U } card axes; pxAng = radians per sprite pixel
      const emitSprite = (s, o) => {
        let n = 0;
        // thin, broken elements (lily pads) skip the broad passes, which would average them into one blot
        for (let li = o.minLayer || 0; li < 4; li++) {
          const L = layers[li];
          const sp = alpha0 * L.k * (o.fine || fine) * (o.ext ? o.spMul || 1 : 1);
          const step = sp / o.pxAng;
          if (step < 0.7 && li < 3) continue;
          const st = Math.max(0.7, step);
          const img = level(s, li === 3 ? 0 : st * [0.55, 0.45, 0.25][li]);
          const inner = solid(s, Math.max(1, st * (li === 3 ? 0.35 : 0.6)));
          // the finest pass may sit on thin structures (masts, rigging, window bars) the coarser passes skip
          const need = [0.97, 0.9, 0.75, 0.3][li];
          for (let yy = st * 0.5; yy < s.h; yy += st * 0.866) {
            const off = rand() * st;
            for (let xx = off; xx < s.w; xx += st) {
              const x = clamp(Math.round(xx + (rand() - 0.5) * st * 0.8), 0, s.w - 1), y = clamp(Math.round(yy + (rand() - 0.5) * st * 0.8), 0, s.h - 1);
              const i = y * s.w + x;
              if (!s.m[i] || inner[i] < need) continue;
              if (li === 3 && rand() > clamp(s.grad[i] * 6 - 0.05, o.flatMin ?? 0.15, 0.9)) continue;
              const P = o.place(x + 0.5, y + 0.5);
              const d = norm(P), dist = Math.hypot(P[0], P[1], P[2]);
              const im = imp ? imp(d) : 1;
              if (imp && gate && li >= 1 && rand() > lerp(gate[li - 1], 1, smooth(0.1, 0.8, im))) continue;
              // only elements beyond the frame soften: soft strokes on the stacked cards in the frame veil the plate
              const so = imp && o.ext ? softOf(li, im) : 0;
              const coh = Math.sqrt((s.Jxx[i] - s.Jyy[i]) ** 2 + 4 * s.Jxy[i] ** 2) / (s.Jxx[i] + s.Jyy[i] + 1e-6);
              let a = rand() < coh * 1.4 ? 0.5 * Math.atan2(2 * s.Jxy[i], s.Jxx[i] - s.Jyy[i]) + Math.PI / 2 : o.angle(rand);
              if (o.flipX) a = Math.PI - a;
              let maj = sp * lerp(L.maj[0], L.maj[1], rand()), mn = sp * lerp(L.min[0], L.min[1], rand());
              // near the silhouette strokes shrink and follow the edge so the outline stays legible
              const edge = smooth(need, 1, inner[i]);
              maj *= lerp(0.6, 1, edge) * (1 + 0.25 * so); mn *= lerp(0.75, 1, edge) * (1 + 0.35 * so);
              const ca = Math.cos(a) * maj * dist, sa = -Math.sin(a) * maj * dist;
              const axis = [o.R[0] * ca + o.U[0] * sa, o.R[1] * ca + o.U[1] * sa, o.R[2] * ca + o.U[2] * sa];
              const jit = 1 + (rand() - 0.5) * 0.06;
              const col = [0, 1, 2].map((j) => clamp(img[i * 3 + j] * jit + (rand() - 0.5) * 0.02, 0, 1));
              const fy = 1 - (y + 0.5) / s.h;
              const lumP = 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2];
              const c = o.cls(col, lumP, fy, o.hull);
              const flex = (c === CLS.SAIL ? clamp((fy - o.hull) / (1 - o.hull), 0, 1) : c === CLS.TREE ? fy : 0) * (o.flexMul ?? 1);
              let cpos = P, delay;
              if (!o.ext) {
                const sc = sC * (1 + 0.004 * (3 - li)) * f / -d[2];
                cpos = [d[0] * sc, d[1] * sc, d[2] * sc];
                const p = proj(d);
                const rad = Math.hypot(p[0] - 0.5, (p[1] - 0.5) * asp) / 0.62;
                delay = clamp(rad * 0.62 + rand() * 0.38, 0, 1);
              } else delay = extDelay(P);
              B.add(P, cpos, axis, mn * dist, col, L.a, c, o.hot, flex, delay, o.ext ? 1 : 0, softSeed(so, rand()));
              n++;
              if (o.hot) {
                let acc = hotAcc.get(o.hot);
                if (!acc) { acc = { n: 0, x: 0, y: 0, z: 0, pts: [] }; hotAcc.set(o.hot, acc); }
                acc.n++; acc.x += P[0]; acc.y += P[1]; acc.z += P[2];
                if (rand() < 0.2) acc.pts.push(P);
              }
              if (o.refl && rand() < o.refl) n += reflect(P, axis, mn * dist, col, L.a, o.ext, c === CLS.SAIL ? flex : 0);
            }
          }
        }
        // outline: short hard strokes laid along the silhouette, coloured from just inside it, so a sail or a
        // house ends in a clean edge (spacing and length relative to the finest pass)
        if (o.outline) {
          const L = layers[3];
          const sp = alpha0 * L.k * (o.fine || fine) * (o.ext ? o.spMul || 1 : 1) * o.outline;
          const st = Math.max(0.7, sp / o.pxAng), cov = solid(s, Math.max(1, st * 0.6)), img = level(s, st * 0.3);
          for (let yy = st * 0.5; yy < s.h; yy += st * 0.7) {
            for (let xx = rand() * st; xx < s.w; xx += st * 0.7) {
              const x = clamp(Math.round(xx), 1, s.w - 2), y = clamp(Math.round(yy), 1, s.h - 2), i = y * s.w + x;
              if (!s.m[i] || cov[i] > 0.8 || cov[i] < 0.35) continue;
              const gx = cov[i + 1] - cov[i - 1], gy = cov[i + s.w] - cov[i - s.w], gl = Math.hypot(gx, gy);
              if (gl < 1e-4) continue;
              const xi = clamp(Math.round(x + (gx / gl) * st * 0.6), 0, s.w - 1), yi = clamp(Math.round(y + (gy / gl) * st * 0.6), 0, s.h - 1), k = yi * s.w + xi;
              const P = o.place(x + 0.5, y + 0.5);
              const d = norm(P), dist = Math.hypot(P[0], P[1], P[2]);
              const a = Math.atan2(gy, gx) + Math.PI / 2 + (rand() - 0.5) * 0.15;
              const maj = sp * lerp(1.1, 1.6, rand()), mn = sp * lerp(0.32, 0.45, rand());
              const ca = Math.cos(a) * maj * dist, sa = -Math.sin(a) * maj * dist;
              const axis = [o.R[0] * ca + o.U[0] * sa, o.R[1] * ca + o.U[1] * sa, o.R[2] * ca + o.U[2] * sa];
              const col = [0, 1, 2].map((j) => clamp(img[k * 3 + j] * (1 + (rand() - 0.5) * 0.04), 0, 1));
              const fy = 1 - (y + 0.5) / s.h;
              const c = o.cls(col, 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2], fy, o.hull);
              const flex = (c === CLS.SAIL ? clamp((fy - o.hull) / (1 - o.hull), 0, 1) : c === CLS.TREE ? fy : 0) * (o.flexMul ?? 1);
              const Pn = P.map((q) => q * 0.997);
              let cpos = Pn, delay;
              if (!o.ext) {
                const sc = sC * f / -d[2];
                cpos = [d[0] * sc, d[1] * sc, d[2] * sc];
                const p = proj(d);
                delay = clamp(Math.hypot(p[0] - 0.5, (p[1] - 0.5) * asp) / 0.62 * 0.62 + rand() * 0.38, 0, 1);
              } else delay = extDelay(Pn);
              B.add(Pn, cpos, axis, mn * dist, col, 0.97, c, o.hot, flex, delay, o.ext ? 1 : 0, rand());
              n++;
            }
          }
        }
        // feather: past a tree's silhouette its touches thin out over a few stroke widths, so a card never ends
        // in a cut edge against the sky or the plate (not where an element was cut out behind another one)
        if (o.feather) {
          const L = layers[3];
          const sp = alpha0 * L.k * (o.fine || fine) * (o.ext ? o.spMul || 1 : 1) * 1.15;
          const st = Math.max(0.7, sp / o.pxAng), reach = o.feather * st;
          const cov = solid(s, Math.max(1, st)), img = level(s, st * 0.5);
          for (let yy = st * 0.5; yy < s.h; yy += st * 0.9) {
            for (let xx = rand() * st; xx < s.w; xx += st * 0.9) {
              const x = clamp(Math.round(xx), 1, s.w - 2), y = clamp(Math.round(yy), 1, s.h - 2), i = y * s.w + x;
              if (!s.m[i] || cov[i] > 0.85) continue;
              const gx = cov[i + 1] - cov[i - 1], gy = cov[i + s.w] - cov[i - s.w], gl = Math.hypot(gx, gy);
              if (gl < 1e-4) continue;
              for (let q = 0; q < 2; q++) {
                const t = Math.pow(rand(), 1.3);
                const ox = x - (gx / gl) * t * reach + (rand() - 0.5) * st, oy = y - (gy / gl) * t * reach + (rand() - 0.5) * st;
                const xi = Math.round(ox), yi = Math.round(oy);
                if (xi >= 0 && yi >= 0 && xi < s.w && yi < s.h && s.a[yi * s.w + xi] > 0.5) continue;
                const P = o.place(ox + 0.5, oy + 0.5);
                const d = norm(P), dist = Math.hypot(P[0], P[1], P[2]);
                const a = o.angle(rand), maj = sp * lerp(0.7, 1.2, rand()) * lerp(1, 0.6, t), mn = sp * lerp(0.4, 0.6, rand()) * lerp(1, 0.6, t);
                const ca = Math.cos(a) * maj * dist, sa = -Math.sin(a) * maj * dist;
                const axis = [o.R[0] * ca + o.U[0] * sa, o.R[1] * ca + o.U[1] * sa, o.R[2] * ca + o.U[2] * sa];
                const col = [0, 1, 2].map((j) => clamp(img[i * 3 + j] * (1 + (rand() - 0.5) * 0.1) + (rand() - 0.5) * 0.03, 0, 1));
                const fy = clamp(1 - (oy + 0.5) / s.h, 0, 1);
                const c = o.cls(col, 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2], fy, o.hull);
                const flex = (c === CLS.TREE ? fy : 0) * (o.flexMul ?? 1);
                let cpos = P, delay;
                if (!o.ext) {
                  const sc = sC * f / -d[2];
                  cpos = [d[0] * sc, d[1] * sc, d[2] * sc];
                  const p = proj(d);
                  delay = clamp(Math.hypot(p[0] - 0.5, (p[1] - 0.5) * asp) + rand() * 0.38, 0, 1);
                } else delay = extDelay(P);
                B.add(P, cpos, axis, mn * dist, col, L.a * (1 - t) * 0.9, c, 0, flex, delay, o.ext ? 1 : 0, rand());
                n++;
              }
            }
          }
        }
        return n;
      };

      // a broken mirror image on the river; flex = -m lets the shader keep it under its object for any eye.
      // Laid out for the origin (ext 0.25 inside the frame tells the shader so); hot = -sail flex lets the
      // image lean with its sail in the wind
      const reflect = (P, axis, minor, col, alpha, ext, sway) => {
        const yRel = P[1] + h;
        if (yRel < 0.03) return 0;
        // Monet's sail reflections are short horizontal dabs, broken wider and thinned out the further
        // they reach from the hull (q: 0 at the waterline, 1 at the masthead's image)
        const q = sway;
        if (rand() < 0.7 * q) return 0;
        const k = (h / (h + yRel * 0.95)) * 0.995;
        const w = [P[0] * k + (rand() - 0.5) * (0.5 + 2.2 * q) * k, -h + 0.01, P[2] * k];
        const th = Math.atan2(w[0], -w[2]), t = [Math.cos(th), 0, Math.sin(th)];
        const len = Math.hypot(axis[0], axis[1], axis[2]) * lerp(1.5, 2.6, rand()) * k;
        const cl = (col[0] + col[1] + col[2]) / 3;
        const c = [0, 1, 2].map((j) => clamp(lerp(cl + (col[j] - cl) * 1.2, baseWater[j], 0.35 + 0.3 * q) * 0.95, 0, 1));
        const d = norm(w);
        let cpos = w, delay;
        if (!ext) {
          if (!inRect(proj(d))) return 0;
          const sc = sC * f / -d[2];
          cpos = [d[0] * sc, d[1] * sc, d[2] * sc];
          delay = clamp(0.5 + rand() * 0.45, 0, 1);
        } else {
          if (inRect(proj(d))) return 0;
          delay = extDelay(w);
        }
        B.add(w, cpos, [t[0] * len, 0, t[2] * len], minor * k * 0.9, c, alpha * lerp(0.75, 0.45, q), CLS.WATER, -sway, -1 / k, delay, ext ? 1 : 0.25, rand());
        return 1;
      };

      // the whole rig above the hull leans as one, shaded canvas included, so a gust never tears a sail apart
      const sailCls = (col, l, fy, hull) => (fy > hull ? CLS.SAIL : CLS.STATIC);
      const sailAngle = (r) => Math.PI / 2 + (r() - 0.5) * 0.5;
      const treeAngle = (r) => r() * Math.PI;
      const flatAngle = (r) => (r() - 0.5) * 0.6;
      const kindOf = {
        sail: { cls: sailCls, angle: sailAngle, refl: 0.6, flatMin: 0, outline: 0.8, dabs: false },
        tree: { cls: () => CLS.TREE, angle: treeAngle, refl: 0 },
        house: { cls: () => CLS.STATIC, angle: flatAngle, refl: 0, outline: 0.8 },
        lily: { cls: () => CLS.STATIC, angle: flatAngle, refl: 0 },
      };

      /* ---- the painted elements, each on its own card inside the frame ---- */
      spec.cards.forEach((c, k) => {
        const [u0, v0, u1, v1] = c.box;
        const D = cardDepth(c, groundZ, wl);
        const pxAng0 = (u1 - u0) / f;
        const cf = c.fine || fine;
        const wWork = Math.min(set.cards[k].naturalWidth * 1.6, Math.max(24, pxAng0 / (alpha0 * layers[3].k * cf * 0.55)));
        const s = readSprite(set.cards[k], wWork);
        // an element painted over this one but standing behind it (so the shrubs can cover its foot)
        // must not be hidden by this layer: cut its silhouette out. Where one painted over it stands in
        // front, only the part well inside that element's outline goes (no eye position can see it), so
        // stacked foliage does not pay for strokes nobody sees
        // hideShift: the furthest the eye travels (m); the margin is how far the two layers can slide apart
        const shift = spec.hideShift ?? 0;
        spec.cards.forEach((c2, j) => {
          const [a0, b0, a1, b1] = c2.box;
          if (j <= k || a0 > u1 || a1 < u0 || b0 > v1 || b1 < v0) return;
          const P2 = pix(j);
          const solidAt = (u, v) => {
            const px = Math.floor(((u - a0) / (a1 - a0)) * P2.w), py = Math.floor(((v - b0) / (b1 - b0)) * P2.h);
            return px >= 0 && py >= 0 && px < P2.w && py < P2.h && P2.d[(py * P2.w + px) * 4 + 3] > 100;
          };
          for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
            const u = u0 + ((x + 0.5) / s.w) * (u1 - u0), v = v0 + ((y + 0.5) / s.h) * (v1 - v0);
            if (!solidAt(u, v)) continue;
            const dj = depthAt(c2, u, v, groundZ, wl), dk = depthAt(c, u, v, groundZ, wl);
            if (dj > dk) { s.m[y * s.w + x] = 0; continue; }
            if (!shift) continue;
            const m = shift * (1 / dj - 1 / dk) * f + 0.006;
            if (solidAt(u - m, v) && solidAt(u + m, v) && solidAt(u, v - m / asp) && solidAt(u, v + m / asp)) s.m[y * s.w + x] = 0;
          }
        });
        const kd = kindOf[c.kind];
        const toW = (u, v) => { const z = depthAt(c, u, v, groundZ, wl); return [(u - 0.5) * z / f, -(v - vH) * asp * z / f, -z]; };
        const n = emitSprite(s, {
          ext: false, fine: cf, pxAng: pxAng0 / s.w, R: [1, 0, 0], U: [0, 1, 0], hot: c.hot || 0, hull: c.hull ?? 0.12, minLayer: c.minLayer,
          place: (sx, sy) => toW(u0 + (sx / s.w) * (u1 - u0), v0 + (sy / s.h) * (v1 - v0)),
          cls: kd.cls, angle: kd.angle, refl: c.refl ?? kd.refl, feather: c.kind === 'tree' ? spec.feather : 0,
          ...(imp ? { outline: kd.outline, flatMin: kd.flatMin } : {}),
        });
        stats.push(`${c.id}:${n}@${D.toFixed(0)}m`);
      });

      /* ---- shrubs in front of the bank elements' feet ---- */
      (spec.hedges || []).forEach((hd, k) => {
        const [u0, v0, u1, v1] = hd.box;
        // next to the grove's own card (hd.behind: x its distance), so it slides with the grove and not with the
        // elements behind it
        const D = cardDepth(spec.cards.find((q) => q.id === hd.src), groundZ, wl) * (hd.behind ?? 0.995);
        const pxA = (u1 - u0) / f, hf = hd.fine || fine;
        const wPx = Math.max(24, pxA / (alpha0 * layers[3].k * hf * 0.55));
        const cvs = makeHedge(set.cards[spec.cards.findIndex((q) => q.id === hd.src)], hd, Math.round(wPx), Math.max(8, Math.round((wPx * (v1 - v0) * asp) / (u1 - u0))));
        const ss = readSprite(cvs, cvs.width);
        const n = emitSprite(ss, {
          ext: false, fine: hf, pxAng: pxA / ss.w, R: [1, 0, 0], U: [0, 1, 0], hot: 0, hull: 0,
          place: (sx, sy) => { const u = u0 + (sx / ss.w) * (u1 - u0), v = v0 + (sy / ss.h) * (v1 - v0); return [(u - 0.5) * D / f, -(v - vH) * asp * D / f, -D]; },
          cls: () => CLS.TREE, angle: kindOf.tree.angle, refl: 0, flexMul: 0.2,
        });
        stats.push(`hedge${k}:${n}@${D.toFixed(0)}m`);
      });

      /* ---- crowns: elements cut by the frame's top edge grow on above it ---- */
      spec.cards.forEach((c, k) => {
        const [u0, v0, u1, v1] = c.box;
        if (!c.crown || v0 > 0.02) return;
        // finer than the card: inside the frame the dabs carry the texture, above it the crown has to
        const cf = (c.fine || fine) * 0.8;
        const pxA = (u1 - u0) / f, wPx = Math.round(Math.max(24, pxA / (alpha0 * layers[3].k * cf * 0.55)));
        const hPx = Math.max(8, Math.round((wPx * c.crown * asp) / (u1 - u0)));
        const cvs = makeCrown(pix(k), wPx, hPx, (v1 - v0) / c.crown, k);
        const ss = readSprite(cvs, cvs.width);
        const n = emitSprite(ss, {
          ext: true, spMul: 1, fine: cf, pxAng: pxA / ss.w, R: [1, 0, 0], U: [0, 1, 0], hot: 0, hull: 0, minLayer: 2,
          place: (sx, sy) => { const u = u0 + (sx / ss.w) * (u1 - u0), v = v0 - (1 - sy / ss.h) * c.crown, z = depthAt(c, u, v0, groundZ, wl); return [(u - 0.5) * z / f, -(v - vH) * asp * z / f, -z]; },
          cls: () => CLS.TREE, angle: kindOf.tree.angle, refl: 0, feather: spec.feather,
        });
        stats.push(`crown_${c.id}:${n}`);
      });

      /* ---- pointillist dabs: the finished picture laid over every layer in small broken-colour touches ---- */
      if (spec.dabs) {
        const { W: PW, H: PH, cls: pCls, depZ: pZ, flex: pFlex } = ctx.plate;
        const Pc = pixels(set.dabs), sp = alpha0 * spec.dabs.k;
        const colAt = (u, v) => {
          const x = clamp(Math.floor(u * Pc.w), 0, Pc.w - 1), y = clamp(Math.floor(v * Pc.h), 0, Pc.h - 1), i = (y * Pc.w + x) * 4;
          return [Pc.d[i] / 255, Pc.d[i + 1] / 255, Pc.d[i + 2] / 255];
        };
        // the topmost PSD layer at a point is the one seen there (lower ones were cut out where they stood in front)
        const topCard = (u, v) => {
          for (let j = spec.cards.length - 1; j >= 0; j--) {
            const [a0, b0, a1, b1] = spec.cards[j].box;
            if (u < a0 || u > a1 || v < b0 || v > b1) continue;
            const P2 = pix(j), px = Math.floor(((u - a0) / (a1 - a0)) * P2.w), py = Math.floor(((v - b0) / (b1 - b0)) * P2.h);
            if (px >= 0 && py >= 0 && px < P2.w && py < P2.h && P2.d[(py * P2.w + px) * 4 + 3] > 128) return j;
          }
          return -1;
        };
        // fold (canvas widths): the dabs also cover the mirrored band the plate continues in past the frame
        const fold = spec.dabs.fold || 0, [e0, e1, ev] = spec.dabs.foldEdge || [0, 1, 1];
        let n = 0;
        for (let v = 0; v < 1 + fold / asp; ) {
          const ty = -(v - vH) * asp / f;
          for (let u = -fold + rand() * f * sp; u < 1 + fold; ) {
            const tx = (u - 0.5) / f;
            const uo = u, vo = Math.max(0, v + (rand() - 0.5) * sp * f / asp);
            u += f * sp * (1 + tx * tx) * (0.85 + rand() * 0.3);
            const out = Math.max(uo < e0 ? e0 - uo : uo > e1 ? uo - e1 : 0, vo > ev ? (vo - ev) * asp : 0);
            if (out > 0 && rand() > 1 - smooth(fold * 0.35, fold, out)) continue;
            const uu = clamp(uo < e0 ? 2 * e0 - uo : uo > e1 ? 2 * e1 - uo : uo, 0, 1), vv = clamp(vo > ev ? 2 * ev - vo : vo, 0, 0.9999);
            // focus: the touches gather where the eye is led
            if (imp && rand() > lerp(spec.dabs.minor ?? 0.1, 1, smooth(0.15, 0.85, imp(norm([(uo - 0.5) / f, -(vo - vH) * asp / f, -1]))))) continue;
            const j = topCard(uu, vv);
            let z, c, fl;
            if (j >= 0 && kindOf[spec.cards[j].kind].dabs === false) continue;
            if (j >= 0) {
              const cd = spec.cards[j], fy = 1 - (vv - cd.box[1]) / (cd.box[3] - cd.box[1]), hull = cd.hull ?? 0.12;
              z = depthAt(cd, uu, vv, groundZ, wl);
              c = kindOf[cd.kind].cls([0, 0, 0], 0, fy, hull);
              // a sail's touches lean with it in the wind
              fl = c === CLS.TREE ? fy : c === CLS.SAIL ? clamp((fy - hull) / (1 - hull), 0, 1) : 0;
            } else {
              const i = clamp(Math.floor(vv * PH), 0, PH - 1) * PW + clamp(Math.floor(uu * PW), 0, PW - 1);
              c = pCls[i]; z = pZ[i]; fl = pFlex[i];
              if (c === CLS.SKY) continue;
            }
            // broken colour: a touch from close by in the picture (on the same layer, so thin things like the
            // bridge rails keep their own colour), nudged warm or cool, a little richer
            const r0 = sp * f * (spec.dabs.jitter ?? 1.2);
            const ju = clamp(uu + (rand() - 0.5) * r0, 0, 1), jv = clamp(vv + (rand() - 0.5) * r0 / asp, 0, 0.9999);
            const col = topCard(ju, jv) === j ? colAt(ju, jv) : colAt(uu, vv);
            const lm = 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2], tint = (rand() - 0.5) * 2 * spec.dabs.tint;
            const tc = tint > 0 ? [1, 0.45, -0.7] : [-0.6, -0.1, 1];
            for (let q = 0; q < 3; q++) col[q] = clamp(lm + (col[q] - lm) * spec.dabs.sat + tc[q] * Math.abs(tint), 0, 1);
            if (vo > ev && c === CLS.WATER) z = groundZ(vo);
            const zz = z * 0.996;
            const P = [(uo - 0.5) * zz / f, -(vo - vH) * asp * zz / f, -zz];
            const dist = Math.hypot(P[0], P[1], P[2]);
            // leaves: upright touches suit hanging willows; round shrubs take them any way (leaves: 'any')
            const a = c === CLS.WATER ? (rand() - 0.5) * 0.35 : c === CLS.TREE && spec.dabs.leaves !== 'any' ? Math.PI / 2 + (rand() - 0.5) * 1.4 : rand() * Math.PI;
            let maj = sp * lerp(0.9, 1.5, rand()), mn = sp * lerp(0.5, 0.75, rand());
            // the shader flattens water strokes towards grazing angles: water touches start wider and fuller
            if (c === CLS.WATER) { const [wa, wb] = spec.dabs.water || [1.6, 1.5]; maj *= wa; mn *= wb; }
            const axis = [Math.cos(a) * maj * dist, -Math.sin(a) * maj * dist, 0];
            const d = norm(P), sc = sC * f / -d[2];
            const p = proj(d), rad = Math.hypot(p[0] - 0.5, (p[1] - 0.5) * asp) / 0.62;
            if (uo < 0 || uo > 1 || vo > 1) B.add(P, P, axis, mn * dist, col, 0.92, c, 0, fl, ctx.extDelay(P), 1, rand());
            else B.add(P, [d[0] * sc, d[1] * sc, d[2] * sc], axis, mn * dist, col, 0.92, c, 0, fl, clamp(rad * 0.62 + rand() * 0.38, 0, 1), 0, rand());
            n++;
          }
          v += sp * f / asp * (1 + ty * ty) * 0.866;
        }
        stats.push(`dabs:${n}`);

        // near: the pond below and beside the frame in the same touches, its colours from the painting's near
        // pond (lilies and broken reflections) tiled by ground position. near = touch size relative to the frame's
        if (spec.dabs.near) {
          const tri = (x) => { const t = ((x % 2) + 2) % 2; return t > 1 ? 2 - t : t; };
          const [nu0, nu1, nv0, nv1] = spec.dabs.nearSrc;
          let m = 0;
          for (let el = -0.06; el > -1.4; ) {
            const spA = sp * spec.dabs.near * (1 + 1.5 * smooth(0.5, 1.4, -el)), ce = Math.cos(el), dAz = spA / ce;
            for (let az = -2 + rand() * dAz; az < 2; az += dAz * (0.85 + rand() * 0.3)) {
              const d = [Math.sin(az) * ce, Math.sin(el), -Math.cos(az) * ce];
              const p = proj(d);
              if (p && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1) continue;
              const hw = h / Math.tan(-el);
              if (hw >= shoreS(az) * 0.96) continue;
              const t = h / -d[1], P = [d[0] * t, -h + 0.01, d[2] * t];
              let col = null;
              for (let k = 0; k < 6 && !col; k++) {
                const su = tri(P[0] / 9 + 0.8 * (fbm2(P[0] * 0.05 + k, P[2] * 0.05, 3) - 0.5) + k * 0.37), sv = tri(-P[2] / 5 + 0.8 * (fbm2(P[0] * 0.05, P[2] * 0.05 + 4 + k, 3) - 0.5));
                const u = lerp(nu0, nu1, su), v = lerp(nv0, nv1, sv);
                const i = clamp(Math.floor(v * PH), 0, PH - 1) * PW + clamp(Math.floor(u * PW), 0, PW - 1);
                if (pCls[i] === CLS.WATER && topCard(u, v) < 0) col = colAt(u, v);
                else if (pCls[i] === CLS.WATER && k === 5) col = colAt(u, v);
              }
              if (!col) continue;
              const lm = 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2], tint = (rand() - 0.5) * 2 * spec.dabs.tint;
              const tc = tint > 0 ? [1, 0.45, -0.7] : [-0.6, -0.1, 1];
              for (let q = 0; q < 3; q++) col[q] = clamp(lm + (col[q] - lm) * spec.dabs.sat + tc[q] * Math.abs(tint), 0, 1);
              const dist = Math.hypot(P[0], P[1], P[2]), a = (rand() - 0.5) * 0.3;
              const maj = spA * lerp(1.3, 2.2, rand()), mn = spA * lerp(0.6, 0.9, rand());
              const Rv = [Math.cos(az), 0, Math.sin(az)];
              const axis = [Rv[0] * Math.cos(a) * maj * dist, Math.sin(a) * maj * dist * 0.3, Rv[2] * Math.cos(a) * maj * dist];
              B.add(P, P, axis, mn * dist, col, 0.88, CLS.WATER, 0, 0.5 + rand() * 0.5, extDelay(P), 1, rand());
              m++;
            }
            el -= spA * 0.866;
          }
          stats.push(`nearWater:${m}`);
        }
      }

      /* ---- the extra sails and trees, staged around the viewer ---- */
      spec.extras.forEach((e, k) => {
        const img = set.extras[k];
        (e.at || []).forEach(([deg, distSpec, Hm, flip]) => {
          const th = (deg * Math.PI) / 180;
          const onWater = e.kind === 'sail';
          const S = shoreS(th);
          const r = onWater ? Math.min(distSpec, S - 8) : S * (distSpec || 1.15);
          const base = [r * Math.sin(th), -h + (onWater ? 0 : 0.25), -r * Math.cos(th)];
          const Rv = [Math.cos(th), 0, Math.sin(th)], Uv = [0, 1, 0];
          const Wm = (Hm * img.naturalWidth) / img.naturalHeight;
          const pxTarget = (Hm / r) / (alpha0 * layers[3].k * fine * (e.spMul || 1) * 0.55);
          const s = readSprite(img, Math.min(img.naturalWidth, Math.max(24, (pxTarget * img.naturalWidth) / img.naturalHeight)));
          const kd = kindOf[e.kind];
          const n = emitSprite(s, {
            ext: true, spMul: e.spMul || 1, pxAng: Hm / r / s.h, R: Rv, U: Uv, hot: 0, hull: e.hull ?? 0.12, flipX: !!flip, minLayer: e.minLayer,
            place: (sx, sy) => {
              const xm = ((flip ? s.w - sx : sx) / s.w - 0.5) * Wm, ym = (1 - sy / s.h) * Hm;
              return [base[0] + Rv[0] * xm, base[1] + ym, base[2] + Rv[2] * xm];
            },
            cls: kd.cls, angle: kd.angle, refl: e.kind === 'sail' ? 0.6 : e.refl ?? 0.3, feather: e.kind === 'tree' && r > 8 ? spec.feather : 0,
            ...(imp ? { outline: kd.outline, flatMin: kd.flatMin } : {}),
          });
          stats.push(`${e.id}@${deg}:${n}`);
        });
      });
      console.log(`[monet] layer cards ${stats.join(' ')}`);
    },
  };
}

// distance of an element's card: sails where the hull meets the river, bank elements behind the shore
// line, stepped back in PSD order so upper layers always stand in front of lower ones
function cardDepth(c, groundZ, wl) {
  const [u0, v0, u1, v1] = c.box;
  if (c.kind === 'sail') return groundZ(v1 - (c.contactUp ?? 0.004));
  if (c.kind === 'lily') return groundZ((v0 + v1) / 2);
  if (c.z) return (c.z[0] + c.z[1]) / 2;
  return groundZ(wl((u0 + u1) / 2)) * c.depth;
}

// distance along the ray through (u, v): lily pads lie on the pond, z = [left, right] metres turns a card
// about the vertical so a bank can recede across the frame, everything else is a flat card
function depthAt(c, u, v, groundZ, wl) {
  if (c.kind === 'lily') return groundZ(v) * 0.995;
  if (c.z) { const [u0, , u1] = c.box; return lerp(c.z[0], c.z[1], clamp((u - u0) / (u1 - u0), 0, 1)); }
  return cardDepth(c, groundZ, wl);
}
