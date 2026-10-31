export const CLS = {
  SKY: 0, GRASS: 1, FLOWER: 2, TREE: 3, STATIC: 4, FIGURE: 5, WATER: 6, SAIL: 7,
  PETAL: 8, MOTE: 9, HALO: 10, GLINT: 11,
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
  image: 'assets/regatta/composite.jpg',
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
    alphaMul: { low: 1.1, mid: 1.21, high: 1.21 },
    // the clean plate has no boats: every element comes from its own layer card (see layered)
    boats: [],
    landMinLayer: 1,
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
      { id: 'house_small', kind: 'house', depth: 1.3, fine: 0.28, skirt: { src: 'grove_front', h: 0.17, margin: 0.14, seed: 2 }, box: [0.6129, 0.3527, 0.7146, 0.4978] },
      { id: 'tree', kind: 'tree', hot: 3, depth: 1.18, fine: 0.42, skirt: { src: 'grove_front', h: 0.12, margin: 0.45, seed: 5 }, box: [0.5794, 0.2366, 0.648, 0.5037] },
    ].map((c) => ({ ...c, src: `assets/regatta/${c.id}.webp` })),
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
    ].map((e) => ({ spMul: e.kind === 'tree' ? 1.25 : 1.2, ...e, src: `assets/regatta/${e.id}.webp` })),
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

export const SCENES = [poppies, regatta];
