// Deterministic frame-by-frame capture of the auto demo.
//   node tools/capture.mjs --out frames --fps 30 --size 1920x1080            full video frames
//   node tools/capture.mjs --shots 3,9,15 --out shots --dt 0.1               stills at given seconds
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const [W, H] = (args.size || '1600x900').split('x').map(Number);
const fps = Number(args.fps || 30);
const out = args.out || 'frames';
const url = args.url || `http://localhost:8123/index.html?capture=1&q=${args.q || 'high'}`;
const shots = args.shots ? String(args.shots).split(',').map(Number) : null;
const dt = shots ? Number(args.dt || 0.1) : 1 / fps;
const start = Number(args.start || 0);
const maxT = Number(args.max || 400);

fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: args.chrome || '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', `--window-size=${W},${H}`, '--hide-scrollbars'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 300000 });
await page.evaluate(() => document.fonts.ready);

let t = 0, frame = 0, shotIdx = 0;
const levels = [];
const t0 = Date.now();
while (t < maxT) {
  const draw = shots ? t + dt + 1e-6 >= shots[shotIdx] : t + dt + 1e-6 >= start;
  await page.evaluate((d, dr) => window.__step(d, dr), dt, draw);
  t += dt;
  const done = await page.evaluate(() => !!window.__demoDone);
  if (shots) {
    if (t + 1e-6 >= shots[shotIdx]) {
      const f = path.join(out, `shot_${String(shots[shotIdx]).replace('.', '_')}.jpg`);
      await page.screenshot({ path: f, type: 'jpeg', quality: 90 });
      console.log('shot', f);
      if (++shotIdx >= shots.length) break;
    }
  } else if (t >= start) {
    await page.screenshot({ path: path.join(out, `f_${String(frame).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
    levels.push(await page.evaluate(() => window.app.S.windLevel));
    if (frame % 150 === 0) fs.writeFileSync(path.join(out, 'wind.json'), JSON.stringify({ fps, levels }));
    frame++;
    if (frame % 30 === 0) console.log(`t=${t.toFixed(2)}s frame=${frame} elapsed=${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  if (done) break;
}
if (!shots) fs.writeFileSync(path.join(out, 'wind.json'), JSON.stringify({ fps, levels }));
await browser.close();
console.log('done', { t, frame });
