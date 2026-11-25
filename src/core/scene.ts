// 样例赛场生成：纯 TS 软件光栅输出 RGBA。
// 同一套代码在浏览器 Worker 与 Node 自测中运行；识别器不读取这里的真值。

import { Raster } from './raster';
import { Rng, fbm } from './rng';
import { buildPlayers } from './players';
import { findHomography, applyH, invert3, warpRGBA, type Mat3 } from './geometry';
import type { BagTruth, Gcp, LightKind, Preset, Pt, SampleDataset, TerrainKind } from './types';

export const SITE_W = 80;
export const SITE_H = 60;
export const TARGET: Pt = { x: 40, y: 30 };
export const ZONE_R = 20;
export const PPM = 40;

interface Mud {
  x: number;
  y: number;
  rx: number;
  ry: number;
}
interface Features {
  seed: number;
  rowAngle: number;
  rowSpacing: number;
  ridgeX0: number;
  ridgeY0: number;
  ridgeX1: number;
  ridgeY1: number;
  ridgesEverywhere: boolean;
  muds: Mud[];
  ditchBase: number;
  ditchAmp: number;
  ditchFreq: number;
  ditchPhase: number;
  ditchW: number;
}

function makeFeatures(seed: number, terrain: TerrainKind): Features {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const muds: Mud[] = [
    { x: 55 + rng.gauss(1.5), y: 18 + rng.gauss(1), rx: 7.5, ry: 5 },
    { x: 24 + rng.gauss(1), y: 40 + rng.gauss(1), rx: 6, ry: 4 },
  ];
  if (terrain === 'mud') {
    muds.push({ x: 40, y: 16, rx: 12, ry: 7 });
    muds.push({ x: 66, y: 40, rx: 8, ry: 6 });
  }
  if (terrain === 'wet') {
    muds.push({ x: 14, y: 30, rx: 7, ry: 9 });
  }
  return {
    seed,
    rowAngle: 0,
    rowSpacing: 1.0,
    ridgeX0: 4,
    ridgeY0: 3,
    ridgeX1: 36,
    ridgeY1: 28,
    ridgesEverywhere: terrain === 'ridges',
    muds,
    ditchBase: 49 + rng.range(-1, 1),
    ditchAmp: 2.0,
    ditchFreq: 0.11,
    ditchPhase: rng.range(0, 6.28),
    ditchW: terrain === 'wet' ? 4.6 : 3.2,
  };
}

function ditchY(f: Features, x: number): number {
  return f.ditchBase + f.ditchAmp * Math.sin(x * f.ditchFreq + f.ditchPhase);
}

const LIGHTS: Record<
  LightKind,
  { mul: [number, number, number]; add: [number, number, number]; vignette: number; grain: number; shadow: Pt & { a: number } }
