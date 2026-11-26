import type { ControlPoint, BagTruth, Pt, Raster, RGB, SampleScenario } from '../lib/types';
import { ROSTER } from '../lib/roster';
import { mulberry32, hash2, clamp } from '../lib/rng';
import {
  createRaster,
  fillCircle,
  fillRect,
  strokeLine,
  strokeTapered,
  drawCodeLabel,
  warpResample,
} from '../lib/raster';
import { solveHomography, invert3, applyH, type Mat3 } from '../lib/geometry';

// ---- 成像 / 坐标常量（校验脚本与 App 共用） ----
export const PPM = 70; // 像素 / 米
export const ORTHO_W = 3200;
export const ORTHO_H = 2400;
export const NADIR_W = 3600;
export const NADIR_H = 2800;
export const ORIGIN_U = NADIR_W / 2 - 0.5;
export const ORIGIN_V = NADIR_H / 2 - 0.5;
export const OUT_ORIGIN_U = ORTHO_W / 2 - 0.5;
export const OUT_ORIGIN_V = ORTHO_H / 2 - 0.5;
export const ZONE_RADIUS_M = 15;
export const LABEL_SCALE = 3;
export const BAG_R = 19;

export type VariantId = 'morning-ridges' | 'midday-mudwater' | 'dusk-nearcolors';

export interface Placement {
  code: string;
  gx: number;
  gy: number;
  kind: BagTruth['kind'];
  pairId?: string;
  ribbonAngle: number;
  ribbonLen: number;
  halfCover?: boolean;
  onFurrow?: boolean;
}

function groundToNadir(gx: number, gy: number): Pt {
  return { x: ORIGIN_U + gx * PPM, y: ORIGIN_V + gy * PPM };
}

// 平滑值噪声
function smoothNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

interface VariantStyle {
  seed: number;
  rowAngle: number; // 垄方向（弧度）
  rowSpacingPx: number;
  ridge: RGB;
  ridgeDark: RGB;
  furrow: RGB;
  soil: RGB;
  light: { mul: RGB; add: number; vignette: number; grain: number };
  shadow: { dx: number; dy: number; len: number; alpha: number };
  title: string;
  terrain: string;
  lightName: string;
  description: string;
}

const VARIANTS: Record<VariantId, VariantStyle> = {
  'morning-ridges': {
    seed: 101,
    rowAngle: Math.PI / 2, // 竖直垄（沿 y）
    rowSpacingPx: 58,
    ridge: [74, 122, 48],
    ridgeDark: [58, 98, 38],
    furrow: [122, 92, 58],
    soil: [110, 84, 54],
    light: { mul: [1.07, 1.0, 0.86], add: 6, vignette: 0.18, grain: 12 },
    shadow: { dx: 1, dy: 0.32, len: 2.6, alpha: 0.28 },
    title: '清晨玉米垄 · 东侧斜光',
    terrain: '玉米垄 / 褐色垄沟',
    lightName: '清晨低角度暖光',
    description: '竖直玉米垄与垄沟，3 个袋子完全被庄稼遮住、只留飘带；东侧低太阳拉出长影。',
  },
  'midday-mudwater': {
    seed: 202,
    rowAngle: 0.06,
    rowSpacingPx: 64,
    ridge: [112, 138, 62],
    ridgeDark: [92, 116, 48],
    furrow: [140, 118, 82],
    soil: [128, 102, 70],
    light: { mul: [1.0, 1.0, 1.0], add: 10, vignette: 0.1, grain: 10 },
    shadow: { dx: 0.35, dy: 0.5, len: 1.1, alpha: 0.22 },
    title: '正午混作田 · 泥地水沟',
    terrain: '泥地 / 水沟 / 短茬田',
    lightName: '正午顶光中性',
    description: '斑块泥地与斜穿水沟，袋子落在湿泥、水边和短茬地里，考验背景颜色干扰。',
  },
  'dusk-nearcolors': {
    seed: 303,
    rowAngle: -0.62,
    rowSpacingPx: 54,
    ridge: [96, 110, 52],
    ridgeDark: [78, 92, 42],
    furrow: [112, 84, 52],
    soil: [96, 74, 48],
    light: { mul: [1.12, 0.92, 0.7], add: 2, vignette: 0.3, grain: 14 },
    shadow: { dx: -0.8, dy: 0.55, len: 3.1, alpha: 0.34 },
    title: '傍晚葡萄园 · 金色暗光',
    terrain: '斜垄葡萄园 / 干沟',
    lightName: '傍晚金色逆光',
    description: '偏暗暖调斜垄，安排三对颜色极近的袋子紧紧相邻，必须靠编号 05/06、17/18、29/30 分开。',
  },
};

