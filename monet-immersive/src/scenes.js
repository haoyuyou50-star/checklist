export const CLS = {
  SKY: 0, GRASS: 1, FLOWER: 2, TREE: 3, STATIC: 4, FIGURE: 5, WATER: 6, SAIL: 7,
  PETAL: 8, MOTE: 9, HALO: 10, GLINT: 11, GULL: 12,
};

const lerp = (a, b, t) => a + (b - a) * t;

export function polyline(pts) {
  return (u) => {
    if (u <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (u <= pts[i][0]) {
        const [u0, v0] = pts[i - 1], [u1, v1] = pts[i];
        return lerp(v0, v1, (u - u0) / (u1 - u0));
      }
    }
    return pts[pts.length - 1][1];
  };
}

export function inPoly(u, v, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > v) !== (yj > v) && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inEllipse = (u, v, cu, cv, ru, rv) => ((u - cu) / ru) ** 2 + ((v - cv) / rv) ** 2 < 1;
const inRect = (u, v, u0, v0, u1, v1) => u >= u0 && u <= u1 && v >= v0 && v <= v1;
const luma = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;

/**
 * Painting camera model: rays through the painting are (u - 0.5, -(v - vH) * asp, -f).
 * Every painted stroke keeps its ray, only its distance along the ray changes,
 * so the original composition is preserved exactly from the viewing point.
 */
function groundDepth(cam, asp, v) {
  const y = -(v - cam.vH) * asp;
  if (y >= -1e-4) return cam.maxD;
  return Math.min(cam.maxD, (cam.h * cam.f) / -y);
}

/* ============================================================
 *  01  Coquelicots (Poppy Field), 1873
 * ============================================================ */
const poppiesGroundTop = polyline([[0, 0.468], [0.12, 0.478], [0.25, 0.49], [0.4, 0.508], [0.55, 0.525], [0.7, 0.522], [1, 0.518]]);
const poppiesTreeTop = polyline([[0, 0.37], [0.02, 0.37], [0.06, 0.345], [0.235, 0.34], [0.25, 0.215], [0.42, 0.215], [0.435, 0.415], [1, 0.415]]);
const womanPoly = [[0.648, 0.735], [0.70, 0.712], [0.722, 0.682], [0.752, 0.688], [0.762, 0.735], [0.792, 0.845], [0.79, 0.965], [0.698, 0.968], [0.69, 0.85], [0.652, 0.812]];

