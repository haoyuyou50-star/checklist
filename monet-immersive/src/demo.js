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

export async function runDemo(app) {
  const W = innerWidth, H = innerHeight;
  await app.wait(2.6);
  await app.cursor.show(W * 0.72, H * 0.86);

  /* ---- 01 Coquelicots ---- */
  await press(app, app.el.enter, () => app.enter(), { move: 1.5, dwell: 0.9 });
  app.cursor.moveTo(W * 0.52, H * 0.6, 2.4);
  await app.wait(7.4);

  await app.look(0.55, -0.04, 3.6);
  await app.wait(0.4);
  await app.look(-1.15, 0.02, 5.0);
  await app.wait(0.3);
  await app.look(0.6, 0.02, 3.0);
  await app.wait(0.4);

  await press(app, app.el.gustBtn, () => app.gust(), { move: 1.2, dwell: 0.5 });
  app.cursor.moveTo(W * 0.5, H * 0.45, 2.0);
  await app.wait(4.6);

  await visitHotspot(app, 1, 3.4);
  await visitHotspot(app, 2, 2.8);

  const r = app.el.range.getBoundingClientRect();
  await app.cursor.moveTo(r.left + r.width * 0.55, r.top + r.height / 2, 1.3);
  await app.wait(0.3);
  const w0 = app.S.windTarget;
  await app.tween(1.6, (e) => { app.setWind(w0 + (0.95 - w0) * e); app.cursor.moveTo(r.left + r.width * (0.55 + 0.4 * e), r.top + r.height / 2, 0.001); });
  app.cursor.moveTo(W * 0.42, H * 0.5, 2.0);
  await app.wait(4.0);

  await press(app, app.el.exit, () => app.exit(), { move: 1.5, dwell: 0.6 });
  await app.wait(5.6);

  /* ---- 02 Régates ---- */
  const pick2 = app.el.picker.children[1];
  await press(app, pick2, () => app.selectPainting(1), { move: 1.4, dwell: 0.5 });
  await app.wait(2.6);
  await press(app, app.el.enter, () => app.enter(), { move: 1.3, dwell: 0.7 });
  app.cursor.moveTo(W * 0.5, H * 0.62, 2.4);
  await app.wait(7.4);

  await app.look(-0.75, -0.03, 4.0);
  await app.wait(0.3);
  await app.look(1.45, 0.03, 5.4);
  await app.wait(0.3);
  await app.look(-0.7, 0.0, 3.2);
  await app.wait(0.3);

  await visitHotspot(app, 1, 3.2);
  await visitHotspot(app, 4, 3.0);

  await press(app, app.el.gustBtn, () => app.gust(), { move: 1.2, dwell: 0.5 });
  app.cursor.moveTo(W * 0.56, H * 0.4, 2.0);
  await app.wait(4.8);

  await press(app, app.el.exit, () => app.exit(), { move: 1.5, dwell: 0.6 });
  await app.wait(5.0);
  await app.cursor.hide();
  await app.wait(1.0);
}
