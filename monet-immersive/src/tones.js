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

export function buildToneLUT(baseImg, refImg) {
  const w = SW, h = Math.max(8, Math.round((SW * baseImg.naturalHeight) / baseImg.naturalWidth));
  const b = smallRGB(baseImg, w, h), t = smallRGB(refImg, w, h), M = w * h;
  const glob = [0, 0, 0];
  for (let i = 0; i < M; i++) for (let j = 0; j < 3; j++) glob[j] += (t[i * 3 + j] - b[i * 3 + j]) / M;
  const lut = new Float32Array(N * N * N * 3), k2 = 1 / (2 * BW * BW);
  for (let ri = 0; ri < N; ri++) for (let gi = 0; gi < N; gi++) for (let bi = 0; bi < N; bi++) {
    const c = [ri / (N - 1), gi / (N - 1), bi / (N - 1)];
    let ws = 0; const o = [0, 0, 0];
    for (let i = 0; i < M; i++) {
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

export function toneColor(lut, r, g, b, out = [0, 0, 0], expo = 1) {
  const f = [r, g, b].map((x) => Math.min(N - 1.0001, Math.max(0, x * (N - 1))));
  const i0 = f.map(Math.floor), t = f.map((x, j) => x - i0[j]);
  out[0] = r; out[1] = g; out[2] = b;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = c >> 2;
    const w = (dx ? t[0] : 1 - t[0]) * (dy ? t[1] : 1 - t[1]) * (dz ? t[2] : 1 - t[2]);
    const q = (((i0[0] + dx) * N + i0[1] + dy) * N + i0[2] + dz) * 3;
    for (let j = 0; j < 3; j++) out[j] += w * lut[q + j];
  }
  for (let j = 0; j < 3; j++) out[j] = Math.min(1, Math.max(0, out[j] * expo));
  return out;
}

// per-stroke colours of one mood, same layout as D (rgb + alpha)
export function toneStrokes(lut, D, count, expo = 1) {
  const out = new Float32Array(count * 4), c = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    toneColor(lut, D[o], D[o + 1], D[o + 2], c, expo);
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = D[o + 3];
  }
  return out;
}

// the gallery picture in a mood, so leaving the scene lands on a painting in the same colours
export function tonePainting(lut, img, expo = 1) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const id = cx.getImageData(0, 0, w, h), px = id.data, c = [0, 0, 0];
  for (let i = 0; i < w * h; i++) {
    toneColor(lut, px[i * 4] / 255, px[i * 4 + 1] / 255, px[i * 4 + 2] / 255, c, expo);
    px[i * 4] = c[0] * 255; px[i * 4 + 1] = c[1] * 255; px[i * 4 + 2] = c[2] * 255;
  }
  cx.putImageData(id, 0, 0);
  return cv.toDataURL('image/jpeg', 0.92);
}
