import * as THREE from 'three';
import { SCENES } from './scenes.js';
import { buildScene, loadImage, QUALITY, smooth } from './generator.js';
import { SplatCloud, makeBackdrop } from './splats.js';
import { WindAudio } from './audio.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
const DEMO = (params.has('demo') || CAPTURE) && !params.has('nodemo');
const qName = params.get('q') || (matchMedia('(pointer: coarse)').matches ? 'low' : 'mid');
const Q = QUALITY[qName] || QUALITY.high;

const $ = (s, r = document) => r.querySelector(s);
const el = {
  wall: $('#wall'), canvas: $('#gl'), gallery: $('#gallery'), hud: $('#hud'), card: $('#card'), loader: $('#loader'),
  top: $('.g-top'), artWrap: $('.art-wrap'), frame: $('.frame'), art: $('.art'), label: $('.label'), picker: $('.picker'),
  idx: $('.idx'), titleCn: $('.title-cn'), titleFr: $('.title-fr'), meta: $('.meta'), desc: $('.desc'), enter: $('.enter'),
  hIdx: $('.h-idx'), hCn: $('.h-cn'), hFr: $('.h-fr'), exit: $('.h-exit'), hint: $('.h-hint'),
  range: $('.w-range'), gustBtn: $('.w-gust'), sound: $('.w-sound'), markers: $('.markers'),
  cIdx: $('.c-idx'), cTitle: $('.c-title'), cSub: $('.c-sub'), cText: $('.c-text'), cBack: $('.c-back'),
  cursor: $('#cursor'), ldBar: $('.ld-bar i'),
};
const labelParts = [el.idx, el.titleCn, el.titleFr, $('.rule'), el.meta, el.desc, el.enter];

/* ---------------- clock & tweens ---------------- */
let clock = 0;
const tweens = [];
export const ease = {
  lin: (t) => t,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOut5: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  in: (t) => t * t * t,
  sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};
function tween(dur, fn, { delay = 0, e = ease.inOut } = {}) {
  return new Promise((res) => tweens.push({ t0: clock + delay, dur: Math.max(dur, 1e-4), fn, e, res }));
}
const wait = (s) => tween(s, () => {});
function runTweens() {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    if (!tw) continue;
    const k = (clock - tw.t0) / tw.dur;
    if (k < 0) continue;
    const kk = Math.min(1, k);
    tw.fn(tw.e(kk), kk);
    if (k >= 1) { tweens.splice(tweens.indexOf(tw), 1); tw.res(); }
  }
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const fade = (node, o, y = 0, x = 0, s = 1, blur = 0) => {
  node.style.opacity = o;
  node.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  node.style.filter = blur > 0.05 ? `blur(${blur}px)` : '';
};

/* ---------------- renderer ---------------- */
const renderer = new THREE.WebGLRenderer({
  canvas: el.canvas, antialias: false, alpha: true, premultipliedAlpha: true,
  preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance',
});
renderer.setClearColor(0x000000, 0);
const DPR = Math.min(window.devicePixelRatio || 1, CAPTURE ? 1 : qName === 'high' ? 1.5 : 1.25);
renderer.setPixelRatio(DPR);
const scene3 = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 5000);
camera.rotation.order = 'YXZ';
const audio = new WindAudio();

/* ---------------- state ---------------- */
const S = {
  idx: 0, mode: 'loading', grade: 0,
  morph: 0, reveal: 0, wind: 0, windTarget: 0.55, windOn: 0, flash: 1, fMix: 0,
  gustFront: -999, gustAmp: 0, focusDim: 0, focusId: -1,
  hotBase: 0, hot: new Array(8).fill(0), hoverId: 0, markers: 0,
  cam: { pos: new THREE.Vector3(), yaw: 0, pitch: 0, fov: 62 }, basePitch: 0,
  vel: { yaw: 0, pitch: 0 }, galleryFr: null, glVisible: false, hintShown: false, windLevel: 0,
};
const IMM_FOV = 62;
const built = SCENES.map(() => null);
const cur = () => built[S.idx];

