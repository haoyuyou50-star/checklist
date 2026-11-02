// Export the stroke fields as MNT1 files for the Unity player (needs the local server on :8123).
//   node tools/export_mnt1.mjs [--q low,mid,high] [--scenes regatta,bridge] [--out export] [--params psd]
//
// MNT1, little-endian: 'MNT1', uint32 N, then N strokes of 20 float32 each, in the generator's own order
// A.xyzw B.xyzw C.xyzw D.rgba E.xyzw (8 + N * 80 bytes). Coordinates stay in generator space (the player's
// shader turns them into its own). A colour mood (<id>_<tier>_tone<k>.bytes) differs only in D.rgb.
// A.w packs the stroke's edge softness: floor(A.w) / 7 is the softness (0 hard .. 1 soft), fract(A.w) the seed.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const tiers = String(args.q || 'mid').split(',');
const only = args.scenes ? String(args.scenes).split(',') : null;
const out = args.out || 'export';
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=640,360'],
  defaultViewport: { width: 640, height: 360 },
});
const manifest = [];
for (const q of tiers) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.stack || e.message));
  await page.goto(`http://localhost:8123/index.html?capture=1&nodemo=1&q=${q}${args.params ? `&${args.params}` : ''}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 300000 });
  const ids = await page.evaluate(async () => {
    const { SCENES } = await import('./src/scenes.js');
    return SCENES.map((s) => s.id);
  });
  for (let i = 0; i < ids.length; i++) {
    if (only && !only.includes(ids[i])) continue;
    await page.evaluate((i) => { if (!window.app.built[i]) window.app.selectPainting(i); }, i);
    await page.waitForFunction((i) => !!window.app.built[i], { timeout: 300000 }, i);
    const nTones = await page.evaluate((i) => (window.app.built[i].data.tones || [null]).length, i);
    for (let k = 0; k < nTones; k++) {
      const b64 = await page.evaluate((i, k) => {
        const d = window.app.built[i].data, n = d.count, D = k && d.tones ? d.tones[k] : d.D;
        if (!D) return null;
        const buf = new ArrayBuffer(8 + n * 80), dv = new DataView(buf);
        [77, 78, 84, 49].forEach((c, j) => dv.setUint8(j, c));
        dv.setUint32(4, n, true);
        const F = new Float32Array(n * 20);
        for (let s = 0; s < n; s++) {
          const o = s * 4, w = s * 20;
          for (let j = 0; j < 4; j++) { F[w + j] = d.A[o + j]; F[w + 4 + j] = d.B[o + j]; F[w + 8 + j] = d.C[o + j]; F[w + 12 + j] = D[o + j]; F[w + 16 + j] = d.E[o + j]; }
        }
        // the page runs on little-endian hardware: the float block is copied as it is
        new Uint8Array(buf, 8).set(new Uint8Array(F.buffer));
        const u8 = new Uint8Array(buf);
        let s = '';
        for (let j = 0; j < u8.length; j += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(j, j + 0x8000));
        return btoa(s);
      }, i, k);
      if (!b64) continue;
      const name = `${ids[i]}_${q}${k ? `_tone${k}` : ''}.bytes`;
      const bytes = Buffer.from(b64, 'base64');
      fs.writeFileSync(path.join(out, name), bytes);
      const n = bytes.readUInt32LE(4);
      manifest.push({ file: name, scene: ids[i], tier: q, tone: k, strokes: n, bytes: bytes.length });
      console.log(`${name}: ${n.toLocaleString()} strokes, ${(bytes.length / 1048576).toFixed(1)} MB`);
    }
  }
  await page.close();
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
await browser.close();
