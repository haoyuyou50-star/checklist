// Stills of one immersive scene at several yaw angles (for look-dev).
//   node tools/shot.mjs --scene 1 --yaws 0,0.6,-0.6,3.1 --out shots --q mid [--params flat]
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
page.on('pageerror', (e) => console.log('[pageerror]', e.stack || e.message));
page.on('console', (m) => console.log('[page]', m.text()));
await page.goto(`http://localhost:8123/index.html?capture=1&nodemo=1&q=${args.q || 'mid'}${args.params ? `&${args.params}` : ''}`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 300000 });
const step = (t, dt = 0.1) => page.evaluate(async (t, dt) => {
  for (let k = 0; k < Math.round(t / dt); k++) { window.__step(dt, false); await new Promise((r) => setTimeout(r, 0)); }
  window.__step(0.001, true);
}, t, dt);
await step(2);
if (scene !== 0) {
  await page.evaluate((i) => { window.app.selectPainting(i); }, scene);
  await step(3);
  // a scene not built yet builds on selection
  for (let k = 0; k < 60 && (await page.evaluate(() => window.app.S.mode)) !== 'gallery'; k++) await step(0.5);
}
// --dump: backdrop colours and mean stroke colour per class of the scene
if (args.dump) {
  console.log(await page.evaluate((i) => {
    const d = window.app.built[i].data, m = {};
    for (let j = 0; j < d.count; j++) {
      const c = d.B[j * 4 + 3], a = (m[c] ||= [0, 0, 0, 0]);
      for (let k = 0; k < 3; k++) a[k] += d.D[j * 4 + k];
      a[3]++;
    }
    const f = (v) => v.map((x) => x.toFixed(3)).join(',');
    // strokes much bluer than they are bright, above eye level
    const odd = [];
    for (let j = 0; j < d.count && odd.length < 12; j++) {
      const o = j * 4, [r, g, b] = [d.D[o], d.D[o + 1], d.D[o + 2]];
      if (b > r + 0.25 && b > g + 0.12 && d.A[o + 1] > 1) odd.push(`cls ${d.B[o + 3]} at ${f([d.A[o], d.A[o + 1], d.A[o + 2]])} col ${f([r, g, b])} ext ${d.E[o + 3]}`);
    }
    return `odd blue:\n${odd.join('\n')}\nbg ${JSON.stringify(Object.fromEntries(Object.entries(d.bg).map(([k, v]) => [k, f(v)])))}\n` + Object.entries(m).map(([c, a]) => `cls ${c}: n=${a[3]} mean ${f(a.slice(0, 3).map((x) => x / a[3]))}`).join('\n');
  }, scene));
}
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
// --series 8 --gust: frames 0.7 s apart at the first yaw, to catch things that flicker over time
if (args.series) {
  await page.evaluate(() => { window.app.eye.force = [0, 0]; });
  if (args.gust) await page.evaluate(() => { window.app.gust(); });
  for (let i = 0; i < Number(args.series); i++) {
    await step(0.7);
    await page.screenshot({ path: path.join(out, `${tag}t${i}.jpg`), type: 'jpeg', quality: 90 });
  }
  await browser.close();
  process.exit(0);
}
// --tone 2 [--tonemid 0.8,1.6]: switch the colour mood (stills part-way through the wave, then the shots below)
if (args.tone !== undefined) {
  await page.evaluate(() => { window.app.eye.force = [0, 0]; });
  await page.evaluate((k) => { window.app.setTone(k); }, Number(args.tone));
  let t = 0;
  for (const m of args.tonemid ? String(args.tonemid).split(',').map(Number) : []) {
    await step(m - t); t = m;
    await page.screenshot({ path: path.join(out, `${tag}tone${args.tone}_${m}.jpg`), type: 'jpeg', quality: 90 });
  }
  await step(Math.max(0.1, 4.2 - t));
}
// --look "-1,0;1,0" pins the parallax eye offset (x,y in -1..1) for each shot
const looks = args.look ? String(args.look).split(';').map((s) => s.split(',').map(Number)) : [null];
for (const y of args.focus ? [] : yaws) for (const lk of looks) {
  await page.evaluate((y, p, fov, lk) => {
    const S = window.app.S; S.cam.yaw = y; if (p !== null) S.cam.pitch = p; if (fov) S.cam.fov = fov; S.vel.yaw = S.vel.pitch = 0;
    window.app.eye.force = lk || [0, 0];
  }, y, pitch, args.fov ? Number(args.fov) : 0, lk);
  await step(0.3);
  const f = path.join(out, `${tag}y${y}${lk ? `_l${lk.join('_')}` : ''}.jpg`);
  await page.screenshot({ path: f, type: 'jpeg', quality: 90 });
  console.log('shot', f);
}
await browser.close();