// 泥地与水沟的固定地面区域（米），保证有袋子落在其中
const MUD = { gx: 10.5, gy: -8.5, rx: 5.2, ry: 3.4 };
const DITCH = { ax: -22, ay: 11.5, bx: 22, by: 6.5, widthM: 1.7 };

/** 生成 40 个落点（含全部特殊工况），并按垄向把 ribbon-only 袋吸入垄沟 */
function buildLayout(style: VariantStyle): Placement[] {
  const rnd = mulberry32(style.seed + 7);
  const list: Placement[] = [];
  const used = new Set<string>();
  const push = (p: Placement) => {
    list.push(p);
    used.add(p.code);
  };

  const angleFor = () => rnd() * Math.PI * 2;

  // 三对近色相邻袋
  const pairs: Array<[string, string, number, number, string]> = [
    ['05', '06', -6.5, -4.5, 'p1'],
    ['17', '18', 7.5, 5.5, 'p2'],
    ['29', '30', -9.5, 7.5, 'p3'],
  ];
  for (const [a, b, cx, cy, pid] of pairs) {
    const ang = rnd() * Math.PI;
    const sep = 0.82;
    const dx = Math.cos(ang) * sep;
    const dy = Math.sin(ang) * sep;
    push({ code: a, gx: cx - dx / 2, gy: cy - dy / 2, kind: 'adjacent-pair', pairId: pid, ribbonAngle: angleFor(), ribbonLen: 1.5 });
    push({ code: b, gx: cx + dx / 2, gy: cy + dy / 2, kind: 'adjacent-pair', pairId: pid, ribbonAngle: angleFor(), ribbonLen: 1.4 });
  }

  // 只露飘带的 3 袋（颜色各自独特），先给位置，随后吸附到垄沟
  const ribbonOnlyCodes = ['03', '11', '24'];
  const ribbonSeeds: Array<[number, number]> = [[-14, -9], [13, 11], [-2, 13.5]];
  ribbonOnlyCodes.forEach((code, i) => {
    let [gx, gy] = ribbonSeeds[i];
    // 吸附到最近垄沟：把垂直于垄方向的坐标对齐到 spacing 网格中心
    const ca = Math.cos(style.rowAngle);
    const sa = Math.sin(style.rowAngle);
    // 垄方向单位向量 (ca,sa)，法向 (-sa,ca)
    const along = gx * ca + gy * sa;
    const normal = -gx * sa + gy * ca;
    const spacingM = style.rowSpacingPx / PPM;
    const furrowNormal = Math.round(normal / spacingM) * spacingM + spacingM * 0.5;
    gx = along * ca - furrowNormal * sa;
    gy = along * sa + furrowNormal * ca;
    push({ code, gx, gy, kind: 'ribbon-only', ribbonAngle: style.rowAngle + (rnd() - 0.5) * 0.25, ribbonLen: 1.7 + rnd() * 0.5, onFurrow: true });
  });

  // 半遮袋
  (['01', '15', '23', '33', '40'] as const).forEach((code) => {
    push({ code, gx: 0, gy: 0, kind: 'half-covered', halfCover: true, ribbonAngle: angleFor(), ribbonLen: 1.3 + rnd() * 0.5 });
  });

  // 区外袋
  const outsideCodes = ['08', '19', '26', '31', '38', '39'];
  outsideCodes.forEach((code, i) => {
    const ang = (i / outsideCodes.length) * Math.PI * 2 + 0.35;
    const rad = ZONE_RADIUS_M + 0.8 + rnd() * 4.5;
    let gx = Math.cos(ang) * rad;
    let gy = Math.sin(ang) * rad * 0.72;
    gx = clamp(gx, -22.5, 22.5);
    gy = clamp(gy, -16.2, 16.2);
    push({ code, gx, gy, kind: 'outside', ribbonAngle: angleFor(), ribbonLen: 1.2 + rnd() * 0.6 });
  });

  // 泥地 / 水沟袋
  push({ code: '10', gx: MUD.gx + 0.6, gy: MUD.gy - 0.4, kind: 'normal', ribbonAngle: 2.4, ribbonLen: 1.3 });
  push({ code: '25', gx: MUD.gx - 1.4, gy: MUD.gy + 0.9, kind: 'normal', ribbonAngle: -0.6, ribbonLen: 1.5 });
  // 水沟：取中线上两点
  const ditchT = [0.32, 0.68];
  ditchT.forEach((t, i) => {
    const gx = DITCH.ax + (DITCH.bx - DITCH.ax) * t;
    const gy = DITCH.ay + (DITCH.by - DITCH.ay) * t + (i === 0 ? -0.2 : 0.3);
    push({ code: i === 0 ? '14' : '32', gx, gy, kind: 'normal', ribbonAngle: 0.2, ribbonLen: 1.6 });
  });

  // 其余普通袋随机撒布，保持间距
  for (const c of ROSTER) {
    if (used.has(c.code)) continue;
    let gx = 0;
    let gy = 0;
    let ok = false;
    for (let attempt = 0; attempt < 400 && !ok; attempt++) {
      gx = (rnd() * 2 - 1) * 21;
      gy = (rnd() * 2 - 1) * 15.5;
      // 避开中心十字 2.2m
      if (Math.hypot(gx, gy) < 2.6) continue;
      ok = list.every((p) => Math.hypot(p.gx - gx, p.gy - gy) > 2.1);
    }
    push({ code: c.code, gx, gy, kind: 'normal', ribbonAngle: angleFor(), ribbonLen: 0.9 + rnd() * 0.9 });
  }

  // 给半遮袋分配不与中心冲突的位置
  for (const p of list) {
    if (p.kind === 'half-covered' && p.gx === 0 && p.gy === 0) {
      for (let attempt = 0; attempt < 400; attempt++) {
        const gx = (rnd() * 2 - 1) * 19;
        const gy = (rnd() * 2 - 1) * 14;
        if (Math.hypot(gx, gy) < 3) continue;
        if (list.every((q) => q === p || Math.hypot(q.gx - gx, q.gy - gy) > 2.2)) {
          p.gx = gx;
          p.gy = gy;
          break;
        }
      }
    }
  }

  return list;
}