/* ---------------- layout ---------------- */
function layoutGallery() {
  const sc = SCENES[S.idx];
  if (!sc.asp) return;
  const W = innerWidth, H = innerHeight;
  const maxW = W * 0.5, maxH = H * 0.62;
  let w = maxW, h = w * sc.asp;
  if (h > maxH) { h = maxH; w = h / sc.asp; }
  el.art.style.width = `${Math.round(w)}px`;
  el.art.style.height = `${Math.round(w * sc.asp)}px`;
}
function resize() {
  const W = innerWidth, H = innerHeight;
  renderer.setSize(W, H, false);
  layoutGallery();
  if (S.mode === 'gallery' && cur()) S.galleryFr = galleryFrustum(cur().data);
}
addEventListener('resize', resize);

function galleryFrustum(data) {
  const r = el.art.getBoundingClientRect();
  const p = data.paint, W = innerWidth, H = innerHeight;
  const ppt = r.width * p.f;
  const l = p.xL - r.left / ppt, t = p.yT + r.top / ppt;
  return { l, r: l + W / ppt, t, b: t - H / ppt };
}
function immersiveFrustum(fov) {
  const t = Math.tan((fov * Math.PI) / 360), a = innerWidth / innerHeight;
  return { l: -t * a, r: t * a, t, b: -t };
}
function applyCamera() {
  let fr = immersiveFrustum(S.cam.fov);
  if (S.fMix < 1 && S.galleryFr) {
    const g = S.galleryFr, k = S.fMix;
    fr = { l: lerp(g.l, fr.l, k), r: lerp(g.r, fr.r, k), t: lerp(g.t, fr.t, k), b: lerp(g.b, fr.b, k) };
  }
  S.fr = fr;
  const n = camera.near;
  camera.projectionMatrix.makePerspective(fr.l * n, fr.r * n, fr.t * n, fr.b * n, n, camera.far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  const breathe = S.fMix * 0.03;
  // parallax: the eye slides sideways so near cards move against far ones
  // only once the painting has opened up: the frame morph relies on the exact centre of projection
  const pa = (SCENES[S.idx].cam.parallax || 0) * smooth(0.82, 1, S.fMix) * (S.mode === 'focus' ? 0.45 : 1);
  const ox = look.x * pa, oy = look.y * pa * 0.3;
  camera.position.set(S.cam.pos.x + Math.cos(S.cam.yaw) * ox, S.cam.pos.y + oy + Math.sin(clock * 0.55) * breathe, S.cam.pos.z - Math.sin(S.cam.yaw) * ox);
  camera.rotation.set(S.cam.pitch + Math.sin(clock * 0.31) * 0.002 * S.fMix, S.cam.yaw + Math.sin(clock * 0.23) * 0.003 * S.fMix, 0);
  camera.updateMatrixWorld();
}

/* ---------------- gallery content ---------------- */
function setGalleryContent(i) {
  const sc = SCENES[i];
  el.art.src = sc.image;
  el.idx.innerHTML = `<b>${sc.info.index}</b><span>/ 0${SCENES.length}</span>`;
  el.titleCn.textContent = sc.info.titleCn;
  el.titleCn.classList.toggle('long', sc.info.titleCn.length > 5);
  el.titleFr.textContent = sc.info.titleFr;
  el.meta.innerHTML = sc.info.meta;
  el.desc.textContent = sc.info.desc;
  el.hIdx.textContent = sc.info.index;
  el.hCn.textContent = sc.info.titleCn;
  el.hFr.textContent = sc.info.titleFr;
  [...el.picker.children].forEach((p, k) => p.classList.toggle('on', k === i));
  el.enter.classList.toggle('is-busy', !built[i]);
  layoutGallery();
}
function buildPicker() {
  el.picker.innerHTML = SCENES.map((sc, i) => `<div class="pick" data-i="${i}"><img src="${sc.image}" alt="" /><span>${sc.info.index} · ${sc.info.thumbLabel}<i>${sc.info.titleFr.split(',')[0]}</i></span></div>`).join('');
  [...el.picker.children].forEach((p) => p.addEventListener('click', () => selectPainting(+p.dataset.i)));
}

function galleryIn(delay = 0, full = true) {
  const parts = full ? [el.top, el.artWrap, ...labelParts, el.picker] : [...labelParts];
  parts.forEach((n) => fade(n, 0, 18));
  if (full) fade(el.artWrap, 0, 0, 0, 0.985);
  return Promise.all(parts.map((n, k) => tween(1.3, (e) => (n === el.artWrap ? fade(n, e, 0, 0, lerp(0.985, 1, e)) : fade(n, e, 18 * (1 - e))), { delay: delay + k * 0.09, e: ease.out })));
}

async function selectPainting(i) {
  if (S.mode !== 'gallery' || i === S.idx) return;
  S.mode = 'switching';
  await Promise.all([
    tween(0.55, (e) => labelParts.forEach((n) => fade(n, 1 - e, -10 * e)), { e: ease.in }),
    tween(0.6, (e) => fade(el.artWrap, 1 - e, 0, 0, lerp(1, 0.985, e)), { e: ease.in }),
  ]);
  S.idx = i;
  setGalleryContent(i);
  await el.art.decode().catch(() => {});
  if (!built[i]) {
    await new Promise((r) => setTimeout(r, 30));
    buildOne(i);
    el.enter.classList.remove('is-busy');
  }
  tween(0.9, (e) => fade(el.artWrap, e, 0, 0, lerp(0.985, 1, e)), { e: ease.out });
  await Promise.all(labelParts.map((n, k) => tween(1.0, (e) => fade(n, e, 14 * (1 - e)), { delay: 0.15 + k * 0.07, e: ease.out })));
  S.mode = 'gallery';
}

/* ---------------- hotspot markers ---------------- */
let markerEls = [];
function buildMarkers() {
  el.markers.innerHTML = '';
  markerEls = cur().data.hotspots.map((hs) => {
    const m = document.createElement('div');
    m.className = 'mk';
    m.innerHTML = `<span class="mk-ring"></span><span class="mk-ring b"></span><span class="mk-dot"></span><span class="mk-line"></span><span class="mk-label"><b>${hs.cn}</b><i>${hs.en}</i></span>`;
    m.addEventListener('pointerenter', () => { S.hoverId = hs.id; });
    m.addEventListener('pointerleave', () => { if (S.hoverId === hs.id) S.hoverId = 0; });
    m.addEventListener('click', (ev) => { ev.stopPropagation(); focusHotspot(hs.id); });
    el.markers.appendChild(m);
    return { m, hs, x: -1e4, y: -1e4, vis: 0 };
  });
}
const tmpV = new THREE.Vector3();
function updateMarkers() {
  const W = innerWidth, H = innerHeight;
  markerEls.forEach((mk) => {
    tmpV.set(...mk.hs.center).project(camera);
    const behind = tmpV.z > 1 || tmpV.z < -1;
    mk.x = (tmpV.x * 0.5 + 0.5) * W; mk.y = (-tmpV.y * 0.5 + 0.5) * H;
    const on = !behind && mk.x > 30 && mk.x < W - 30 && mk.y > 30 && mk.y < H - 30;
    const target = on && S.mode !== 'focus' ? S.markers : 0;
    mk.vis += (target - mk.vis) * 0.18;
    mk.m.style.opacity = mk.vis.toFixed(3);
    mk.m.style.pointerEvents = mk.vis > 0.5 ? 'auto' : 'none';
    mk.m.style.transform = `translate(${mk.x.toFixed(1)}px, ${mk.y.toFixed(1)}px)`;
    mk.m.classList.toggle('is-hover', S.hoverId === mk.hs.id);
  });
}

/* ---------------- transitions ---------------- */
async function enter() {
  if (S.mode !== 'gallery' || !cur()) return;
  S.mode = 'entering';
  if (!CAPTURE) audio.start();
  const B = cur(), sc = SCENES[S.idx];
  built.forEach((b) => { if (b) { b.cloud.mesh.visible = b === B; b.backdrop.visible = b === B; } });
  buildMarkers();
  layoutGallery();
  S.galleryFr = galleryFrustum(B.data);
  const p = B.data.paint;
  S.basePitch = Math.atan((p.yT + p.yB) / 2);
  Object.assign(S, { fMix: 0, morph: 0, reveal: 0, flash: 1, windOn: 0, markers: 0, hotBase: 0, focusDim: 0, focusId: -1 });
  S.windTarget = sc.wind.base;
  el.range.value = Math.round(S.windTarget * 100);
  el.range.style.setProperty('--p', `${el.range.value}%`);
  S.cam.pos.set(0, 0, 0); S.cam.yaw = 0; S.cam.pitch = 0; S.cam.fov = IMM_FOV;
  S.glVisible = true;
  el.canvas.style.opacity = 1;
  const dolly = sc.cam.dolly;

  tween(0.9, (e) => { fade(el.top, 1 - e, -12 * e); fade(el.picker, 1 - e, 12 * e); });
  labelParts.forEach((n, k) => tween(0.8, (e) => fade(n, 1 - e, 0, 26 * e), { delay: k * 0.05, e: ease.in }));
  tween(1.0, (e) => { el.art.style.opacity = 1 - e; }, { delay: 0.4, e: ease.sine });
  tween(1.4, (e) => { el.frame.style.opacity = 1 - e; el.frame.style.transform = `scale(${1 + 0.05 * e})`; el.frame.style.filter = `blur(${e * 6}px)`; }, { delay: 1.0, e: ease.inOut });
  tween(1.0, (e) => { $('.art-floor').style.opacity = 1 - e; $('.spot').style.opacity = 1 - e; }, { delay: 1.0 });
  tween(3.9, (e) => { S.morph = e; }, { delay: 1.0, e: ease.inOut });
  tween(3.4, (e) => { S.grade = e; }, { delay: 1.1, e: ease.inOut });
  tween(4.8, (e) => { S.fMix = e; S.cam.pitch = S.basePitch * e; S.cam.pos.set(0, 0, -dolly * e); }, { delay: 1.35, e: ease.inOut });
  tween(4.4, (e) => { S.reveal = e; }, { delay: 1.6, e: ease.inOut });
  tween(2.0, (e) => { el.wall.style.opacity = 1 - e; }, { delay: 1.7 });
  tween(3.2, (e) => { S.windOn = e; }, { delay: 4.4, e: ease.inOut });
  tween(1.4, (e) => { el.hud.style.opacity = e; }, { delay: 5.8, e: ease.out });
  tween(1.6, (e) => { S.markers = e; S.hotBase = 0.38 * e; }, { delay: 6.3, e: ease.out });
  await wait(6.4);
  el.gallery.style.visibility = 'hidden';
  S.mode = 'immersive';
  el.hud.classList.add('on');
  if (!S.hintShown) {
    S.hintShown = true;
    el.hint.style.opacity = 0;
    tween(1.2, (e) => { el.hint.style.opacity = e; }, { e: ease.out });
    tween(1.5, (e) => { el.hint.style.opacity = 1 - e; }, { delay: 7 });
  } else el.hint.style.opacity = 0;
}

function nearestYaw(y) { return y - Math.round(y / (Math.PI * 2)) * Math.PI * 2; }

async function exit() {
  if (S.mode !== 'immersive') return;
  S.mode = 'exiting';
  el.hud.classList.remove('on');
  const B = cur(), sc = SCENES[S.idx], dolly = sc.cam.dolly;
  S.cam.yaw = nearestYaw(S.cam.yaw);
  S.vel.yaw = S.vel.pitch = 0;
  const from = { pos: S.cam.pos.clone(), yaw: S.cam.yaw, pitch: S.cam.pitch, fov: S.cam.fov };
  const homePos = new THREE.Vector3(0, 0, -dolly);
  tween(0.7, (e) => { el.hud.style.opacity = 1 - e; S.markers = 1 - e; S.hotBase = 0.38 * (1 - e); });
  tween(1.6, (e) => { S.windOn = 1 - e; });
  await tween(1.5, (e) => {
    S.cam.pos.lerpVectors(from.pos, homePos, e);
    S.cam.yaw = lerp(from.yaw, 0, e); S.cam.pitch = lerp(from.pitch, S.basePitch, e); S.cam.fov = lerp(from.fov, IMM_FOV, e);
  });
  el.gallery.style.visibility = 'visible';
  [el.top, el.picker, ...labelParts].forEach((n) => fade(n, 0));
  S.galleryFr = galleryFrustum(B.data);
  S.flash = 0.7;
  tween(3.3, (e) => { S.reveal = 1 - e; }, { e: ease.inOut });
  tween(3.7, (e) => { S.fMix = 1 - e; S.cam.pitch = S.basePitch * (1 - e); S.cam.pos.set(0, 0, -dolly * (1 - e)); }, { delay: 0.25, e: ease.inOut });
  tween(3.2, (e) => { S.morph = 1 - e; }, { delay: 0.55, e: ease.inOut });
  tween(3.0, (e) => { S.grade = 1 - e; }, { delay: 0.6, e: ease.inOut });
  tween(1.6, (e) => { el.wall.style.opacity = e; }, { delay: 1.5 });
  tween(1.1, (e) => { el.frame.style.opacity = e; el.frame.style.transform = `scale(${1.05 - 0.05 * e})`; el.frame.style.filter = `blur(${(1 - e) * 6}px)`; $('.art-floor').style.opacity = e; $('.spot').style.opacity = e; }, { delay: 2.7, e: ease.out });
  tween(0.9, (e) => { el.art.style.opacity = e; }, { delay: 3.55, e: ease.sine });
  await wait(3.9);
  galleryIn(0.1, false);
  tween(1.0, (e) => { fade(el.top, e, -12 * (1 - e)); fade(el.picker, e, 12 * (1 - e)); }, { delay: 0.2, e: ease.out });
  await wait(0.6);
  S.glVisible = false;
  el.canvas.style.opacity = 0;
  S.mode = 'gallery';
}

/* ---------------- focus on a hotspot ---------------- */
let saved = null;
async function focusHotspot(id) {
  if (S.mode !== 'immersive') return;
  const hs = cur().data.hotspots.find((h) => h.id === id);
  if (!hs) return;
  S.mode = 'focus';
  S.vel.yaw = S.vel.pitch = 0;
  saved = { pos: S.cam.pos.clone(), yaw: S.cam.yaw, pitch: S.cam.pitch, fov: S.cam.fov };
  const c = new THREE.Vector3(...hs.center);
  const toC = c.clone().sub(S.cam.pos);
  const dist = toC.length();
  const tPos = S.cam.pos.clone().add(toC.normalize().multiplyScalar(Math.min(dist * 0.12, 3)));
  const d = c.clone().sub(tPos);
  const fov = clamp(IMM_FOV / (hs.zoom || 2), 22, 46);
  const offset = Math.atan(Math.tan((fov * Math.PI) / 360) * (innerWidth / innerHeight) * 0.3);
  let tYaw = Math.atan2(-d.x, -d.z) - offset;
  tYaw = S.cam.yaw + nearestYaw(tYaw - S.cam.yaw);
  const tPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  const from = { ...saved };
  S.focusId = id;

  const sc = SCENES[S.idx];
  el.cIdx.textContent = `${sc.info.index} — ${String(hs.id).padStart(2, '0')}`;
  el.cTitle.textContent = hs.cn;
  el.cSub.textContent = hs.en;
  el.cText.textContent = hs.text;

  tween(1.9, (e) => {
    S.cam.pos.lerpVectors(from.pos, tPos, e);
    S.cam.yaw = lerp(from.yaw, tYaw, e); S.cam.pitch = lerp(from.pitch, tPitch, e); S.cam.fov = lerp(from.fov, fov, e);
  }, { e: ease.inOut5 });
  tween(1.4, (e) => { S.focusDim = 0.85 * e; }, { delay: 0.2 });
  el.card.classList.add('on');
  [el.cIdx, el.cTitle, el.cSub, $('.c-rule'), el.cText, el.cBack].forEach((n, k) => {
    fade(n, 0, 12);
    tween(0.9, (e) => fade(n, e, 12 * (1 - e)), { delay: 1.0 + k * 0.08, e: ease.out });
  });
  await tween(1.0, (e) => { el.card.style.opacity = e; el.card.style.transform = `translateY(-50%) translateX(${30 * (1 - e)}px)`; }, { delay: 0.8, e: ease.out });
}

async function unfocus() {
  if (S.mode !== 'focus' || !saved) return;
  S.mode = 'unfocus';
  const from = { pos: S.cam.pos.clone(), yaw: S.cam.yaw, pitch: S.cam.pitch, fov: S.cam.fov };
  tween(0.6, (e) => { el.card.style.opacity = 1 - e; el.card.style.transform = `translateY(-50%) translateX(${20 * e}px)`; }, { e: ease.in });
  const fd = S.focusDim;
  tween(1.2, (e) => { S.focusDim = fd * (1 - e); });
  await tween(1.6, (e) => {
    S.cam.pos.lerpVectors(from.pos, saved.pos, e);
    S.cam.yaw = lerp(from.yaw, saved.yaw, e); S.cam.pitch = lerp(from.pitch, saved.pitch, e); S.cam.fov = lerp(from.fov, saved.fov, e);
  }, { e: ease.inOut5 });
  el.card.classList.remove('on');
  S.focusId = -1;
  S.mode = 'immersive';
}

/* ---------------- wind ---------------- */
function gust() {
  if (S.mode !== 'immersive' && S.mode !== 'focus') return;
  const wd = SCENES[S.idx].wind.dir, l = Math.hypot(wd[0], wd[1]);
  const base = (S.cam.pos.x * wd[0] + S.cam.pos.z * wd[1]) / l;
  return tween(6.0, (e, k) => { S.gustFront = base + lerp(-60, 80, k); S.gustAmp = Math.sin(k * Math.PI) ** 0.7 * 1.3; }, { e: ease.lin });
}
function setWind(v) {
  S.windTarget = v;
  el.range.value = Math.round(v * 100);
  el.range.style.setProperty('--p', `${el.range.value}%`);
}
el.range.addEventListener('input', () => setWind(el.range.value / 100));
el.gustBtn.addEventListener('click', gust);
el.sound.addEventListener('click', () => { audio.start(); el.sound.classList.toggle('on', audio.toggle()); });
el.sound.classList.add('on');

/* ---------------- look controls ---------------- */
let drag = null;
const look = { x: 0, y: 0, px: 0, py: 0, t: -99 };
addEventListener('pointermove', (e) => {
  look.px = (e.clientX / innerWidth - 0.5) * 2; look.py = -(e.clientY / innerHeight - 0.5) * 2; look.t = clock;
});
function updateLook(dt) {
  if (look.force) { [look.x, look.y] = look.force; return; }
  let tx = Math.sin(clock * 0.13) * 0.55 + Math.sin(clock * 0.071 + 1.3) * 0.3;
  let ty = Math.sin(clock * 0.11 + 2.1) * 0.5;
  const pointer = cursor.on ? [(cursor.x / innerWidth - 0.5) * 2, -(cursor.y / innerHeight - 0.5) * 2] : clock - look.t < 6 ? [look.px, look.py] : null;
  if (pointer) { tx = tx * 0.25 + pointer[0] * 0.85; ty = ty * 0.25 + pointer[1] * 0.85; }
  const k = Math.min(1, dt * 1.6);
  look.x += (clamp(tx, -1, 1) - look.x) * k; look.y += (clamp(ty, -1, 1) - look.y) * k;
}
el.canvas.addEventListener('pointerdown', (e) => {
  if (S.mode !== 'immersive') return;
  drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() };
  el.canvas.setPointerCapture(e.pointerId);
});
el.canvas.addEventListener('pointermove', (e) => {
  if (!drag || S.mode !== 'immersive') return;
  const k = 0.0032 * (S.cam.fov / IMM_FOV);
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  S.cam.yaw += dx * k; S.cam.pitch = clamp(S.cam.pitch + dy * k, -0.9, 0.95);
  S.vel.yaw = dx * k; S.vel.pitch = dy * k;
  drag.x = e.clientX; drag.y = e.clientY;
});
el.canvas.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
  drag = null;
  if (moved < 6 && S.mode === 'immersive') {
    let best = null, bd = 110;
    markerEls.forEach((mk) => { const d = Math.hypot(mk.x - e.clientX, mk.y - e.clientY); if (mk.vis > 0.5 && d < bd) { bd = d; best = mk; } });
    S.vel.yaw = S.vel.pitch = 0;
    if (best) focusHotspot(best.hs.id);
  }
});
el.canvas.addEventListener('wheel', (e) => {
  if (S.mode !== 'immersive') return;
  S.cam.fov = clamp(S.cam.fov + e.deltaY * 0.02, 36, 76);
}, { passive: true });
el.enter.addEventListener('click', enter);
el.exit.addEventListener('click', exit);
el.cBack.addEventListener('click', unfocus);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (S.mode === 'focus') unfocus(); else if (S.mode === 'immersive') exit(); }
});

