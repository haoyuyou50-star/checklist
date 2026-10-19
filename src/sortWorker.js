import { sortSplats } from './sort.js';

const scenes = new Map();

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    scenes.set(m.id, { count: m.count, A: m.A, B: m.B, E: m.E });
  } else if (m.type === 'sort') {
    const S = scenes.get(m.id);
    if (!S) return;
    const out = new Float32Array(S.count);
    sortSplats(S, m.cam, m.dir, m.morph, out);
    self.postMessage({ id: m.id, order: out, seq: m.seq }, [out.buffer]);
  }
};
