import type { Raster, RGB } from './types';
import { clamp } from './rng';
import { codeBitmap, FONT_W, FONT_H } from './digitFont';

export function createRaster(width: number, height: number, fill?: RGB | [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill) {
    const [r, g, b, a = 255] = fill;
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = a;
    }
  }
  return { width, height, data };
}

export function cloneRaster(src: Raster): Raster {
  return { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
}

/** 坐标均为“像素索引空间”：第 i 列像素横跨 [i, i+1]，中心 i+0.5 */
export function blendPixel(r: Raster, x: number, y: number, c: RGB, alpha: number): void {
  const ix = x | 0;
  const iy = y | 0;
  if (ix < 0 || iy < 0 || ix >= r.width || iy >= r.height) return;
  if (alpha <= 0) return;
  const i = (iy * r.width + ix) * 4;
  const a = clamp(alpha, 0, 1);
  r.data[i] = r.data[i] * (1 - a) + c[0] * a;
  r.data[i + 1] = r.data[i + 1] * (1 - a) + c[1] * a;
  r.data[i + 2] = r.data[i + 2] * (1 - a) + c[2] * a;
  r.data[i + 3] = 255;
}

export function fillRect(r: Raster, x0: number, y0: number, x1: number, y1: number, c: RGB, alpha = 1): void {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(r.width - 1, Math.ceil(x1) - 1);
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(r.height - 1, Math.ceil(y1) - 1);
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      // 边缘覆盖
      const covX = Math.min(x + 1, x1) - Math.max(x, x0);
      const covY = Math.min(y + 1, y1) - Math.max(y, y0);
      const cov = clamp(covX, 0, 1) * clamp(covY, 0, 1);
      if (cov > 0) blendPixel(r, x, y, c, alpha * cov);
    }
  }
}

export function fillCircle(r: Raster, cx: number, cy: number, rad: number, c: RGB, alpha = 1): void {
  const x0 = Math.max(0, Math.floor(cx - rad - 1));
  const x1 = Math.min(r.width - 1, Math.ceil(cx + rad + 1));
  const y0 = Math.max(0, Math.floor(cy - rad - 1));
  const y1 = Math.min(r.height - 1, Math.ceil(cy + rad + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cov = clamp(rad - d + 0.75, 0, 1);
      if (cov > 0) blendPixel(r, x, y, c, alpha * cov);
    }
  }
}

/** 粗线段（圆头），width 为像素宽 */
export function strokeLine(
  r: Raster,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  c: RGB,
  alpha = 1,
): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len / Math.max(1, width * 0.35)));
  const rad = width / 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillCircle(r, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, rad, c, alpha);
  }
}

/** 沿折线逐段变宽绘制（模拟锥形飘带），widthAt(t) 给出宽度 */
export function strokeTapered(
  r: Raster,
  pts: Array<{ x: number; y: number }>,
  widthAt: (t: number) => number,
  c: RGB,
  alpha = 1,
): void {
  if (pts.length < 2) return;
  let total = 0;
  const segLen: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segLen.push(l);
    total += l;
  }
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = segLen[i] || 1;
    const sub = Math.max(2, Math.ceil(l / 3));
    for (let k = 0; k < sub; k++) {
      const t0 = (acc + (l * k) / sub) / total;
      const t1 = (acc + (l * (k + 1)) / sub) / total;
      const a = k / sub;
      const b = (k + 1) / sub;
      const ax = pts[i].x + (pts[i + 1].x - pts[i].x) * a;
      const ay = pts[i].y + (pts[i + 1].y - pts[i].y) * a;
      const bx = pts[i].x + (pts[i + 1].x - pts[i].x) * b;
      const by = pts[i].y + (pts[i + 1].y - pts[i].y) * b;
      const w = (widthAt(t0) + widthAt(t1)) / 2;
      strokeLine(r, ax, ay, bx, by, w, c, alpha);
    }
    acc += l;
  }
}

