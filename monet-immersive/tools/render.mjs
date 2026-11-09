// One-command demo video renderer: serves the project, plays the scripted demo frame by frame
// in Chrome, encodes with ffmpeg and adds a synthesized wind soundtrack.
//
//   node tools/render.mjs                         1920x1080 · 30fps · high  ->  monet_demo.mp4
//   node tools/render.mjs --preview               1280x720 · 24fps · mid   (quick check)
//   node tools/render.mjs --out a.mp4 --size 2560x1440 --fps 60 --q high
//   node tools/render.mjs --headless              no browser window (software rendering, much slower)
//   node tools/render.mjs --chrome "C:\path\to\chrome.exe"
//   node tools/render.mjs --dry                   only measure the demo length, no video
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const preview = !!args.preview;
const [W, H] = String(args.size || (preview ? '1280x720' : '1920x1080')).split('x').map(Number);
const fps = Number(args.fps || (preview ? 24 : 30));
const quality = args.q || (preview ? 'mid' : 'high');
const out = path.resolve(args.out || (preview ? 'monet_demo_preview.mp4' : 'monet_demo.mp4'));
const maxT = Number(args.max || 240);
const dry = !!args.dry;

/* ---------------- static server ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

/* ---------------- tools ---------------- */
function findChrome() {
  if (args.chrome) return args.chrome;
  const env = process.env;
  const c = {
    win32: [
      `${env['PROGRAMFILES']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${env['PROGRAMFILES']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    linux: ['/usr/bin/google-chrome', '/usr/local/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'],
  }[process.platform] || [];
  return c.find((p) => p && fs.existsSync(p));
}
async function findFfmpeg() {
  try { const m = await import('ffmpeg-static'); if (m.default && fs.existsSync(m.default)) return m.default; } catch { /* fall back to PATH */ }
  const r = spawnSync('ffmpeg', ['-version']);
  return r.status === 0 ? 'ffmpeg' : null;
}
const fail = (msg) => { console.error(`\n✗ ${msg}\n`); server.close(); process.exit(1); };

const chrome = findChrome();
if (!chrome) fail('没有找到 Chrome / Edge。请安装 Google Chrome，或用 --chrome "浏览器路径" 指定。');
const ffmpeg = dry ? null : await findFfmpeg();
if (!dry && !ffmpeg) fail('没有找到 ffmpeg。请先在本目录运行 npm install（会自动下载 ffmpeg），或自行安装 ffmpeg。');

/* ---------------- wind soundtrack ---------------- */
function biquad(type, f0, q, sr) {
  const w = (2 * Math.PI * f0) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'low') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; } else { b0 = al; b1 = 0; b2 = -al; }
  const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  const k = [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  return (x) => {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = k[0] * x[i] + k[1] * x1 + k[2] * x2 - k[3] * y1 - k[4] * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  };
}
function windWav(levels, file) {
  const SR = 44100, n = Math.floor((levels.length / fps) * SR);
  const env = new Float32Array(n);
  let e = 0;
  const a = 1 - Math.exp((-2 * Math.PI * 1.5) / SR);
  for (let i = 0; i < n; i++) {
    const t = (i / SR) * fps, j = Math.min(levels.length - 1, Math.floor(t)), f = t - j;
    const target = levels[j] * (1 - f) + (levels[Math.min(levels.length - 1, j + 1)] ?? levels[j]) * f;
    e += (target - e) * a; env[i] = e;
  }
  let seed = 1873;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  const chans = [0, 1].map(() => {
    const src = new Float32Array(n);
    let b = 0;
    for (let i = 0; i < n; i++) { b = b * 0.997 + rnd() * 0.12; src[i] = b + rnd() * 0.03; }
    const low = biquad('low', 260, 0.707, SR)(src);
    const mid = biquad('band', 480, 0.9, SR)(src);
    const high = biquad('band', 1250, 1.1, SR)(src);
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const g = Math.max(0, env[i] - 0.55);
      o[i] = low[i] * (0.25 + 0.5 * env[i]) + mid[i] * (0.1 + 1.2 * env[i]) + high[i] * 1.8 * g ** 1.5;
    }
    return o;
  });
  let peak = 1e-9;
  chans.forEach((c) => { for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(c[i])); });
  const fade = SR * 1.5, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const g = Math.min(1, i / fade, (n - i) / fade) * (0.7 / peak);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, chans[0][i] * g)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, chans[1][i] * g)) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}

/* ---------------- capture ---------------- */
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
console.log(`莫奈 · 走进画境 — 演示视频渲染\n  分辨率 ${W}x${H} · ${fps}fps · 画质 ${quality}${args.headless ? ' · 无窗口模式' : ''}\n  浏览器 ${chrome}\n  输出   ${dry ? '（仅测量时长）' : out}\n`);

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: !!args.headless,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  protocolTimeout: 600000,
  args: [
    `--window-size=${W},${H + 120}`, '--hide-scrollbars', '--mute-audio', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ...(args.headless ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
  ],
});
const page = (await browser.pages())[0] || (await browser.newPage());
page.on('pageerror', (e) => console.log('[页面错误]', e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?capture=1&q=${quality}`, { waitUntil: 'load' });
console.log('生成笔触中…');
await page.waitForFunction('window.__ready === true', { timeout: 600000 });
await page.evaluate(() => document.fonts.ready);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monet-render-'));
const tmpVideo = path.join(tmpDir, 'video.mp4'), tmpWav = path.join(tmpDir, 'wind.wav');
let ff = null;
if (!dry) {
  ff = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmpVideo], { stdio: ['pipe', 'inherit', 'inherit'] });
}
const write = (buf) => new Promise((r) => (ff.stdin.write(buf) ? r() : ff.stdin.once('drain', r)));

const dt = 1 / fps, levels = [], t0 = Date.now();
let t = 0, frame = 0;
const EST = 120;
while (t < maxT) {
  const [done, level] = await page.evaluate((d, draw) => { window.__step(d, draw); return [!!window.__demoDone, window.app.S.windLevel]; }, dt, !dry);
  t += dt;
  if (!dry) {
    await write(await page.screenshot({ type: 'jpeg', quality: 93, optimizeForSpeed: true }));
    levels.push(level);
    frame++;
    if (frame % fps === 0) {
      const el = (Date.now() - t0) / 1000, eta = (el / t) * Math.max(0, EST - t);
      process.stdout.write(`\r  已渲染 ${fmt(t)} / 约 ${fmt(EST)}   用时 ${fmt(el)}   预计还需 ${fmt(eta)}    `);
    }
  }
  if (done) break;
  if (dry) await new Promise((r) => setImmediate(r));
}
await browser.close();
server.close();

if (dry) { console.log(`演示时长：${t.toFixed(1)} 秒（${fmt(t)}）`); process.exit(0); }

console.log(`\n画面完成（${frame} 帧，${fmt(t)}），合成风声与音轨…`);
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
windWav(levels, tmpWav);
const mux = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', tmpVideo, '-i', tmpWav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', out], { stdio: 'inherit' });
if (mux.status !== 0) fail('ffmpeg 合成失败。');
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`\n✓ 完成：${out}\n  总用时 ${fmt((Date.now() - t0) / 1000)}`);