> = {
  morning: { mul: [1.09, 0.99, 0.8], add: [7, 3, -7], vignette: 0.22, grain: 9, shadow: { x: -2.3, y: 1.5, a: 0.2 } },
  noon: { mul: [1.02, 1.02, 1.0], add: [2, 2, 0], vignette: 0.1, grain: 6, shadow: { x: 0.28, y: 0.4, a: 0.22 } },
  evening: { mul: [1.14, 0.9, 0.7], add: [11, -1, -11], vignette: 0.34, grain: 11, shadow: { x: 2.5, y: 1.3, a: 0.24 } },
  overcast: { mul: [0.9, 0.95, 1.02], add: [0, 3, 9], vignette: 0.12, grain: 7, shadow: { x: 0.2, y: 0.25, a: 0.1 } },
};

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** 逐像素绘制地表（含作物垄、泥地、水沟） */
function paintGround(r: Raster, ppm: number, seed: number, terrain: TerrainKind) {
  const f = makeFeatures(seed, terrain);
  const w = r.w;
  const h = r.h;
  const d = r.data;
  for (let py = 0; py < h; py++) {
    const y = py / ppm;
    for (let px = 0; px < w; px++) {
      const x = px / ppm;
      const n = fbm(x * 0.075, y * 0.075, seed, 3);
      const n2 = fbm(x * 0.5, y * 0.5, seed + 31, 2);
      let col: [number, number, number];

      if (terrain === 'mud') {
        col = mix([96, 72, 46], [132, 104, 70], n);
        if (n2 > 0.72) col = mix(col, [84, 66, 48], 0.5);
      } else if (terrain === 'wet') {
        col = mix([74, 78, 58], [104, 96, 66], n);
      } else if (terrain === 'ridges') {
        col = mix([96, 78, 52], [120, 100, 66], n);
      } else {
        // mixed：草地 / 作物 / 裸土斑块
        if (n < 0.42) col = mix([82, 118, 56], [104, 140, 66], n2);
        else if (n < 0.68) col = mix([104, 126, 60], [132, 142, 74], n2);
        else col = mix([118, 92, 60], [140, 112, 74], n2);
      }

      // 作物垄 / 条播行
      const inRidgeRect =
        f.ridgesEverywhere ||
        (x > f.ridgeX0 && x < f.ridgeX1 && y > f.ridgeY0 && y < f.ridgeY1);
      if (inRidgeRect) {
        const p = -x * Math.sin(f.rowAngle) + y * Math.cos(f.rowAngle);
        const ridge = 0.5 + 0.5 * Math.cos((2 * Math.PI * p) / f.rowSpacing);
        if (ridge > 0.55) {
          // 垄上庄稼：深绿到亮绿，带植株噪点
          const plant = mix([58, 96, 40], [96, 138, 56], n2);
          col = mix(col, plant, 0.55 + 0.4 * ridge);
        } else if (ridge < 0.2) {
          // 垄沟裸土
          col = mix(col, [86, 64, 40], 0.7);
        }
      }

      // 泥地斑块
      for (const m of f.muds) {
        const e = ((x - m.x) / m.rx) ** 2 + ((y - m.y) / m.ry) ** 2;
        const edge = 1 + (n2 - 0.5) * 0.5;
        if (e < edge) {
          const wet = fbm(x * 0.9, y * 0.9, seed + 77, 2);
          let mc = mix([104, 78, 50], [134, 106, 72], n2);
          if (wet > 0.62) mc = mix(mc, [74, 76, 82], 0.55); // 积水反光
          col = mix(col, mc, e < edge - 0.25 ? 0.92 : 0.6);
        }
      }

      // 水沟
      const dy = Math.abs(y - ditchY(f, x));
      if (dy < f.ditchW / 2 + 1.1) {
        if (dy < f.ditchW / 2) {
          const wn = fbm(x * 0.5, y * 0.9, seed + 123, 2);
          let wc = mix([34, 66, 78], [52, 96, 104], wn);
          if (n2 > 0.86) wc = mix(wc, [190, 214, 220], 0.7); // 水面高光
          col = wc;
        } else {
          col = mix(col, [92, 74, 52], 0.7); // 沟沿湿泥
        }
      }

      const i = (py * w + px) * 4;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = 255;
    }
  }
}

