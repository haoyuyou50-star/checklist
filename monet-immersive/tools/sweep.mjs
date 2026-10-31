// Frames of the regatta scene while the eye sways sideways (to check the paper-card parallax).
//   node tools/sweep.mjs /tmp/sweep 0.05 && ffmpeg -framerate 24 -i /tmp/sweep/f%03d.jpg sweep.mp4
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const out = process.argv[2] || '/tmp/sweep';
const yaw = Number(process.argv[3] || 0);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1280,720', '--hide-scrollbars'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto('http://localhost:8123/index.html?capture=1&nodemo=1&q=mid', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 300000 });
const step = (t, dt = 0.1) => page.evaluate(async (t, dt) => {
  for (let k = 0; k < Math.round(t / dt); k++) { window.__step(dt, false); await new Promise((r) => setTimeout(r, 0)); }
  window.__step(0.001, true);
}, t, dt);
await step(2);
await page.evaluate(() => { window.app.selectPainting(1); }); await step(3);
await page.evaluate(() => { window.app.enter(); }); await step(8);
await page.evaluate((y) => { const S = window.app.S; S.cam.yaw = y; S.vel.yaw = S.vel.pitch = 0; document.querySelectorAll('body > *:not(canvas)').forEach((e) => (e.style.opacity = 0)); }, yaw);
const F = 72;
for (let k = 0; k < F; k++) {
  const x = Math.sin((k / F) * Math.PI * 2) * 1, y = Math.sin((k / F) * Math.PI * 4) * 0.35;
  await page.evaluate((x, y) => { window.app.eye.force = [x, y]; }, x, y);
  await step(1 / 24, 1 / 24);
  await page.screenshot({ path: `${out}/f${String(k).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 88 });
}
await browser.close();