/* ---------------- frame loop ---------------- */
const vp = new THREE.Vector2();
function step(dt, draw = true) {
  clock += dt;
  runTweens();

  if (S.mode === 'immersive' && !drag) {
    const damp = Math.pow(0.9, dt * 60);
    S.cam.yaw += S.vel.yaw * damp; S.cam.pitch = clamp(S.cam.pitch + S.vel.pitch * damp, -0.9, 0.95);
    S.vel.yaw *= damp; S.vel.pitch *= damp;
  }
  updateLook(dt);
  S.wind += (S.windTarget * S.windOn - S.wind) * Math.min(1, dt * 1.8);
  const B = cur();
  if (B) {
    B.data.hotspots.forEach((hs) => {
      const t = S.focusId === hs.id ? 0.16 : S.hotBase + (S.hoverId === hs.id ? 0.45 : 0);
      S.hot[hs.id] += (t - S.hot[hs.id]) * Math.min(1, dt * 5);
    });
  }
  applyCamera();

  if (S.glVisible && B && draw) {
    const U = B.cloud.uniforms, sc = SCENES[S.idx];
    renderer.getDrawingBufferSize(vp);
    U.uViewport.value.copy(vp);
    U.uTime.value = clock;
    U.uEye0.value.copy(S.cam.pos);
    U.uMorph.value = S.morph; U.uReveal.value = S.reveal; U.uWind.value = S.wind; U.uFlash.value = S.flash;
    U.uGrade.value = S.grade;
    const fh = S.focusId > 0 && B.data.hotspots.find((h) => h.id === S.focusId);
    if (fh) { U.uFocusPos.value.set(...fh.center); U.uFocusR.value = fh.radius; }
    U.uFocusDim.value = S.focusDim; U.uFocusId.value = S.focusId;
    U.uGustFront.value = S.gustFront; U.uGustAmp.value = S.gustAmp;
    U.uWindDir.value.set(...sc.wind.dir).normalize();
    for (let i = 0; i < 8; i++) U.uHot.value[i] = S.hot[i];
    B.backdrop.material.uniforms.uOpacity.value = clamp((S.reveal - 0.05) / 0.6, 0, 1);
    B.backdrop.position.copy(camera.position);
    B.cloud.requestSort(camera, S.fr, S.morph, S.reveal);
    renderer.render(scene3, camera);
  }
  if (markerEls.length) updateMarkers();
  S.windLevel = clamp(S.wind * (0.7 + 0.3 * Math.sin(clock * 0.6)) + S.gustAmp * 0.6, 0, 1.4) * S.windOn;
  audio.update(S.windLevel);
  cursorTick();
}

