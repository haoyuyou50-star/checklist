const center = (node) => {
  const r = node.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
};

async function press(app, node, action, { dwell = 0.6, move = 1.3 } = {}) {
  const [x, y] = center(node);
  await app.cursor.moveTo(x, y, move);
  node.classList.add('is-hover');
  await app.wait(dwell);
  await Promise.all([app.cursor.click(), (async () => { await app.wait(0.12); node.classList.remove('is-hover'); action(); })()]);
}

async function visitHotspot(app, id, linger) {
  const [x, y] = app.markerPos(id);
  await app.cursor.moveTo(x, y, 1.4);
  app.S.hoverId = id;
  await app.wait(1.0);
  await app.cursor.click();
  app.focusHotspot(id);
  app.S.hoverId = 0;
  await app.wait(2.0);
  const [bx, by] = center(app.el.cBack);
  app.cursor.moveTo(bx + 30, by - 70, 2.2);
  await app.wait(linger);
  await press(app, app.el.cBack, () => app.unfocus(), { move: 0.9, dwell: 0.4 });
  await app.wait(1.9);
}

async function gazeAt(app, egg) {
  await app.cursor.moveTo(...app.eggPos(egg), 0.9);
  // the parallax eye has drifted while the cursor travelled
  await app.cursor.moveTo(...app.eggPos(egg), 0.3);
  await app.wait(2.1);
}

export async function runDemo(app) {
  const W = innerWidth, H = innerHeight;
  await app.wait(2.2);
  await app.cursor.show(W * 0.72, H * 0.86);

  /* ---- 01 Régates ---- */
  await press(app, app.el.enter, () => app.enter(), { move: 1.3, dwell: 0.7 });
  app.cursor.moveTo(W * 0.5, H * 0.62, 2.4);
  await app.wait(6.2);

  await app.look(-0.75, -0.03, 3.6);
  // the gaze (here the cursor) rests on the duck: it turns its head
  await gazeAt(app, 0);
  await app.look(1.45, 0.03, 4.8);
  await app.wait(0.3);
  await app.look(-0.7, 0.0, 2.8);
  await app.wait(0.3);

  await visitHotspot(app, 1, 3.0);
  await visitHotspot(app, 4, 2.8);

  await press(app, app.el.gustBtn, () => app.gust(), { move: 1.2, dwell: 0.5 });
  app.cursor.moveTo(W * 0.56, H * 0.4, 2.0);
  await app.wait(4.6);

  await press(app, app.el.exit, () => app.exit(), { move: 1.5, dwell: 0.6 });
  await app.wait(4.8);

  /* ---- 02 Le Bassin aux nymphéas ---- */
  const pick2 = app.el.picker.children[1];
  await press(app, pick2, () => app.selectPainting(1), { move: 1.4, dwell: 0.5 });
  await app.wait(2.2);
  await press(app, app.el.enter, () => app.enter(), { move: 1.3, dwell: 0.7 });
  app.cursor.moveTo(W * 0.5, H * 0.62, 2.4);
  await app.wait(6.2);

  // down to the lily bud by the near bank: under the gaze it opens
  await app.look(0.25, -0.32, 2.6);
  await gazeAt(app, 0);
  await app.look(0.45, 0.27, 2.4);
  await app.wait(0.3);
  await app.look(-1.3, 0.02, 4.6);
  await app.wait(0.3);
  await app.look(0.6, 0.03, 2.8);
  await app.wait(1.2);

  // the colour moods: 盛夏, then 秋暮
  for (const k of [1, 2]) {
    await press(app, app.el.tones.children[k], () => app.setTone(k), { move: 1.3, dwell: 0.5 });
    app.cursor.moveTo(W * 0.5, H * 0.45, 2.2);
    await app.wait(6.5);
  }

  await press(app, app.el.exit, () => app.exit(), { move: 1.5, dwell: 0.6 });
  await app.wait(4.8);
  await app.cursor.hide();
  await app.wait(1.0);
}