function buildBags(seed: number): BagTruth[] {
  const rng = new Rng(seed ^ 0x51ed270b);
  const bags: BagTruth[] = [];
  const put = (b: Partial<BagTruth> & { bib: number; x: number; y: number }) => {
    const dx = b.x - TARGET.x;
    const dy = b.y - TARGET.y;
    const distance = Math.hypot(dx, dy);
    bags.push({
      surface: 'grass',
      kind: 'normal',
      angle: rng.range(0, Math.PI),
      radius: 0.42,
      ribbonAngle: rng.range(0, Math.PI * 2),
      ribbonLen: rng.range(2.2, 3.6),
      ...b,
      outside: distance > ZONE_R,
    } as BagTruth);
  };

  // —— 刻意考点 ——
  // 两对颜色相近且紧贴
  put({ bib: 7, x: 32.7, y: 23.8, kind: 'pair', pairWith: 23, surface: 'crop', ribbonAngle: 2.4 });
  put({ bib: 23, x: 33.42, y: 24.28, kind: 'pair', pairWith: 7, surface: 'crop', ribbonAngle: 0.6 });
  put({ bib: 12, x: 47.6, y: 35.7, kind: 'pair', pairWith: 31, surface: 'stubble', ribbonAngle: -0.8 });
  put({ bib: 31, x: 48.42, y: 36.2, kind: 'pair', pairWith: 12, surface: 'stubble', ribbonAngle: 2.9 });

  // 两垄之间只露飘带（y 取垄沟中心 k+0.5，飘带顺垄水平）
  put({ bib: 3, x: 12, y: 8.5, kind: 'hidden', surface: 'ridge', ribbonAngle: 0, ribbonLen: 3.4 });
  put({ bib: 19, x: 25, y: 15.5, kind: 'hidden', surface: 'ridge', ribbonAngle: Math.PI, ribbonLen: 3.8 });
  put({ bib: 27, x: 17, y: 23.5, kind: 'hidden', surface: 'ridge', ribbonAngle: 0, ribbonLen: 2.9 });

  // 飘带遮住一半
  put({ bib: 9, x: 44.5, y: 20.5, kind: 'half', surface: 'grass', ribbonAngle: 0.5 });
  put({ bib: 14, x: 36.5, y: 33.5, kind: 'half', surface: 'crop', ribbonAngle: -1.1 });
  put({ bib: 33, x: 52.5, y: 28.5, kind: 'half', surface: 'grass', ribbonAngle: 2.2 });

  // 泥地里
  put({ bib: 2, x: 53.2, y: 17.2, surface: 'mud', ribbonAngle: 1.2 });
  put({ bib: 16, x: 57.4, y: 19.4, surface: 'mud', kind: 'half', ribbonAngle: -0.4 });
  put({ bib: 25, x: 54.2, y: 21.2, surface: 'mud', ribbonAngle: 2.6 });
  put({ bib: 18, x: 23.2, y: 39.6, surface: 'mud' });
  put({ bib: 6, x: 26.4, y: 41.2, surface: 'mud' });

  // 水沟里 / 沟沿
  const f = makeFeatures(seed, 'mixed');
  put({ bib: 11, x: 20, y: ditchY(f, 20), surface: 'water', kind: 'half', ribbonAngle: 0.2 });
  put({ bib: 38, x: 62, y: ditchY(f, 62) + 0.4, surface: 'water', ribbonAngle: -0.6 });

  // 目标区外（记最低分）
  put({ bib: 4, x: 18, y: 12, surface: 'crop' });
  put({ bib: 21, x: 64, y: 12, surface: 'grass' });
  put({ bib: 29, x: 67, y: 45, surface: 'stubble' });
  put({ bib: 36, x: 14, y: 47, surface: 'crop' });
  put({ bib: 40, x: 41, y: 5.2, surface: 'grass' });

  const used = new Set(bags.map((b) => b.bib));
  // 其余 20 个随机均匀落点
  let guard = 0;
  for (let bib = 1; bib <= 40; bib++) {
    if (used.has(bib)) continue;
    let x = 0;
    let y = 0;
    let ok = false;
    while (!ok && guard++ < 4000) {
      const a = rng.range(0, Math.PI * 2);
      const rr = Math.sqrt(rng.next()) * (ZONE_R - 2.5);
      x = TARGET.x + Math.cos(a) * rr;
      y = TARGET.y + Math.sin(a) * rr;
      ok = bags.every((b) => Math.hypot(b.x - x, b.y - y) > 1.9);
    }
    let surface: BagTruth['surface'] = 'grass';
    if (x > f.ridgeX0 && x < f.ridgeX1 && y > f.ridgeY0 && y < f.ridgeY1) surface = 'crop';
    else if (f.muds.some((m) => ((x - m.x) / m.rx) ** 2 + ((y - m.y) / m.ry) ** 2 < 1)) surface = 'mud';
    else if (Math.abs(y - ditchY(f, x)) < f.ditchW / 2) surface = 'water';
    else if (rng.next() < 0.4) surface = 'stubble';
    put({ bib, x, y, surface });
  }
  return bags;
}

function buildGcps(trueH: Mat3): Gcp[] {
  const surveyed: Array<[string, string, number, number]> = [
    ['T', '目标十字', TARGET.x, TARGET.y],
    ['C1', '西北控制点', 5, 5],
    ['C2', '东北控制点', 75, 5],
    ['C3', '正东控制点', 76, 30],
    ['C4', '东南控制点', 75, 55],
    ['C5', '西南控制点', 5, 55],
    ['C6', '正西控制点', 4, 30],
  ];
  return surveyed.map(([id, name, x, y]) => {
    const p = applyH(trueH, x, y);
    return { id, name, x, y, px: p.x, py: p.y };
  });
}

