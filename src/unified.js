import { CLS, polyline, inPoly } from './scenes.js';
import { makeRng, clamp, lerp, lerp3, smooth, fbm2, vnoise2, blur1, blurRGB, blurMasked, Builder } from './generator.js';

/*
 * One stroke field for the whole sphere around the viewer.
 *
 * Directions are sampled on rings around the painting's centre ray with a spacing that grows smoothly
 * towards the back, so stroke size and density never jump at the frame. Every direction is resolved
 * against one world model (sky dome, river plane, riverbank curtain, boats). Inside the frame the
 * world comes from the painting's segmentation, with each object resting where it meets the water;
 * outside, the same surfaces continue and borrow the painting's own pixels: the sky and the far bank
 * are mirror-continued from the frame edge, the near bank continues the land columns from the right
 * edge, the river samples rows at the same distance. Colours therefore always come from the painting.
 */

const FAM_SKY = 0, FAM_WATER = 1, FAM_LAND = 2, FAM_BOAT = 3;
const tri = (x) => { const m = ((x % 2) + 2) % 2; return m <= 1 ? m : 2 - m; };
const triFlip = (x) => (((x % 2) + 2) % 2) <= 1;
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lumOf = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

export function buildUnified(scene, img, Q) {
  const t0 = performance.now();
  const rand = makeRng(scene.id.length * 7919 + 1872);
  const asp = img.naturalHeight / img.naturalWidth;
  scene.asp = asp;
  const cam = scene.cam, f = cam.f, vH = cam.vH, h = cam.h, R = cam.sky;
  const U = scene.unified;
  const W = Q.analysisW, H = Math.round(W * asp), N = W * H;

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const rgb = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { rgb[i * 3] = px[i * 4] / 255; rgb[i * 3 + 1] = px[i * 4 + 1] / 255; rgb[i * 3 + 2] = px[i * 4 + 2] / 255; }
  const b1 = blurRGB(rgb, W, H, 1);

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

  /* ---------------- segmentation: class + where each pixel meets the water ---------------- */
  const wl = polyline(U.water);
  const groundZ = (v) => { const y = -(v - vH) * asp; return y >= -1e-5 ? cam.maxD : Math.min(cam.maxD, (h * f) / -y); };
  const skyLike = (r, g, b) => {
    const L = 0.3 * r + 0.59 * g + 0.11 * b, ch = Math.max(r, g, b) - Math.min(r, g, b);
    // Monet's sky here is a near-neutral grey (sometimes faintly warm); sails, roofs and foliage all carry chroma
    return ch < 0.125 && L > 0.42 && b > r - 0.11;
  };
  const boats = U.boats.map((b, i) => ({ ...b, i, top: Math.min(...b.poly.map((p) => p[1])) }));
  const boatsByNear = [...boats].sort((a, b) => b.contact - a.contact);

  const green = (r, g, b) => g > r * 1.03 && g >= b * 0.98;
  const greenish = (r, g, b) => g >= r * 0.99 && g > b * 1.03;
  // object masks: colour test inside the outline, then close small gaps and fill enclosed holes
  const objectMask = (poly, test, rad, maxHole) => {
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs) * W) - 1), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs) * W) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(...ys) * H) - 1), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys) * H) + 1);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const inside = new Uint8Array(bw * bh), m = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const gx_ = x0 + x, gy_ = y0 + y, i = gy_ * W + gx_;
      if (!inPoly((gx_ + 0.5) / W, (gy_ + 0.5) / H, poly)) continue;
      inside[y * bw + x] = 1;
      m[y * bw + x] = test(b1[i * 3], b1[i * 3 + 1], b1[i * 3 + 2], (gy_ + 0.5) / H) ? 1 : 0;
    }
    const morph = (src, grow) => {
      const out = new Uint8Array(bw * bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        let any = !grow;
        for (let dy = -rad; dy <= rad && any !== grow; dy++) for (let dx = -rad; dx <= rad; dx++) {
          const yy = y + dy, xx = x + dx;
          const v = yy >= 0 && yy < bh && xx >= 0 && xx < bw ? src[yy * bw + xx] : 0;
          if (grow ? v : !v) { any = grow; break; }
        }
        out[y * bw + x] = (grow ? any : any) ? 1 : 0;
      }
      return out;
    };
    let c = morph(morph(m, true), false);
    const seen = new Uint8Array(bw * bh), st = [];
    for (let x = 0; x < bw; x++) { st.push(x, (bh - 1) * bw + x); }
    for (let y = 0; y < bh; y++) { st.push(y * bw, y * bw + bw - 1); }
    for (let i = 0; i < bw * bh; i++) if (!inside[i]) st.push(i);
    while (st.length) {
      const i = st.pop();
      if (seen[i] || c[i]) continue;
      seen[i] = 1;
      const x = i % bw, y = (i / bw) | 0;
      if (x > 0) st.push(i - 1); if (x < bw - 1) st.push(i + 1); if (y > 0) st.push(i - bw); if (y < bh - 1) st.push(i + bw);
    }
    // only small enclosed holes are mistakes; larger ones are real gaps
    const hole = new Uint8Array(bw * bh);
    for (let i0 = 0; i0 < bw * bh; i0++) {
      if (seen[i0] || c[i0]) continue;
      const q = [i0], pts = []; seen[i0] = 1;
      while (q.length) {
        const i = q.pop(); pts.push(i);
        const x = i % bw, y = (i / bw) | 0;
        for (const j of [x > 0 ? i - 1 : -1, x < bw - 1 ? i + 1 : -1, y > 0 ? i - bw : -1, y < bh - 1 ? i + bw : -1]) if (j >= 0 && !seen[j] && !c[j]) { seen[j] = 1; q.push(j); }
      }
      if (pts.length <= maxHole) for (const i of pts) hole[i] = 1;
    }
    return (gx_, gy_) => {
      const x = gx_ - x0, y = gy_ - y0;
      if (x < 0 || y < 0 || x >= bw || y >= bh) return false;
      const i = y * bw + x;
      return !!(inside[i] && (c[i] || m[i] || hole[i]));
    };
  };
  // around the sails only a cool, unsaturated, not-too-bright pixel is sky; pale cream highlights belong to the sail
  const skyNearSail = (r, g, b) => {
    const L = 0.3 * r + 0.59 * g + 0.11 * b, ch = Math.max(r, g, b) - Math.min(r, g, b);
    return ch < 0.09 && L > 0.42 && L < 0.8 && b > r - 0.05;
  };
  const inFarBank = (r, g, b, v) => v >= U.farBank.top && v < wl(0) + 0.002 && 0.3 * r + 0.59 * g + 0.11 * b < 0.64;
  const boatMasks = boats.map((bt) => objectMask(bt.poly, (r, g, b, v) => v < bt.contact + 0.003 && !skyNearSail(r, g, b) && !greenish(r, g, b) && !inFarBank(r, g, b, v), 2, 4000));
  const landMask = objectMask(U.land, (r, g, b, v) => !skyLike(r, g, b), 1, 24);
  const cls = new Uint8Array(N), depZ = new Float32Array(N), hot = new Uint8Array(N), flex = new Float32Array(N);
  const comp = new Int8Array(N).fill(-1), fam = new Uint8Array(N);
  const colTopV = new Float32Array(W).fill(2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, u = (x + 0.5) / W, v = (y + 0.5) / H;
    const r = b1[i * 3], g = b1[i * 3 + 1], b = b1[i * 3 + 2];
    const vw = wl(u);
    let c = -1, d = 0, fl = 0, k = -1;
    const boat = boatsByNear.find((bt) => v < bt.contact + 0.003 && boatMasks[bt.i](x, y));
    if (boat) {
      const L = 0.3 * r + 0.59 * g + 0.11 * b;
      c = L > 0.55 && r >= b * 0.95 ? CLS.SAIL : CLS.STATIC;
      d = groundZ(boat.contact); k = boat.i;
      fl = c === CLS.SAIL ? clamp((boat.contact - v) / (boat.contact - boat.top), 0, 1) : 0;
    } else if (v < vw && landMask(x, y)) {
      c = green(r, g, b) ? CLS.TREE : CLS.STATIC;
      d = groundZ(vw);
      if (y / H < colTopV[x]) colTopV[x] = y / H;
    } else if (u < U.farBank.uMax && v >= U.farBank.top && v < vw) {
      c = CLS.STATIC; d = groundZ(vw);
      if (y / H < colTopV[x]) colTopV[x] = y / H;
    } else if (v >= vw || v > vH + 0.002) {
      c = CLS.WATER; d = groundZ(Math.max(v, vH + 0.003)); fl = 0.5 + rand() * 0.5;
    } else {
      c = CLS.SKY; d = 0;
    }
    cls[i] = c; depZ[i] = d; flex[i] = fl; comp[i] = k;
    hot[i] = U.hot(u, v, c);
    fam[i] = c === CLS.SKY ? FAM_SKY : c === CLS.WATER ? FAM_WATER : k >= 0 ? FAM_BOAT : FAM_LAND;
  }
  for (let x = 0; x < W; x++) if (colTopV[x] > 1) colTopV[x] = wl((x + 0.5) / W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (cls[i] === CLS.TREE) { const vw = wl((x + 0.5) / W); flex[i] = clamp((vw - y / H) / Math.max(0.02, vw - colTopV[x]), 0, 1); }
  }

  /* ---------------- per-family colour layers (no bleeding across boundaries) ---------------- */
  // fill everything outside a mask from progressively wider rings of the masked pixels only
  const inpaint = (m) => {
    let n = 0; const mean = [0, 0, 0];
    for (let i = 0; i < N; i++) if (m[i]) { n++; for (let j = 0; j < 3; j++) mean[j] += rgb[i * 3 + j]; }
    let cur = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) for (let j = 0; j < 3; j++) cur[i * 3 + j] = n ? mean[j] / n : 0.6;
    for (const r of [120, 50, 20, 9]) cur = blurMasked(rgb, m, cur, W, H, r);
    return cur;
  };
  const famImg = [0, 1, 2, 3].map((fm) => {
    const m = new Float32Array(N);
    for (let i = 0; i < N; i++) m[i] = fam[i] === fm && !(fm === FAM_SKY && U.skyBad((i % W + 0.5) / W, ((i / W) | 0) / H)) ? 1 : 0;
    const big = inpaint(m);
    const l6 = blurMasked(rgb, m, big, W, H, 6), l3 = blurMasked(rgb, m, big, W, H, 3);
    const fine = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) for (let j = 0; j < 3; j++) fine[i * 3 + j] = m[i] ? b1[i * 3 + j] : l3[i * 3 + j];
    return [l6, l3, fine, fine];
  });
  // open water without reflections, for river that has no object above it
  const rowMed = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const ls = [];
    for (let x = 0; x < W; x++) if (cls[y * W + x] === CLS.WATER) ls.push(lum[y * W + x]);
    ls.sort((a, b) => a - b);
    rowMed[y] = ls.length ? ls[ls.length >> 1] : 0.6;
  }
  const isRefl = (i) => {
    const y = (i / W) | 0, c = [b1[i * 3], b1[i * 3 + 1], b1[i * 3 + 2]];
    return Math.abs(lum[i] - rowMed[y]) > 0.09 || Math.max(...c) - Math.min(...c) > 0.16 || c[2] < c[0] - 0.05;
  };
  const baseMask = new Float32Array(N);
  for (let i = 0; i < N; i++) baseMask[i] = cls[i] === CLS.WATER && !isRefl(i) ? 1 : 0;
  const baseBig = inpaint(baseMask);
  const base6 = blurMasked(rgb, baseMask, baseBig, W, H, 6), base3 = blurMasked(rgb, baseMask, baseBig, W, H, 3);
  const baseFine = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) for (let j = 0; j < 3; j++) baseFine[i * 3 + j] = baseMask[i] ? b1[i * 3 + j] : base3[i * 3 + j];
  const waterBaseImg = [base6, base3, baseFine, baseFine];

  // clean sources: sky well away from any object (Monet lightens the sky around sails), water without reflections
  const notSky = new Float32Array(N), notBase = new Float32Array(N);
  for (let i = 0; i < N; i++) { notSky[i] = fam[i] === FAM_SKY && !U.skyBad((i % W + 0.5) / W, ((i / W) | 0) / H) ? 0 : 1; notBase[i] = baseMask[i] ? 0 : 1; }
  const nearObj = blur1(notSky, W, H, 6), nearRefl = blur1(notBase, W, H, 1);
  const skyOK = new Uint8Array(N), waterOK = new Uint8Array(N);
  for (let i = 0; i < N; i++) { skyOK[i] = nearObj[i] < 1e-4 ? 1 : 0; waterOK[i] = nearRefl[i] < 1e-4 ? 1 : 0; }
  // nearest clean pixel along the same row keeps neighbouring strokes coherent
  const rowLists = new Map();
  const rowList = (ok, y) => {
    const key = (ok === skyOK ? 0 : 1) * H + y;
    let l = rowLists.get(key);
    if (!l) { l = []; for (let x = 0; x < W; x++) if (ok[y * W + x]) l.push(x); rowLists.set(key, l); }
    return l;
  };
  // where clean pixels are scarce, scatter over the row instead of smearing one pixel sideways
  const cleanInRow = (ok, x, y) => {
    const row = y * W;
    if (ok[row + x]) return x;
    const dir = rand() < 0.5 ? 1 : -1;
    for (let k = 1; k <= 24; k++) {
      const a = x + k * dir, b = x - k * dir;
      if (a >= 0 && a < W && ok[row + a]) return a;
      if (b >= 0 && b < W && ok[row + b]) return b;
    }
    const l = rowList(ok, y);
    return l.length ? l[Math.floor(rand() * l.length)] : -1;
  };
  if (globalThis.__monetDebug) globalThis.__monetDebug = { W, H, cls, sky: famImg[FAM_SKY][2], sky6: famImg[FAM_SKY][0], water: waterBaseImg[2], land: famImg[FAM_LAND][2] };

  /* ---------------- column profiles of the bank ---------------- */
  const colWl = new Float32Array(W), colD = new Float32Array(W), colHb = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    colWl[x] = wl((x + 0.5) / W);
    colD[x] = groundZ(colWl[x]);
    colHb[x] = Math.max(0, h + (vH - colTopV[x]) * asp * colD[x] / f);
  }

  /* ---------------- world outside the frame ---------------- */
  const thE = Math.atan(0.5 / f);
  const S_R = colD[W - 1] / Math.cos(thE), S_L = colD[0] / Math.cos(thE), S_B = U.backDist;
  const wrap = (th) => Math.atan2(Math.sin(th), Math.cos(th));
  const sideT = (th) => (Math.abs(th) - thE) / (Math.PI - thE);
  const shoreN = (th) => vnoise2(Math.cos(th) * 2.5 + 3, Math.sin(th) * 2.5 - 1);
  const shoreS = (th) => {
    th = wrap(th);
    const t = clamp(sideT(th), 0, 1);
    const base = lerp(th > 0 ? S_R : S_L, S_B, smooth(0, 0.6, t));
    return base * (1 + 0.3 * (shoreN(th) - 0.5) * smooth(0, 0.25, t));
  };
  const pLand = (th) => { th = wrap(th); const t = clamp(sideT(th), 0, 1); return th > 0 ? lerp(1, 0.55, smooth(0, 1, t)) : lerp(0, 0.55, smooth(0.1, 1, t)); };

  // pool coordinates: texture distance travelled away from the frame edge, at the bank's own scale
  const NT = 2048, span = 2 * Math.PI - 2 * thE;
  const tabR = new Float32Array(NT + 1), tabL = new Float32Array(NT + 1);
  const duEdge = f / Math.cos(thE) ** 2;
  for (let k = 1; k <= NT; k++) {
    const a = thE + (span * (k - 0.5)) / NT;
    tabR[k] = tabR[k - 1] + (duEdge * shoreS(a) / S_R) * (span / NT);
    tabL[k] = tabL[k - 1] + (duEdge * shoreS(-a) / S_L) * (span / NT) * U.farRate;
  }
  const tabAt = (tab, a) => { const k = clamp(((a - thE) / span) * NT, 0, NT); const k0 = Math.floor(k), k1 = Math.min(NT, k0 + 1); return lerp(tab[k0], tab[k1], k - k0); };
  // a pool is a chain of column ranges walked away from the frame edge; distinctive landmarks are left out
  const chain = (segs) => {
    const len = segs.reduce((t, [a, b]) => t + Math.abs(b - a), 0);
    return { segs, len, at(q) {
      let t = q * len;
      for (let k = 0; k < segs.length; k++) {
        const [a, b] = segs[k], l = Math.abs(b - a);
        if (t <= l || k === segs.length - 1) {
          const nb = t < 0.012 && k > 0 ? segs[k - 1] : t > l - 0.012 && k < segs.length - 1 ? segs[k + 1] : null;
          if (nb && rand() < 0.5 - Math.min(t, l - t) / 0.024) return nb[t < 0.012 ? 1 : 0];
          return a + Math.sign(b - a) * Math.min(t, l);
        }
        t -= l;
      }
      return segs[0][0];
    } };
  };
  const landChain = chain(U.landPool), farChain = chain(U.farPool);
  const poolU = (th, land) => {
    th = wrap(th);
    const ch = land ? landChain : farChain;
    const along = land ? (th > 0 ? th : th + 2 * Math.PI) : (th < 0 ? -th : 2 * Math.PI - th);
    let s = tabAt(land ? tabR : tabL, along) / ch.len;
    s += 0.6 * (fbm2(s * 0.7 + (land ? 3.3 : 8.1), 1.7, 3) - 0.5) * smooth(0.6, 2, s);
    return { u: ch.at(tri(s)), flip: triFlip(s) };
  };
  const landAt = (th) => { const p = pLand(th); return p > 0.2 && vnoise2(Math.cos(th) * 1.7 + 11, Math.sin(th) * 1.7 + 4) * 0.85 + rand() * 0.15 < p; };
  const xOf = (u) => clamp(Math.floor(u * W), 0, W - 1), yOf = (v) => clamp(Math.floor(v * H), 0, H - 1);

  // one coordinate running from the right edge round the back to the left edge, closing on an even tile
  const kSky = Math.round((1 + span * duEdge) / 2) * 2 - 1;
  const skyRate = kSky / span;
  const skySrc = (th, el) => {
    th = wrap(th);
    let uv;
    if (Math.abs(th) <= thE) uv = 0.5 + f * Math.tan(th);
    else {
      const along = (th > 0 ? th : th + 2 * Math.PI) - thE;
      uv = 1 + along * skyRate;
      const away = Math.min(along, span - along) * skyRate;
      uv += (0.5 * (fbm2(Math.cos(th) * 1.4 + 5.5, Math.sin(th) * 1.4, 3) - 0.5) + 0.4 * (fbm2(Math.cos(th) * 2 + 1.3, el * 4, 3) - 0.5)) * smooth(0.2, 1.2, away);
    }
    const cth = Math.cos(clamp(th, -thE, thE));
    const vv = vH - (Math.tan(Math.min(el, 1.45)) / cth) * f / asp;
    const band = 0.22;
    const vs = vv >= 0 ? Math.min(vv, vH - 0.01) : band * tri(-vv / band);
    const [lo, hi] = U.skyRange;
    return { u: Math.abs(th) <= thE ? uv : lo + tri(uv) * (hi - lo), v: vs, flip: !triFlip(uv), zen: smooth(0, -2.2, vv) };
  };
  const reflAt = (x, y) => isRefl(y * W + x);

  const front = norm([0, -(0.5 - vH) * asp, -f]);
  const proj = (d) => (d[2] < -1e-6 ? [0.5 + (d[0] / -d[2]) * f, vH - ((d[1] / -d[2]) * f) / asp] : null);
  const inRect = (p) => p && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1;

  // resolve a viewing direction to a surface point and the painting pixel that colours it
  const resolve = (d) => {
    const p = proj(d);
    if (inRect(p)) {
      let x = xOf(p[0]);
      const y = yOf(p[1]), i = y * W + x, c = cls[i];
      const t = c === CLS.SKY ? R : depZ[i] / -d[2];
      if (c === CLS.SKY && U.skyBad(p[0], p[1])) x = Math.max(0, cleanInRow(skyOK, x, y));
      return { P: [d[0] * t, d[1] * t, d[2] * t], cls: c, x, y, flip: false, img: famImg[fam[i]], hot: hot[i], flex: flex[i], comp: comp[i], uv: p };
    }
    const th = Math.atan2(d[0], -d[2]), el = Math.asin(clamp(d[1], -1, 1)), ce = Math.cos(el);
    const S = shoreS(th), land = landAt(th);
    const pu = poolU(th, land), x = xOf(pu.u), hw = d[1] < -1e-4 ? (h / -d[1]) * ce : Infinity;
    if (hw < S) {
      const t = h / -d[1];
      // the reflection band under the bank keeps the bank's own painted reflections
      const shoreBand = land && hw > S * lerp(0.5, 0.8, rand());
      let vs, xs, flip, img;
      if (shoreBand) {
        xs = x; flip = pu.flip; img = famImg[FAM_WATER];
        vs = vH + (h * f) / (colD[x] * (hw / S) * asp);
      } else {
        const sv = skySrc(th, 0);
        xs = xOf(sv.u); flip = sv.flip; img = waterBaseImg;
        vs = vH + (h * f) / (hw * Math.cos(thE) * asp);
      }
      if (vs > 1) vs = 2 - vs;
      vs = Math.max(vs, colWl[xs] + 0.004);
      let ys = yOf(vs);
      if (!shoreBand) {
        const cx = cleanInRow(waterOK, xs, ys);
        if (cx >= 0 && !U.waterBad(cx / W, ys / H)) xs = cx;
        else for (let k = 0; k < 10 && (!waterOK[ys * W + xs] || U.waterBad(xs / W, ys / H)); k++) { xs = xOf(rand()); ys = yOf(Math.max(vs, colWl[xs] + 0.004)); }
      }
      return { P: [d[0] * t, d[1] * t, d[2] * t], cls: CLS.WATER, x: xs, y: ys, flip, img, hot: 0, flex: 0.5 + rand() * 0.5, comp: -1, haze: 0 };
    }
    const tb = S / ce, yb = d[1] * tb;
    const hb = colHb[x] * (land ? lerp(1, 0.85, smooth(40, 140, S)) : 1);
    if (yb > -h && yb + h <= hb) {
      const fr = (yb + h) / Math.max(hb, 1e-3);
      const vs = colWl[x] - fr * (colWl[x] - colTopV[x]);
      const ys = yOf(vs), i = ys * W + x;
      if (cls[i] !== CLS.SKY && cls[i] !== CLS.WATER) {
        const c = cls[i] === CLS.SAIL ? CLS.STATIC : cls[i];
        return { P: [d[0] * tb, yb, d[2] * tb], cls: c, x, y: ys, flip: pu.flip, img: famImg[fam[i] === FAM_BOAT ? FAM_LAND : fam[i]], hot: 0, flex: c === CLS.TREE ? fr : 0, comp: -1, haze: land ? smooth(30, 150, S) * 0.5 : 0, far: smooth(40, 120, S), thin: hb / S };
      }
    }
    const s = skySrc(th, el);
    let sy = yOf(s.v), sx = cleanInRow(skyOK, xOf(s.u), sy);
    for (let k = 0; sx < 0 && k < 40; k++) { sy = Math.max(0, sy - 2); sx = cleanInRow(skyOK, xOf(s.u), sy); }
    return { P: [d[0] * R, d[1] * R, d[2] * R], cls: CLS.SKY, x: Math.max(0, sx), y: sy, flip: s.flip, img: famImg[FAM_SKY], hot: 0, flex: 0, comp: -1, zen: s.zen };
  };

  /* ---------------- colour references ---------------- */
  const meanRows = (img, v0, v1, fm) => {
    const m = [0, 0, 0]; let n = 0;
    for (let y = yOf(v0); y <= yOf(v1); y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (fam[i] !== fm) continue; m[0] += img[i * 3]; m[1] += img[i * 3 + 1]; m[2] += img[i * 3 + 2]; n++; }
    return n ? [m[0] / n, m[1] / n, m[2] / n] : [0.6, 0.65, 0.72];
  };
  const horizCol = meanRows(b1, vH - 0.12, vH - 0.02, FAM_SKY);
  const topCol = meanRows(b1, 0, 0.06, FAM_SKY);
  const zenCol = lerp3(topCol, [topCol[0] * 0.94, topCol[1] * 0.98, Math.min(1, topCol[2] * 1.05)], 0.6);
  const sampleCol = (r, lvl) => {
    const img = r.img[lvl], i = (r.y * W + r.x) * 3;
    let c = [img[i], img[i + 1], img[i + 2]];
    if (r.zen) c = lerp3(c, lerp3(c, zenCol, 0.75), r.zen);
    if (r.haze) c = lerp3(c, horizCol, r.haze);
    return c;
  };

  /* ---------------- stroke emission ---------------- */
  const B = new Builder(320000);
  const hotAcc = new Map();
  const alpha0 = Q.uniAlpha;
  const gOf = (psi) => 1 + 1.0 * smooth(0.5, 2.6, psi);
  const sC = 3.0 / f;
  const up = [0, 1, 0];
  const frontDir = front;
  const extDelay = (P) => {
    const l = Math.hypot(P[0], P[1], P[2]) || 1;
    const dd = (P[0] * frontDir[0] + P[1] * frontDir[1] + P[2] * frontDir[2]) / l;
    return clamp((Math.acos(clamp(dd, -1, 1)) - 0.3) / 2.7, 0, 1) * 0.85 + rand() * 0.15;
  };
  const layers = [
    { k: 3.4, a: 0.97, lvl: 0, maj: [1.3, 2.2], min: [0.6, 0.85] },
    { k: 1.9, a: 0.97, lvl: 1, maj: [1.2, 2.1], min: [0.5, 0.75] },
    { k: 1.0, a: 0.97, lvl: 2, maj: [1.1, 2.0], min: [0.45, 0.7] },
    { k: 0.72, a: 0.96, lvl: 3, maj: [1.0, 1.8], min: [0.42, 0.66], detail: true },
  ];
  const strokeAngle = (r, g) => {
    const i = r.y * W + r.x, c = r.cls;
    if (c === CLS.WATER) return (rand() - 0.5) * 0.2;
    const sxx = Jxx[i], sxy = Jxy[i], syy = Jyy[i];
    const coh = Math.sqrt((sxx - syy) ** 2 + 4 * sxy * sxy) / (sxx + syy + 1e-6);
    let a;
    if (rand() < coh * 1.3) a = 0.5 * Math.atan2(2 * sxy, sxx - syy) + Math.PI / 2;
    else if (c === CLS.SKY) a = (rand() - 0.5) * 0.6;
    else if (c === CLS.SAIL) a = Math.PI / 2 + (rand() - 0.5) * 0.5;
    else a = rand() * Math.PI;
    if (c === CLS.SKY) a = lerp(a, (rand() - 0.5) * 0.35, smooth(1.05, 1.6, g));
    if (r.far) a = lerp(a, (rand() - 0.5) * 0.5, r.far * 0.7);
    return r.flip ? Math.PI - a : a;
  };
  const emit = (r, d, li, sp, ext, uvIn, g = 1) => {
    const L = layers[li], c = r.cls;
    const jit = 1 + (rand() - 0.5) * 0.07;
    const c0 = sampleCol(r, L.lvl);
    const col = [0, 1, 2].map((j) => clamp(c0[j] * jit + (rand() - 0.5) * 0.025, 0, 1));
    let maj = sp * lerp(L.maj[0], L.maj[1], rand()), mn = sp * lerp(L.min[0], L.min[1], rand());
    if (c === CLS.WATER) { maj *= li === 0 ? 0.9 : 1.1; mn *= 0.72; }
    if (r.far) maj *= lerp(1, 0.7, r.far);
    if (c === CLS.SKY && li === 0) maj *= 1.25;
    const dm = 1 + 0.014 * (3 - li);
    const P = [r.P[0] * dm, r.P[1] * dm, r.P[2] * dm];
    const dist = Math.hypot(P[0], P[1], P[2]);
    const Rt = norm(cross(d, up)), Ut = cross(Rt, d);
    const ang = strokeAngle(r, g), ca = Math.cos(ang) * maj * dist, sa = -Math.sin(ang) * maj * dist;
    const axis = [Rt[0] * ca + Ut[0] * sa, Rt[1] * ca + Ut[1] * sa, Rt[2] * ca + Ut[2] * sa];
    let cpos = P, delay;
    if (!ext) {
      const sc = sC * (1 + 0.004 * (3 - li)) * f / -d[2];
      cpos = [d[0] * sc, d[1] * sc, d[2] * sc];
      const rad = Math.hypot(uvIn[0] - 0.5, (uvIn[1] - 0.5) * asp) / 0.62;
      delay = clamp(rad * 0.62 + rand() * 0.38, 0, 1);
    } else delay = extDelay(P);
    B.add(P, cpos, axis, mn * dist, col, L.a, c, r.hot, r.flex, delay, ext ? 1 : 0, rand());
    if (r.hot) {
      let a = hotAcc.get(r.hot);
      if (!a) { a = { n: 0, x: 0, y: 0, z: 0, pts: [] }; hotAcc.set(r.hot, a); }
      a.n++; a.x += P[0]; a.y += P[1]; a.z += P[2];
      if (rand() < 0.2) a.pts.push(P);
    }
    return { P, axis, minor: mn * dist, col };
  };

  // backdrop behind boats, revealed once the camera moves
  const behind = (d, p) => {
    const x = xOf(p[0]), y = yOf(p[1]), vw = colWl[x];
    if (p[1] >= vw || p[1] > vH + 0.002) {
      const t = groundZ(Math.max(p[1], vH + 0.003)) / -d[2];
      const wx = cleanInRow(waterOK, x, y);
      return { P: [d[0] * t, d[1] * t, d[2] * t], cls: CLS.WATER, x: wx < 0 ? x : wx, y, flip: false, img: waterBaseImg, hot: 0, flex: 0.7, comp: -1 };
    }
    if (p[0] < U.farBank.uMax && p[1] >= U.farBank.top) {
      const t = colD[x] / -d[2];
      return { P: [d[0] * t, d[1] * t, d[2] * t], cls: CLS.STATIC, x, y, flip: false, img: famImg[FAM_LAND], hot: 0, flex: 0, comp: -1 };
    }
    const sx = cleanInRow(skyOK, x, y);
    return { P: [d[0] * R, d[1] * R, d[2] * R], cls: CLS.SKY, x: sx < 0 ? x : sx, y, flip: false, img: famImg[FAM_SKY], hot: 0, flex: 0, comp: -1 };
  };

  const fA = norm(cross(front, up)), fB = cross(fA, front);
  const counts = [0, 0, 0, 0];
  layers.forEach((L, li) => {
    const spOf = (psi) => alpha0 * L.k * gOf(psi);
    let psi = spOf(0) * 0.45, row = 0;
    while (psi < Math.PI) {
      const sp = spOf(psi), rowStep = sp * 0.866;
      const n = Math.max(1, Math.round((2 * Math.PI * Math.sin(psi)) / sp));
      const off = rand();
      for (let k = 0; k < n; k++) {
        const ph = ((k + off + (rand() - 0.5) * 0.9) / n) * 2 * Math.PI;
        const ps = clamp(psi + (rand() - 0.5) * rowStep * 0.9, 0, Math.PI);
        const sps = Math.sin(ps), cps = Math.cos(ps), cph = Math.cos(ph), sph = Math.sin(ph);
        const d = norm([front[0] * cps + (fA[0] * cph + fB[0] * sph) * sps, front[1] * cps + (fA[1] * cph + fB[1] * sph) * sps, front[2] * cps + (fA[2] * cph + fB[2] * sph) * sps]);
        const r = resolve(d);
        if (L.detail) {
          const i = r.y * W + r.x;
          let p = clamp(grad[i] * 9 - 0.12, 0, 0.85) * 0.3;
          if (r.cls === CLS.SKY) continue;
          if (rand() > p) continue;
          const l3 = r.img[1], dl = Math.abs(lum[i] - lumOf([l3[i * 3], l3[i * 3 + 1], l3[i * 3 + 2]]));
          if (dl > 0.2) continue;
        }
        if (r.cls === CLS.SKY && li >= 2 && rand() < lerp(0.3, 0.6, smooth(0.8, 2.2, psi))) continue;
        // a band thinner than the stroke only takes strokes that fit inside it
        if (r.thin !== undefined && ((li === 0 && r.thin < sp * 1.6) || (li === 1 && r.thin < sp * 0.9))) continue;
        const p = proj(d), inF = inRect(p);
        emit(r, d, li, sp, !inF, p, sp / (alpha0 * L.k));
        counts[li]++;
        if (li <= 1 && inF && r.comp >= 0) emit(behind(d, p), d, li, sp, true, p);
      }
      psi += rowStep; row++;
    }
  });

  /* ---------------- boats beyond the frame: the painted boats, re-staged ---------------- */
  const reflections = [];
  const baseWater = meanRows(baseFine, vH + 0.02, 0.9, FAM_WATER);
  const mirror = (w, axis, minor, col, alpha) => {
    const yRel = w[1] + h;
    if (yRel < 0.02 || rand() > 0.5) return;
    const k = (h / (h + yRel * 0.95)) * 0.995;
    const wm = [w[0] * k + (rand() - 0.5) * 0.3, -h + 0.01, w[2] * k];
    const th = Math.atan2(w[0], -w[2]), t = [Math.cos(th), 0, Math.sin(th)];
    const len = Math.hypot(axis[0], axis[1], axis[2]) * lerp(1.2, 1.9, rand()) * k;
    const cl = (col[0] + col[1] + col[2]) / 3;
    const c = [0, 1, 2].map((j) => clamp(lerp(cl + (col[j] - cl) * 1.3, baseWater[j], 0.18) * 0.86, 0, 1));
    reflections.push([wm, [t[0] * len, 0, t[2] * len], minor * k * 1.4, c, alpha * 0.85]);
  };
  const toWorld = (u, v, z) => { const s = z / f; return [(u - 0.5) * s, -(v - vH) * asp * s, -z]; };
  (U.boatsOut || []).forEach(([deg, dist, Hh, si]) => {
    const bt = boats[si];
    const pts = [];
    let uc = 0, top = 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (comp[y * W + x] === bt.i) { pts.push([x, y]); uc += x; top = Math.min(top, y / H); }
    if (!pts.length) return;
    uc = (uc / pts.length + 0.5) / W;
    const Dc = groundZ(bt.contact), Bs = toWorld(uc, bt.contact, Dc);
    const Hsrc = h + (vH - top) * asp * Dc / f, s = Hh / Hsrc;
    const th = (deg * Math.PI) / 180, rt = Math.min(dist, shoreS(th) - 8);
    const Bt = [rt * Math.sin(th), -h, -rt * Math.cos(th)];
    const rot = th - Math.atan2(Bs[0], -Bs[2]), cr = Math.cos(rot), sr = Math.sin(rot);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pxAng = (s * Dc) / (f * W * rt);
    for (let li = 0; li < 4; li++) {
      const sp = alpha0 * layers[li].k, step = Math.max(0.6, sp / pxAng);
      for (let yy = y0; yy <= y1; yy += step * 0.866) for (let xx = x0; xx <= x1; xx += step) {
        const x = clamp(Math.round(xx + (rand() - 0.5) * step), 0, W - 1), y = clamp(Math.round(yy + (rand() - 0.5) * step), 0, H - 1);
        const i = y * W + x;
        if (comp[i] !== bt.i) continue;
        if (li === 3 && rand() > clamp(grad[i] * 9 - 0.12, 0, 0.85)) continue;
        const Ps = toWorld((x + 0.5) / W, (y + 0.5) / H, Dc);
        const Lx = (Ps[0] - Bs[0]) * s, Ly = (Ps[1] - Bs[1]) * s, Lz = (Ps[2] - Bs[2]) * s;
        const P = [Bt[0] + Lx * cr - Lz * sr, Bt[1] + Ly, Bt[2] + Lx * sr + Lz * cr];
        const d = norm(P);
        if (inRect(proj(d))) continue;
        const r = { P, cls: cls[i], x, y, flip: false, img: famImg[FAM_BOAT], hot: 0, flex: flex[i], comp: -1 };
        const e = emit(r, d, li, sp, true, null);
        if (li >= 2) mirror(e.P, e.axis, e.minor, e.col, 0.95);
      }
    }
  });
  reflections.forEach(([w, axis, minor, col, a]) => {
    if (inRect(proj(norm(w)))) return;
    B.add(w, w, axis, minor, col, a, CLS.WATER, 0, 1, extDelay(w), 1, rand());
  });

  // sparkle on the river and drifting motes
  for (let k = 0; k < Q.glints; k++) {
    const th = rand() * Math.PI * 2, r = 2 + Math.pow(rand(), 1.6) * Math.min(48, shoreS(th) - 2);
    const x = r * Math.sin(th), z = -r * Math.cos(th);
    const s = 0.016 * Math.pow(r, 0.8);
    B.add([x, -h + 0.02, z], [x, -h + 0.02, z], [Math.cos(th) * s * 2.5, 0, Math.sin(th) * s * 2.5], s * 0.6, [1, 0.97, 0.86], 0.9, CLS.GLINT, 0, 1, extDelay([x, -h, z]), 1, rand());
  }
  for (let k = 0; k < Q.motes * 0.45; k++) {
    const x = (rand() - 0.5) * 36, y = -h + 0.25 + Math.pow(rand(), 1.5) * 3.2, z = (rand() - 0.5) * 36;
    const s = 0.016 + rand() * 0.022;
    B.add([x, y, z], [x, y, z], [s, 0, 0], s * 0.85, [1, 0.84, 0.55], 0.55, CLS.MOTE, 0, 0, extDelay([x, y, z]), 1, rand());
  }

  /* ---------------- hotspot halos and anchors ---------------- */
  const nMain = B.n;
  const haloP = new Map([...hotAcc].map(([id, a]) => [id, Math.min(0.16, 700 / a.n)]));
  for (let j = 0; j < nMain; j++) {
    const o = j * 4, hs = B.E[o];
    if (hs > 0 && rand() < haloP.get(hs)) {
      const col = [lerp(B.D[o], 1.0, 0.55), lerp(B.D[o + 1], 0.84, 0.55), lerp(B.D[o + 2], 0.56, 0.55)];
      B.add([B.A[o], B.A[o + 1], B.A[o + 2]], [B.B[o], B.B[o + 1], B.B[o + 2]],
        [B.C[o] * 2.6, B.C[o + 1] * 2.6, B.C[o + 2] * 2.6], B.C[o + 3] * 3.2, col, 1, CLS.HALO, hs, 0, B.E[o + 2], B.E[o + 3], rand());
    }
  }
  const hotspots = scene.hotspots.map((hs) => {
    const a = hotAcc.get(hs.id);
    if (!a) return { ...hs, center: [0, 0, -10], radius: 2 };
    const c = [a.x / a.n, a.y / a.n, a.z / a.n];
    const ds = a.pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])).sort((x, y) => x - y);
    return { ...hs, center: c, radius: ds[Math.floor(ds.length * 0.8)] || 2 };
  });
  console.log(`[monet] unified layers ${counts.join('/')} total ${B.n} in ${Math.round(performance.now() - t0)}ms`);

  const ground = meanRows(baseFine, 0.85, 1, FAM_WATER), near = meanRows(baseFine, 0.7, 0.85, FAM_WATER);
  return {
    count: B.n, A: B.A.subarray(0, B.n * 4), B: B.B.subarray(0, B.n * 4), C: B.C.subarray(0, B.n * 4),
    D: B.D.subarray(0, B.n * 4), E: B.E.subarray(0, B.n * 4),
    hotspots, front: frontDir, bg: { horizon: horizCol, zenith: zenCol, ground, near },
    paint: { f, vH, asp, xL: -0.5 / f, yT: (vH * asp) / f, yB: (-(1 - vH) * asp) / f },
    unified: true,
  };
}
