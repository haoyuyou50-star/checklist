import { blurRGB } from './generator.js';

/*
 * Colour moods for one painting. Each mood is given as a reference painting of the same motif (not
 * pixel-aligned, only the same composition), so it is learnt as a colour transfer: both paintings are
 * blurred to their broad masses, and every colour of the base picks up the average shift of base
 * pixels like it (kernel regression in RGB, baked into an N^3 table). Applied as an offset, each
 * stroke keeps its own variation and only its mood changes.
 */

const N = 20, SW = 128, BW = 0.07;

function smallRGB(img, w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, w, h);
  const px = cx.getImageData(0, 0, w, h).data, out = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] = px[i * 4 + j] / 255;
  return blurRGB(out, w, h, 1);
}

// changedOnly: the pair is pixel-aligned and differs only in places (two versions of one plate), so
// learn from the pixels that changed and leave the rest of the colour space alone
export function buildToneLUT(baseImg, refImg, changedOnly = false) {
  const w = SW, h = Math.max(8, Math.round((SW * baseImg.naturalHeight) / baseImg.naturalWidth));
  const b = smallRGB(baseImg, w, h), t = smallRGB(refImg, w, h);
  const use = [];
  for (let i = 0; i < w * h; i++) {
    const d = Math.abs(t[i * 3] - b[i * 3]) + Math.abs(t[i * 3 + 1] - b[i * 3 + 1]) + Math.abs(t[i * 3 + 2] - b[i * 3 + 2]);
    if (!changedOnly || d > 0.06) use.push(i);
  }
  const M = use.length, glob = [0, 0, 0];
  for (const i of use) for (let j = 0; j < 3; j++) glob[j] += (t[i * 3 + j] - b[i * 3 + j]) / M;
  const lut = new Float32Array(N * N * N * 3), k2 = 1 / (2 * BW * BW);
  for (let ri = 0; ri < N; ri++) for (let gi = 0; gi < N; gi++) for (let bi = 0; bi < N; bi++) {
    const c = [ri / (N - 1), gi / (N - 1), bi / (N - 1)];
    let ws = 0; const o = [0, 0, 0];
    for (const i of use) {
      const dr = c[0] - b[i * 3], dg = c[1] - b[i * 3 + 1], db = c[2] - b[i * 3 + 2];
      const d = dr * dr + dg * dg + db * db;
      if (d > 0.09) continue;
      const wgt = Math.exp(-d * k2);
      ws += wgt;
      for (let j = 0; j < 3; j++) o[j] += wgt * (t[i * 3 + j] - b[i * 3 + j]);
    }
    // colours the base hardly uses fall back to the overall shift
    const conf = Math.min(1, ws / 3), q = ((ri * N + gi) * N + bi) * 3;
    for (let j = 0; j < 3; j++) lut[q + j] = (ws > 0 ? o[j] / ws : 0) * conf + glob[j] * (1 - conf);
  }
  return lut;
}

export function toneColor(lut, r, g, b, out = [0, 0, 0], adj = {}) {
  const expo = adj.expo ?? 1, gam = adj.gamma ?? 1;
  const f = [r, g, b].map((x) => Math.min(N - 1.0001, Math.max(0, x * (N - 1))));
  const i0 = f.map(Math.floor), t = f.map((x, j) => x - i0[j]);
  out[0] = r; out[1] = g; out[2] = b;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = c >> 2;
    const w = (dx ? t[0] : 1 - t[0]) * (dy ? t[1] : 1 - t[1]) * (dz ? t[2] : 1 - t[2]);
    const q = (((i0[0] + dx) * N + i0[1] + dy) * N + i0[2] + dz) * 3;
    for (let j = 0; j < 3; j++) out[j] += w * lut[q + j];
  }
  // keepLight: take the reference's hue and chroma but keep (part of) the base painting's lightness
  if (adj.keepLight) {
    const Li = 0.3 * r + 0.59 * g + 0.11 * b, Lo = Math.max(1e-3, 0.3 * out[0] + 0.59 * out[1] + 0.11 * out[2]);
    // scaling a dark stroke a long way up would blow its chroma out: the rest of the lift is neutral
    const Lt = Lo + (Li - Lo) * adj.keepLight, s = Math.min(Lt / Lo, 1.5);
    for (let j = 0; j < 3; j++) out[j] = out[j] * s + (Lt - Lo * s);
  }
  for (let j = 0; j < 3; j++) out[j] = Math.min(1, Math.pow(Math.max(0, out[j]), gam) * expo);
  return out;
}

// per-stroke colours of one mood, same layout as D (rgb + alpha); water = { lut, adj, mix, isWater(i) } gives
// the pond its own mapping, mixed into the mood's by mix
export function toneStrokes(lut, D, count, adj, water = null) {
  const out = new Float32Array(count * 4), c = [0, 0, 0], w = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    toneColor(lut, D[o], D[o + 1], D[o + 2], c, adj);
    if (water && water.isWater(i)) {
      toneColor(water.lut, D[o], D[o + 1], D[o + 2], w, water.adj);
      for (let j = 0; j < 3; j++) c[j] += (w[j] - c[j]) * water.mix;
    }
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = D[o + 3];
  }
  return out;
}

// the gallery picture in a mood, so leaving the scene lands on a painting in the same colours; alt is the
// same picture in another version (pixel-aligned): wherever it differs, it is mixed in by altMix
export function tonePainting(lut, img, adj, alt = null, altMix = 1) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const read = (im) => { cx.clearRect(0, 0, w, h); cx.drawImage(im, 0, 0, w, h); return cx.getImageData(0, 0, w, h); };
  const ap = alt ? read(alt).data : null;
  const id = read(img), px = id.data, c = [0, 0, 0];
  for (let i = 0; i < w * h; i++) {
    toneColor(lut, px[i * 4] / 255, px[i * 4 + 1] / 255, px[i * 4 + 2] / 255, c, adj);
    let k = 0;
    if (ap) {
      const d = (Math.abs(ap[i * 4] - px[i * 4]) + Math.abs(ap[i * 4 + 1] - px[i * 4 + 1]) + Math.abs(ap[i * 4 + 2] - px[i * 4 + 2])) / 255;
      k = Math.min(1, Math.max(0, (d - 0.02) / 0.06)) * altMix;
    }
    for (let j = 0; j < 3; j++) px[i * 4 + j] = c[j] * 255 * (1 - k) + (ap ? ap[i * 4 + j] * k : 0);
  }
  cx.putImageData(id, 0, 0);
  return cv.toDataURL('image/jpeg', 0.92);
}