const PRESET_META: Record<string, { title: string; subtitle: string; seed: number }> = {
  mixed_morning: { title: '清晨 · 混合地块', subtitle: '暖光长影 / 庄稼·泥地·水沟', seed: 20261126 },
  ridges_noon: { title: '正午 · 垄沟藏袋', subtitle: '顶光高反差 / 只露飘带专项', seed: 7712031 },
  mud_evening: { title: '傍晚 · 泥地鏖战', subtitle: '金色侧光 / 泥地与积水反光', seed: 31337 },
  wet_morning: { title: '晨雾 · 水沟边', subtitle: '柔和暖光 / 水面镜面高光', seed: 8675309 },
  mixed_overcast: { title: '阴天 · 高密相邻', subtitle: '散射光 / 多组相近色紧贴', seed: 424242 },
  ridges_evening: { title: '傍晚 · 垄沟相近色', subtitle: '长影暗角 / 颜色+编号分离', seed: 90210 },
};

export function presetId(p: Preset): string {
  return `${p.terrain}_${p.light}`;
}

export const listPresets: Array<Preset & { id: string; title: string; subtitle: string }> = [
  { terrain: 'mixed', light: 'morning', id: 'mixed_morning', ...PRESET_META.mixed_morning },
  { terrain: 'ridges', light: 'noon', id: 'ridges_noon', ...PRESET_META.ridges_noon },
  { terrain: 'mud', light: 'evening', id: 'mud_evening', ...PRESET_META.mud_evening },
  { terrain: 'wet', light: 'morning', id: 'wet_morning', ...PRESET_META.wet_morning },
  { terrain: 'mixed', light: 'overcast', id: 'mixed_overcast', ...PRESET_META.mixed_overcast },
  { terrain: 'ridges', light: 'evening', id: 'ridges_evening', ...PRESET_META.ridges_evening },
];

/** 构造一个样例场次（不含像素） */
export function createDataset(preset: Preset): SampleDataset {
  const id = presetId(preset);
  const meta = PRESET_META[id] ?? { title: '自定义样例', subtitle: '', seed: 1234 };
  const seed = meta.seed;
  const rng = new Rng(seed);
  const orthoW = SITE_W * PPM;
  const orthoH = SITE_H * PPM;
  const photoW = 3600;
  const photoH = 2700;

  // 地面米 -> 照片像素：轻微透视 + 旋转感
  const m = 150;
  const quad: Pt[] = [
    { x: m + rng.range(-30, 30), y: m * 0.7 + rng.range(-20, 20) },
    { x: photoW - m + rng.range(-30, 30), y: m * 0.55 + rng.range(-20, 20) },
    { x: photoW - m * 0.8 + rng.range(-20, 20), y: photoH - m * 0.7 + rng.range(-20, 20) },
    { x: m * 0.7 + rng.range(-20, 20), y: photoH - m * 0.8 + rng.range(-20, 20) },
  ];
  const groundCorners: Pt[] = [
    { x: 0, y: 0 },
    { x: SITE_W, y: 0 },
    { x: SITE_W, y: SITE_H },
    { x: 0, y: SITE_H },
  ];
  const trueH = findHomography(groundCorners, quad);
  const players = buildPlayers();
  const bags = buildBags(seed + (preset.terrain === 'ridges' ? 13 : preset.terrain === 'mud' ? 29 : preset.terrain === 'wet' ? 47 : 0));
  const gcps = buildGcps(trueH);

  // 裁判卷尺复核：真值 + 真实量测误差（σ≈0.4cm），记录到厘米
  const refRng = new Rng(seed ^ 0xf00d);
  const referee = bags.map((b) => {
    const truth = Math.hypot(b.x - TARGET.x, b.y - TARGET.y);
    const measured = truth + refRng.gauss(0.004);
    return { bib: b.bib, distanceM: Math.round(measured * 100) / 100 };
  });

  return {
    id,
    title: meta.title,
    subtitle: meta.subtitle,
    terrain: preset.terrain,
    light: preset.light,
    seed,
    siteW: SITE_W,
    siteH: SITE_H,
    target: { ...TARGET },
    zoneRadius: ZONE_R,
    ppm: PPM,
    orthoW,
    orthoH,
    photoW,
    photoH,
    trueH,
    gcps,
    players,
    bags,
    referee,
    refereeNote: '裁判组使用 50m 纤维卷尺 + 激光测距复核，读数记录至厘米；样例中含 ±0.5cm 内的真实量测误差。',
  };
}