function drawTerrain(r: Raster, style: VariantStyle): void {
  const W = r.width;
  const H = r.height;
  // 基础土壤
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = smoothNoise(x / 220, y / 220, style.seed) * 0.5 + smoothNoise(x / 60, y / 60, style.seed + 5) * 0.5;
      const shade = 0.82 + n * 0.36;
      const i = (y * W + x) * 4;
      r.data[i] = clamp(style.soil[0] * shade, 0, 255);
      r.data[i + 1] = clamp(style.soil[1] * shade, 0, 255);
      r.data[i + 2] = clamp(style.soil[2] * shade, 0, 255);
      r.data[i + 3] = 255;
    }
  }

  // 垄：沿 rowAngle 方向的条带
  const ca = Math.cos(style.rowAngle);
  const sa = Math.sin(style.rowAngle);
  const sp = style.rowSpacingPx;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const normal = -x * sa + y * ca;
      const m = ((normal % sp) + sp) % sp;
      const furrowW = sp * 0.34;
      let col: RGB | null = null;
      if (m < furrowW || m > sp - furrowW * 0.4) {
        col = style.furrow;
      } else if (m < furrowW + 5) {
        col = style.ridgeDark;
      } else if (m > sp - furrowW * 0.4 - 5) {
        col = style.ridgeDark;
      } else {
        const n = hash2(x >> 2, y >> 2, style.seed + 9) * 0.25;
        col = [
          clamp(style.ridge[0] * (0.85 + n), 0, 255),
          clamp(style.ridge[1] * (0.85 + n), 0, 255),
          clamp(style.ridge[2] * (0.85 + n), 0, 255),
        ];
      }
      if (col) {
        fillRect(r, x, y, x + 2, y + 2, col, 0.85);
      }
    }
  }

  // 泥地斑块
  const mudC = groundToNadir(MUD.gx, MUD.gy);
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * Math.PI * 2;
    const rr = 0.7 + hash2(k, 3, style.seed) * 0.5;
    fillCircle(
      r,
      mudC.x + Math.cos(a) * MUD.rx * PPM * 0.5 * rr,
      mudC.y + Math.sin(a) * MUD.ry * PPM * 0.5 * rr,
      MUD.rx * PPM * (0.5 + hash2(k, 7, style.seed) * 0.35),
      [96 + (k % 5) * 6, 72 + (k % 4) * 5, 48 + (k % 3) * 4],
      0.9,
    );
  }
  fillCircle(r, mudC.x, mudC.y, MUD.rx * PPM * 0.62, [84, 62, 40], 0.55);
  // 湿泥反光
  for (let k = 0; k < 14; k++) {
    const hx = mudC.x + (hash2(k, 11, style.seed) - 0.5) * MUD.rx * PPM * 1.1;
    const hy = mudC.y + (hash2(k, 13, style.seed) - 0.5) * MUD.ry * PPM * 1.1;
    fillCircle(r, hx, hy, 6 + hash2(k, 17, style.seed) * 14, [150, 128, 96], 0.25);
  }

  // 水沟（岸 + 水体 + 反光）
  const d0 = groundToNadir(DITCH.ax, DITCH.ay);
  const d1 = groundToNadir(DITCH.bx, DITCH.by);
  const dw = DITCH.widthM * PPM;
  strokeLine(r, d0.x, d0.y, d1.x, d1.y, dw + 16, [74, 66, 48], 0.95); // 岸泥
  strokeLine(r, d0.x, d0.y, d1.x, d1.y, dw + 6, [58, 74, 78], 1); // 深水边
  strokeLine(r, d0.x, d0.y, d1.x, d1.y, dw, [52, 92, 110], 1); // 水
  for (let t = 0.08; t < 0.95; t += 0.07) {
    const x = d0.x + (d1.x - d0.x) * t;
    const y = d0.y + (d1.y - d0.y) * t;
    strokeLine(r, x - 18, y - 3, x + 22, y + 2, 3, [190, 214, 220], 0.4);
  }
}

