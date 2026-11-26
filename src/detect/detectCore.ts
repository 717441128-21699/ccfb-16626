import type { DetectedBag, Pt, Raster, StageTiming } from '../lib/types';
import { ROSTER } from '../lib/roster';
import { applyH, distanceCm, type Mat3 } from '../lib/geometry';
import { warpResample } from '../lib/raster';
import { connectedComponents, type Comp } from './cc';
import { decodeLabel } from './ocr';
import { colorDist } from '../lib/color';
import { PPM, ORTHO_W, ORTHO_H, OUT_ORIGIN_U, OUT_ORIGIN_V } from '../sample/scene';

export interface DetectOptions {
  ppm?: number;
  originU?: number;
  originV?: number;
  onProgress?: (stage: string, pct: number) => void;
}

export interface CoreResult {
  bags: DetectedBag[];
  width: number;
  height: number;
  ppm: number;
  target: Pt;
  stages: StageTiming[];
  recognized: number;
  candidateCount: number;
}

/** 用控制点解出的 地面->原片 矩阵，把原片重采样成正射图 */
export function warpToOrtho(raw: Raster, hGroundToRaw: Mat3, ppm = PPM): Raster {
  return warpResample(raw, ORTHO_W, ORTHO_H, (u, v) => {
    const gx = (u - OUT_ORIGIN_U) / ppm;
    const gy = (v - OUT_ORIGIN_V) / ppm;
    const p = applyH(hGroundToRaw, gx, gy);
    return { u: p.x, v: p.y };
  });
}

function luminance(r: Raster): Float32Array {
  const lum = new Float32Array(r.width * r.height);
  const d = r.data;
  for (let i = 0, p = 0; p < r.width * r.height; i += 4, p++) {
    lum[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }
  return lum;
}

interface RibbonAnchor {
  anchor: Pt;
  tip: Pt;
}

/** PCA 求飘带主轴，并取较宽一端为袋中心锚点 */
function estimateRibbonAnchor(r: Raster, labels: Int32Array, comp: Comp): RibbonAnchor | null {
  const pts: Pt[] = [];
  for (let y = comp.minY; y <= comp.maxY; y++) {
    for (let x = comp.minX; x <= comp.maxX; x++) {
      if (labels[y * r.width + x] === comp.id + 1) pts.push({ x: x + 0.5, y: y + 0.5 });
    }
  }
  if (pts.length < 20) return null;
  const mx = comp.sumX / comp.area;
  const my = comp.sumY / comp.area;
  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const ax = Math.cos(theta);
  const ay = Math.sin(theta);
  const px = -ay;
  const py = ax;

  let tmin = Infinity;
  let tmax = -Infinity;
  for (const p of pts) {
    const t = p.x * ax + p.y * ay;
    if (t < tmin) tmin = t;
    if (t > tmax) tmax = t;
  }
  const endWidth = (side: -1 | 1) => {
    const tEdge = side === -1 ? tmin : tmax;
    const endPts = pts.filter((p) => {
      const t = p.x * ax + p.y * ay;
      return side === -1 ? t <= tEdge + 16 : t >= tEdge - 16;
    });
    if (!endPts.length) return { width: 0, qMean: 0, t: tEdge };
    let qmin = Infinity;
    let qmax = -Infinity;
    let qSum = 0;
    for (const p of endPts) {
      const q = p.x * px + p.y * py;
      qSum += q;
      if (q < qmin) qmin = q;
      if (q > qmax) qmax = q;
    }
    return { width: qmax - qmin, qMean: qSum / endPts.length, t: tEdge };
  };

  const e0 = endWidth(-1);
  const e1 = endWidth(1);
  const anchorEnd = e0.width >= e1.width ? e0 : e1;
  const tipEnd = anchorEnd === e0 ? e1 : e0;
  const sign = anchorEnd === e0 ? -1 : 1;

  // 圆头/加固套半径约为端宽一半；袋中心在极端缘向内约一个半径处
  const tAnchor = anchorEnd.t - sign * (anchorEnd.width / 2 + 1.5);
  const anchor = {
    x: ax * tAnchor + px * anchorEnd.qMean,
    y: ay * tAnchor + py * anchorEnd.qMean,
  };
  const tip = {
    x: ax * (tipEnd.t + sign * 6) + px * tipEnd.qMean,
    y: ay * (tipEnd.t + sign * 6) + py * tipEnd.qMean,
  };
  return { anchor, tip };
}

/** 为某个未识别编号，在全图按其注册色寻找飘带 */
function findRibbonForColor(
  r: Raster,
  color: [number, number, number],
  labelCenters: Pt[],
): { comp: Comp; anchor: RibbonAnchor } | null {
  const N = r.width * r.height;
  const mask = new Uint8Array(N);
  const d = r.data;
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const dr = d[i];
    const dg = d[i + 1];
    const db = d[i + 2];
    // 颜色距离 + 饱和度门槛，排除灰褐背景
    const mx = Math.max(dr, dg, db);
    const mn = Math.min(dr, dg, db);
    if (mx - mn < 45) continue;
    if (colorDist([dr, dg, db], color) < 72) mask[p] = 1;
  }
  const cc = connectedComponents(mask, r.width, r.height, true);
  let best: { comp: Comp; anchor: RibbonAnchor; score: number } | null = null;
  for (const comp of cc.comps) {
    if (comp.area < 180 || comp.area > 6000) continue;
    const bw = comp.maxX - comp.minX + 1;
    const bh = comp.maxY - comp.minY + 1;
    const major = Math.max(bw, bh);
    const minor = Math.min(bw, bh);
    if (major < 42 || major > 280) continue;
    if (minor < 4 || minor > 40) continue;
    if (major / Math.max(1, minor) < 2.2) continue;
    const anchor = estimateRibbonAnchor(r, cc.labels, comp);
    if (!anchor) continue;
    // 锚点若紧邻某个已识别编号牌，说明这是已有袋子的飘带，排除
    if (labelCenters.some((lc) => Math.hypot(lc.x - anchor.anchor.x, lc.y - anchor.anchor.y) < 78)) continue;
    const score = major / minor + Math.min(comp.area, 1500) / 300;
    if (!best || score > best.score) best = { comp, anchor, score };
  }
  return best ? { comp: best.comp, anchor: best.anchor } : null;
}

