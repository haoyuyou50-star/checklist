import { CLS } from './scenes.js';
import { clamp, lerp, smooth, blur1, blurMasked, fbm2 } from './generator.js';

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
  const [base, ...imgs] = await Promise.all([spec.base, ...spec.cards.map((c) => c.src), ...spec.extras.map((e) => e.src)].map(loadImage));
  const n = spec.cards.length;
  return { spec, base, cards: imgs.slice(0, n), extras: imgs.slice(n) };
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
      const want = ((fx * 0.8 + 0.1 + seed * 0.137) % 1) * G.w;
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

export function makeLayerEmitter(set, Q) {
  const spec = set.spec;
  let occMap = null;

  return {
    // the plate's bank behind an element steps back behind that element's card
    occlude({ W, H, cls, depZ, groundZ, wl }) {
      occMap = new Float32Array(W * H);
      spec.cards.forEach((c, k) => {
        if (c.kind === 'sail') return;
        const d = cardDepth(c, groundZ, wl);
        const [u0, v0, u1, v1] = c.box;
        const s = readSprite(set.cards[k], Math.max(8, (u1 - u0) * W), false);
        for (let y = Math.floor(v0 * H); y < Math.ceil(v1 * H); y++) for (let x = Math.floor(u0 * W); x < Math.ceil(u1 * W); x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const sx = Math.floor(((x + 0.5) / W - u0) / (u1 - u0) * s.w), sy = Math.floor(((y + 0.5) / H - v0) / (v1 - v0) * s.h);
          if (sx < 0 || sy < 0 || sx >= s.w || sy >= s.h || s.a[sy * s.w + sx] < 0.3) continue;
          const i = y * W + x;
          occMap[i] = Math.max(occMap[i], d);
        }
      });
      for (let i = 0; i < W * H; i++) if (occMap[i] > 0 && cls[i] !== CLS.SKY && cls[i] !== CLS.WATER) depZ[i] = Math.max(depZ[i], occMap[i] * 1.12);
    },

    emit(ctx) {
      const { B, rand, f, vH, asp, h, groundZ, wl, alpha0, layers, extDelay, proj, inRect, sC, hotAcc, shoreS, baseWater } = ctx;
      const stats = [];
      const fine = spec.fine;

      // one element: place(sx, sy) -> world point on its card; frame = { R, U } card axes; pxAng = radians per sprite pixel
      const emitSprite = (s, o) => {
        let n = 0;
        for (let li = 0; li < 4; li++) {
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
              if (li === 3 && rand() > clamp(s.grad[i] * 6 - 0.05, 0.15, 0.9)) continue;
              const P = o.place(x + 0.5, y + 0.5);
              const d = norm(P), dist = Math.hypot(P[0], P[1], P[2]);
              const coh = Math.sqrt((s.Jxx[i] - s.Jyy[i]) ** 2 + 4 * s.Jxy[i] ** 2) / (s.Jxx[i] + s.Jyy[i] + 1e-6);
              let a = rand() < coh * 1.4 ? 0.5 * Math.atan2(2 * s.Jxy[i], s.Jxx[i] - s.Jyy[i]) + Math.PI / 2 : o.angle(rand);
              if (o.flipX) a = Math.PI - a;
              let maj = sp * lerp(L.maj[0], L.maj[1], rand()), mn = sp * lerp(L.min[0], L.min[1], rand());
              // near the silhouette strokes shrink and follow the edge so the outline stays legible
              const edge = smooth(need, 1, inner[i]);
              maj *= lerp(0.6, 1, edge); mn *= lerp(0.75, 1, edge);
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
              B.add(P, cpos, axis, mn * dist, col, L.a, c, o.hot, flex, delay, o.ext ? 1 : 0, rand());
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
        sail: { cls: sailCls, angle: sailAngle, refl: 0.6 },
        tree: { cls: () => CLS.TREE, angle: treeAngle, refl: 0 },
        house: { cls: () => CLS.STATIC, angle: flatAngle, refl: 0 },
      };

      /* ---- the painted elements, each on its own card inside the frame ---- */
      spec.cards.forEach((c, k) => {
        const [u0, v0, u1, v1] = c.box;
        const D = cardDepth(c, groundZ, wl);
        const pxAng0 = (u1 - u0) / f;
        const cf = c.fine || fine;
        const wWork = Math.min(set.cards[k].naturalWidth * 1.6, Math.max(24, pxAng0 / (alpha0 * layers[3].k * cf * 0.55)));
        const s = readSprite(set.cards[k], wWork);
        const kd = kindOf[c.kind];
        const toW = (u, v) => { const z = D; return [(u - 0.5) * z / f, -(v - vH) * asp * z / f, -z]; };
        const n = emitSprite(s, {
          ext: false, fine: cf, pxAng: pxAng0 / s.w, R: [1, 0, 0], U: [0, 1, 0], hot: c.hot || 0, hull: c.hull ?? 0.12,
          place: (sx, sy) => toW(u0 + (sx / s.w) * (u1 - u0), v0 + (sy / s.h) * (v1 - v0)),
          cls: kd.cls, angle: kd.angle, refl: kd.refl,
        });
        stats.push(`${c.id}:${n}`);
      });

      /* ---- shrubs in front of the bank elements' feet ---- */
      (spec.hedges || []).forEach((hd, k) => {
        const [u0, v0, u1, v1] = hd.box;
        const D = groundZ(wl((u0 + u1) / 2)) * hd.depth;
        const pxA = (u1 - u0) / f, hf = hd.fine || fine;
        const wPx = Math.max(24, pxA / (alpha0 * layers[3].k * hf * 0.55));
        const cvs = makeHedge(set.cards[spec.cards.findIndex((q) => q.id === hd.src)], hd, Math.round(wPx), Math.max(8, Math.round((wPx * (v1 - v0) * asp) / (u1 - u0))));
        const ss = readSprite(cvs, cvs.width);
        const n = emitSprite(ss, {
          ext: false, fine: hf, pxAng: pxA / ss.w, R: [1, 0, 0], U: [0, 1, 0], hot: 0, hull: 0,
          place: (sx, sy) => { const u = u0 + (sx / ss.w) * (u1 - u0), v = v0 + (sy / ss.h) * (v1 - v0); return [(u - 0.5) * D / f, -(v - vH) * asp * D / f, -D]; },
          cls: () => CLS.TREE, angle: kindOf.tree.angle, refl: 0, flexMul: 0.2,
        });
        stats.push(`hedge${k}:${n}`);
      });

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
            ext: true, spMul: e.spMul || 1, pxAng: Hm / r / s.h, R: Rv, U: Uv, hot: 0, hull: e.hull ?? 0.12, flipX: !!flip,
            place: (sx, sy) => {
              const xm = ((flip ? s.w - sx : sx) / s.w - 0.5) * Wm, ym = (1 - sy / s.h) * Hm;
              return [base[0] + Rv[0] * xm, base[1] + ym, base[2] + Rv[2] * xm];
            },
            cls: kd.cls, angle: kd.angle, refl: e.kind === 'sail' ? 0.6 : 0.3,
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
  const [u0, , u1, v1] = c.box;
  if (c.kind === 'sail') return groundZ(v1 - (c.contactUp ?? 0.004));
  return groundZ(wl((u0 + u1) / 2)) * c.depth;
}
