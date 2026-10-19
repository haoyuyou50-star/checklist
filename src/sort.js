const BUCKETS = 65536;
const counts = new Uint32Array(BUCKETS);
const starts = new Uint32Array(BUCKETS);
let keys = null;
let vis = null;

const CLS_PETAL = 8, CLS_MOTE = 9;

/**
 * View-frustum cull + back-to-front counting sort on log view depth.
 * Writes visible splat indices to `out` and returns how many there are.
 * Painted strokes are evaluated at the position they occupy during the
 * canvas → world morph, mirroring the per-stroke easing used by the shader.
 *
 * view: { cam:[x,y,z], fwd, right, up, fr:{l,r,t,b} (tan units), margin }
 */
export function sortSplats(S, view, morph, reveal, out) {
  const n = S.count;
  if (!keys || keys.length < n) { keys = new Uint16Array(n); vis = new Uint32Array(n); }
  const { A, B, C, E } = S;
  const lmin = Math.log(0.05), lmax = Math.log(4000), scale = (BUCKETS - 1) / (lmax - lmin);
  const [cx, cy, cz] = view.cam, [fx, fy, fz] = view.fwd, [rx, ry, rz] = view.right, [ux, uy, uz] = view.up;
  const { l, r, t, b } = view.fr;
  const mBase = view.margin;
  const cullExt = reveal > 0.999;
  counts.fill(0);
  let nv = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let x = A[o], y = A[o + 1], z = A[o + 2];
    const ext = E[o + 3] > 0.5;
    if (!ext && morph < 0.999) {
      let m = morph * 1.6 - E[o + 2] * 0.6;
      m = m < 0 ? 0 : m > 1 ? 1 : m;
      m = m * m * (3 - 2 * m);
      x = B[o] + (x - B[o]) * m; y = B[o + 1] + (y - B[o + 1]) * m; z = B[o + 2] + (z - B[o + 2]) * m;
    }
    const px = x - cx, py = y - cy, pz = z - cz;
    const d = px * fx + py * fy + pz * fz;
    const cls = B[o + 3];
    const cullable = cls !== CLS_MOTE && cls !== CLS_PETAL && (!ext || cullExt);
    if (cullable) {
      if (d < 0.05) continue;
      const size = Math.sqrt(C[o] * C[o] + C[o + 1] * C[o + 1] + C[o + 2] * C[o + 2]) * 2.5 + 0.6 + d * 0.03;
      const m = mBase + size / d;
      const sx = (px * rx + py * ry + pz * rz) / d;
      if (sx < l - m || sx > r + m) continue;
      const sy = (px * ux + py * uy + pz * uz) / d;
      if (sy < b - m || sy > t + m) continue;
    }
    let k = d <= 0.05 ? 0 : ((Math.log(d) - lmin) * scale) | 0;
    if (k > BUCKETS - 1) k = BUCKETS - 1;
    k = BUCKETS - 1 - k;
    keys[nv] = k;
    vis[nv++] = i;
    counts[k]++;
  }
  let acc = 0;
  for (let k = 0; k < BUCKETS; k++) { starts[k] = acc; acc += counts[k]; }
  for (let j = 0; j < nv; j++) out[starts[keys[j]]++] = vis[j];
  return nv;
}