const poppies = {
  id: 'poppies',
  image: 'assets/paintings/poppies.jpg',
  info: {
    index: '01',
    titleCn: '罂粟花田',
    titleFr: 'Coquelicots, 1873',
    meta: '布面油画 · 50 × 65 cm<br>巴黎 · 奥赛博物馆',
    desc: '1873 年夏，莫奈在阿让特伊的郊野写生。几抹跳跃的朱红便是迎风摇曳的罂粟，近处撑伞的是他的妻子卡米耶与儿子让。斜坡上下两对母子连成一条对角线，把目光引向远方。翌年，这幅画出现在第一届印象派画展上。',
    thumbLabel: '罂粟花田',
  },
  cam: { f: 0.866, h: 2.4, vH: 0.505, maxD: 92, dolly: 1.8, sky: 620 },
  grade: { gamma: 0.96, expo: 1.04, wb: [0.97, 1.0, 1.05], sat: 1.2, lift: 0.1, contrast: 1.12, clean: 0.8 },
  wind: { dir: [0.86, 0.5], base: 0.55 },
  classify(u, v, r, g, b, rand) {
    const cam = this.cam, asp = this.asp;
    const L = luma(r, g, b);
    if (inEllipse(u, v, 0.676, 0.76, 0.042, 0.064) && (b > r * 1.05 || L < 0.36)) return { cls: CLS.FIGURE, depth: groundDepth(cam, asp, 0.965), hot: 1, flex: 0.25 };
    if (inPoly(u, v, womanPoly)) return { cls: CLS.FIGURE, depth: groundDepth(cam, asp, 0.965), hot: 1, flex: (0.965 - v) * 2 };
    if (inEllipse(u, v, 0.593, 0.818, 0.03, 0.057)) return { cls: CLS.FIGURE, depth: groundDepth(cam, asp, 0.875), hot: 1, flex: 0.1 };
    if (inEllipse(u, v, 0.201, 0.447, 0.026, 0.066)) return { cls: CLS.FIGURE, depth: 46, hot: 0, flex: 0.1 };
    if (inEllipse(u, v, 0.157, 0.467, 0.016, 0.04)) return { cls: CLS.FIGURE, depth: 46, hot: 0, flex: 0.1 };
    if (inRect(u, v, 0.543, 0.462, 0.6, 0.528) && L > 0.5) return { cls: CLS.STATIC, depth: 86, hot: 4, flex: 0 };

    const gt = poppiesGroundTop(u);
    if (v >= gt) {
      const depth = Math.max(groundDepth(cam, asp, v), u < 0.45 && v < cam.vH + 0.01 ? 60 : 0);
      const red = r > 0.42 && r > g * 1.42 && r > b * 1.45;
      if (red) {
        const hot = inEllipse(u, v, 0.21, 0.635, 0.2, 0.11) ? 3 : 0;
        return { cls: CLS.FLOWER, depth, hot, flex: 0.7 + rand() * 0.3 };
      }
      return { cls: CLS.GRASS, depth, hot: 0, flex: 0.35 + rand() * 0.65 };
    }
    const tt = poppiesTreeTop(u);
    if (v >= tt) {
      const skyLike = L > 0.6 || (b > r + 0.03 && L > 0.5);
      if (!skyLike) {
        const big = u > 0.245 && u < 0.43;
        const depth = big ? 72 : 88;
        const flex = Math.min(1, Math.max(0, (gt - v) / (big ? 0.3 : 0.12)));
        return { cls: CLS.TREE, depth, hot: big ? 2 : 0, flex };
      }
    }
    return { cls: CLS.SKY, depth: cam.sky, hot: 0, flex: 0 };
  },
  hotspots: [
    { id: 1, cn: '卡米耶与让', en: 'Camille & Jean', zoom: 2.0,
      text: '撑着蓝色阳伞的，是莫奈的妻子卡米耶，身旁是他们六岁的儿子让。人物的面容被简化成几笔色块——在莫奈眼中，他们和花草一样，都只是夏日光线的一部分。坡顶还有另一对母子，与这里遥相呼应。' },
    { id: 2, cn: '坡顶的树', en: 'The Lone Tree', zoom: 1.8,
      text: '这棵树由层层叠加的绿色笔触堆成，亮部与暗部之间没有一条轮廓线。当时的评论家批评这样的画面"像是没有完成的草图"，而这正是印象派要捕捉的——光在一瞬间的样子。' },
    { id: 3, cn: '罂粟花', en: 'Poppies', zoom: 2.0,
      text: '罂粟并没有被一朵朵细细描绘，只是一点点跳跃的朱红。红与绿互为补色，并置时彼此映衬，显得格外鲜亮——这正是印象派"色彩分割"的秘密。' },
    { id: 4, cn: '远处的农舍', en: 'The Farmhouse', zoom: 2.6,
      text: '地平线上，一座浅色的农舍隐在树影里。莫奈让天空占据了近一半的画面，云的流动与花田的起伏彼此呼应，整幅画便有了风的节奏。' },
  ],
  ext: { kind: 'field', ring: [80, 96], nearTrees: [[112, 30, 14], [-138, 38, 17], [172, 52, 12], [-72, 46, 11]], houses: [[-64, 90], [128, 92]], flowers: true, petals: true },
};

/* ============================================================
 *  02  Régates à Argenteuil, c.1872
 * ============================================================ */