export function detectBags(raster: Raster, opts: DetectOptions = {}): CoreResult {
  const ppm = opts.ppm ?? PPM;
  const originU = opts.originU ?? OUT_ORIGIN_U;
  const originV = opts.originV ?? OUT_ORIGIN_V;
  const stage = (name: string, ms: number, stages: StageTiming[]) => stages.push({ name, ms });
  const stages: StageTiming[] = [];
  const t0 = performance.now();
  opts.onProgress?.('亮度分析', 0.05);

  const lum = luminance(raster);
  const N = raster.width * raster.height;
  const d = raster.data;

  // 1) 白色编号牌掩膜
  const tw = performance.now();
  const white = new Uint8Array(N);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const rC = d[i];
    const gC = d[i + 1];
    const bC = d[i + 2];
    const mx = Math.max(rC, gC, bC);
    const mn = Math.min(rC, gC, bC);
    if (lum[p] > 156 && mn > 116 && mx - mn < 122) white[p] = 1;
  }
  const cc = connectedComponents(white, raster.width, raster.height, true);
  stage('编号牌连通域', performance.now() - tw, stages);
  opts.onProgress?.('编号识别', 0.35);

  // 2) 几何筛选 + OCR
  const to = performance.now();
  const byCode = new Map<string, DetectedBag>();
  let candidateCount = 0;
  for (const comp of cc.comps) {
    const bw = comp.maxX - comp.minX + 1;
    const bh = comp.maxY - comp.minY + 1;
    if (bw < 22 || bw > 100 || bh < 13 || bh > 74) continue;
    const ratio = bw / bh;
    if (ratio < 0.7 || ratio > 3.4) continue;
    const fill = comp.area / (bw * bh);
    if (fill < 0.4) continue;
    candidateCount++;
    const ocr = decodeLabel(raster, comp);
    if (!ocr) continue;
    // 用模板最佳原点反推牌面中心：code 点阵为 11*s 宽、7*s 高，中心与 pad 无关
    const cx = ocr.ox + (11 * ocr.scale) / 2;
    const cy = ocr.oy + (7 * ocr.scale) / 2;
    const roster = ROSTER.find((c) => c.code === ocr.code)!;
    const bag: DetectedBag = {
      id: `lab-${ocr.code}`,
      code: ocr.code,
      contestantNo: roster.no,
      x: cx,
      y: cy,
      gx: (cx - originU) / ppm,
      gy: (cy - originV) / ppm,
      distanceCm: distanceCm((cx - originU) / ppm, (cy - originV) / ppm),
      color: roster.color,
      colorName: roster.colorName,
      confidence: ocr.confidence,
      source: 'number-label',
      labelBox: { x: comp.minX, y: comp.minY, w: bw, h: bh },
    };
    const prev = byCode.get(ocr.code);
    if (!prev || bag.confidence > prev.confidence) byCode.set(ocr.code, bag);
  }
  stage('OCR 编号匹配', performance.now() - to, stages);
  opts.onProgress?.('飘带追踪', 0.7);

  // 3) 对未出现的编号按注册色追踪飘带
  const tr = performance.now();
  const labelCenters: Pt[] = Array.from(byCode.values()).map((b) => ({ x: b.x, y: b.y }));
  for (const contestant of ROSTER) {
    if (byCode.has(contestant.code)) continue;
    const found = findRibbonForColor(raster, contestant.color, labelCenters);
    if (!found) continue;
    const { anchor } = found.anchor;
    const gx = (anchor.x - originU) / ppm;
    const gy = (anchor.y - originV) / ppm;
    byCode.set(contestant.code, {
      id: `rib-${contestant.code}`,
      code: contestant.code,
      contestantNo: contestant.no,
      x: anchor.x,
      y: anchor.y,
      gx,
      gy,
      distanceCm: distanceCm(gx, gy),
      color: contestant.color,
      colorName: contestant.colorName,
      confidence: 0.72,
      source: 'ribbon',
      ribbon: { x1: anchor.x, y1: anchor.y, x2: found.anchor.tip.x, y2: found.anchor.tip.y },
    });
  }
  stage('飘带锚点定位', performance.now() - tr, stages);

  const bags = Array.from(byCode.values()).sort((a, b) => (a.contestantNo ?? 999) - (b.contestantNo ?? 999));
  opts.onProgress?.('完成', 1);
  return {
    bags,
    width: raster.width,
    height: raster.height,
    ppm,
    target: { x: originU, y: originV },
    stages,
    recognized: bags.filter((b) => b.source === 'number-label').length,
    candidateCount,
  };
}

/** 手动增删/拖动后，由 Worker 统一重算地面坐标与距离 */
export function remeasure(
  bags: DetectedBag[],
  ppm = PPM,
  originU = OUT_ORIGIN_U,
  originV = OUT_ORIGIN_V,
): DetectedBag[] {
  return bags.map((b) => {
    const gx = (b.x - originU) / ppm;
    const gy = (b.y - originV) / ppm;
    return { ...b, gx, gy, distanceCm: distanceCm(gx, gy) };
  });
}