// ============================ 渲染 ============================

function m2px(v: number): number {
  return v * PPM;
}

function drawTarget(r: Raster) {
  const cx = m2px(TARGET.x);
  const cy = m2px(TARGET.y);
  const arm = m2px(3.4);
  const wOut = m2px(0.85);
  const wIn = m2px(0.42);
  const dark: [number, number, number] = [30, 34, 40];
  const white: [number, number, number] = [244, 246, 248];
  // 外描边
  r.line(cx - arm, cy, cx + arm, cy, wOut, dark, 0.95);
  r.line(cx, cy - arm, cx, cy + arm, wOut, dark, 0.95);
  r.line(cx - arm, cy, cx + arm, cy, wIn, white, 1);
  r.line(cx, cy - arm, cx, cy + arm, wIn, white, 1);
  r.circle(cx, cy, m2px(0.42), dark, 1);
  r.circle(cx, cy, m2px(0.2), [220, 60, 50], 1);
  r.circle(cx, cy, m2px(0.07), white, 1);
}

function drawGcp(r: Raster, g: Gcp) {
  const cx = m2px(g.x);
  const cy = m2px(g.y);
  const R = m2px(0.62);
  r.circle(cx, cy, R + 2, [255, 255, 255], 0.9);
  r.circle(cx, cy, R, [24, 28, 34], 1);
  // 四象限白
  const q = R * 0.78;
  r.polygon(
    [
      { x: cx, y: cy },
      { x: cx, y: cy - q },
      { x: cx + q, y: cy - q },
      { x: cx + q, y: cy },
    ],
    [245, 247, 250],
    1,
  );
  r.polygon(
    [
      { x: cx, y: cy },
      { x: cx, y: cy + q },
      { x: cx - q, y: cy + q },
      { x: cx - q, y: cy },
    ],
    [245, 247, 250],
    1,
  );
  r.circle(cx, cy, R * 0.22, [220, 60, 50], 1);
  r.circle(cx, cy, R * 0.09, [255, 255, 255], 1);
}

function ribbonPath(b: BagTruth): Pt[] {
  const x0 = b.x;
  const y0 = b.y;
  const dir = b.ribbonAngle;
  const seg = 7;
  const pts: Pt[] = [];
  const wave = 0.22;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const dist = b.ribbonLen * t;
    const lateral = Math.sin(t * Math.PI * 2.2 + b.bib) * wave * t;
    const x = x0 + Math.cos(dir) * dist + Math.cos(dir + Math.PI / 2) * lateral;
    const y = y0 + Math.sin(dir) * dist + Math.sin(dir + Math.PI / 2) * lateral;
    pts.push({ x: m2px(x), y: m2px(y) });
  }
  return pts;
}

function drawRibbon(r: Raster, b: BagTruth, rgb: [number, number, number], wideRoot: boolean) {
  const pts = ribbonPath(b);
  const width = m2px(wideRoot ? 0.3 : 0.2);
  r.polyline(pts, width + 2, [40, 40, 40], 0.25); // 投影边
  r.polyline(pts, width, rgb, 0.98);
  // 中间浅色反光条
  r.polyline(pts, width * 0.32, mix(rgb, [255, 255, 255], 0.55), 0.8);
  // 燕尾
  const tail = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const a = Math.atan2(tail.y - prev.y, tail.x - prev.x);
  const s = width * 0.9;
  r.polygon(
    [
      tail,
      { x: tail.x - s * Math.cos(a - 0.5), y: tail.y - s * Math.sin(a - 0.5) },
      { x: tail.x - s * 1.6 * Math.cos(a), y: tail.y - s * 1.6 * Math.sin(a) },
      { x: tail.x - s * Math.cos(a + 0.5), y: tail.y - s * Math.sin(a + 0.5) },
    ],
    rgb,
    0.98,
  );
}