const regattaLand = [[0.44, 0.66], [0.452, 0.5], [0.53, 0.42], [0.552, 0.24], [0.6, 0.15], [0.632, 0.25], [0.69, 0.3], [0.78, 0.27], [0.8, 0.28], [0.95, 0.3], [1, 0.32], [1, 0.66]];
const inR = (u, v, u0, v0, u1, v1) => u >= u0 && u <= u1 && v >= v0 && v <= v1;

const regatta = {
  id: 'regatta',
  image: 'assets/paintings/regatta.jpg',
  info: {
    index: '02',
    titleCn: '阿让特伊的帆船赛',
    titleFr: 'Régates à Argenteuil, vers 1872',
    meta: '布面油画 · 48 × 75 cm<br>巴黎 · 奥赛博物馆',
    desc: '塞纳河流经阿让特伊时变得开阔，这里是巴黎人周末驾帆的去处。莫奈用快速并置的色块画水：白帆、红屋与绿岸，被河水打碎成一片颤动的倒影。他不再描摹物体的轮廓，而是捕捉光落在水面上转瞬即逝的那一刻。',
    thumbLabel: '阿让特伊的帆船赛',
  },
  cam: { f: 0.866, h: 1.6, vH: 0.55, maxD: 450, dolly: 1.4, sky: 520, parallax: 2.4 },
  grade: { gamma: 0.9, expo: 1.1, wb: [0.94, 1.0, 1.1], sat: 1.18, lift: 0.34, contrast: 1.06, clean: 1 },
  wind: { dir: [1, 0.22], base: 0.5 },
  unified: {
    water: [[0, 0.556], [0.44, 0.557], [0.465, 0.62], [0.5, 0.642], [0.68, 0.64], [1, 0.645]],
    farBank: { top: 0.542, uMax: 0.445 },
    // the plate takes broader strokes so the element cards can be fine within the splat budget
    alphaMul: { low: 1.15, mid: 1.26, high: 1.27 },
    // the clean plate has no boats: every element comes from its own layer card (see layered)
    boats: [],
    landMinLayer: 1,
    // gulls roaming over the river: [azimuth°, distance m, height m, roaming radius m]
    gulls: [[-18, 70, 30, 24], [8, 95, 40, 30], [24, 60, 24, 20], [-40, 85, 26, 28], [62, 75, 20, 22], [140, 80, 24, 26], [-120, 70, 19, 22], [-170, 90, 28, 30], [95, 55, 15, 16]],
    land: regattaLand,
    // column ranges walked outward from the frame edge (the red house and the tall tree stay unique)
    landPool: [[1.0, 0.955], [0.79, 0.665]],
    farPool: [[0.0, 0.43]],
    farRate: 1,
    backDist: 140,
    hot(u, v, c) {
      return c === CLS.WATER && inR(u, v, 0.6, 0.665, 0.97, 0.93) ? 4 : 0;
    },
    // the unpainted canvas edge and the signature are not texture to continue
    skyBad: (u, v) => u > 0.972 && v < 0.5,
    skyRange: [0.004, 0.97],
    waterBad: (u, v) => u > 0.72 && v > 0.92,
  },
  // the art team's layer split (assets/layers, exported by tools/export_layers.py)
  layered: {
    base: 'assets/regatta/base.jpg',
    // stroke size on elements relative to the plate (per card where detail like windows must read)
    fine: 0.5,
    // PSD order, bottom to top; depth = card distance as a multiple of the shore under it
    cards: [
      { id: 'sail_r', kind: 'sail', hot: 1, fine: 0.42, box: [0.2777, 0.1637, 0.436, 0.6466] },
      { id: 'sail_m', kind: 'sail', fine: 0.4, box: [0.1626, 0.3787, 0.2662, 0.6213] },
      { id: 'sail_s', kind: 'sail', fine: 0.38, box: [0.1209, 0.4836, 0.1549, 0.6213] },
      { id: 'sail_l', kind: 'sail', fine: 0.42, box: [0.0211, 0.2708, 0.1127, 0.6109] },
      { id: 'house_big', kind: 'house', hot: 2, depth: 1.9, fine: 0.28, box: [0.7899, 0.2939, 0.9477, 0.4807] },
      { id: 'grove_back', kind: 'tree', depth: 1.62, fine: 0.55, box: [0.4906, 0.3185, 0.8398, 0.5119] },
      { id: 'grove_front', kind: 'tree', depth: 1.44, box: [0.4508, 0.3728, 0.7113, 0.5268] },
      { id: 'house_small', kind: 'house', depth: 1.54, fine: 0.28, box: [0.6129, 0.3527, 0.7146, 0.4978] },
      { id: 'tree', kind: 'tree', hot: 3, depth: 1.5, fine: 0.42, box: [0.5794, 0.2366, 0.648, 0.5037] },
    ].map((c) => ({ ...c, src: `assets/regatta/${c.id}.webp` })),
    // shrubs on the front grove's card; the tall tree and the small house stand just behind it, so the
    // shrubs hide their feet and slide with the grove
    hedges: [{ src: 'grove_front', box: [0.468, 0.452, 0.742, 0.536], fine: 0.5, seed: 3 }],
    // beyond the frame (coarser strokes than in the frame): [azimuth°, distance (sails: metres on the river; trees: x shore distance), height m, mirrored]
    extras: [
      { id: 'x_sail_side', kind: 'sail', at: [[-42, 95, 7, 0]] },
      { id: 'x_boat_two', kind: 'sail', at: [[-62, 60, 9.5, 1]] },
      { id: 'x_boat_side', kind: 'sail', at: [[-96, 42, 8, 0]] },
      { id: 'x_sail_front', kind: 'sail', at: [[-140, 70, 9, 0]] },
      { id: 'x_boat_oblique', kind: 'sail', at: [[172, 80, 10, 1]] },
      { id: 'x_boat_1', kind: 'sail', at: [[132, 52, 8, 1]] },
      { id: 'x_boat_2', kind: 'sail', at: [[76, 30, 7, 0]] },
      { id: 'x_grove_1', kind: 'tree', at: [[44, 1.1, 9, 0], [92, 1.08, 10, 1], [150, 1.04, 13, 0]] },
      { id: 'x_grove_2', kind: 'tree', at: [[64, 1.1, 9.5, 1], [116, 1.06, 11, 0], [-165, 1.04, 13, 1]] },
      { id: 'x_tree_1', kind: 'tree', at: [[56, 1.18, 14, 0], [104, 1.14, 15, 1], [176, 1.06, 17, 0]] },
      { id: 'x_tree_2', kind: 'tree', at: [[80, 1.16, 14, 0], [134, 1.1, 16, 1], [-150, 1.06, 16, 0]] },
    ].map((e) => ({ spMul: e.kind === 'tree' ? 1.0 : 1.2, ...e, src: `assets/regatta/${e.id}.webp` })),
  },
  hotspots: [
    { id: 1, cn: '白帆', en: 'The Sails', zoom: 2.0,
      text: '帆船只用大块的白色与奶油色涂出，帆面上一抹蓝灰的阴影，暗示着风从哪里来。在阿让特伊驾帆竞渡，是当时巴黎人最时髦的周末消遣，莫奈自己也有一条画室船，漂在河上作画。' },
    { id: 2, cn: '红顶房屋', en: 'The Red House', zoom: 2.4,
      text: '岸边的房屋用橙红与赭石画成，与蓝灰的天空和河水形成冷暖对比，整幅画因此有了夏日的温度。' },
    { id: 3, cn: '岸边的树', en: 'The Riverside Tree', zoom: 2.2,
      text: '这棵深绿的树像一根立柱，稳住了画面右侧的构图，也把视线从帆船引向岸边，再顺着倒影回到水面。' },
    { id: 4, cn: '碎裂的倒影', en: 'Broken Reflections', zoom: 1.35,
      text: '这是整幅画最大胆的部分：倒影由一道道水平的色块组成，彼此并不相连。站远一些，它们便在眼中融成荡漾的水光——观者的眼睛，替画家完成了最后一笔。' },
  ],
};

