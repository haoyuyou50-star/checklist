import * as THREE from 'three';
import { sortSplats } from './sort.js';

const TEX_W = 2048;

const vert = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D tA, tB, tC, tD, tE;
uniform vec2 uViewport;
uniform float uTime, uMorph, uReveal, uWind, uFlash, uFocusDim, uFocusId, uGustFront, uGustAmp, uOpacity, uH;
uniform vec2 uWindDir;
uniform vec3 uFront;
uniform float uHot[8];
uniform float uGrade, uGamma, uExpo, uSat, uLift, uContrast;
uniform vec3 uWB;

in float aIndex;
out vec4 vColor;
out vec2 vUv;
out float vSeed;
out float vEmit;
out float vBr;
out float vPx;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
vec3 grade(vec3 c) {
  vec3 g = pow(max(c, vec3(0.0)), vec3(uGamma)) * uExpo * uWB;
  float l = dot(g, vec3(0.299, 0.587, 0.114));
  g = max(mix(vec3(l), g, uSat), vec3(0.0));
  g = mix(g, (1.0 - exp(-g * 1.8)) / (1.0 - exp(-1.8)), uLift);
  g = (g - 0.5) * uContrast + 0.5;
  return mix(c, clamp(g, 0.0, 1.0), uGrade);
}
vec3 rotAround(vec3 v, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

float windField(vec3 p) {
  vec2 q = p.xz;
  float along = dot(q, uWindDir);
  float n = vnoise(q * 0.045 + uWindDir * uTime * 0.25);
  float w = 0.5 + 0.5 * sin(along * 0.3 - uTime * 2.6 + n * 4.0);
  w = w * w;
  float g = smoothstep(0.15, 0.85, vnoise(q * 0.011 - uWindDir * uTime * 0.07));
  float front = along - uGustFront;
  float gust = exp(-front * front / 300.0) * uGustAmp;
  return w * (0.35 + 0.95 * g) * uWind + gust * (0.55 + 0.6 * w);
}

void main() {
  int i = int(aIndex + 0.5);
  ivec2 tc = ivec2(i % ${TEX_W}, i / ${TEX_W});
  vec4 A = texelFetch(tA, tc, 0);
  vec4 B = texelFetch(tB, tc, 0);
  vec4 C = texelFetch(tC, tc, 0);
  vec4 D = texelFetch(tD, tc, 0);
  vec4 E = texelFetch(tE, tc, 0);

  vec3 world = A.xyz; float seed = A.w;
  vec3 canv = B.xyz; int cls = int(B.w + 0.5);
  vec3 axis = C.xyz; float minor = C.w;
  vec3 col = grade(D.rgb); float alpha = D.a * uOpacity;
  float hot = E.x, flex = E.y, delay = E.z, ext = E.w;

  vec3 wd3 = normalize(vec3(uWindDir.x, 0.0, uWindDir.y));
  vec3 pos = world;
  float sizeMul = 1.0;
  float emit = 0.0;

  if (ext < 0.5) {
    float m = clamp(uMorph * 1.6 - delay * 0.6, 0.0, 1.0);
    m = m * m * (3.0 - 2.0 * m);
    pos = mix(canv, world, m);
    float sc = length(pos) / max(length(world), 1e-4);
    axis *= sc; minor *= sc;
    float pulse = sin(m * 3.14159265) * uFlash;
    vec3 rnd = vec3(hash(vec2(seed, 1.3)) - 0.5, hash(vec2(seed, 7.1)) - 0.5, 0.0);
    pos += (rnd * 0.9 + vec3(wd3.x * 0.6, 0.25, 0.0)) * pulse * 0.03 * length(pos);
    sizeMul *= 1.0 + pulse * 0.65;
    axis = rotAround(axis, normalize(-pos), pulse * (seed - 0.5) * 2.4);
    col += vec3(1.0, 0.8, 0.5) * pulse * 0.32;
  } else {
    float r = clamp((uReveal * 1.5 - delay) / 0.5, 0.0, 1.0);
    float re = r * r * (3.0 - 2.0 * r);
    vec3 start = normalize(mix(normalize(world), uFront, 0.42) + 1e-4) * length(world) * 0.9;
    pos = mix(start, world, re);
    alpha *= re;
    sizeMul *= mix(0.2, 1.0, re);
    col += vec3(1.0, 0.82, 0.52) * sin(r * 3.14159265) * 0.34;
  }

  float dist = length(pos);
  float w = windField(pos);

  if (cls == 1 || cls == 2) {               // grass / flowers
    float b = w * flex;
    pos += wd3 * b * (0.15 + 0.02 * dist);
    pos.y -= b * 0.005 * dist;
    float al = length(axis);
    vec3 ad = axis / max(al, 1e-5);
    vec3 bent = normalize(wd3 + vec3(0.0, 0.3, 0.0));
    axis = normalize(mix(ad, bent * sign(dot(ad, bent) + 0.3), clamp(b * 0.55, 0.0, 0.7))) * al * (1.0 + b * 0.55);
    col = mix(col, col * 1.22 + vec3(0.11, 0.11, 0.085), clamp(b, 0.0, 1.0) * 0.75);
  } else if (cls == 3) {                     // foliage
    float sway = sin(uTime * 1.25 + pos.x * 0.07 + pos.z * 0.05) * 0.5 + 0.5;
    float b = flex * (0.25 * sway + w * 0.8);
    pos += wd3 * b * (0.05 + 0.007 * dist);
    float flut = sin(uTime * (6.0 + seed * 5.0) + seed * 40.0) * min(w + 0.1, 1.3);
    axis = rotAround(axis, normalize(-pos), flut * 0.35);
    col += vec3(0.06, 0.065, 0.03) * max(flut, 0.0) * (0.3 + flex);
  } else if (cls == 0) {                     // clouds breathing
    vec3 dn = normalize(pos);
    vec3 tang = normalize(cross(vec3(0.0, 1.0, 0.0), dn) + 1e-4);
    pos += tang * sin(uTime * 0.11 + seed * 6.283) * dist * 0.006 + vec3(0.0, 1.0, 0.0) * cos(uTime * 0.08 + seed * 4.0) * dist * 0.002;
    axis = rotAround(axis, -dn, sin(uTime * 0.09 + seed * 9.0) * 0.15);
  } else if (cls == 6) {                     // water
    float ph = uTime * 1.3 + pos.x * 0.35 + pos.z * 0.6 + seed * 6.283;
    pos.y += sin(ph) * 0.015 * (1.0 + dist * 0.02);
    vec3 tang = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(pos)) + 1e-4);
    pos += tang * sin(uTime * 0.8 + pos.z * 0.25 + seed * 3.0) * 0.01 * dist * (0.5 + w);
    axis *= 1.0 + (0.22 + 0.35 * w) * (0.5 + 0.5 * sin(uTime * 0.7 + pos.z * 0.35 + seed * 5.0));
    col *= 1.0 + 0.1 * sin(uTime * 2.3 + seed * 30.0) * (0.4 + w);
  } else if (cls == 7) {                     // sails
    float b = flex * (0.25 + 0.55 * w);
    pos += wd3 * b * (0.25 + 0.006 * dist);
    pos.y += sin(uTime * 0.9 + world.x * 0.08) * 0.06;
  } else if (cls == 5) {                     // figures
    pos += wd3 * flex * w * 0.03;
  } else if (cls == 8) {                     // petals riding the gusts
    float life = fract(uTime * (0.06 + seed * 0.05) + seed * 13.0);
    float strength = clamp(w * 1.15 + uGustAmp * 0.7, 0.0, 1.0);
    pos += wd3 * life * (6.0 + seed * 11.0)
         + vec3(0.0, 1.0, 0.0) * sin(life * 3.14159) * (0.8 + seed * 2.4)
         + vec3(sin(life * 9.0 + seed * 20.0), 0.0, cos(life * 7.0 + seed * 11.0)) * 0.7 * life;
    alpha *= smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.62, 1.0, life)) * smoothstep(0.12, 0.55, strength);
    axis = rotAround(axis, normalize(vec3(seed, 1.0 - seed, 0.5)), uTime * (3.0 + seed * 4.0));
    alpha *= smoothstep(2.0, 6.0, length(pos - cameraPosition));
  } else if (cls == 9) {                     // motes of light
    vec3 drift = wd3 * uTime * (0.45 + seed * 0.6) * (0.4 + uWind)
               + vec3(sin(uTime * 0.31 + seed * 17.0), sin(uTime * 0.23 + seed * 29.0) * 0.4, cos(uTime * 0.27 + seed * 11.0)) * 1.5;
    vec3 box = vec3(36.0, 6.0, 36.0);
    vec3 rel = pos + drift - cameraPosition;
    rel.xz = mod(rel.xz + box.xz * 0.5, box.xz) - box.xz * 0.5;
    pos = vec3(cameraPosition.x + rel.x, pos.y + drift.y, cameraPosition.z + rel.z);
    vec2 e2 = abs(rel.xz) / (box.xz * 0.5);
    alpha *= (1.0 - smoothstep(0.7, 1.0, max(e2.x, e2.y))) * (0.45 + 0.55 * sin(uTime * 1.7 + seed * 30.0));
    emit = 1.0;
  } else if (cls == 11) {                    // glints on water
    float tw = pow(max(sin(uTime * (1.6 + seed * 2.0) + seed * 50.0), 0.0), 10.0);
    alpha *= tw * (0.4 + w);
    sizeMul *= 0.6 + tw;
    emit = 1.0;
  }

  if (hot > 0.5) {
    float g = uHot[int(hot + 0.5)];
    float pulse = 0.55 + 0.45 * sin(uTime * 2.4 - seed * 2.5);
    if (cls == 10) {
      alpha *= g * (0.035 + 0.05 * pulse);
      emit = 1.0;
    } else {
      col += vec3(1.0, 0.86, 0.6) * g * pulse * 0.1;
      emit = max(emit, g * pulse * 0.12);
    }
  }
  if (uFocusDim > 0.001 && abs(hot - uFocusId) > 0.5) {
    float l = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(col, vec3(l), 0.5 * uFocusDim) * (1.0 - 0.38 * uFocusDim);
  }

  vec4 vc = viewMatrix * vec4(pos, 1.0);
  if (vc.z > -0.06 || alpha < 0.003) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vec4 cc = projectionMatrix * vc;
  vec3 axV = (viewMatrix * vec4(axis * sizeMul, 0.0)).xyz;
  vec3 endV = vc.xyz + axV;
  if (endV.z > -0.02) endV = vc.xyz + axV * ((-0.02 - vc.z) / min(axV.z, -1e-4));
  vec4 ce = projectionMatrix * vec4(endV, 1.0);
  vec2 ndcC = cc.xy / cc.w;
  vec2 dPx = (ce.xy / ce.w - ndcC) * 0.5 * uViewport;
  float maj = length(dPx);
  float mn = minor * sizeMul * projectionMatrix[1][1] * 0.5 * uViewport.y / cc.w;
  if (ext > 0.5 && (cls == 6 || cls == 11)) {
    float graze = abs(pos.y - cameraPosition.y) / max(length(pos - cameraPosition), 1e-3);
    mn *= clamp(graze * 3.2 + 0.12, 0.16, 1.0);
  }
  vec2 dir = maj > 1e-4 ? dPx / maj : vec2(1.0, 0.0);
  maj = max(maj, mn);
  if (cls == 8) { maj = min(maj, 0.011 * uViewport.y); mn = min(mn, maj * 0.6); }
  float lim = 0.6 * uViewport.y;
  maj = min(maj, lim); mn = min(mn, lim);
  if (mn < 0.9) { alpha *= mn / 0.9; mn = 0.9; }
  maj = max(maj, 0.9);

  vec2 perp = vec2(-dir.y, dir.x);
  vec2 off = dir * position.x * maj + perp * position.y * mn;
  gl_Position = cc + vec4(off / (0.5 * uViewport) * cc.w, 0.0, 0.0);
  vUv = position.xy;
  vColor = vec4(col, alpha);
  vSeed = seed;
  vEmit = emit;
  vBr = 1.0 - smoothstep(8.0, 40.0, mn);
  vPx = mn;
}
`;

const frag = /* glsl */ `
precision highp float;
in vec4 vColor;
in vec2 vUv;
in float vSeed;
in float vEmit;
in float vBr;
in float vPx;
out vec4 fragColor;
void main() {
  float ang = atan(vUv.y, vUv.x);
  float r = length(vUv) * (1.0 + 0.07 * sin(ang * 3.0 + vSeed * 41.0) + 0.04 * sin(ang * 7.0 + vSeed * 13.0));
  if (r > 1.0) discard;
  // firm paint body with a short anti-aliased rim (about 1.2px wide on the minor axis)
  float rim = clamp(1.4 / max(vPx, 1.0), 0.12, 0.6);
  float body = 1.0 - smoothstep(1.0 - rim, 1.0, r);
  float a = vColor.a * mix(body, exp(-2.7 * r * r), vEmit);
  float streak = (sin(vUv.y * 9.0 + vSeed * 37.0) * 0.5 + 0.5) * vBr;
  if (a < 0.003) discard;
  vec3 c = vColor.rgb * (1.0 + 0.045 * (streak - 0.5 * vBr) + 0.035 * (1.0 - r));
  fragColor = vec4(c * a, a * (1.0 - vEmit));
}
`;

function dataTex(src, count) {
  const h = Math.ceil(count / TEX_W);
  const arr = new Float32Array(TEX_W * h * 4);
  arr.set(src);
  const t = new THREE.DataTexture(arr, TEX_W, h, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export const NO_GRADE = { gamma: 1, expo: 1, wb: [1, 1, 1], sat: 1, lift: 0, contrast: 1 };
export function gradeColor(c, g) {
  let v = c.map((x, k) => Math.pow(Math.max(x, 0), g.gamma) * g.expo * g.wb[k]);
  const l = 0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2];
  const n = 1 - Math.exp(-1.8);
  v = v.map((x) => Math.max(l + (x - l) * g.sat, 0)).map((x) => x + ((1 - Math.exp(-x * 1.8)) / n - x) * g.lift);
  return v.map((x) => Math.min(1, Math.max(0, (x - 0.5) * g.contrast + 0.5)));
}

let sortWorker = null;
let seqCounter = 0;

export class SplatCloud {
  constructor(id, data, { syncSort = false, grade = NO_GRADE } = {}) {
    this.id = id;
    this.data = data;
    this.syncSort = syncSort;
    const n = data.count;

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 2, 0, -1.7321, -1, 0, 1.7321, -1, 0]), 3));
    const order = new Float32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    this.orderAttr = new THREE.InstancedBufferAttribute(order, 1);
    this.orderAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aIndex', this.orderAttr);
    geo.instanceCount = n;

    this.uniforms = {
      tA: { value: dataTex(data.A, n) }, tB: { value: dataTex(data.B, n) }, tC: { value: dataTex(data.C, n) },
      tD: { value: dataTex(data.D, n) }, tE: { value: dataTex(data.E, n) },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 }, uMorph: { value: 0 }, uReveal: { value: 0 }, uWind: { value: 0 }, uFlash: { value: 1 },
      uFocusDim: { value: 0 }, uFocusId: { value: -1 }, uGustFront: { value: -999 }, uGustAmp: { value: 0 },
      uOpacity: { value: 1 }, uH: { value: 2 },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uFront: { value: new THREE.Vector3(...data.front) },
      uHot: { value: new Array(8).fill(0) },
      uGrade: { value: 0 }, uGamma: { value: grade.gamma }, uExpo: { value: grade.expo }, uSat: { value: grade.sat },
      uLift: { value: grade.lift }, uContrast: { value: grade.contrast }, uWB: { value: new THREE.Vector3(...grade.wb) },
    };
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms,
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;

    this.pending = false;
    this.lastKey = null;
    if (!syncSort) {
      if (!sortWorker) sortWorker = new Worker(new URL('./sortWorker.js', import.meta.url), { type: 'module' });
      sortWorker.postMessage({ type: 'init', id, count: n, A: data.A.slice(), B: data.B.slice(), C: data.C.slice(), E: data.E.slice() });
      sortWorker.addEventListener('message', (e) => {
        if (e.data.id !== this.id) return;
        this.orderAttr.array.set(e.data.order.subarray(0, e.data.n));
        this.orderAttr.clearUpdateRanges();
        this.orderAttr.addUpdateRange(0, e.data.n);
        this.orderAttr.needsUpdate = true;
        this.mesh.geometry.instanceCount = e.data.n;
        this.pending = false;
      });
    }
  }

  requestSort(camera, fr, morph, reveal) {
    const e = camera.matrixWorld.elements;
    const p = camera.position;
    const view = {
      cam: [p.x, p.y, p.z], right: [e[0], e[1], e[2]], up: [e[4], e[5], e[6]], fwd: [-e[8], -e[9], -e[10]],
      fr, margin: this.syncSort ? 0.06 : 0.3,
    };
    const key = [...view.cam, ...view.fwd, fr.l, fr.t, morph, reveal].map((v) => v.toFixed(3)).join(',');
    if (key === this.lastKey) return;
    if (this.syncSort) {
      const n = sortSplats(this.data, view, morph, reveal, this.orderAttr.array);
      this.orderAttr.clearUpdateRanges();
      this.orderAttr.addUpdateRange(0, n);
      this.orderAttr.needsUpdate = true;
      this.mesh.geometry.instanceCount = n;
      this.lastKey = key;
      return;
    }
    if (this.pending) return;
    this.pending = true;
    this.lastKey = key;
    sortWorker.postMessage({ type: 'sort', id: this.id, view, morph, reveal });
  }
}

const bgVert = /* glsl */ `
out vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const bgFrag = /* glsl */ `
precision highp float;
uniform vec3 uZenith, uHorizon, uGround, uNear;
uniform float uOpacity;
in vec3 vDir;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, y));
  vec3 gnd = mix(uGround, uNear, smoothstep(0.0, -0.5, y));
  vec3 c = y > 0.0 ? sky : mix(uHorizon, gnd, smoothstep(0.0, -0.04, y));
  c += (hash(gl_FragCoord.xy) - 0.5) * 0.02;
  fragColor = vec4(c * uOpacity, uOpacity);
}`;

export function makeBackdrop(bg, grade = NO_GRADE) {
  bg = Object.fromEntries(Object.entries(bg).map(([k, c]) => [k, gradeColor(c, grade)]));
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: bgVert, fragmentShader: bgFrag,
    uniforms: {
      uZenith: { value: new THREE.Color(...bg.zenith) }, uHorizon: { value: new THREE.Color(...bg.horizon) },
      uGround: { value: new THREE.Color(...bg.ground) }, uNear: { value: new THREE.Color(...bg.near) },
      uOpacity: { value: 0 },
    },
    side: THREE.BackSide, depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  return mesh;
}