function drawLabel(r: Raster, bib: number, cx: number, cy: number, scale: number) {
  const text = String(bib);
  const cell = 2 * scale;
  const digitW = 5 * cell;
  const gap = Math.max(1, Math.round(cell));
  const totalW = text.length * digitW + (text.length - 1) * gap;
  const padX = cell * 1.25;
  const padY = cell * 1.05;
  const lw = totalW + padX * 2;
  const lh = 7 * cell + padY * 2;
  // 粗黑描边：强对比，并在紧贴袋子之间隔开相邻白面板，防止连通域合并
  r.roundRect(cx + 1, cy + 1.5, lw + 5, lh + 5, 7, [15, 18, 24], 0.45);
  r.roundRect(cx, cy, lw + 4, lh + 4, 6, [18, 22, 30], 1);
  r.roundRect(cx, cy, lw, lh, 4, [250, 251, 253], 1);
  r.digitText(text, cx, cy + 0.5, cell, [20, 24, 32], 1);
}

function drawBag(r: Raster, b: BagTruth, rgb: [number, number, number], light: LightKind) {
  const cx = m2px(b.x);
  const cy = m2px(b.y);
  const rad = m2px(b.radius);
  const L = LIGHTS[light];

  // 投影
  r.ellipse(cx + m2px(L.shadow.x), cy + m2px(L.shadow.y), rad * 1.05, rad * 0.8, 0.2, [20, 26, 20], L.shadow.a);

  if (b.kind === 'hidden') {
    // 只露出飘带；编号拍面在调色后统一绘制，保证高对比、不被暖光切碎
    drawRibbon(r, b, rgb, true);
    return;
  }

  const ribbonOver = b.kind === 'half' || b.kind === 'pair';
  if (!ribbonOver) drawRibbon(r, b, rgb, false);

  // 袋体：深色边 + 主色 + 明暗
  r.circle(cx, cy, rad + 1.5, mix(rgb, [0, 0, 0], 0.45), 1);
  r.circle(cx, cy, rad, rgb, 1);
  r.circle(cx - rad * 0.18, cy - rad * 0.22, rad * 0.82, mix(rgb, [255, 255, 255], 0.12), 0.55);
  r.ellipse(cx - rad * 0.32, cy - rad * 0.36, rad * 0.28, rad * 0.16, -0.6, [255, 255, 255], 0.35);
  // 织物褶皱
  r.line(cx - rad * 0.5, cy + rad * 0.2, cx + rad * 0.4, cy + rad * 0.42, 1.4, mix(rgb, [0, 0, 0], 0.35), 0.5);
  r.line(cx - rad * 0.3, cy + rad * 0.5, cx + rad * 0.5, cy + rad * 0.1, 1.2, mix(rgb, [0, 0, 0], 0.3), 0.45);

  if (ribbonOver) {
    // 飘带斜搭过袋面，遮住一部分
    const pts = ribbonPath(b);
    r.polyline(pts, m2px(0.34), mix(rgb, [0, 0, 0], 0.3), 0.9);
    r.polyline(pts, m2px(0.26), mix(rgb, [255, 255, 255], 0.08), 1);
    r.polyline(pts, m2px(0.08), mix(rgb, [255, 255, 255], 0.5), 0.7);
  }
}

/** 调色后绘制全部编号牌，保持纯白底深墨字，确保各光线下 OCR 稳定 */
function drawAllLabels(r: Raster, ds: SampleDataset) {
  for (const b of ds.bags) drawLabel(r, b.bib, b.x * ds.ppm, b.y * ds.ppm, 1);
}

/** 渲染基准正射（“真实地面”）RGBA */
export function renderWorld(ds: SampleDataset): Raster {
  const r = new Raster(ds.orthoW, ds.orthoH);
  paintGround(r, ds.ppm, ds.seed, ds.terrain);
  drawTarget(r);
  for (const g of ds.gcps) drawGcp(r, g);
  const colorOf = new Map(ds.players.map((p) => [p.bib, p.rgb]));
  // 先画普通阴影/袋子，特殊紧贴对也都各自绘制
  for (const b of ds.bags) drawBag(r, b, colorOf.get(b.bib) ?? [220, 40, 40], ds.light);

  const L = LIGHTS[ds.light];
  r.grade({ mul: L.mul, add: L.add, vignette: L.vignette, grain: L.grain, seed: ds.seed });
  // 编号牌在调色之后绘制，避免早晚暖光把白底压成易碎的米色
  drawAllLabels(r, ds);
  return r;
}