/* ---------------- demo cursor ---------------- */
const cursor = { x: innerWidth * 0.6, y: innerHeight * 0.8, on: false, node: $('#cursor i') };
function cursorTick() {
  if (!cursor.on) return;
  cursor.node.style.transform = `translate(${cursor.x.toFixed(1)}px, ${cursor.y.toFixed(1)}px)`;
}
const app = {
  S, el, built, ease, tween, wait, enter, exit, focusHotspot, unfocus, gust, setWind, selectPainting,
  cursor: {
    show(x, y) { cursor.x = x; cursor.y = y; cursor.on = true; el.cursor.classList.add('on'); cursor.node.style.opacity = 0; return tween(0.6, (e) => { cursor.node.style.opacity = e; }); },
    hide() { return tween(0.5, (e) => { cursor.node.style.opacity = 1 - e; }); },
    moveTo(x, y, dur = 1.2) { const fx = cursor.x, fy = cursor.y; return tween(dur, (e) => { cursor.x = lerp(fx, x, e); cursor.y = lerp(fy, y, e); }, { e: ease.inOut }); },
    pos: () => [cursor.x, cursor.y],
    async click() {
      const r = document.createElement('div');
      r.className = 'click-ripple';
      r.style.left = `${cursor.x}px`; r.style.top = `${cursor.y}px`;
      document.body.appendChild(r);
      tween(0.15, (e) => { cursor.node.style.scale = `${1 - 0.25 * e}`; }).then(() => tween(0.25, (e) => { cursor.node.style.scale = `${0.75 + 0.25 * e}`; }));
      await tween(0.7, (e) => { r.style.transform = `scale(${1 + 1.8 * e})`; r.style.opacity = 1 - e; }, { e: ease.out });
      r.remove();
    },
  },
  markerPos(id) { const mk = markerEls.find((m) => m.hs.id === id); return mk ? [mk.x, mk.y] : [innerWidth / 2, innerHeight / 2]; },
  look(dYaw, dPitch, dur) {
    const y0 = S.cam.yaw, p0 = S.cam.pitch, [cx, cy] = [cursor.x, cursor.y];
    const k = 0.0032 * (S.cam.fov / IMM_FOV);
    return tween(dur, (e) => {
      S.cam.yaw = y0 + dYaw * e; S.cam.pitch = p0 + dPitch * e;
      if (cursor.on) { cursor.x = cx + (dYaw / k) * e * 0.35; cursor.y = cy + (dPitch / k) * e * 0.35; }
    }, { e: ease.sine });
  },
};
app.eye = look;
window.app = app;

