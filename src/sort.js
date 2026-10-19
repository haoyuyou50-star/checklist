const BUCKETS = 65536;
let counts = new Uint32Array(BUCKETS);
let starts = new Uint32Array(BUCKETS);
let keys = null;

/**
 * Back-to-front counting sort on log view depth.
 * Painted strokes are sorted at the position they currently occupy during the
 * canvas → world morph, mirroring the per-stroke easing used by the shader.
 */
export function sortSplats(S, cam, dir, morph, out) {
  const n = S.count;
  if (!keys || keys.length < n) keys = new Uint16Array(n);
  const { A, B, E } = S;
  const lmin = Math.log(0.05), lmax = Math.log(4000), scale = (BUCKETS - 1) / (lmax - lmin);
  const cx = cam[0], cy = cam[1], cz = cam[2], dx = dir[0], dy = dir[1], dz = dir[2];
  counts.fill(0);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let x = A[o], y = A[o + 1], z = A[o + 2];
    if (E[o + 3] < 0.5 && morph < 0.999) {
      let m = morph * 1.6 - E[o + 2] * 0.6;
      m = m < 0 ? 0 : m > 1 ? 1 : m;
      m = m * m * (3 - 2 * m);
      x = B[o] + (x - B[o]) * m; y = B[o + 1] + (y - B[o + 1]) * m; z = B[o + 2] + (z - B[o + 2]) * m;
    }
    const d = (x - cx) * dx + (y - cy) * dy + (z - cz) * dz;
    let k = d <= 0.05 ? 0 : ((Math.log(d) - lmin) * scale) | 0;
    if (k > BUCKETS - 1) k = BUCKETS - 1;
    k = BUCKETS - 1 - k;
    keys[i] = k;
    counts[k]++;
  }
  let acc = 0;
  for (let b = 0; b < BUCKETS; b++) { starts[b] = acc; acc += counts[b]; }
  for (let i = 0; i < n; i++) out[starts[keys[i]]++] = i;
  return out;
}