export interface LabelGeom {
  x: number; // 左上角（索引空间）
  y: number;
  w: number;
  h: number;
  scale: number;
  pad: number;
}

export function labelGeometry(cx: number, cy: number, code: string, scale: number, pad = 5): LabelGeom {
  const bw = code.length * FONT_W + (code.length - 1);
  const w = bw * scale + pad * 2;
  const h = FONT_H * scale + pad * 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h, scale, pad };
}

/** 画白色编号牌 + 深色点阵编号，返回几何 */
export function drawCodeLabel(
  r: Raster,
  cx: number,
  cy: number,
  code: string,
  scale: number,
  opts: { pad?: number; bg?: RGB; fg?: RGB; alpha?: number } = {},
): LabelGeom {
  const pad = opts.pad ?? 5;
  const bg = opts.bg ?? [245, 245, 245];
  const fg = opts.fg ?? [20, 24, 30];
  const alpha = opts.alpha ?? 1;
  const g = labelGeometry(cx, cy, code, scale, pad);
  // 底板（轻微圆角用多层矩形近似）
  fillRect(r, g.x + 2, g.y, g.x + g.w - 2, g.y + g.h, bg, alpha);
  fillRect(r, g.x, g.y + 2, g.x + g.w, g.y + g.h - 2, bg, alpha);
  fillCircle(r, g.x + 2, g.y + 2, 2, bg, alpha);
  fillCircle(r, g.x + g.w - 2, g.y + 2, 2, bg, alpha);
  fillCircle(r, g.x + 2, g.y + g.h - 2, 2, bg, alpha);
  fillCircle(r, g.x + g.w - 2, g.y + g.h - 2, 2, bg, alpha);
  // 编号点阵
  const bm = codeBitmap(code);
  for (let row = 0; row < FONT_H; row++) {
    for (let col = 0; col < bm[row].length; col++) {
      if (!bm[row][col]) continue;
      const px = g.x + pad + col * scale;
      const py = g.y + pad + row * scale;
      fillRect(r, px, py, px + scale, py + scale, fg, alpha);
    }
  }
  return g;
}

/** 双线性采样，u/v 为索引空间坐标 */
export function sampleBilinear(r: Raster, u: number, v: number): [number, number, number, number] {
  const x = u - 0.5;
  const y = v - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const w = r.width;
  const h = r.height;
  const cx0 = clamp(x0, 0, w - 1);
  const cx1 = clamp(x0 + 1, 0, w - 1);
  const cy0 = clamp(y0, 0, h - 1);
  const cy1 = clamp(y0 + 1, 0, h - 1);
  const i00 = (cy0 * w + cx0) * 4;
  const i10 = (cy0 * w + cx1) * 4;
  const i01 = (cy1 * w + cx0) * 4;
  const i11 = (cy1 * w + cx1) * 4;
  const d = r.data;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const a = d[i00 + k] * (1 - tx) + d[i10 + k] * tx;
    const b = d[i01 + k] * (1 - tx) + d[i11 + k] * tx;
    out[k] = a * (1 - ty) + b * ty;
  }
  return out;
}

/** 用映射函数把源栅格重采样为目标栅格（输出像素中心 -> 源索引空间坐标） */
export function warpResample(
  src: Raster,
  outW: number,
  outH: number,
  mapOutCenterToSrc: (u: number, v: number) => { u: number; v: number },
): Raster {
  const out = createRaster(outW, outH);
  const d = out.data;
  for (let j = 0; j < outH; j++) {
    for (let i = 0; i < outW; i++) {
      const u = i + 0.5;
      const v = j + 0.5;
      const s = mapOutCenterToSrc(u, v);
      const c = sampleBilinear(src, s.u, s.v);
      const o = (j * outW + i) * 4;
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = c[3];
    }
  }
  return out;
}

export function rasterToImageData(r: Raster): ImageData {
  return new ImageData(new Uint8ClampedArray(r.data), r.width, r.height);
}