/* ---------------- boot ---------------- */
let imgs = [];
function buildOne(i) {
  const data = buildScene(SCENES[i], imgs[i], Q);
  const cloud = new SplatCloud(SCENES[i].id, data, { syncSort: CAPTURE, grade: SCENES[i].grade });
  const backdrop = makeBackdrop(data.bg, SCENES[i].grade);
  cloud.mesh.visible = false; backdrop.visible = false;
  scene3.add(backdrop, cloud.mesh);
  built[i] = { data, cloud, backdrop };
  console.log(`[monet] ${SCENES[i].id}: ${data.count.toLocaleString()} splats`);
}

async function boot() {
  if (location.protocol === 'file:') {
    $('.ld-txt').innerHTML = '请通过本地服务器打开：双击 start.bat（Windows）或 start.command（macOS）<br>或在本目录运行 python3 -m http.server 8123 后访问 http://localhost:8123';
    $('.ld-txt').style.cssText = 'text-align:center;line-height:2.2;letter-spacing:.15em';
    return;
  }
  buildPicker();
  imgs = await Promise.all(SCENES.map((sc) => loadImage(sc.image)));
  imgs.forEach((img, i) => { SCENES[i].asp = img.naturalHeight / img.naturalWidth; });
  setGalleryContent(0);
  resize();
  el.ldBar.style.width = '30%';
  await new Promise((r) => setTimeout(r, 30));

  buildOne(0);
  el.ldBar.style.width = '70%';
  await new Promise((r) => setTimeout(r, 30));
  if (CAPTURE) buildOne(1);
  el.ldBar.style.width = '100%';
  built.forEach((b) => { if (b) { b.cloud.mesh.visible = true; b.backdrop.visible = true; } });
  applyCamera();
  renderer.compile(scene3, camera);
  built.forEach((b, i) => { if (b) { b.cloud.mesh.visible = i === 0; b.backdrop.visible = i === 0; } });
  setGalleryContent(S.idx);

  [el.top, el.artWrap, el.picker, ...labelParts].forEach((n) => fade(n, 0));
  el.hud.style.opacity = 0;
  el.loader.classList.add('done');
  if (CAPTURE) el.loader.style.display = 'none';
  S.mode = 'gallery';
  galleryIn(0.25);

  if (DEMO) {
    const { runDemo } = await import('./demo.js');
    runDemo(app).then(() => { window.__demoDone = true; });
  }
  window.__ready = true;
}

if (CAPTURE) {
  window.__step = (dt, draw = true) => step(dt, draw);
} else {
  let last = performance.now();
  const frame = (now) => {
    step(Math.min(0.05, (now - last) / 1000));
    last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
boot();
