import { CLS, polyline } from './scenes.js';
import { makeRng, clamp, lerp, lerp3, smooth, blur1, blurRGB, Builder } from './generator.js';

/*
 * A scene painted all the way round: the colours come from one equirectangular picture of the whole
 * sphere (tools/make_pano.py), the gallery picture is that sphere seen through the scene's pinhole camera.
 *
 * Directions are sampled on rings around the front ray with a spacing that grows towards the back (as in
 * the unified field), each resolved to a surface: the sky dome, the pond's plane, or the garden standing
 * round the pond. Strokes take their direction from the picture's own brushwork, and a last pass of small
 * broken-colour touches (warmer or cooler than the picture beneath) gives the pointillist surface.
 * The eye stays where the panorama was painted from.
 */

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const DEG = Math.PI / 180;

export function buildPano(scene, img, Q) {
  const t0 = performance.now();
  const rand = makeRng(scene.id.length * 7919 + 2203);
  const P = scene.pano, cam = scene.cam, f = cam.f, vH = cam.vH, h = cam.h, R = cam.sky;
  const asp = scene.asp;
  const W = P.analysisW[Q.tier] || 2048, H = W >> 1, N = W * H;

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const rgb = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { rgb[i * 3] = px[i * 4] / 255; rgb[i * 3 + 1] = px[i * 4 + 1] / 255; rgb[i * 3 + 2] = px[i * 4 + 2] / 255; }
  const b1 = blurRGB(rgb, W, H, 1), b2 = blurRGB(rgb, W, H, 2), b4 = blurRGB(rgb, W, H, 4);
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
  const levels = [b4, b2, b1, b1];

  /* ---------------- where things are: sky, pond, garden ---------------- */
  // the pond spans elevations [low, top] (degrees) at each azimuth; -99: none
  const wTop = polyline(P.pondTop), wLow = polyline(P.pondLow), shoreD = polyline(P.shore);
  const [sAz, sOff] = P.underfoot;
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
  const xOf = (az) => { const x = Math.floor((az / (2 * Math.PI) + 0.5) * W); return ((x % W) + W) % W; };
  const yOf = (el) => clamp(Math.floor((0.5 - el / Math.PI) * H), 0, H - 1);
  const resolve = (d) => {
    const vel = Math.asin(clamp(d[1], -1, 1)), w = warp(Math.atan2(d[0], -d[2]), vel), az = w.az, el = w.el;
    const x = xOf(az), y = yOf(el), i = y * W + x, c = cls[i];
    const hz = Math.hypot(d[0], d[2]) || 1e-6;
    let t, flex = 0;
    if (c === CLS.SKY) t = R;
    else {
      const S = shoreD(az / DEG) * w.m;
      if (c === CLS.WATER) { t = d[1] < -1e-3 ? Math.min(h / -d[1], cam.maxD) : cam.maxD; flex = 0.5 + rand() * 0.5; }
      else {
        // the garden stands round the pond at the shore's distance, nearer where it comes down to the eye's feet
        t = d[1] < -1e-3 ? Math.min(h / -d[1], S / hz) : S / hz;
        flex = clamp((el / DEG + 12) / 45, 0.1, 1);
      }
    }
    // kx, ky: view arc per panorama radian across and up
    return { P: [d[0] * t, d[1] * t, d[2] * t], cls: c, i, x, y, az, el, vel, kx: w.kx * Math.cos(vel), ky: w.ky, flex };
  };

  /* ---------------- colour references ---------------- */
  const meanEl = (e0, e1, want) => {
    const m = [0, 0, 0]; let n = 0;
    for (let y = yOf(e1 * DEG); y <= yOf(e0 * DEG); y++) for (let x = 0; x < W; x += 2) {
      const i = y * W + x; if (want !== undefined && cls[i] !== want) continue;
      m[0] += b4[i * 3]; m[1] += b4[i * 3 + 1]; m[2] += b4[i * 3 + 2]; n++;
    }
    return n ? [m[0] / n, m[1] / n, m[2] / n] : [0.6, 0.65, 0.72];
  };
  const horizCol = meanEl(8, 30, CLS.SKY), zenCol = meanEl(70, 90), ground = meanEl(-90, -70), near = meanEl(-50, -25, CLS.WATER);

  /* ---------------- stroke emission ---------------- */
  const B = new Builder(360000);
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
  const layers = [
    { k: 3.4, a: 0.97, maj: [1.3, 2.2], min: [0.6, 0.85] },
    { k: 1.9, a: 0.97, maj: [1.2, 2.1], min: [0.5, 0.75] },
    { k: 1.0, a: 0.97, maj: [1.1, 2.0], min: [0.45, 0.7] },
    { k: 0.72, a: 0.96, maj: [1.0, 1.8], min: [0.42, 0.66], detail: true },
  ];
  // the picture's brushwork direction at a pixel, turned from panorama pixels (one azimuth step is cos el of arc
  // there) to the view
  const strokeAngle = (r) => {
    const i = r.i, c = r.cls, ce = Math.cos(r.el);
    if (c === CLS.WATER) return (rand() - 0.5) * 0.25;
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
  const counts = [0, 0, 0, 0, 0];
  const add = (r, d, sp, col, alpha, majR, minR, li) => {
    let maj = sp * lerp(majR[0], majR[1], rand()), mn = sp * lerp(minR[0], minR[1], rand());
    const c = r.cls, nearW = c === CLS.WATER ? smooth(-0.3, -0.7, d[1]) : 0;
    if (c === CLS.WATER) { maj *= 1.1 * lerp(1, 0.8, nearW); mn *= lerp(0.72, 1.05, nearW); }
    if (c === CLS.SKY) { maj *= li === 0 ? 1.55 : 1.35; mn *= 1.08; }
    // finer passes lie nearer, by more than the foliage sways (or the depth sort would shuffle them up close)
    const d0 = Math.hypot(r.P[0], r.P[1], r.P[2]), dm = 1 + (4 - li) * Math.max(0.014, 0.09 / d0);
    const Pw = [r.P[0] * dm, r.P[1] * dm, r.P[2] * dm];
    const dist = d0 * dm;
    const Rt = norm(cross(d, Math.abs(d[1]) > 0.999 ? [0, 0, 1] : up)), Ut = cross(Rt, d);
    const ang = strokeAngle(r), ca = Math.cos(ang) * maj * dist, sa = -Math.sin(ang) * maj * dist;
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
    B.add(Pw, cpos, axis, mn * dist, col, alpha, c, 0, r.flex, delay, inF ? 0 : 1, rand());
    counts[li]++;
  };
  const colAt = (img, i, j = 0.07) => {
    const m = 1 + (rand() - 0.5) * j;
    return [0, 1, 2].map((q) => clamp(img[i * 3 + q] * m + (rand() - 0.5) * 0.025, 0, 1));
  };

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

  layers.forEach((L, li) => {
    ring((psi) => alpha0 * L.k * gOf(psi), (d, sp) => {
      const r = resolve(d), i = r.i;
      if (L.detail) {
        if (r.cls === CLS.SKY) return;
        if (rand() > clamp(grad[i] * 9 - 0.12, 0, 0.85) * P.detail) return;
        const l4 = levels[1], dl = Math.abs(lum[i] - (0.3 * l4[i * 3] + 0.59 * l4[i * 3 + 1] + 0.11 * l4[i * 3 + 2]));
        if (dl > 0.2) return;
      }
      // the sky is carried by its broad passes; small strokes scattered over it read as crumbs
      if (r.cls === CLS.SKY && li >= 1 && rand() < (li === 1 ? 0.3 : 0.8)) return;
      add(r, d, sp, colAt(levels[li], i), L.a, L.maj, L.min, li);
    });
  });

  // broken colour: small touches over everything, each nudged warm or cool and a little more saturated than
  // the picture beneath, thinning out behind the viewer
  const DB = P.dabs;
  ring((psi) => alpha0 * DB.k * gOf(psi), (d, sp, psi) => {
    if (rand() > DB.p * lerp(1, DB.back, smooth(DB.fade[0], DB.fade[1], psi))) return;
    const r = resolve(d);
    if (r.cls === CLS.SKY && rand() > DB.sky) return;
    const jr = Math.max(1, Math.round(sp * W / (2 * Math.PI) * DB.jitter));
    const x = (r.x + Math.round((rand() - 0.5) * 2 * jr) + W) % W, y = clamp(r.y + Math.round((rand() - 0.5) * 2 * jr), 0, H - 1);
    const j = cls[y * W + x] === r.cls ? y * W + x : r.i;
    const col = [b1[j * 3], b1[j * 3 + 1], b1[j * 3 + 2]];
    const lm = 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2], tint = (rand() - 0.5) * 2 * DB.tint;
    const tc = tint > 0 ? [1, 0.45, -0.7] : [-0.6, -0.1, 1];
    for (let q = 0; q < 3; q++) col[q] = clamp(lm + (col[q] - lm) * DB.sat + tc[q] * Math.abs(tint), 0, 1);
    add(r, d, sp, col, 0.95, [1.0, 1.7], [0.55, 0.85], 4);
  });

  // sparkle on the pond and drifting motes
  for (let k = 0; k < Q.glints * 0.6; k++) {
    const th = rand() * Math.PI * 2, rr = 2.5 + Math.pow(rand(), 1.4) * 30;
    const x = rr * Math.sin(th), z = -rr * Math.cos(th);
    const d = norm([x, -h, z]);
    if (resolve(d).cls !== CLS.WATER) continue;
    const s = 0.016 * Math.pow(rr, 0.8);
    B.add([x, -h + 0.02, z], [x, -h + 0.02, z], [Math.cos(th) * s * 2.5, 0, Math.sin(th) * s * 2.5], s * 0.6, [1, 0.97, 0.86], 0.9, CLS.GLINT, 0, 1, extDelay([x, -h, z]), 1, rand());
  }
  for (let k = 0; k < Q.motes * 0.45; k++) {
    const x = (rand() - 0.5) * 30, y = -h + 0.25 + Math.pow(rand(), 1.5) * 3.2, z = (rand() - 0.5) * 30;
    const s = 0.016 + rand() * 0.022;
    B.add([x, y, z], [x, y, z], [s, 0, 0], s * 0.85, [1, 0.84, 0.55], 0.55, CLS.MOTE, 0, 0, extDelay([x, y, z]), 1, rand());
  }
  console.log(`[monet] pano layers ${counts.join('/')} total ${B.n} in ${Math.round(performance.now() - t0)}ms`);

  return {
    count: B.n, A: B.A.subarray(0, B.n * 4), B: B.B.subarray(0, B.n * 4), C: B.C.subarray(0, B.n * 4),
    D: B.D.subarray(0, B.n * 4), E: B.E.subarray(0, B.n * 4),
    hotspots: [], front, bg: { horizon: horizCol, zenith: lerp3(zenCol, horizCol, 0.2), ground, near },
    paint: { f, vH, asp, xL: -0.5 / f, yT: (vH * asp) / f, yB: (-(1 - vH) * asp) / f },
    unified: true, h,
  };
}
