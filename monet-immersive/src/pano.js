import { CLS, polyline } from './scenes.js';
import { makeRng, clamp, lerp, lerp3, smooth, blur1, blurRGB, Builder, makeImportance, softSeed } from './generator.js';

/*
 * A scene painted all the way round: the colours come from one equirectangular picture of the whole
 * sphere (tools/make_pano.py).
 *
 * Directions are sampled on rings around the front ray with a spacing that grows towards the back (as in
 * the unified field), each resolved to a surface: the sky dome, the pond's plane, or the garden standing
 * round the pond. The eye stays where the panorama was painted from.
 *
 * The picture is painted with a hierarchy, as a painter would: an importance field (foci round the viewer)
 * decides where the picture is resolved and where it stays broad. Every place gets the broad underpainting,
 * laid from simplified value masses in large soft strokes; finer passes go only where the picture has detail
 * at their scale, and only as far as the place matters. Focal strokes are hard-edged, take the picture's own
 * full-resolution colour and keep its contrast; minor places are soft-edged, flattened towards their mass and
 * slightly lowered in contrast. The broken-colour touches gather where the eye is led.
 */

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const DEG = Math.PI / 180;
const lumOf = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

export function buildPano(scene, img, Q) {
  const t0 = performance.now();
  const rand = makeRng(scene.id.length * 7919 + 2203);
  const P = scene.pano, cam = scene.cam, f = cam.f, vH = cam.vH, h = cam.h, R = cam.sky;
  const asp = scene.asp;
  const W = P.analysisW[Q.tier] || 2048, H = W >> 1, N = W * H;

  const pixels = (w, hh) => {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = hh;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, hh);
    return ctx.getImageData(0, 0, w, hh).data;
  };
  // the finest strokes take their colour from the picture at its own resolution
  const WF = img.naturalWidth, HF = img.naturalHeight, full = pixels(WF, HF);
  const px = pixels(W, H);
  let rgb = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { rgb[i * 3] = px[i * 4] / 255; rgb[i * 3 + 1] = px[i * 4 + 1] / 255; rgb[i * 3 + 2] = px[i * 4 + 2] / 255; }
  const b1 = blurRGB(rgb, W, H, 1), b2 = blurRGB(rgb, W, H, 2), b4 = blurRGB(rgb, W, H, 4);
  rgb = null;
  const b8 = blurRGB(b4, W, H, 6);
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) lum[i] = 0.3 * b1[i * 3] + 0.59 * b1[i * 3 + 1] + 0.11 * b1[i * 3 + 2];
  const jxx = new Float32Array(N), jxy = new Float32Array(N), jyy = new Float32Array(N), grad = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const gx = (lum[i - W + 1] + 2 * lum[i + 1] + lum[i + W + 1]) - (lum[i - W - 1] + 2 * lum[i - 1] + lum[i + W - 1]);
    const gy = (lum[i + W - 1] + 2 * lum[i + W] + lum[i + W + 1]) - (lum[i - W - 1] + 2 * lum[i - W] + lum[i - W + 1]);
    jxx[i] = gx * gx; jxy[i] = gx * gy; jyy[i] = gy * gy; grad[i] = Math.hypot(gx, gy);
  }
  const rJ = Math.max(2, Math.round(W / 700));
  const Jxx = blur1(jxx, W, H, rJ), Jxy = blur1(jxy, W, H, rJ), Jyy = blur1(jyy, W, H, rJ);
  // detail at each pass's scale: how far the picture blurred to that pass differs from the next coarser blur
  const band = (a, b, r) => {
    const e = new Float32Array(N);
    for (let i = 0; i < N; i++) e[i] = Math.abs(a[i * 3] - b[i * 3]) + Math.abs(a[i * 3 + 1] - b[i * 3 + 1]) + Math.abs(a[i * 3 + 2] - b[i * 3 + 2]);
    return blur1(e, W, H, r);
  };
  const E1 = band(b2, b4, 3), E2 = band(b1, b2, 2);

  /* ---------------- where things are: sky, pond, garden ---------------- */
  // the pond spans elevations [low, top] (degrees) at each azimuth; -99: none
  const wTop = polyline(P.pondTop), wLow = polyline(P.pondLow), shoreD = polyline(P.shore);
  const [sAz, sOff] = P.underfoot;
  // the water lies a little below the bank (m), so the garden's edge stands over it rather than the pond sitting
  // on the ground
  const BK = P.bank, hw = h + (BK ? BK.drop : 0);
  const isPond = (az, el) => {
    const a = az / DEG, e = el / DEG;
    // underfoot every azimuth meets: the shoreline there is a straight line on the ground (as in the sphere)
    if (e < -60) { const c = 1 / Math.tan(-el); return c * Math.cos(az - sAz * DEG) + sOff > 0; }
    return e <= wTop(a) && e >= wLow(a);
  };
  const skyLike = (r, g, b) => {
    const L = 0.3 * r + 0.59 * g + 0.11 * b, ch = Math.max(r, g, b) - Math.min(r, g, b);
    return b >= g - 0.02 && ((L > 0.55 && (b > r + 0.04 || ch < 0.1)) || (L > 0.42 && b > r + 0.16));
  };
  const skyM = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    const el = (0.5 - (y + 0.5) / H) * Math.PI;
    for (let x = 0; x < W; x++) { const i = y * W + x; skyM[i] = el > 0.02 && skyLike(b2[i * 3], b2[i * 3 + 1], b2[i * 3 + 2]) ? 1 : 0; }
  }
  const skyS = blur1(skyM, W, H, 3);
  const cls = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    const el = (0.5 - (y + 0.5) / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const i = y * W + x, az = ((x + 0.5) / W - 0.5) * 2 * Math.PI;
      cls[i] = el > 1.2 || skyS[i] > 0.5 ? CLS.SKY : isPond(az, el) ? CLS.WATER : CLS.TREE;
    }
  }

  // hanging willow: garden whose brushwork runs steadily up and down (P.willow.coh: how steadily)
  let wM = null;
  if (P.willow) {
    const m = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      const el = (0.5 - (y + 0.5) / H) * Math.PI;
      if (el < P.willow.low * DEG) continue;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (cls[i] !== CLS.TREE || b2[i * 3 + 1] < b2[i * 3 + 2]) continue;
        const sxx = Jxx[i], sxy = Jxy[i], syy = Jyy[i];
        const coh = Math.sqrt((sxx - syy) ** 2 + 4 * sxy * sxy) / (sxx + syy + 1e-6);
        const ap = 0.5 * Math.atan2(2 * sxy, sxx - syy) + Math.PI / 2;
        m[i] = coh > P.willow.coh && Math.abs(Math.cos(ap)) < 0.4 ? 1 : 0;
      }
    }
    wM = blur1(m, W, H, Math.max(3, Math.round(W / 400)));
  }
  const isWillow = (i) => wM !== null && wM[i] > P.willow.mask;
  // the willow hangs as one curtain: each willow pixel's place down its hanging run (0 at the top, 1 at the tip)
  // and the run's length (m, roughly: its arc at the garden's distance). Every stroke there takes
  // flex = 2 + 2 * floor(length / 0.25 m) + place, and every pass swings by the same rule, so the layers move
  // together. The shader takes a tree stroke with flex >= 2 as willow
  let wFlex = null;
  if (wM) {
    wFlex = new Float32Array(N);
    const gap = Math.max(3, Math.round(W / 300));
    for (let x = 0; x < W; x++) {
      const az = ((x + 0.5) / W - 0.5) * 360;
      let y = 0;
      while (y < H) {
        if (!isWillow(y * W + x)) { y++; continue; }
        let y1 = y, miss = 0;
        while (y1 + 1 < H && miss <= gap) { y1++; if (isWillow(y1 * W + x)) miss = 0; else miss++; }
        y1 -= miss;
        const len = Math.max(0.25, ((y1 - y + 1) / H) * Math.PI * shoreD(az)), lq = Math.round(len / 0.25);
        for (let k = y; k <= y1; k++) wFlex[k * W + x] = 2 + 2 * lq + Math.min(0.995, (k - y) / Math.max(1, y1 - y));
        y = y1 + 1;
      }
    }
  }

  // the calm pond: its colour smeared level along each row (within the pond), so the open water reads as a few
  // level bands of reflection rather than a mottle of small ones (pondCalm: { r: radius px at 2048, mix })
  let pondH = null;
  if (P.pondCalm) {
    const rr = Math.max(2, Math.round((P.pondCalm.r * W) / 2048));
    pondH = new Float32Array(N * 3);
    for (let y = 0; y < H; y++) {
      const row = y * W, acc = [0, 0, 0];
      let n = 0;
      const put = (x, s) => { const i = row + ((x % W) + W) % W; if (cls[i] !== CLS.WATER) return; for (let j = 0; j < 3; j++) acc[j] += s * b2[i * 3 + j]; n += s; };
      for (let k = -rr; k <= rr; k++) put(k, 1);
      for (let x = 0; x < W; x++) {
        const i = row + x;
        for (let j = 0; j < 3; j++) pondH[i * 3 + j] = n > 0 ? acc[j] / n : b2[i * 3 + j];
        put(x + rr + 1, 1); put(x - rr, -1);
      }
    }
  }
  const calm0 = (c, r) => (pondH && r.cls === CLS.WATER ? lerp3(c, sample(pondH, r.i), P.pondCalm.mix) : c);
  // the shore: a band of water under the far bank takes the bank's darkened reflection (mirrored about the
  // waterline), the water under the near bank its shadow, and the bank's lip over the water is shaded
  // (bank: { band, lip: degrees of water / garden; refl, shade: shares })
  const shore = (c, r) => {
    if (!BK) return c;
    const a = r.az / DEG, e = r.el / DEG, top = wTop(a), low = wLow(a);
    if (r.cls === CLS.WATER) {
      if (top > -90 && e < top) {
        const f = 1 - smooth(0, BK.band, top - e);
        if (f > 0) {
          const ym = yOf((2 * top - e) * DEG), im = ym * W + r.x;
          const m = cls[im] === CLS.TREE ? sample(b4, im) : c;
          c = lerp3(c, m.map((x) => x * 0.72), BK.refl * f);
        }
      }
      if (low > -90 && e > low) c = c.map((x) => x * (1 - BK.shade * (1 - smooth(0, BK.band * 0.6, e - low))));
    } else if (r.cls === CLS.TREE) {
      const k = (top > -90 && e > top ? 1 - smooth(0, BK.lip, e - top) : 0) + (low > -90 && e < low ? 1 - smooth(0, BK.lip, low - e) : 0);
      if (k > 0) c = c.map((x) => x * (1 - BK.shade * Math.min(k, 1)));
    }
    return c;
  };
  const calm = (c, r) => shore(calm0(c, r), r);

  // the eye stands further back than the panorama was painted from: a zoom out round the front (s times smaller
  // there, larger behind), separable in azimuth and elevation so verticals stay vertical and the horizon level,
  // and conformal along the horizon. turn: the view azimuth where the panorama's azimuth 0 (the bridge) lands
  const zs = P.zoom.s, t2 = (a) => Math.tan(clamp(a, -Math.PI + 1e-6, Math.PI - 1e-6) / 2);
  const G = (a) => 2 * Math.atan(zs * t2(a)), dG = (a) => { const t = t2(a); return (zs * (1 + t * t)) / (1 + zs * zs * t * t); };
  const azOff = -G(P.zoom.turn * DEG);
  const warp = (az, el) => {
    const m = dG(az), te = Math.tan(clamp(el, -1.5707, 1.5707));
    const ae = G(az) + azOff;
    return { az: Math.atan2(Math.sin(ae), Math.cos(ae)), el: Math.atan(m * te), kx: 1 / m, ky: (1 + m * m * te * te) / (m * (1 + te * te)), m };
  };

  // importance (0: left broad, 1: the focus) by view direction; the sky never comes forward much
  const IMP = makeImportance(P.focus), impAt = IMP.at, impDir = IMP.dir;
  const imp = (vaz, vel, c) => { const m = impAt(vaz, vel); return c === CLS.SKY ? Math.min(m, P.focus.skyMax) : m; };

  const xOf = (az) => { const x = Math.floor((az / (2 * Math.PI) + 0.5) * W); return ((x % W) + W) % W; };
  const yOf = (el) => clamp(Math.floor((0.5 - el / Math.PI) * H), 0, H - 1);
  const resolve = (d) => {
    const vaz = Math.atan2(d[0], -d[2]), vel = Math.asin(clamp(d[1], -1, 1)), w = warp(vaz, vel), az = w.az, el = w.el;
    const x = xOf(az), y = yOf(el), i = y * W + x, c = cls[i];
    const hz = Math.hypot(d[0], d[2]) || 1e-6;
    let t, flex = 0;
    if (c === CLS.SKY) t = R;
    else {
      const S = shoreD(az / DEG) * w.m;
      if (c === CLS.WATER) { t = d[1] < -1e-3 ? Math.min(hw / -d[1], cam.maxD) : cam.maxD; flex = 0.5 + rand() * 0.5; }
      else {
        // the garden stands round the pond at the shore's distance, nearer where it comes down to the eye's feet
        t = d[1] < -1e-3 ? Math.min(h / -d[1], S / hz) : S / hz;
        flex = wFlex && wFlex[i] >= 2 ? wFlex[i] : clamp((el / DEG + 12) / 45, 0.1, 1);
      }
    }
    // kx, ky: view arc per panorama radian across and up
    return { P: [d[0] * t, d[1] * t, d[2] * t], cls: c, i, x, y, az, el, vel, kx: w.kx * Math.cos(vel), ky: w.ky, flex, imp: imp(vaz, vel, c) };
  };

  /* ---------------- colour ---------------- */
  const meanEl = (e0, e1, want) => {
    const m = [0, 0, 0]; let n = 0;
    for (let y = yOf(e1 * DEG); y <= yOf(e0 * DEG); y++) for (let x = 0; x < W; x += 2) {
      const i = y * W + x; if (want !== undefined && cls[i] !== want) continue;
      m[0] += b4[i * 3]; m[1] += b4[i * 3 + 1]; m[2] += b4[i * 3 + 2]; n++;
    }
    return n ? [m[0] / n, m[1] / n, m[2] / n] : [0.6, 0.65, 0.72];
  };
  const horizCol = meanEl(8, 30, CLS.SKY), zenCol = meanEl(70, 90), ground = meanEl(-90, -70), near = meanEl(-50, -25, CLS.WATER);
  // a value mass: the broad colour there, its value drawn towards one of a few steps (soft posterising), so minor
  // places read as a handful of light and dark shapes
  const NV = P.masses.steps;
  const massAt = (i) => {
    const c = [b8[i * 3], b8[i * 3 + 1], b8[i * 3 + 2]], l = lumOf(c);
    const s = l * NV - 0.5, k = Math.floor(s), fr = s - k;
    const q = (k + smooth(0.5 - P.masses.edge, 0.5 + P.masses.edge, fr) + 0.5) / NV;
    return c.map((x) => clamp(x + (q - l) * P.masses.pull, 0, 1));
  };
  const fullAt = (az, el) => {
    const x = ((Math.floor((az / (2 * Math.PI) + 0.5) * WF) % WF) + WF) % WF, y = clamp(Math.floor((0.5 - el / Math.PI) * HF), 0, HF - 1);
    const o = (y * WF + x) * 4;
    return [full[o] / 255, full[o + 1] / 255, full[o + 2] / 255];
  };
  // focal colour keeps (and slightly lifts) the picture's contrast against its surroundings; minor colour
  // settles into its mass, a little flatter and, far off, a little towards the air
  const finish = (c, r, toMass) => {
    const i = r.i, m = [b8[i * 3], b8[i * 3 + 1], b8[i * 3 + 2]], q = 1 - r.imp;
    const k = lerp(P.contrast[0], P.contrast[1], r.imp);
    let o = c.map((x, j) => m[j] + (x - m[j]) * k);
    if (toMass > 0) o = lerp3(o, massAt(i), toMass);
    if (r.cls === CLS.TREE) o = lerp3(o, horizCol, P.air * q * smooth(8, 30, Math.hypot(r.P[0], r.P[2])));
    return o.map((x) => clamp(x + (rand() - 0.5) * 0.02, 0, 1));
  };

  /* ---------------- stroke emission ---------------- */
  const B = new Builder(600000);
  const alpha0 = Q.uniAlpha * (P.alphaMul[Q.tier] || 1);
  const [gA, gB, gM] = P.falloff;
  const gOf = (psi) => 1 + gM * smooth(gA, gB, psi);
  const sC = 3.0 / f;
  const up = [0, 1, 0];
  const front = norm([0, -(0.5 - vH) * asp, -f]);
  const extDelay = (p) => {
    const l = Math.hypot(p[0], p[1], p[2]) || 1;
    const dd = (p[0] * front[0] + p[1] * front[1] + p[2] * front[2]) / l;
    return clamp((Math.acos(clamp(dd, -1, 1)) - 0.3) / 2.7, 0, 1) * 0.85 + rand() * 0.15;
  };
  const proj = (d) => (d[2] < -1e-6 ? [0.5 + (d[0] / -d[2]) * f, vH - ((d[1] / -d[2]) * f) / asp] : null);
  const inRect = (p) => p && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1;
  // the picture's brushwork direction at a pixel, turned from panorama pixels (one azimuth step is cos el of arc
  // there) to the view
  const strokeAngle = (r, lily) => {
    const i = r.i, c = r.cls, ce = Math.cos(r.el);
    if (c === CLS.WATER || lily) return (rand() - 0.5) * (lily ? 0.35 : 0.25);
    let a;
    const sxx = Jxx[i], sxy = Jxy[i], syy = Jyy[i];
    const coh = Math.sqrt((sxx - syy) ** 2 + 4 * sxy * sxy) / (sxx + syy + 1e-6);
    if (ce > 0.35 && rand() < coh * 1.3) {
      const ap = 0.5 * Math.atan2(2 * sxy, sxx - syy) + Math.PI / 2;
      a = Math.atan2(Math.sin(ap) * r.ky, Math.cos(ap) * r.kx);
    } else a = c === CLS.SKY ? (rand() - 0.5) * 0.6 : rand() * Math.PI;
    // Monet's sky goes on in long, nearly level drags (overhead they would close into rings: any direction there)
    if (c === CLS.SKY) { const h0 = a - Math.PI * Math.round(a / Math.PI); a = lerp(h0 * 0.4 + (rand() - 0.5) * 0.12, h0, smooth(0.5, 1.1, r.vel)); }
    return a;
  };
  const counts = [0, 0, 0, 0, 0, 0];
  // how soft the minor places' edges get (1: as designed; lower leaves the blur to the headset's foveation)
  const SM = P.softMul ?? 1;
  // li: pass (4 = broken colour); soft 0..1: edge softness (packed in the seed's integer part for the shader)
  const add = (r, d, sp, col, alpha, majR, minR, li, soft, lily = false) => {
    let maj = sp * lerp(majR[0], majR[1], rand()), mn = sp * lerp(minR[0], minR[1], rand());
    const c = lily ? CLS.STATIC : r.cls, nearW = r.cls === CLS.WATER ? smooth(-0.3, -0.7, d[1]) : 0;
    if (c === CLS.WATER) { maj *= 1.1 * lerp(1, 0.8, nearW); mn *= lerp(0.72, 1.05, nearW); }
    // a lily pad lies on the pond: the further off, the flatter its dash
    if (lily) { const a = clamp(1 / (Math.sin(-r.vel) * 2.2 + 0.25), 1.15, 2.8); maj = sp * (P.lilySize ?? 1) * lerp(0.75, 1.05, rand()) * Math.sqrt(a); mn = maj / a; }
    if (c === CLS.SKY) { maj *= li === 0 ? 1.55 : 1.35; mn *= 1.08; }
    // soft strokes spread a little wider so they still close up over their neighbours
    maj *= 1 + 0.25 * soft; mn *= 1 + 0.35 * soft;
    // finer passes lie nearer, by more than the foliage sways (or the depth sort would shuffle them up close)
    const d0 = Math.hypot(r.P[0], r.P[1], r.P[2]), dm = 1 + (4 - li) * Math.max(0.014, 0.09 / d0);
    const Pw = [r.P[0] * dm, r.P[1] * dm, r.P[2] * dm];
    const dist = d0 * dm;
    const Rt = norm(cross(d, Math.abs(d[1]) > 0.999 ? [0, 0, 1] : up)), Ut = cross(Rt, d);
    // under the strands the broad passes hang too: long, upright, narrow
    const hang = c === CLS.TREE && r.flex >= 2;
    if (hang) { maj *= P.willow.under[0]; mn *= P.willow.under[1]; }
    const ang = hang ? Math.PI / 2 + (rand() - 0.5) * 0.12 : strokeAngle(r, lily), ca = Math.cos(ang) * maj * dist, sa = -Math.sin(ang) * maj * dist;
    let axis = [Rt[0] * ca + Ut[0] * sa, Rt[1] * ca + Ut[1] * sa, Rt[2] * ca + Ut[2] * sa];
    // looking down, strokes laid across the line of sight close into rings round the nadir: flat on the pond instead
    if (c === CLS.WATER && rand() < nearW) { const a = rand() * Math.PI; axis = [Math.cos(a) * maj * dist, 0, Math.sin(a) * maj * dist]; }
    const p = proj(d), inF = inRect(p);
    let cpos = Pw, delay;
    if (inF) {
      const sc = sC * (1 + 0.004 * (4 - li)) * f / -d[2];
      cpos = [d[0] * sc, d[1] * sc, d[2] * sc];
      delay = clamp(Math.hypot(p[0] - 0.5, (p[1] - 0.5) * asp) / 0.62 * 0.62 + rand() * 0.38, 0, 1);
    } else delay = extDelay(Pw);
    B.add(Pw, cpos, axis, mn * dist, col, alpha, c, 0, r.flex, delay, inF ? 0 : 1, softSeed(soft, rand()));
    counts[li]++;
  };
  const sample = (img, i) => [img[i * 3], img[i * 3 + 1], img[i * 3 + 2]];

  const fA = norm(cross(front, up)), fB = cross(fA, front);
  const ring = (sp0, each) => {
    let psi = sp0(0) * 0.45;
    while (psi < Math.PI) {
      const sp = sp0(psi), rowStep = sp * 0.866;
      const n = Math.max(1, Math.round((2 * Math.PI * Math.sin(psi)) / sp));
      const off = rand();
      for (let k = 0; k < n; k++) {
        const ph = ((k + off + (rand() - 0.5) * 0.9) / n) * 2 * Math.PI;
        const ps = clamp(psi + (rand() - 0.5) * rowStep * 0.9, 0, Math.PI);
        const s = Math.sin(ps), c = Math.cos(ps), cph = Math.cos(ph), sph = Math.sin(ph);
        each(norm([front[0] * c + (fA[0] * cph + fB[0] * sph) * s, front[1] * c + (fA[1] * cph + fB[1] * sph) * s, front[2] * c + (fA[2] * cph + fB[2] * sph) * s]), sp, ps);
      }
      psi += rowStep;
    }
  };
  const L = P.passes;
  // lily pads and flowers on the pond: water with detail of its own (not the plain surface)
  const isLily = (r, e) => r.cls === CLS.WATER && e > P.lily && r.vel < -0.03;

  // underpainting: everywhere, large; minor places from their value masses, in soft strokes
  ring((psi) => alpha0 * L[0].k * gOf(psi), (d, sp) => {
    const r = resolve(d), q = 1 - r.imp;
    const col = finish(calm(sample(b4, r.i), r), r, P.masses.mix * q);
    add(r, d, sp, col, 0.97, L[0].maj, L[0].min, 0, r.cls === CLS.SKY ? 0.75 : (0.2 + 0.55 * q) * SM);
  });
  // second pass: most places still, thinning out where nothing much happens
  ring((psi) => alpha0 * L[1].k * gOf(psi), (d, sp) => {
    const r = resolve(d), e = E1[r.i];
    if (r.cls === CLS.SKY && rand() < 0.35) return;
    if (rand() > clamp(L[1].base + L[1].imp * r.imp + L[1].gain * e, 0, 1)) return;
    const q = 1 - r.imp;
    add(r, d, sp, finish(calm(sample(b2, r.i), r), r, P.masses.mix * q * 0.6), 0.97, L[1].maj, L[1].min, 1, r.cls === CLS.SKY ? 0.6 : (0.1 + 0.45 * q) * SM);
  });
  // third pass: only where the picture has detail at this scale, as far as the place matters
  ring((psi) => alpha0 * L[2].k * gOf(psi), (d, sp) => {
    const pre = clamp((L[2].base + L[2].gain * 0.25) * lerp(L[2].low, 1, smooth(L[2].from, 0.8, impDir(d))), 0, 1);
    if (rand() > pre) return;
    const r = resolve(d), e = E2[r.i];
    if (r.cls === CLS.SKY && rand() > 0.25 * r.imp) return;
    if (rand() * pre > clamp((L[2].base + L[2].gain * e) * lerp(L[2].low, 1, smooth(L[2].from, 0.8, r.imp)), 0, 1)) return;
    if (isWillow(r.i)) return;
    const lily = isLily(r, e);
    const c1 = sample(b1, r.i);
    add(r, d, sp, finish(lily ? c1 : calm(c1, r), r, 0), 0.97, L[2].maj, L[2].min, 2, (1 - r.imp) * 0.3 * SM, lily);
  });
  // finest pass: edges in the focal places, at the picture's own resolution, hard-edged
  // (the fine passes test most directions only to leave them out: a first test on the importance alone, before
  // the direction is resolved, keeps the build fast; the second test makes up the rest of the chance)
  ring((psi) => alpha0 * L[3].k * gOf(psi), (d, sp) => {
    const pre = 0.85 * L[3].p * smooth(L[3].from, 1, impDir(d));
    if (rand() > pre) return;
    const r = resolve(d);
    if (r.cls === CLS.SKY || isWillow(r.i)) return;
    if (rand() * pre > clamp(grad[r.i] * 9 - 0.12, 0, 0.85) * L[3].p * smooth(L[3].from, 1, r.imp)) return;
    const e = E2[r.i], lily = isLily(r, e);
    if (P.pondCalm && r.cls === CLS.WATER) return;
    add(r, d, sp, finish(fullAt(r.az, r.el), r, 0), 0.96, L[3].maj, L[3].min, 3, 0, lily);
  });

  // broken colour: small touches, warm or cool and a little more saturated than the picture beneath, gathered
  // where the eye is led (and on the pond's lilies), sparse in the broad places
  const DB = P.dabs;
  ring((psi) => alpha0 * DB.k * gOf(psi), (d, sp) => {
    const pre = DB.p * lerp(DB.minor, 1, smooth(0.15, 0.85, impDir(d)));
    if (rand() > pre) return;
    const r = resolve(d);
    if (r.cls === CLS.SKY && rand() > DB.sky) return;
    if (isWillow(r.i) || (r.cls === CLS.WATER && rand() > (DB.water ?? 1))) return;
    const e = E2[r.i];
    if (rand() * pre > DB.p * lerp(DB.minor, 1, smooth(0.15, 0.85, r.imp)) * (0.5 + 0.5 * smooth(0, 0.12, e))) return;
    const jr = (DB.jitter * sp) / Math.max(r.kx, 0.2);
    const az = r.az + (rand() - 0.5) * 2 * jr, el = r.el + (rand() - 0.5) * 2 * jr;
    const col = fullAt(cls[yOf(el) * W + xOf(az)] === r.cls ? az : r.az, cls[yOf(el) * W + xOf(az)] === r.cls ? el : r.el);
    const lm = lumOf(col), tint = (rand() - 0.5) * 2 * DB.tint * (0.5 + r.imp);
    const tc = tint > 0 ? [1, 0.45, -0.7] : [-0.6, -0.1, 1];
    for (let q = 0; q < 3; q++) col[q] = clamp(lm + (col[q] - lm) * DB.sat + tc[q] * Math.abs(tint), 0, 1);
    add(r, d, sp, finish(col, r, 0), 0.95, [1.0, 1.6], [0.6, 0.9], 4, 0, isLily(r, e));
  });

  // willow strands: each hangs from where it starts and runs down the picture's own brushwork as one chain of
  // thin overlapping strokes, so it reads as one strand and sways as one. The shader takes flex 2..3 on a tree
  // stroke as a strand: 2 + how far down it (0 at its top, 1 at its tip)
  if (P.willow) {
    const WL = P.willow;
    ring((psi) => alpha0 * WL.k * gOf(psi), (d0, sp) => {
      let r = resolve(d0);
      if (!isWillow(r.i)) return;
      const n = Math.round(lerp(WL.len[0], WL.len[1], rand()));
      if (rand() > WL.cover / n) return;
      const pts = [];
      let d = d0;
      for (let k = 0; k < n; k++) {
        if (k > 0) {
          r = resolve(d);
          if (r.cls !== CLS.TREE || (wM[r.i] < WL.mask * 0.6)) break;
        }
        // down the brushwork (steadily: a strand barely wanders)
        const Rt = norm(cross(d, up)), Ut = cross(Rt, d);
        const i = r.i, sxx = Jxx[i], sxy = Jxy[i], syy = Jyy[i];
        const ap = 0.5 * Math.atan2(2 * sxy, sxx - syy) + Math.PI / 2;
        let dx = Math.cos(ap) * r.kx, dy = Math.abs(Math.sin(ap)) * r.ky;
        const l = Math.hypot(dx, dy) || 1;
        dx = clamp(dx / l, -0.35, 0.35); dy = Math.sqrt(1 - dx * dx);
        pts.push({ r, d, dir: [Rt[0] * dx - Ut[0] * dy, Rt[1] * dx - Ut[1] * dy, Rt[2] * dx - Ut[2] * dy] });
        const st = sp * WL.step;
        d = norm([d[0] + pts[k].dir[0] * st, d[1] + pts[k].dir[1] * st, d[2] + pts[k].dir[2] * st]);
      }
      if (pts.length < 4) return;
      const tone = 1 + (rand() - 0.5) * WL.tone;
      // the strand's colour from the lightly blurred picture, eased along it: the picture's own flecks, taken a
      // pixel at a time, made a strand a chain of light and dark dashes
      let run = null;
      pts.forEach(({ r, d, dir }, k) => {
        const t = k / (pts.length - 1);
        const c1 = lerp3(sample(b1, r.i), sample(b4, r.i), WL.settle);
        run = run ? lerp3(run, c1, WL.ease) : c1;
        const col = finish(run, r, 0).map((x) => clamp(x * tone, 0, 1));
        const dist = Math.hypot(r.P[0], r.P[1], r.P[2]), dm = 1 - 0.004 * (1 + t);
        const Pw = r.P.map((q) => q * dm);
        const half = sp * WL.step * WL.over * 0.5 * dist, mn = sp * WL.width * dist * lerp(1, 0.7, t);
        const p = proj(d), inF = inRect(p);
        let cpos = Pw, delay;
        if (inF) {
          const sc = sC * f / -d[2];
          cpos = [d[0] * sc, d[1] * sc, d[2] * sc];
          delay = clamp(Math.hypot(p[0] - 0.5, (p[1] - 0.5) * asp) / 0.62 * 0.62 + rand() * 0.38, 0, 1);
        } else delay = extDelay(Pw);
        B.add(Pw, cpos, dir.map((q) => q * half), mn, col, 0.95, CLS.TREE, 0, r.flex >= 2 ? r.flex : 2 + 2 * Math.round(2 / 0.25) + Math.min(t, 0.995), delay, inF ? 0 : 1, softSeed(0, rand()));
        counts[5]++;
      });
    });
  }

  // lily pads: whole, hard-edged pads lying flat on the water in drifts where the picture's pond has them, a few
  // in flower. Each pad is one broad touch and a lighter one over it (never a scatter of small ones); flowers are
  // a small cluster of petals over the pad
  // (pads: { n per tier, r: radius m [min, max], grow: radius per m away, spacing in radii, evidence: pond detail
  // that counts as lilies, drift: share of the pond the drifts cover, flower: share in flower, greens, flowers })
  const PD = P.pads;
  let nPads = 0;
  if (PD) {
    const ev = blur1(E2, W, H, Math.max(3, Math.round(W / 256)));
    const taken = new Map(), cell = 0.5;
    const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    const target = PD.n[Q.tier] || PD.n.mid;
    const flat = (Pw, d, axis, mn, col, soft) => {
      const p = proj(d), inF = inRect(p);
      let cpos = Pw, delay;
      if (inF) {
        const sc = sC * f / -d[2];
        cpos = [d[0] * sc, d[1] * sc, d[2] * sc];
        delay = clamp(Math.hypot(p[0] - 0.5, (p[1] - 0.5) * asp) / 0.62 * 0.62 + rand() * 0.38, 0, 1);
      } else delay = extDelay(Pw);
      B.add(Pw, cpos, axis, mn, col, 1, CLS.STATIC, 0, 0, delay, inF ? 0 : 1, softSeed(soft, rand()));
    };
    for (let tries = 0; tries < target * 40 && nPads < target; tries++) {
      const th = rand() * Math.PI * 2, rr = 3.5 + Math.pow(rand(), 1.3) * PD.far;
      const x = rr * Math.sin(th), z = -rr * Math.cos(th);
      const d = norm([x, -hw, z]), r = resolve(d);
      if (r.cls !== CLS.WATER) continue;
      const a = r.az / DEG, e = r.el / DEG, top = wTop(a), low = wLow(a);
      if ((top > -90 && e > top - BK.band * 0.5) || (low > -90 && e < low + 1)) continue;
      // drifts: slow noise over the water, and the picture's own lilies
      const nz = Math.sin(x * 0.31 + z * 0.17) + Math.sin(x * -0.13 + z * 0.41 + 1.7) * 0.8 + Math.sin(x * 0.57 - z * 0.23 + 4.1) * 0.5;
      const want = smooth(1 - PD.drift * 2.3, 1.3 - PD.drift * 2.3, nz / 2.3 + 0.5) * smooth(PD.evidence * 0.5, PD.evidence, ev[r.i]);
      if (rand() > want) continue;
      const dist = Math.hypot(r.P[0], r.P[1], r.P[2]);
      const R = lerp(PD.r[0], PD.r[1], rand()) * (1 + PD.grow * rr);
      const sp = R * PD.spacing, k0 = Math.floor((x - sp) / cell), k1 = Math.floor((x + sp) / cell);
      let clash = false;
      for (let kx = k0; kx <= k1 && !clash; kx++) for (let kz = Math.floor((z - sp) / cell); kz <= Math.floor((z + sp) / cell) && !clash; kz++) {
        const o = taken.get(`${kx},${kz}`);
        if (o && o.some(([ox, oz, oR]) => Math.hypot(ox - x, oz - z) < (oR + R) * PD.spacing * 0.5)) clash = true;
      }
      if (clash) continue;
      const kk = key(x, z);
      if (!taken.has(kk)) taken.set(kk, []);
      taken.get(kk).push([x, z, R]);
      nPads++;

      // lying flat: across the view at full width, foreshortened up the view
      const Rt = norm(cross(d, up)), sd = Math.max(0.16, -d[1] / Math.hypot(d[0], d[1], d[2]));
      const ang = (rand() - 0.5) * 0.5, ca = Math.cos(ang), sa = Math.sin(ang);
      const fh = norm([d[0], 0, d[2]]), ax = [Rt[0] * ca + fh[0] * sa, 0, Rt[2] * ca + fh[2] * sa];
      const src = sample(b2, r.i), g = PD.greens[Math.floor(rand() * PD.greens.length)];
      const lv = lumOf(src);
      const base = lerp3(g.map((q) => q * (0.8 + lv * 0.45)), src, PD.mix).map((q) => clamp(q * (0.92 + rand() * 0.16), 0, 1));
      const y = -hw + 0.01;
      const at = (ox, oz) => { const pw = [x + ox, y, z + oz]; return { pw, d: norm(pw) }; };
      // the pad's shadow on the water, a touch nearer the viewer
      // (behind the pad in depth, so it only shows as a darker rim round it)
      const sh = at(0, 0);
      sh.pw = sh.pw.map((q) => q * 1.012);
      flat(sh.pw, sh.d, ax.map((q) => q * R * 1.1), R * sd * 1.04, lerp3(base, [0.14, 0.26, 0.28], 0.55), 0.2);
      // two overlapping touches, so the pad's outline is not a perfect oval
      const c0 = at(0, 0), o2 = (rand() < 0.5 ? -1 : 1) * R * lerp(0.3, 0.45, rand());
      flat(c0.pw.map((q, j) => (j === 1 ? y + 0.004 : q)), c0.d, ax.map((q) => q * R), R * sd * 0.9, base, 0.08);
      const c1 = at(ax[0] * o2 + fh[0] * R * 0.1, ax[2] * o2 + fh[2] * R * 0.1);
      flat([c1.pw[0], y + 0.005, c1.pw[2]], c1.d, ax.map((q) => q * R * 0.7), R * sd * lerp(0.7, 0.85, rand()), base.map((q) => clamp(q * 0.95, 0, 1)), 0);
      // a lighter touch over its far half, where it catches the sky
      const o = (rand() - 0.5) * 0.5 * R, hi = at(Rt[0] * o + d[0] * R * 0.15, Rt[2] * o + d[2] * R * 0.15);
      flat([hi.pw[0], y + 0.008, hi.pw[2]], hi.d, ax.map((q) => q * R * 0.62), R * sd * 0.5, base.map((q, j) => clamp(q * 1.12 + [0.06, 0.07, 0.05][j], 0, 1)), 0);
      counts[4] += 4;
      // far off a flower would be a speck: only the nearer pads flower
      if (rr < PD.flowerFar && rand() < PD.flower) {
        const fc = PD.flowers[Math.floor(rand() * PD.flowers.length)], fr = R * lerp(0.4, 0.5, rand());
        const fo = (rand() - 0.5) * 0.6 * R;
        for (let q = 0; q < 4; q++) {
          const pa = (q / 4) * Math.PI + rand() * 0.3, px = Math.cos(pa) * fr * 0.35, pz = Math.sin(pa) * fr * 0.35;
          const fp = [x + Rt[0] * fo + px, y + 0.05 + fr * 0.25, z + Rt[2] * fo + pz];
          const pd = norm(fp), pR = norm(cross(pd, up)), pU = cross(pR, pd);
          const tilt = (q / 3 - 0.5) * 1.6;
          const pax = [pR[0] * Math.cos(tilt) + pU[0] * Math.sin(tilt) * 0.6, pR[1] * Math.cos(tilt) + pU[1] * Math.sin(tilt) * 0.6, pR[2] * Math.cos(tilt) + pU[2] * Math.sin(tilt) * 0.6];
          flat(fp, pd, pax.map((v) => v * fr * 0.7), fr * 0.4, fc.map((v) => clamp(v * (0.94 + rand() * 0.1), 0, 1)), 0);
        }
        const cp = [x + Rt[0] * fo, y + 0.07 + fr * 0.3, z + Rt[2] * fo];
        flat(cp, norm(cp), Rt.map((v) => v * fr * 0.3), fr * 0.22, [0.98, 0.84, 0.42], 0);
        counts[4] += 5;
      }
    }
  }

  // sparkle on the pond and drifting motes
  for (let k = 0; k < Q.glints * 0.6 * (P.glints ?? 1); k++) {
    const th = rand() * Math.PI * 2, rr = 2.5 + Math.pow(rand(), 1.4) * 30;
    const x = rr * Math.sin(th), z = -rr * Math.cos(th);
    const d = norm([x, -hw, z]);
    if (resolve(d).cls !== CLS.WATER) continue;
    const s = 0.016 * Math.pow(rr, 0.8);
    B.add([x, -hw + 0.02, z], [x, -hw + 0.02, z], [Math.cos(th) * s * 2.5, 0, Math.sin(th) * s * 2.5], s * 0.6, [1, 0.97, 0.86], 0.9, CLS.GLINT, 0, 1, extDelay([x, -hw, z]), 1, rand());
  }
  for (let k = 0; k < Q.motes * 0.45 * (P.motes ?? 1); k++) {
    const x = (rand() - 0.5) * 30, y = -h + 0.25 + Math.pow(rand(), 1.5) * 3.2, z = (rand() - 0.5) * 30;
    const s = 0.016 + rand() * 0.022;
    B.add([x, y, z], [x, y, z], [s, 0, 0], s * 0.85, [1, 0.84, 0.55], 0.55, CLS.MOTE, 0, 0, extDelay([x, y, z]), 1, rand());
  }
  console.log(`[monet] pano passes ${counts.join('/')} pads ${nPads} total ${B.n} in ${Math.round(performance.now() - t0)}ms`);

  return {
    count: B.n, A: B.A.subarray(0, B.n * 4), B: B.B.subarray(0, B.n * 4), C: B.C.subarray(0, B.n * 4),
    D: B.D.subarray(0, B.n * 4), E: B.E.subarray(0, B.n * 4),
    hotspots: [], front, bg: { horizon: horizCol, zenith: lerp3(zenCol, horizCol, 0.2), ground, near },
    paint: { f, vH, asp, xL: -0.5 / f, yT: (vH * asp) / f, yB: (-(1 - vH) * asp) / f },
    unified: true, h,
  };
}