function drawTargetAndControls(r: Raster, cps: ControlPoint[]): void {
  const c = groundToNadir(0, 0);
  // 目标十字：白底黑芯大十字 + 圆环
  strokeLine(r, c.x - 70, c.y, c.x + 70, c.y, 16, [245, 245, 245], 0.95);
  strokeLine(r, c.x, c.y - 70, c.x, c.y + 70, 16, [245, 245, 245], 0.95);
  strokeLine(r, c.x - 70, c.y, c.x + 70, c.y, 7, [20, 24, 28], 1);
  strokeLine(r, c.x, c.y - 70, c.x, c.y + 70, 7, [20, 24, 28], 1);
  fillCircle(r, c.x, c.y, 12, [20, 24, 28], 1);
  fillCircle(r, c.x, c.y, 5, [235, 235, 235], 1);

  // 控制点：黑白棋盘靶 + 橙色外圈
  for (const cp of cps) {
    const p = groundToNadir(cp.gx, cp.gy);
    fillCircle(r, p.x, p.y, 30, [255, 138, 0], 1);
    fillCircle(r, p.x, p.y, 25, [250, 250, 250], 1);
    const s = 11;
    fillRect(r, p.x - 22, p.y - 22, p.x, p.y, [20, 20, 20], 1);
    fillRect(r, p.x, p.y, p.x + 22, p.y + 22, [20, 20, 20], 1);
    void s;
    // 中心小十字
    strokeLine(r, p.x - 26, p.y, p.x + 26, p.y, 3, [255, 138, 0], 1);
    strokeLine(r, p.x, p.y - 26, p.x, p.y + 26, 3, [255, 138, 0], 1);
  }
}

