export const CLS = {
  SKY: 0, GRASS: 1, FLOWER: 2, TREE: 3, STATIC: 4, FIGURE: 5, WATER: 6, SAIL: 7,
  PETAL: 8, MOTE: 9, HALO: 10, GLINT: 11, GULL: 12, HULL: 13,
};

const lerp = (a, b, t) => a + (b - a) * t;
// the water-lily pond is painted from the two panoramas (assets/bridge_pano); ?psd builds it from the PSD's layers
// instead, ?flat from the PSD's finished picture alone, with a still eye
const QS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const PANO = !QS.has('psd') && !QS.has('flat');
const LAYERED = QS.has('psd');

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

/* ============================================================
 *  01  Régates à Argenteuil, c.1872
 * ============================================================ */
const regattaLand = [[0.44, 0.66], [0.452, 0.5], [0.53, 0.42], [0.552, 0.24], [0.6, 0.15], [0.632, 0.25], [0.69, 0.3], [0.78, 0.27], [0.8, 0.28], [0.95, 0.3], [1, 0.32], [1, 0.66]];
const inR = (u, v, u0, v0, u1, v1) => u >= u0 && u <= u1 && v >= v0 && v <= v1;

const regatta = {
  id: 'regatta',
  image: 'assets/paintings/regatta.jpg',
  info: {
    index: '01',
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
    // beyond the frame the colours come from the art team's panorama (tools/make_pano_ext.py), matched to the
    // painting's palette; its own copy of the picture (sails, houses: about -45..60 deg) is skipped
    panoExt: { src: 'assets/regatta/pano_ext.jpg', cls: 'assets/regatta/pano_ext_cls.png', az: [[-180, -172.5], [-30, -45], [30, 60], [180, 187.5]], blend: 15, strength: 0.9, water: 0.5, low: [-24, -40] },
    water: [[0, 0.556], [0.44, 0.557], [0.465, 0.62], [0.5, 0.642], [0.68, 0.64], [1, 0.645]],
    farBank: { top: 0.542, uMax: 0.445 },
    // the plate takes broader strokes so the element cards can be fine within the splat budget
    alphaMul: { low: 1.0, mid: 0.8, high: 0.72 },
    // what is resolved and what stays broad, by view direction [azimuth°, elevation°, radius across°, radius up°,
    // weight] (azimuth 0 straight ahead, positive to the right): the big sail leads, then the other sails, the red
    // house with the tall tree and the broken reflections under them, the whole bank between them (no soft pocket
    // inside it), the sails beyond the frame; sky and open
    // water are left broad (floor)
    focus: {
      foci: [[-9, 5, 11, 10, 1], [-22, 3, 9, 8, 0.85], [-27, 2, 5, 6, 0.7], [20, 3, 11, 7, 0.85], [8, 6, 5, 9, 0.8],
        [16, -9, 16, 7, 0.8], [-12, -5, 14, 4, 0.6], [12, 2, 22, 6, 0.75],
        [-42, 1, 6, 6, 0.5], [-62, 1, 7, 7, 0.5], [-96, 1, 7, 7, 0.5], [-140, 1, 7, 7, 0.45], [172, 1, 7, 7, 0.45], [132, 1, 7, 7, 0.45], [76, 1, 8, 8, 0.5]],
      floor: 0.18, skyMax: 0.3,
      // the foci widened and blurred (degrees) so resolved and broad places melt into each other
      spread: 1.35, blur: 4,
    },
    // value masses of the broad places (steps, how sharp a step is, how far values are drawn to it, share of the
    // mass in their colour), contrast against the surroundings [broad, focus], and each finer pass's share in the
    // broad places
    masses: { steps: 5, edge: 0.25, pull: 0.5, mix: 0.6 },
    contrast: [0.9, 1.1],
    passes: [0.55, 0.25, 0.15],
    // the painted reflections as long level dashes: length and width multiples, from which pass on
    // beyond the frame: greenish or dark sky, grey bank and dark river drawn back to clean colours
    cleanOut: { sky: 0.85, land: 0.6, dark: 0.5 },
    reflDash: { len: [2.4, 3.8], min: 0.62, from: 1 },
    // and traced: each run of one colour in a painted reflection row (rows step px apart, colour tolerance,
    // shortest run in px) is one stroke, thick x step high, over x its length, richer (sat) and further in value from the river (value);
    // the wave marks low in the picture are not reflections (vMax)
    reflRuns: { step: 2, tol: 0.12, min: 5, thick: 2.2, over: 1.25, alpha: 0.82, sat: 1.35, value: 1.2, vMax: 0.86, soft: 0.3 },
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
    // with the plate's focus: each finer pass's share on elements in the broad places
    focusPasses: [0.6, 0.3, 0.2],
    // sail reflections stacked in this many cream bars down their length
    reflBars: 6,
    // broken colour over the finished picture, gathered where the eye is led (minor: share in the broad places)
    // water: how much longer and wider a touch on the river is (long level dashes, not pebbles)
    dabs: { src: 'assets/regatta/composite.jpg', k: 0.5, minor: 0.08, tint: 0.07, sat: 1.12, jitter: 0.6, water: [2.6, 1.0], leaves: 'any', skipRefl: true },
    // PSD order, bottom to top; depth = card distance as a multiple of the shore under it
    cards: [
      { id: 'sail_r', kind: 'sail', hot: 1, fine: 0.36, box: [0.2777, 0.1637, 0.436, 0.6466] },
      { id: 'sail_m', kind: 'sail', fine: 0.34, box: [0.1626, 0.3787, 0.2662, 0.6213] },
      { id: 'sail_s', kind: 'sail', fine: 0.32, box: [0.1209, 0.4836, 0.1549, 0.6213] },
      { id: 'sail_l', kind: 'sail', fine: 0.36, box: [0.0211, 0.2708, 0.1127, 0.6109] },
      { id: 'house_big', kind: 'house', hot: 2, depth: 1.9, fine: 0.24, box: [0.7899, 0.2939, 0.9477, 0.4807] },
      { id: 'grove_back', kind: 'tree', depth: 1.62, fine: 0.46, box: [0.4906, 0.3185, 0.8398, 0.5119] },
      { id: 'grove_front', kind: 'tree', depth: 1.44, fine: 0.42, box: [0.4508, 0.3728, 0.7113, 0.5268] },
      { id: 'house_small', kind: 'house', depth: 1.54, fine: 0.24, box: [0.6129, 0.3527, 0.7146, 0.4978] },
      { id: 'tree', kind: 'tree', hot: 3, depth: 1.5, fine: 0.36, box: [0.5794, 0.2366, 0.648, 0.5037] },
    ].map((c) => ({ ...c, src: `assets/regatta/${c.id}.webp` })),
    // shrubs painted from the front grove, standing just behind it (behind: x the grove's distance) and in front
    // of the tall tree and the small house: they hide those elements' feet, while the grove's own shrubs stay on
    // top (in front of the grove they veiled it in a pale band)
    hedges: [{ src: 'grove_front', box: [0.468, 0.452, 0.742, 0.536], fine: 0.42, seed: 3, behind: 1.025 }],
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

// ?layered: the art team's layer split (assets/layers/莲花桥*.psd, exported by tools/export_bridge.py) as
// separate cards at their own depths
const bridgeLayers = {
    base: 'assets/bridge/base.jpg',
    fine: 0.9,
    // how far the eye slides (m): anything buried deeper than that behind a nearer layer is not painted
    hideShift: 1.3,
    // Monet's broken colour: small touches over every layer, coloured from the finished picture (so they cross
    // the joins between layers as the painting does), nudged warm or cool. k: size relative to the plate's strokes
    // near: the pond below and beside the frame in the same touches (size relative), from nearSrc [u0, u1, v0, v1]
    dabs: { src: 'assets/bridge/composite.jpg', k: 0.36, tint: 0.07, sat: 1.12, near: 2.8, nearSrc: [0.22, 0.8, 0.74, 0.97] },
    // feather (stroke widths): how far a tree's touches thin out past its silhouette
    feather: 3,
    // PSD order, bottom to top. z = [distance at the card's left, at its right] in metres; lilies lie on the pond;
    // crown: how far (canvas heights) an element cut by the frame's top edge grows on above it
    cards: [
      { id: 'willow_far_r', kind: 'tree', z: [30, 30], box: [0.8084, 0.0557, 0.9409, 0.4171] },
      { id: 'willow_l', kind: 'tree', z: [17, 16], box: [0.0009, 0.0408, 0.2548, 0.553] },
      { id: 'bush_l', kind: 'tree', crown: 0.42, z: [3.8, 9], box: [0.0018, 0.0, 0.3195, 0.9878] },
      { id: 'willow_c2', kind: 'tree', z: [20, 20], box: [0.4894, 0.0299, 0.7567, 0.5829] },
      { id: 'willow_r', kind: 'tree', crown: 0.42, z: [19, 19], box: [0.5337, 0.0082, 0.7285, 0.6386] },
      { id: 'willow_big', kind: 'tree', crown: 0.42, z: [16, 15], box: [0.1597, 0.0122, 0.4926, 0.5788] },
      { id: 'willow_l2', kind: 'tree', z: [11.5, 11.5], box: [0.2225, 0.3098, 0.3763, 0.6155] },
      { id: 'willow_weep', kind: 'tree', crown: 0.42, z: [15.5, 15.5], box: [0.3186, 0.0122, 0.5406, 0.5883] },
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
      // tall willows past the frame's sides carry the canopy on round the viewer (the narrow card, far enough
      // round that it never reaches into the frame)
      { id: 'willow_weep', kind: 'tree', at: [[80, 2.4, 13, 1], [-80, 2.4, 13, 0]] },
      { id: 'grass_br', kind: 'tree', at: [[53, 0.92, 1.4, 1]] },
      { id: 'bush_r', kind: 'tree', at: [[62, 1.0, 3.3, 1]] },
      { id: 'flowers_1', kind: 'tree', at: [[78, 1.0, 2.2, 0]] },
      { id: 'flowers_2', kind: 'tree', at: [[92, 1.0, 2.4, 1]] },
      { id: 'willow_r', kind: 'tree', at: [[110, 1.05, 9, 0]] },
      { id: 'willow_far_r', kind: 'tree', at: [[128, 1.1, 9, 1]] },
      { id: 'willow_c2', kind: 'tree', at: [[150, 1.05, 9, 0]] },
      { id: 'willow_soft', kind: 'tree', at: [[172, 1.05, 8, 1]] },
    // refl: the garden's mirror images stay sparse, up close full ones read as smears over the lilies
    ].map((e) => ({ spMul: 1.35, minLayer: 1, refl: 0.1, ...e, src: `assets/bridge/${e.id}.webp` })),
};

/* ============================================================
 *  02  The water-lily pond and the Japanese bridge, Giverny
 * ============================================================ */
const bridgePano = {
  src: 'assets/bridge_pano/sphere.jpg',
  // the panorama is painted close to the bridge: the eye steps back until the bridge spans what it does in the
  // painting (s: how much smaller straight ahead; turn: view azimuth of the bridge, degrees)
  zoom: { s: 2.0, turn: 17 },
  analysisW: { low: 1536, mid: 2048, high: 2048 },
  alphaMul: { low: 1.12, mid: 0.8, high: 0.74 },
  // stroke spacing grows from the front ray towards the back: [from, to (radians), extra]
  falloff: [0.9, 2.6, 0.55],
  // the pond, in degrees: its far edge [azimuth, elevation] and its near edge (-99: no pond / down to the feet).
  // Behind the viewer (azimuth past -115 / 165) the bank comes right down to the eye's feet
  pondTop: [[-180, -99], [-116, -99], [-110, -28], [-100, -18], [-80, -14], [-60, -10], [-40, -8], [40, -8], [60, -9], [80, -9], [100, -10], [150, -10], [160, -12], [166, -99], [180, -99]],
  pondLow: [[-180, -99], [50, -99], [60, -30], [75, -18], [90, -16], [150, -16], [165, -14], [180, -99]],
  // underfoot the pond's edge is a straight line on the ground: [azimuth of the pond side, offset] (as in make_pano.py)
  underfoot: [-32, 0.22],
  // the garden's distance round the pond (m)
  shore: [[-180, 5], [-110, 7], [-80, 7], [-60, 9], [-40, 11], [40, 11], [60, 10], [90, 9], [150, 9], [180, 5]],
  // what is resolved and what stays broad, by view direction: [azimuth°, elevation°, radius across°, radius up°,
  // weight]. The bridge and the bright water under it lead; the lilies before it, a willow and a flower bank to
  // either side, and three places behind the viewer follow; the rest is left broad (floor), the sky most of all
  focus: {
    foci: [[17, 3, 20, 8, 1], [14, -6, 28, 7, 0.85], [6, -17, 30, 9, 0.65], [-38, -2, 16, 14, 0.6], [52, -8, 14, 12, 0.55],
      [-140, -6, 24, 16, 0.6], [130, -6, 22, 16, 0.55], [180, -12, 20, 14, 0.5], [-80, -10, 18, 14, 0.45], [90, -8, 16, 14, 0.45]],
    floor: 0.42, skyMax: 0.4, spread: 1.12, blur: 4,
  },
  // value masses of the broad places: value steps, how sharp a step is, how far values are drawn to it, and how
  // much of the underpainting's colour comes from the mass where nothing matters
  masses: { steps: 5, edge: 0.25, pull: 0.3, mix: 0.3 },
  // contrast against the surroundings [broad, focus], and how far broad distant garden leans to the air's colour
  contrast: [0.95, 1.06], air: 0.08,
  // the headset's foveated rendering softens what the eye is not on: the baked soft edges stay light
  softMul: 0.45,
  // the passes, coarse to fine: size k (relative), stroke shape, and when a stroke is laid (base, + importance,
  // + detail at the pass's scale; from..: the importance over which a pass comes in fully, low: its share below)
  passes: [
    { k: 3.6, maj: [1.3, 2.2], min: [0.6, 0.85] },
    { k: 1.9, maj: [1.2, 2.1], min: [0.5, 0.75], base: 0.3, imp: 0.7, gain: 4 },
    { k: 1.0, maj: [1.1, 2.0], min: [0.45, 0.7], base: 0.35, gain: 8, from: 0.1, low: 0.25 },
    { k: 0.6, maj: [1.0, 1.8], min: [0.42, 0.66], p: 0.5, from: 0.2 },
  ],
  // pond detail (at the third pass's scale) above which a touch on the water is a lily pad or flower
  lily: 0.15,
  // lily pads as touches this many spacings wide (smaller ones read as specks)
  lilySize: 1.7,
  // the open pond: colour smeared level along the rows (radius px, share); lily pads only at the third pass's scale
  pondCalm: { r: 12, mix: 0.45 },
  // broken colour: size relative to the plate's strokes, share laid, share left in the broad places, warm/cool
  // tint, saturation, how far a touch may borrow its colour (touch sizes), how much of it falls on the sky
  dabs: { k: 0.42, p: 0.12, minor: 0.04, tint: 0.06, sat: 1.1, jitter: 0.5, sky: 0.1, water: 0 },
  // hanging willows as whole strands (tree strokes whose brushwork runs up and down from elevation low°, coh: how
  // steadily, mask: share of such brushwork around): seed spacing k, strokes per strand, how many strands cover
  // a place, step between strokes and overlap (spacings), width, light/dark spread between strands; under: how
  // much longer and narrower the broad passes' strokes hang there
  willow: { low: -12, coh: 0.3, mask: 0.45, k: 0.75, len: [8, 18], cover: 1.6, step: 0.9, over: 1.5, width: 0.2, tone: 0.3, under: [1.9, 0.55] },
};

const bridge = {
  id: 'bridge',
  image: 'assets/bridge/composite.jpg',
  info: {
    index: '02',
    titleCn: '睡莲池与日本桥',
    titleFr: 'Le Bassin aux nymphéas, Giverny',
    meta: '吉维尼 · 莫奈的水上花园<br>可切换三种色调',
    desc: '1893 年，莫奈在吉维尼的家旁引水造池，种下睡莲，架起一座日本式的拱桥。此后二十多年，他一遍遍画这同一座桥、同一池水：清晨与黄昏，盛夏与深秋，光一变，整座花园就换了一种颜色。',
    thumbLabel: '睡莲池与日本桥',
  },
  // no hotspots or cards here: the interaction is the colour mood
  hint: '拖动环顾四周 · 右下角切换色调',
  // no parallax: the eye stays at the painting's viewpoint (no dolly, no sway), so straight ahead is the picture
  // itself (?flat only; the layered pond keeps the moving eye its cards were made for)
  cam: PANO ? { f: 0.45, h: 1.6, vH: 0.42, maxD: 160, dolly: 0, sky: 420, parallax: 0, still: true }
    : LAYERED ? { f: 0.45, h: 1.6, vH: 0.42, maxD: 120, dolly: 1.0, sky: 420, parallax: 2.0 } : { f: 0.45, h: 1.6, vH: 0.42, maxD: 120, dolly: 0, sky: 420, parallax: 0, still: true },
  grade: { gamma: 0.98, expo: 1.03, wb: [1, 1, 1.01], sat: 1.04, lift: 0.08, contrast: 1.03, clean: 0 },
  wind: { dir: [1, 0.3], base: 0.5 },
  // the gallery picture is the first mood; the others are learnt from reference paintings of the same motif.
  // 盛夏 also has the art team's own warm green pond (the green PSD's plate), taken as it is
  // (the PSD's green pond only fits the PSD's own plate)
  tones: [
    { cn: '晴光', en: 'Clear Light', swatch: ['#9cc6e8', '#e9d36a', '#9bbf5a'] },
    { cn: '盛夏', en: 'Green Harmony', ref: 'assets/paintings/bridge_green.jpg', keepLight: 0.65, expo: 1.05, gamma: 0.94, ...(PANO ? {} : { water: 'assets/bridge/base_green.jpg', waterArt: 'assets/bridge/composite_green.jpg', waterMix: 0.6 }), swatch: ['#2f6b3c', '#7fa860', '#cfe0c6'] },
    { cn: '秋暮', en: 'Autumn Glow', ref: 'assets/paintings/bridge_autumn.jpg', expo: 1.12, swatch: ['#b8341c', '#e98a2b', '#f5c45a'] },
  ],
  ...(PANO ? { pano: bridgePano } : {}),
  unified: PANO ? null : {
    // the visible edge of the pond: near banks reach the bottom corners, the far edge runs under the bridge
    // (this shapes the garden beyond the frame). The layered plate's pond spans the whole width (plateWater),
    // its near banks are element cards
    water: [[0, 1.02], [0.12, 1.0], [0.16, 0.9], [0.2, 0.8], [0.25, 0.72], [0.29, 0.65], [0.32, 0.6], [0.36, 0.585], [0.5, 0.565], [0.75, 0.56], [0.78, 0.6], [0.84, 0.68], [0.89, 0.76], [0.92, 0.86], [0.94, 0.97], [1, 1.02]],
    ...(LAYERED ? { plateWater: [[0, 0.595], [0.1, 0.59], [0.2, 0.575], [0.45, 0.565], [0.75, 0.56], [0.85, 0.55], [1, 0.545]] } : {}),
    land: [[-0.01, -0.01], [1.01, -0.01], [1.01, 1.02], [-0.01, 1.02]],
    boats: [],
    // layered: the plate is mostly covered by element cards, broader strokes here pay for the fine ones on them
    alphaMul: LAYERED ? { low: 1.7, mid: 1.7, high: 1.7 } : { low: 1.25, mid: 1.15, high: 1.0 },
    landMinLayer: 1,
    // the frame spans 96 degrees: keep strokes fine across it and let them grow behind the viewer
    falloff: LAYERED ? [0.7, 2.4, 1.4] : [0.9, 2.6, 1.3],
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
    bankAngular: LAYERED ? 0.85 : 0.3,
    // the bank round the pond is continued from plate columns whose own pond edge matches the line above
    // (the big tree at u 0.6 stays unique)
    // unlayered, each side first runs on with a little of its own edge (no element cards stand there), then
    // with willow columns whose canopy reaches the top (others leave sky gaps that read as a row of poplars;
    // the bridge's columns would repeat ghost bridges)
    landPool: LAYERED ? [[0.75, 0.66], [0.54, 0.36]] : [[1.0, 0.975], [0.89, 0.85], [0.48, 0.19]],
    farPool: LAYERED ? [[0.36, 0.54], [0.66, 0.75]] : [[0.0, 0.05], [0.19, 0.48]],
    // unlayered, the willows cut by the frame's top edge grow on above it: [min, max, variation]
    ...(LAYERED ? {} : { crown: [0.05, 0.16, 5] }),
    // unlayered (still eye): the picture runs on past its sides and bottom as its own mirror image (fold, canvas
    // widths), and the garden beyond stands back at sideDist instead of right beside the near bushes
    // (about foldEdge: inside the canvas's pale border)
    ...(LAYERED ? {} : { fold: 0.3, foldEdge: [0.004, 0.996, 0.985], sideDist: 18, bankCrown: false }),
    farRate: 1,
    backDist: 26,
    // clean sky is only the plate's top band (the left half has no tree reaching into it)
    skyRange: LAYERED ? [0.02, 0.52] : [0.56, 0.98],
    // layered: the plate's sky reaches down to ~0.2 with blue and white cloud, the sky overhead takes all of it
    skyTop: { row: [0.07, 0.04], ceil: LAYERED ? [0.01, 0.2] : [0.015, 0.07] },
    skyChroma: 0.08,
  },
  // default: the finished picture as one plate, with the pointillist touches over it (no element cards)
  layered: PANO ? null : LAYERED ? bridgeLayers : {
    base: 'assets/bridge/composite.jpg',
    fine: 1,
    // jitter: how far (dab sizes) a touch may borrow its colour; one plate has no layers to keep it on the bridge
    dabs: { src: 'assets/bridge/composite.jpg', k: 0.62, tint: 0.07, sat: 1.12, jitter: 0.5, fold: 0.3, foldEdge: [0.004, 0.996, 0.985] },
    cards: [],
    extras: [],
  },
  hotspots: [],
};

export const SCENES = [regatta, bridge];
