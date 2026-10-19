// Stills of one immersive scene at several yaw angles (for look-dev).
//   node tools/shot.mjs --scene 1 --yaws 0,0.6,-0.6,3.1 --out shots --q mid
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const [W, H] = (args.size || '1280x720').split('x').map(Number);
const scene = Number(args.scene || 1);
const yaws = String(args.yaws ?? '0').split(',').map(Number);
const pitch = args.pitch !== undefined ? Number(args.pitch) : null;
const out = args.out || 'shots';
const tag = args.tag || '';
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', `--window-size=${W},${H}`, '--hide-scrollbars'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => console.log('[page]', m.text()));
await page.goto(`http://localhost:8123/index.html?capture=1&nodemo=1&q=${args.q || 'mid'}`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 300000 });
const step = (t, dt = 0.1) => page.evaluate(async (t, dt) => {
  for (let k = 0; k < Math.round(t / dt); k++) { window.__step(dt, false); await new Promise((r) => setTimeout(r, 0)); }
  window.__step(0.001, true);
}, t, dt);
await step(2);
if (scene !== 0) { await page.evaluate((i) => { window.app.selectPainting(i); }, scene); await step(3); }
if (args.gallery) await page.screenshot({ path: path.join(out, `${tag}gallery.jpg`), type: 'jpeg', quality: 90 });
if (args.mid) {
  await page.evaluate(() => { window.app.enter(); });
  await step(Number(args.mid));
  await page.screenshot({ path: path.join(out, `${tag}trans.jpg`), type: 'jpeg', quality: 90 });
  await step(8 - Number(args.mid));
} else {
  await page.evaluate(() => { window.app.enter(); });
  await step(8);
}
if (args.focus) {
  for (const id of String(args.focus).split(',').map(Number)) {
    await page.evaluate((id) => { window.app.focusHotspot(id); }, id);
    await step(3.2);
    await page.screenshot({ path: path.join(out, `${tag}focus${id}.jpg`), type: 'jpeg', quality: 90 });
    console.log('shot focus', id);
    await page.evaluate(() => { window.app.unfocus(); });
    await step(2.2);
  }
}
for (const y of args.focus ? [] : yaws) {
  await page.evaluate((y, p) => { const S = window.app.S; S.cam.yaw = y; if (p !== null) S.cam.pitch = p; S.vel.yaw = S.vel.pitch = 0; }, y, pitch);
  await step(0.3);
  const f = path.join(out, `${tag}y${y}.jpg`);
  await page.screenshot({ path: f, type: 'jpeg', quality: 90 });
  console.log('shot', f);
}
await browser.close();