function drawBag(r: Raster, p: Placement, color: RGB, style: VariantStyle, rnd: () => number): void {
  const c = groundToNadir(p.gx, p.gy);
  const rad = BAG_R;

  // 投影
  const sx = style.shadow.dx * style.shadow.len * 12;
  const sy = style.shadow.dy * style.shadow.len * 12;
  strokeLine(r, c.x + sx * 0.3, c.y + sy * 0.3, c.x + sx, c.y + sy, rad * 1.5, [20, 26, 18], style.shadow.alpha * 0.5);
  fillCircle(r, c.x + sx * 0.5, c.y + sy * 0.5, rad * 1.05, [20, 26, 18], style.shadow.alpha);

  const ribbonColor: RGB = [
    clamp(color[0] + 25, 0, 255),
    clamp(color[1] + 25, 0, 255),
    clamp(color[2] + 25, 0, 255),
  ];

  // 飘带折线路径
  const lenPx = p.ribbonLen * PPM;
  const a = p.ribbonAngle;
  const pts: Pt[] = [{ x: c.x, y: c.y }];
  const segs = 6;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const wig = Math.sin(t * 7 + rnd() * 2) * 10 * t;
    pts.push({
      x: c.x + Math.cos(a) * lenPx * t + Math.cos(a + Math.PI / 2) * wig,
      y: c.y + Math.sin(a) * lenPx * t + Math.sin(a + Math.PI / 2) * wig,
    });
  }

  if (p.kind === 'ribbon-only') {
    // 只画飘带：锚点端最宽（=袋中心），末端尖并分叉
    strokeTapered(r, pts, (t) => 12 * (1 - t) + 2.5, [color[0] * 0.7 | 0, color[1] * 0.7 | 0, color[2] * 0.7 | 0], 1);
    strokeTapered(r, pts, (t) => 8 * (1 - t) + 1.5, ribbonColor, 0.95);
    const tip = pts[pts.length - 1];
    strokeLine(r, tip.x, tip.y, tip.x + Math.cos(a + 0.5) * 16, tip.y + Math.sin(a + 0.5) * 16, 3, ribbonColor, 1);
    strokeLine(r, tip.x, tip.y, tip.x + Math.cos(a - 0.5) * 16, tip.y + Math.sin(a - 0.5) * 16, 3, ribbonColor, 1);
    // 锚点加固套（略深的宽段），其中点即袋中心
    strokeLine(r, c.x - Math.cos(a) * 2, c.y - Math.sin(a) * 2, c.x + Math.cos(a) * 12, c.y + Math.sin(a) * 12, 13, [color[0] * 0.6 | 0, color[1] * 0.6 | 0, color[2] * 0.6 | 0], 0.9);
    return;
  }

  // 袋体
  fillCircle(r, c.x, c.y, rad + 2, [color[0] * 0.55 | 0, color[1] * 0.55 | 0, color[2] * 0.55 | 0], 1);
  fillCircle(r, c.x, c.y, rad, color, 1);
  fillCircle(r, c.x - rad * 0.3, c.y - rad * 0.35, rad * 0.45, [255, 255, 255], 0.22);
  // 袋口结
  fillCircle(r, c.x, c.y - rad * 0.9, 5, [color[0] * 0.6 | 0, color[1] * 0.6 | 0, color[2] * 0.6 | 0], 1);

  if (p.halfCover) {
    // 飘带斜搭过半个袋面
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    strokeLine(r, c.x - ca * rad * 1.4, c.y - sa * rad * 1.4, c.x + ca * rad * 1.4, c.y + sa * rad * 1.4, rad * 1.15, ribbonColor, 0.96);
  } else {
    // 飘带从袋下延伸
    strokeTapered(r, pts, (t) => 9 * (1 - t) + 2, [color[0] * 0.7 | 0, color[1] * 0.7 | 0, color[2] * 0.7 | 0], 1);
    strokeTapered(r, pts, (t) => 6 * (1 - t) + 1.5, ribbonColor, 0.95);
  }
  // 编号牌不在此绘制：由 generateScenario 在所有袋子/飘带之后统一最上层绘制，
  // 避免相邻选手的飘带盖住号码。
}

function applyLighting(r: Raster, style: VariantStyle): void {
  const d = r.data;
  const { mul, add, vignette, grain } = style.light;
  const cx = r.width / 2;
  const cy = r.height / 2;
  const maxD = Math.hypot(cx, cy);
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const i = (y * r.width + x) * 4;
      const vig = 1 - vignette * Math.pow(Math.hypot(x - cx, y - cy) / maxD, 2.2);
      const n = (hash2(x, y, style.seed + 99) - 0.5) * grain;
      d[i] = clamp((d[i] * mul[0] + add + n) * vig, 0, 255);
      d[i + 1] = clamp((d[i + 1] * mul[1] + add + n) * vig, 0, 255);
      d[i + 2] = clamp((d[i + 2] * mul[2] + add + n) * vig, 0, 255);
    }
  }
}