/* ============================================================
 *  03  The water-lily pond and the Japanese bridge, Giverny
 * ============================================================ */
const bridge = {
  id: 'bridge',
  image: 'assets/bridge/composite.jpg',
  info: {
    index: '03',
    titleCn: '睡莲池与日本桥',
    titleFr: 'Le Bassin aux nymphéas, Giverny',
    meta: '吉维尼 · 莫奈的水上花园<br>可切换三种色调',
    desc: '1893 年，莫奈在吉维尼的家旁引水造池，种下睡莲，架起一座日本式的拱桥。此后二十多年，他一遍遍画这同一座桥、同一池水：清晨与黄昏，盛夏与深秋，光一变，整座花园就换了一种颜色。',
    thumbLabel: '睡莲池与日本桥',
  },
  // no hotspots or cards here: the interaction is the colour mood
  hint: '拖动环顾四周 · 右下角切换色调',
  cam: { f: 0.45, h: 1.6, vH: 0.42, maxD: 120, dolly: 1.0, sky: 420, parallax: 2.0 },
  grade: { gamma: 0.98, expo: 1.03, wb: [1, 1, 1.01], sat: 1.04, lift: 0.08, contrast: 1.03, clean: 0 },
  wind: { dir: [1, 0.3], base: 0.5 },
  // the gallery picture is the first mood; the others are learnt from reference paintings of the same motif.
  // 盛夏 also has the art team's own warm green pond (the green PSD's plate), taken as it is
  tones: [
    { cn: '晴光', en: 'Clear Light', swatch: ['#9cc6e8', '#e9d36a', '#9bbf5a'] },
    { cn: '盛夏', en: 'Green Harmony', ref: 'assets/paintings/bridge_green.jpg', keepLight: 0.65, expo: 1.05, gamma: 0.94, water: 'assets/bridge/base_green.jpg', waterArt: 'assets/bridge/composite_green.jpg', waterMix: 0.6, swatch: ['#2f6b3c', '#7fa860', '#cfe0c6'] },
    { cn: '秋暮', en: 'Autumn Glow', ref: 'assets/paintings/bridge_autumn.jpg', expo: 1.12, swatch: ['#b8341c', '#e98a2b', '#f5c45a'] },
  ],
  unified: {
    // the visible edge of the pond: near banks reach the bottom corners, the far edge runs under the bridge
    // (this shapes the garden beyond the frame). On the plate the pond spans the whole width (plateWater);
    // the near banks are the element cards
    water: [[0, 1.02], [0.12, 1.0], [0.16, 0.9], [0.2, 0.8], [0.25, 0.72], [0.29, 0.65], [0.32, 0.6], [0.36, 0.585], [0.5, 0.565], [0.75, 0.56], [0.78, 0.6], [0.84, 0.68], [0.89, 0.76], [0.92, 0.86], [0.94, 0.97], [1, 1.02]],
    plateWater: [[0, 0.595], [0.1, 0.59], [0.2, 0.575], [0.45, 0.565], [0.75, 0.56], [0.85, 0.55], [1, 0.545]],
    land: [[-0.01, -0.01], [1.01, -0.01], [1.01, 1.02], [-0.01, 1.02]],
    boats: [],
    // the plate is mostly covered by element cards: broader strokes here pay for the fine ones on the cards
    alphaMul: { low: 1.5, mid: 1.5, high: 1.5 },
    landMinLayer: 1,
    // the frame spans 96 degrees: keep strokes fine across it and let them grow behind the viewer
    falloff: [0.7, 2.4, 1.4],
    skyLike: (r, g, b, v) => {
      const L = 0.3 * r + 0.59 * g + 0.11 * b;
      // pale blue and white cloud, or a deep blue patch between the clouds
      return v < 0.34 && b >= g - 0.03 && ((L > 0.6 && (b > r + 0.02 || Math.max(r, g, b) - Math.min(r, g, b) < 0.1)) || (L > 0.45 && b > r + 0.18));
    },
    skyClean: 2,
    landCls: () => CLS.TREE,
    // the far bank steps back the higher it rises
    landCard: (u, v, dv) => 1 + 0.55 * Math.min(1, Math.max(0, (dv - 0.03) / 0.27)),
    waterAllBase: true,
    bankAngular: 0.85,
    // the bank round the pond is continued from plate columns whose own pond edge matches the line above
    // (the big tree at u 0.6 stays unique)
    landPool: [[0.75, 0.66], [0.54, 0.36]],
    farPool: [[0.36, 0.54], [0.66, 0.75]],
    farRate: 1,
    backDist: 26,
    // clean sky is only the plate's top band (the left half has no tree reaching into it)
    skyRange: [0.02, 0.52],
    skyTop: { row: [0.07, 0.04], ceil: [0.015, 0.07] },
    skyChroma: 0.08,
  },
  // the art team's layer split (assets/layers/莲花桥*.psd, exported by tools/export_bridge.py)
  layered: {
    base: 'assets/bridge/base.jpg',
    fine: 0.8,
    // how far the eye slides (m): anything buried deeper than that behind a nearer layer is not painted
    hideShift: 1.3,
    // PSD order, bottom to top. z = [distance at the card's left, at its right] in metres; lilies lie on the pond
    cards: [
      { id: 'willow_far_r', kind: 'tree', z: [30, 30], box: [0.8084, 0.0557, 0.9409, 0.4171] },
      { id: 'willow_l', kind: 'tree', z: [17, 16], box: [0.0009, 0.0408, 0.2548, 0.553] },
      { id: 'bush_l', kind: 'tree', z: [3.8, 9], box: [0.0018, 0.0, 0.3195, 0.9878] },
      { id: 'willow_c2', kind: 'tree', z: [20, 20], box: [0.4894, 0.0299, 0.7567, 0.5829] },
      { id: 'willow_r', kind: 'tree', z: [19, 19], box: [0.5337, 0.0082, 0.7285, 0.6386] },
      { id: 'willow_big', kind: 'tree', z: [16, 15], box: [0.1597, 0.0122, 0.4926, 0.5788] },
      { id: 'willow_l2', kind: 'tree', z: [11.5, 11.5], box: [0.2225, 0.3098, 0.3763, 0.6155] },
      { id: 'willow_weep', kind: 'tree', z: [15.5, 15.5], box: [0.3186, 0.0122, 0.5406, 0.5883] },
      { id: 'lily_3', kind: 'lily', box: [0.3998, 0.5326, 0.7281, 0.6793] },
      { id: 'lily_7a', kind: 'lily', box: [0.4201, 0.8465, 0.6043, 0.9946] },
      { id: 'lily_5', kind: 'lily', box: [0.6519, 0.8601, 0.7816, 0.9823] },
      { id: 'lily_4a', kind: 'lily', box: [0.3744, 0.7283, 0.5332, 0.822] },
      { id: 'lily_2', kind: 'lily', box: [0.5891, 0.7758, 0.7073, 0.8465] },
      { id: 'lily_6a', kind: 'lily', box: [0.7082, 0.6957, 0.8555, 0.8111] },
      { id: 'lily_7b', kind: 'lily', box: [0.2696, 0.7717, 0.4538, 0.9198] },
      { id: 'lily_6b', kind: 'lily', box: [0.5005, 0.6712, 0.6214, 0.7649] },
      { id: 'bridge', kind: 'house', z: [14.8, 14.8], refl: 0.35, fine: 0.5, box: [0.4949, 0.2554, 0.8407, 0.534] },
      { id: 'bush_r', kind: 'tree', z: [12, 4], box: [0.7502, 0.2908, 1.0, 0.9891] },
      { id: 'willow_soft', kind: 'tree', z: [13.5, 13.5], box: [0.3463, 0.1698, 0.5125, 0.6005] },
      { id: 'lily_4b', kind: 'lily', box: [0.7632, 0.7989, 0.922, 0.8927] },
      { id: 'bush_lm', kind: 'tree', z: [10, 11], box: [0.0891, 0.1128, 0.2285, 0.5543] },
      { id: 'flowers_3', kind: 'tree', z: [6, 7.5], box: [0.1745, 0.3247, 0.2982, 0.7799] },
      { id: 'flowers_l', kind: 'tree', z: [4, 6], box: [0.0083, 0.284, 0.2364, 0.947] },
      { id: 'flowers_4', kind: 'tree', z: [3.8, 4.4], box: [0.0014, 0.5503, 0.1528, 0.9769] },
      { id: 'flowers_2', kind: 'tree', z: [9, 7.5], box: [0.7507, 0.356, 0.94, 0.6889] },
      { id: 'flowers_1', kind: 'tree', z: [6.5, 5.5], box: [0.8573, 0.4443, 0.9811, 0.7704] },
      { id: 'grass_br', kind: 'tree', z: [4.4, 3.8], box: [0.8883, 0.6957, 1.0, 0.9891] },
    ].map((c) => ({ ...(c.kind === 'lily' ? { fine: 0.55, minLayer: 2 } : { minLayer: 1 }), ...c, src: `assets/bridge/${c.id}.webp` })),
    // the garden round the rest of the pond, from the same elements: [azimuth°, x shore distance, height m, mirrored].
    // The near bushes are mirrored just past the frame's edges so the banks run on without a seam
    extras: [
      { id: 'bush_l', kind: 'tree', at: [[-62, 1.0, 3.0, 1], [-150, 1.0, 4.2, 0]] },
      { id: 'flowers_4', kind: 'tree', at: [[-53, 0.92, 1.6, 1]] },
      { id: 'flowers_l', kind: 'tree', at: [[-80, 1.0, 2.3, 0]] },
      { id: 'bush_lm', kind: 'tree', at: [[-92, 1.0, 3.2, 1]] },
      { id: 'willow_l', kind: 'tree', at: [[-104, 1.1, 7, 1]] },
      { id: 'willow_big', kind: 'tree', at: [[-128, 1.06, 8, 0]] },
      { id: 'willow_weep', kind: 'tree', at: [[-170, 1.05, 10, 1]] },
      { id: 'grass_br', kind: 'tree', at: [[53, 0.92, 1.4, 1]] },
      { id: 'bush_r', kind: 'tree', at: [[62, 1.0, 3.3, 1]] },
      { id: 'flowers_1', kind: 'tree', at: [[78, 1.0, 2.2, 0]] },
      { id: 'flowers_2', kind: 'tree', at: [[92, 1.0, 2.4, 1]] },
      { id: 'willow_r', kind: 'tree', at: [[110, 1.05, 9, 0]] },
      { id: 'willow_far_r', kind: 'tree', at: [[128, 1.1, 9, 1]] },
      { id: 'willow_c2', kind: 'tree', at: [[150, 1.05, 9, 0]] },
      { id: 'willow_soft', kind: 'tree', at: [[172, 1.05, 8, 1]] },
    ].map((e) => ({ spMul: 1.35, minLayer: 1, ...e, src: `assets/bridge/${e.id}.webp` })),
  },
  hotspots: [],
};

export const SCENES = [poppies, regatta, bridge];