/** 由基准正射经相机单应生成“航拍原片” */
export function renderAerialPhoto(ds: SampleDataset, world?: Raster): { rgba: Uint8ClampedArray; width: number; height: number } {
  const w = world ?? renderWorld(ds);
  const hpg = invert3(ds.trueH); // 照片像素 -> 地面米
  const ppm = ds.ppm;
  const scaleM: Mat3 = [ppm, 0, 0, 0, ppm, 0, 0, 0, 1];
  const rgba = warpRGBA(w.data, ds.orthoW, ds.orthoH, ds.photoW, ds.photoH, {
    pixelToGround: (px, py) => applyH(hpg, px, py),
    groundToInput: scaleM,
  });
  // 镜头暗角 + 轻微颗粒（在原片上）
  const tmp = new Raster(ds.photoW, ds.photoH, rgba);
  tmp.grade({ mul: [1, 1, 1], vignette: 0.18, grain: 5, seed: ds.seed + 5 });
  return { rgba, width: ds.photoW, height: ds.photoH };
}

/** 生成卡片用的小地形预览（不含标志袋） */
export function renderTerrainThumbnail(preset: Preset, w = 320, h = 240): Uint8ClampedArray {
  const id = presetId(preset);
  const seed = PRESET_META[id]?.seed ?? 999;
  const ppm = w / SITE_W;
  const r = new Raster(w, h);
  // paintGround 用全局 PPM? 它接收 ppm 参数
  paintGroundScaled(r, ppm, seed, preset.terrain);
  const L = LIGHTS[preset.light];
  r.grade({ mul: L.mul, add: L.add, vignette: L.vignette * 0.7, grain: L.grain * 0.5, seed });
  return r.data;
}

// paintGround 内部用传入 ppm，但尺寸按 r.w/h；直接复用即可（y 用 py/ppm 会超出 SITE_H，
// 因此缩略图采用独立 ppm 使 h/ppm ≈ SITE_H）。
function paintGroundScaled(r: Raster, ppm: number, seed: number, terrain: TerrainKind) {
  // 让缩略图纵向也映射 SITE_H
  const ppmY = r.h / SITE_H;
  const f = makeFeatures(seed, terrain);
  const d = r.data;
  for (let py = 0; py < r.h; py++) {
    const y = py / ppmY;
    for (let px = 0; px < r.w; px++) {
      const x = px / ppm;
      const n = fbm(x * 0.075, y * 0.075, seed, 3);
      const n2 = fbm(x * 0.5, y * 0.5, seed + 31, 2);
      let col: [number, number, number] = mix([86, 116, 58], [128, 140, 72], n);
      if (terrain === 'mud') col = mix([96, 72, 46], [132, 104, 70], n);
      if (terrain === 'wet') col = mix([74, 78, 58], [104, 96, 66], n);
      if (terrain === 'ridges') col = mix([96, 78, 52], [120, 100, 66], n);
      const ridge = 0.5 + 0.5 * Math.cos((2 * Math.PI * y) / f.rowSpacing);
      if (f.ridgesEverywhere || (x < f.ridgeX1 && y < f.ridgeY1)) {
        if (ridge > 0.55) col = mix(col, [92, 134, 54], 0.6);
        else if (ridge < 0.2) col = mix(col, [86, 64, 40], 0.7);
      }
      for (const m of f.muds) {
        const e = ((x - m.x) / m.rx) ** 2 + ((y - m.y) / m.ry) ** 2;
        if (e < 1) col = mix(col, [112, 84, 54], 0.8);
      }
      if (Math.abs(y - ditchY(f, x)) < f.ditchW / 2) col = mix([34, 66, 78], [52, 96, 104], n2);
      const i = (py * r.w + px) * 4;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = 255;
    }
  }
}