/** 地面(米)->航拍原片像素 的透视矩阵 */
function buildGroundToRaw(style: VariantStyle): Mat3 {
  const gxMax = NADIR_W / PPM / 2;
  const gyMax = NADIR_H / PPM / 2;
  const groundCorners: Pt[] = [
    { x: -gxMax, y: -gyMax },
    { x: gxMax, y: -gyMax },
    { x: gxMax, y: gyMax },
    { x: -gxMax, y: gyMax },
  ];
  // 轻微透视 + 越界外扩，保证原片每个像素都能采到天底底图
  const W = 3200;
  const H = 2400;
  const rawCorners: Pt[] = [
    { x: -150 + (style.seed % 40), y: -110 },
    { x: W + 120, y: -80 + (style.seed % 30) },
    { x: W + 90, y: H + 130 },
    { x: -110, y: H + 100 },
  ];
  return solveHomography(groundCorners, rawCorners);
}

const CP_GROUND: Array<{ id: string; name: string; gx: number; gy: number }> = [
  { id: 'CP1', name: '西北控制点', gx: -18, gy: -13 },
  { id: 'CP2', name: '正北控制点', gx: 0, gy: -15.5 },
  { id: 'CP3', name: '东北控制点', gx: 18, gy: -13 },
  { id: 'CP4', name: '西南控制点', gx: -18, gy: 13 },
  { id: 'CP5', name: '正南控制点', gx: 0, gy: 15.5 },
  { id: 'CP6', name: '东南控制点', gx: 18, gy: 13 },
];

export function generateScenario(id: VariantId): SampleScenario {
  const style = VARIANTS[id];
  const rnd = mulberry32(style.seed + 999);
  const layout = buildLayout(style);

  const nadir = createRaster(NADIR_W, NADIR_H);
  drawTerrain(nadir, style);

  const hGroundToRaw = buildGroundToRaw(style);

  const controlPoints: ControlPoint[] = CP_GROUND.map((cp) => {
    const raw = applyH(hGroundToRaw, cp.gx, cp.gy);
    return { id: cp.id, name: cp.name, gx: cp.gx, gy: cp.gy, px: raw.x, py: raw.y, enabled: true };
  });

  drawTargetAndControls(nadir, controlPoints);

  // 按 y 排序绘制，制造一点遮挡层次
  const byCode = new Map(ROSTER.map((c) => [c.code, c]));
  const sorted = layout.slice().sort((a, b) => a.gy - b.gy);
  for (const p of sorted) {
    const contestant = byCode.get(p.code)!;
    drawBag(nadir, p, contestant.color, style, rnd);
  }

  // 所有编号牌最后统一绘制，确保任何飘带（含相邻选手的）都不会盖住号码
  for (const p of layout) {
    const c = groundToNadir(p.gx, p.gy);
    drawCodeLabel(nadir, c.x, c.y, p.code, LABEL_SCALE);
  }

  applyLighting(nadir, style);

  // 透视 warp 成天底 -> 航拍原片：每个原片像素逆映射到地面再采天底图
  const hRawToGround = invert3(hGroundToRaw);
  const raw = warpResample(nadir, 3200, 2400, (u, v) => {
    const g = applyH(hRawToGround, u, v);
    return { u: ORIGIN_U + g.x * PPM, v: ORIGIN_V + g.y * PPM };
  });

  const targetRaw = applyH(hGroundToRaw, 0, 0);

  const truths: BagTruth[] = layout.map((p) => ({
    code: p.code,
    gx: p.gx,
    gy: p.gy,
    refereeCm: Math.round(Math.hypot(p.gx, p.gy) * 100),
    kind: p.kind,
    pairId: p.pairId,
  }));

  return {
    id,
    title: style.title,
    terrain: style.terrain,
    light: style.lightName,
    description: style.description,
    raw,
    rawWidth: 3200,
    rawHeight: 2400,
    hGroundToRaw,
    controlPoints,
    targetRaw,
    pxPerMeter: PPM,
    orthoWidth: ORTHO_W,
    orthoHeight: ORTHO_H,
    truths,
    seed: style.seed,
  };
}

export const VARIANT_LIST = Object.keys(VARIANTS) as VariantId[];
export function variantMeta(id: VariantId): VariantStyle {
  return VARIANTS[id];
}
