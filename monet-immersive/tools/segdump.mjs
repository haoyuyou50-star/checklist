// Dump the unified generator's segmentation and fill layers as PNGs (debug).
//   node tools/segdump.mjs --scene 1 --out /tmp/seg
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const out = args.out || 'seg';
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/usr/local/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8123/index.html?nodemo=1', { waitUntil: 'load' });
const imgs = await page.evaluate(async (si) => {
  const { SCENES } = await import('./src/scenes.js');
  const { buildScene, loadImage, QUALITY } = await import('./src/generator.js');
  const sc = SCENES[si];
  const img = await loadImage(sc.image);
  globalThis.__monetDebug = true;
  buildScene(sc, img, QUALITY.mid);
  const d = globalThis.__monetDebug, { W, H } = d;
  const pal = [[120, 170, 255], [90, 200, 60], [255, 60, 60], [20, 120, 20], [255, 160, 40], [255, 0, 255], [30, 60, 200], [255, 255, 255]];
  const toURL = (fn) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), id = x.createImageData(W, H);
    for (let i = 0; i < W * H; i++) { const p = fn(i); id.data.set([p[0], p[1], p[2], 255], i * 4); }
    x.putImageData(id, 0, 0); return c.toDataURL('image/png');
  };
  const rgb = (a) => (i) => [a[i * 3] * 255, a[i * 3 + 1] * 255, a[i * 3 + 2] * 255];
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, W, H);
  const src = cx.getImageData(0, 0, W, H).data;
  return {
    cls: toURL((i) => { const p = pal[d.cls[i]] || [0, 0, 0]; return [0, 1, 2].map((j) => p[j] * 0.55 + src[i * 4 + j] * 0.45); }),
    sky: toURL(rgb(d.sky)), sky6: toURL(rgb(d.sky6)), water: toURL(rgb(d.water)), land: toURL(rgb(d.land)),
  };
}, Number(args.scene || 1));
for (const [k, v] of Object.entries(imgs)) fs.writeFileSync(path.join(out, k + '.png'), Buffer.from(v.split(',')[1], 'base64'));
console.log('wrote', Object.keys(imgs).join(', '));
await browser.close();
