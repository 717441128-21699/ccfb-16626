// 标志袋检测主管线（纯 TS，Worker / Node 共用）。
// 线索融合：白色编号标签（主种子 + 矩形模板亚像素中心）+ 选手色证据
// + 5x7 OCR，全局贪心唯一分配编号，从而分开紧贴的相近色袋子。

import {
  rgbToHsv,
  hueDist,
  labelComponents,
  refineRectCenter,
  fitRectCenter,
  fitDiskCenter,
  radialContour,
  whiteScore,
  searchPanels,
  type Component,
} from './vision';
import { readLabel, bibOcrSimilarity, type DigitObs } from './ocr';
import { assignRobust } from './assign';
import type { DetectResult, Detection, DetectStats, Player, Pt } from './types';

export interface DetectOptions {
  players: Player[];
  ppm: number;
  target: Pt; // 米
  zoneRadius: number;
  sensitivity?: number;
  debug?: boolean;
  /** 需要排除的已知标志（控制点/十字中心），正射像素坐标 */
  excludeCircles?: { x: number; y: number; r: number }[];
}

interface LabelCand {
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  cx: number;
  cy: number;
  cw: number;
  ch: number;
  ndigits: 1 | 2;
  ocr: { digits: DigitObs[]; total: number } | null;
  ocrText: string;
  strictSupport: number;
  colorHue: number;
  colorSat: number;
  colorPlayer: number;
}

interface HueLut {
  dist: number;
  player: number;
}

function buildHueLut(players: Player[]): HueLut[] {
  const hues = players.map((p) => rgbToHsv(p.rgb[0], p.rgb[1], p.rgb[2]).h);
  const lut: HueLut[] = new Array(360);
  for (let h = 0; h < 360; h++) {
    let best = 1e9;
    let bi = 0;
    hues.forEach((hh, i) => {
      const d = hueDist(h, hh);
      if (d < best) {
        best = d;
        bi = i;
      }
    });
    lut[h] = { dist: best, player: bi };
  }
  return lut;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * 高置信门控贪心唯一分配：全局边按权重降序，候选与编号都未占用且达到门控才配对。
 * 正确编号的 OCR 相似度显著高于其它编号，因此先处理的几乎都是正确配对，
 * 从根本上分开紧贴的相近色袋子；不可信的边宁可不分配，交给保守兜底。
 */
function gatedGreedy(
  weights: number[][],
  ocrMat: number[][],
  colMat: number[][],
): Map<number, number> {
  const C = weights.length;
  const B = weights[0]?.length ?? 0;
  interface E {
    ci: number;
    bi: number;
    w: number;
  }
  const edges: E[] = [];
  for (let ci = 0; ci < C; ci++) {
    for (let bi = 0; bi < B; bi++) edges.push({ ci, bi, w: weights[ci][bi] });
  }
  edges.sort((a, b) => b.w - a.w);
  const usedC = new Set<number>();
  const usedB = new Set<number>();
  const pair = new Map<number, number>();
  for (const e of edges) {
    if (usedC.has(e.ci) || usedB.has(e.bi)) continue;
    const o = ocrMat[e.ci][e.bi];
    const c = colMat[e.ci][e.bi];
    const pass = e.w >= 0.45 && (o >= 0.6 || (o >= 0.5 && c >= 0.4));
    if (!pass) continue;
    usedC.add(e.ci);
    usedB.add(e.bi);
    pair.set(e.ci, e.bi);
  }
  return pair;
}

/**
 * 在期望位置附近精确定位目标十字中心：
 * 利用正中央的红色圆心做加权质心；失败则回退到期望坐标。
 * 返回与袋心同一索引像素约定下的坐标，使全局半像素/单应平移在距离中抵消。
 */
function findTargetCenter(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  ax: number,
  ay: number,
): Pt {
  const R = 11;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = Math.max(0, Math.round(ay - R)); y <= Math.min(h - 1, ay + R); y++) {
    for (let x = Math.max(0, Math.round(ax - R)); x <= Math.min(w - 1, ax + R); x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // 正中央红色圆心：R 明显高于 G/B；高阈值排除傍晚偏红的泥地
      const red = Math.max(0, r - (g + b) / 2);
      if (red < 95) continue;
      const wgt = red * red;
      sx += x * wgt;
      sy += y * wgt;
      sw += wgt;
    }
  }
  if (sw > 1) return { x: sx / sw, y: sy / sw };
  return { x: ax, y: ay };
}

export function detectMarkers(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  opts: DetectOptions,
): DetectResult {
  const tStart = nowMs();
  const N = width * height;
  const sens = opts.sensitivity ?? 0.5;
  const hueTol = 13 + sens * 12; // 13..25

  const hueLut = buildHueLut(opts.players);
  const playerHsv = opts.players.map((p) => rgbToHsv(p.rgb[0], p.rgb[1], p.rgb[2]));

  const whiteProb = new Float32Array(N);
  const markerMask = new Uint8Array(N);
  const markerProb = new Float32Array(N);

  const tMask0 = nowMs();
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    whiteProb[i] = whiteScore(r, g, b);

    const hsv = rgbToHsv(r, g, b);
    if (hsv.s > 0.46 && hsv.v > 66) {
      const bin = hueLut[Math.round(hsv.h) % 360];
      if (bin.dist < hueTol) {
        markerMask[i] = 1;
        markerProb[i] = Math.max(0, 1 - bin.dist / (hueTol + 6)) * (0.5 + 0.5 * hsv.s);
      }
    }
  }
  const maskMs = nowMs() - tMask0;

  // ---------- 编号面板：高召回白块连通域（4 连通），OCR + 全局分配保证精度 ----------
  const tCc0 = nowMs();
  const whiteMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (whiteProb[i] > 0.55) whiteMask[i] = 1;
  const ccLabels = new Int32Array(N);
  const whiteComps = labelComponents(whiteMask, width, height, ccLabels, 70, 4);

  const cands: LabelCand[] = [];
  for (const c of whiteComps) {
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    if (bw < 9 || bw > 72 || bh < 10 || bh > 42) continue;
    const ratio = bw / bh;
    if (ratio < 0.42 || ratio > 3.2) continue;
    if (c.count / (bw * bh) < 0.3) continue;

    const ndigits: 1 | 2 = ratio > 1.1 ? 2 : 1;
    const roughX = (c.minX + c.maxX) / 2;
    const roughY = (c.minY + c.maxY) / 2;
    const fit = fitRectCenter(whiteProb, width, height, roughX, roughY, ndigits === 2 ? 27 : 15, 18, 5);
    // 1/2 位都试，避免极端宽高比误判
    let ocr = readLabel(data, width, height, fit.x, fit.y, fit.ch, ndigits);
    const alt = readLabel(data, width, height, fit.x, fit.y, fit.ch, ndigits === 2 ? 1 : 2);
    if (ocr && alt && alt.total > ocr.total + 0.06) {
      ocr = alt;
    }
    if (!ocr || ocr.total < 0.55) continue;
    const sig = colorEvidence(data, width, height, fit.x, fit.y, fit.cw, fit.ch, playerHsv);
    const hx = fit.cw / 2 + 1;
    const hy = fit.ch / 2 + 1;

    cands.push({
      bbox: {
        minX: Math.round(fit.x - hx),
        minY: Math.round(fit.y - hy),
        maxX: Math.round(fit.x + hx),
        maxY: Math.round(fit.y + hy),
      },
      cx: fit.x,
      cy: fit.y,
      cw: fit.cw,
      ch: fit.ch,
      ndigits: ocr.digits.length as 1 | 2,
      ocr,
      ocrText: ocr.digits.map((d) => d.best).join(''),
      strictSupport: sig.support,
      colorHue: sig.hue,
      colorSat: sig.sat,
      colorPlayer: sig.player,
    });
  }

  // 排除已知控制点 / 目标十字区域，避免黑白标志被当成编号标签
  if (opts.excludeCircles?.length) {
    for (let i = cands.length - 1; i >= 0; i--) {
      const c = cands[i];
      if (opts.excludeCircles.some((z) => Math.hypot(c.cx - z.x, c.cy - z.y) < z.r)) cands.splice(i, 1);
    }
  }
  // 近重复候选去重（同一标签的碎裂块），保留 OCR 总分更高者
  for (let i = cands.length - 1; i >= 0; i--) {
    for (let j = 0; j < i; j++) {
      if (Math.hypot(cands[i].cx - cands[j].cx, cands[i].cy - cands[j].cy) < 13) {
        const ti = cands[i].ocr?.total ?? 0;
        const tj = cands[j].ocr?.total ?? 0;
        if (ti > tj) cands.splice(j, 1);
        else {
          cands.splice(i, 1);
          break;
        }
      }
    }
  }

  // ---------- 选手色连通域（兜底/拆分标记） ----------
  const labels = new Int32Array(N);
  const markerComps = labelComponents(markerMask, width, height, labels, 160, 8);
  const componentsMs = nowMs() - tCc0;

  // ---------- 全局最优唯一分配（匈牙利） ----------
  const tOcr0 = nowMs();
  interface Assign {
    bib: number;
    score: number;
    ocr: number;
    col: number;
  }
  const C = cands.length;
  const B = opts.players.length;
  const weights: number[][] = Array.from({ length: C }, () => new Array(B).fill(0));
  const ocrMat: number[][] = Array.from({ length: C }, () => new Array(B).fill(0));
  const colMat: number[][] = Array.from({ length: C }, () => new Array(B).fill(0));
  cands.forEach((c, ci) => {
    opts.players.forEach((p, bi) => {
      const ocrS = bibOcrSimilarity(c.ocr, p.bib);
      const ph = playerHsv[bi];
      const hueAgree = Math.max(0, 1 - hueDist(c.colorHue, ph.h) / 26);
      const presence = Math.min(1, c.strictSupport / 0.32);
      const satAgree = 1 - Math.min(1, Math.abs(c.colorSat - ph.s));
      const colS = c.strictSupport > 0 ? hueAgree * presence * (0.6 + 0.4 * satAgree) : 0;
      ocrMat[ci][bi] = ocrS;
      colMat[ci][bi] = colS;
      weights[ci][bi] = 0.8 * ocrS + 0.2 * colS;
    });
  });

  // 匈牙利全局最优：C×B 补方阵，虚拟列代价为 1（最差），因此 40 个编号
  // 总会被全局最优的候选覆盖；候选多于编号时多出的候选落到虚拟列。
  const pairing = assignRobust(weights, ocrMat);
  const assigned = new Map<number, Assign>();
  const usedBibs = new Set<number>();
  for (const [ci, bi] of pairing) {
    if (bi < 0 || bi >= B) continue;
    assigned.set(ci, {
      bib: opts.players[bi].bib,
      score: weights[ci][bi],
      ocr: ocrMat[ci][bi],
      col: colMat[ci][bi],
    });
    usedBibs.add(opts.players[bi].bib);
  }
  const ocrMs = nowMs() - tOcr0;

  // ---------- 组装检测 ----------
  const tFit0 = nowMs();
  const cross = findTargetCenter(data, width, height, opts.target.x * opts.ppm, opts.target.y * opts.ppm);
  const detections: Detection[] = [];

  for (const [ci, e] of assigned) {
    const c = cands[ci];
    const radiusPx = 0.46 * opts.ppm;

    // 用该选手的严格色概率做圆盘拟合，与标签中心吻合时取均值降噪
    const playerProb = localPlayerProb(data, width, height, c.cx, c.cy, playerHsv[e.bib - 1]);
    const disk = fitDiskCenter(playerProb, width, height, c.cx, c.cy, radiusPx, 5);
    const diskAgrees = Math.hypot(disk.x - c.cx, disk.y - c.cy) < 1.4 && disk.score > 0.3;
    let fx = c.cx;
    let fy = c.cy;
    let method: Detection['method'] = 'label';
    if (c.strictSupport < 0.12) method = 'ribbon-root';
    if (diskAgrees) {
      fx = (c.cx + disk.x) / 2;
      fy = (c.cy + disk.y) / 2;
      if (method !== 'ribbon-root') method = 'disk-fit';
    }

    const gx = (fx + 0.5) / opts.ppm;
    const gy = (fy + 0.5) / opts.ppm;
    // 相对同一像素帧内检出的十字心，抵消坐标约定/单应平移
    const distanceM = Math.hypot(fx - cross.x, fy - cross.y) / opts.ppm;
    const contour = radialContour(markerMask, width, height, fx, fy, radiusPx + 5, 28);
    const ribbon = traceRibbon(markerMask, width, height, fx, fy, radiusPx * 3.4);
    const ocrMargin = c.ocr?.digits.reduce((m, d) => Math.min(m, d.margin), 1) ?? 0;
    const confidence = Math.max(
      0,
      Math.min(1, 0.5 * e.ocr + 0.22 * e.col + 0.16 * Math.min(1, ocrMargin * 2.4) + 0.12),
    );

    detections.push({
      bib: e.bib,
      cx: fx,
      cy: fy,
      gx,
      gy,
      distanceM,
      outside: distanceM > opts.zoneRadius,
      confidence,
      colorMatch: e.col,
      ocrText: c.ocrText || String(e.bib),
      ocrMargin,
      method,
      radiusPx,
      bbox: { x: c.bbox.minX, y: c.bbox.minY, w: c.bbox.maxX - c.bbox.minX + 1, h: c.bbox.maxY - c.bbox.minY + 1 },
      contour,
      ribbon,
    });
  }

  // ---------- 兜底：仍缺失的编号，用未占用的颜色连通域 ----------
  const remaining = opts.players.filter((p) => !usedBibs.has(p.bib));
  if (remaining.length) {
    const fallbackComps = markerComps
      .filter((mc) => mc.count > 260 && mc.count < 6000)
      .filter((mc) => Math.max(mc.maxX - mc.minX, mc.maxY - mc.minY) < 95)
      .filter((mc) => {
        const mx = mc.sumX / mc.count;
        const my = mc.sumY / mc.count;
        return !detections.some((d) => Math.hypot(d.cx - mx, d.cy - my) < 24);
      })
      .sort((a, b) => b.count - a.count);

    for (const mc of fallbackComps) {
      if (!remaining.length) break;
      const mx = mc.sumX / mc.count;
      const my = mc.sumY / mc.count;
      const hsv = averageHueInComp(data, width, mc);
      let bestIdx = 0;
      let bestD = 1e9;
      remaining.forEach((p, i) => {
        const ph = rgbToHsv(p.rgb[0], p.rgb[1], p.rgb[2]);
        const d = hueDist(hsv.h, ph.h) + Math.abs(hsv.s - ph.s) * 40;
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      });
      const p = remaining.splice(bestIdx, 1)[0];
      usedBibs.add(p.bib);
      const disk = fitDiskCenter(markerProb, width, height, mx, my, 0.46 * opts.ppm, 8);
      const gx = (disk.x + 0.5) / opts.ppm;
      const gy = (disk.y + 0.5) / opts.ppm;
      const distanceM = Math.hypot(disk.x - cross.x, disk.y - cross.y) / opts.ppm;
      detections.push({
        bib: p.bib,
        cx: disk.x,
        cy: disk.y,
        gx,
        gy,
        distanceM,
        outside: distanceM > opts.zoneRadius,
        confidence: 0.45,
        colorMatch: Math.max(0, 1 - bestD / 60),
        ocrText: String(p.bib),
        ocrMargin: 0,
        method: 'color-blob',
        radiusPx: 0.46 * opts.ppm,
        bbox: { x: mc.minX, y: mc.minY, w: mc.maxX - mc.minX + 1, h: mc.maxY - mc.minY + 1 },
        contour: radialContour(markerMask, width, height, disk.x, disk.y, 0.46 * opts.ppm + 5, 28),
        ribbon: [],
      });
    }
  }

  // 紧贴拆分标记：两个袋心相距 < 1.5m（刻意布置的相近色紧贴对约 0.85m，
  // 随机落点最小间距 1.9m），即视为需要靠编号分开的紧贴袋。
  for (const d of detections) {
    const close = detections.some(
      (o) => o !== d && o.bib !== d.bib && Math.hypot(o.gx - d.gx, o.gy - d.gy) < 1.5,
    );
    if (close) d.mergedSplit = true;
  }

  detections.sort((a, b) => (a.bib ?? 999) - (b.bib ?? 999));
  const fitMs = nowMs() - tFit0;

  const stats: DetectStats = {
    totalMs: nowMs() - tStart,
    maskMs,
    componentsMs,
    ocrMs,
    fitMs,
    assignMs: 0,
    pixelCount: N,
    labelCount: cands.length,
    componentCount: markerComps.length,
  };

  return {
    detections,
    width,
    height,
    ppm: opts.ppm,
    targetPx: { x: cross.x, y: cross.y },
    stats,
    debugCands: opts.debug
      ? cands.map((c) => ({
          cx: c.cx,
          cy: c.cy,
          n: c.ndigits,
          ocr: c.ocrText,
          total: c.ocr?.total ?? 0,
          support: c.strictSupport,
          hue: c.colorHue,
        }))
      : undefined,
  };
}

/** 标签外围环带的严格选手色证据 */
function colorEvidence(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  cw: number,
  ch: number,
  playerHsv: { h: number; s: number; v: number }[],
): { support: number; hue: number; sat: number; player: number } {
  const R = 21;
  const halfW = cw / 2 + 2;
  const halfH = ch / 2 + 2;
  let total = 0;
  let strict = 0;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = Math.max(0, Math.round(cy - R)); y <= Math.min(h - 1, cy + R); y++) {
    for (let x = Math.max(0, Math.round(cx - R)); x <= Math.min(w - 1, cx + R); x++) {
      if (Math.abs(x - cx) < halfW && Math.abs(y - cy) < halfH) continue;
      total++;
      const i = (y * w + x) * 4;
      const hsv = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      if (hsv.s < 0.45 || hsv.v < 64) continue;
      let bd = 1e9;
      let bi = -1;
      playerHsv.forEach((ph, idx) => {
        const d = hueDist(hsv.h, ph.h);
        if (d < bd) {
          bd = d;
          bi = idx;
        }
      });
      if (bd < 16) {
        strict++;
        const wgt = hsv.s;
        sx += Math.cos((hsv.h * Math.PI) / 180) * wgt;
        sy += Math.sin((hsv.h * Math.PI) / 180) * wgt;
        sw += wgt;
      }
      void bi;
    }
  }
  if (!total || sw < 1) return { support: strict / Math.max(1, total), hue: 0, sat: 0, player: -1 };
  let hue = (Math.atan2(sy, sx) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return { support: strict / total, hue, sat: sw / Math.max(1, strict), player: -1 };
}

/** 针对某个选手颜色，在标签附近 ROI 生成紧概率图（返回全尺寸，ROI 外为 0） */
function localPlayerProb(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  ph: { h: number; s: number; v: number },
): Float32Array {
  const prob = new Float32Array(w * h);
  const R = 26;
  for (let y = Math.max(0, Math.round(cy - R)); y <= Math.min(h - 1, cy + R); y++) {
    for (let x = Math.max(0, Math.round(cx - R)); x <= Math.min(w - 1, cx + R); x++) {
      const i = (y * w + x) * 4;
      const hsv = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      if (hsv.s < 0.4 || hsv.v < 60) continue;
      const dh = hueDist(hsv.h, ph.h);
      if (dh < 22) prob[y * w + x] = Math.max(0, 1 - dh / 26) * (0.55 + 0.45 * hsv.s);
    }
  }
  return prob;
}

function averageHueInComp(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  c: Component,
): { h: number; s: number } {
  let sx = 0;
  let sy = 0;
  let ss = 0;
  let n = 0;
  const x0 = Math.max(0, c.minX);
  const x1 = Math.min(w - 1, c.maxX);
  for (let y = c.minY; y <= c.maxY; y += 2) {
    for (let x = x0; x <= x1; x += 2) {
      const i = (y * w + x) * 4;
      const hsv = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      if (hsv.s < 0.3) continue;
      sx += Math.cos((hsv.h * Math.PI) / 180) * hsv.s;
      sy += Math.sin((hsv.h * Math.PI) / 180) * hsv.s;
      ss += hsv.s;
      n++;
    }
  }
  let h = (Math.atan2(sy, sx) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { h, s: n ? ss / n : 0 };
}

function traceRibbon(mask: Uint8Array, w: number, h: number, cx: number, cy: number, maxLen: number): Pt[] {
  let bestAngle = 0;
  let bestRun = 0;
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let run = 0;
    for (let t = 4; t < maxLen; t++) {
      const x = Math.round(cx + dx * t);
      const y = Math.round(cy + dy * t);
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      if (mask[y * w + x]) run = t;
      else if (t - run > 5) break;
    }
    if (run > bestRun) {
      bestRun = run;
      bestAngle = a;
    }
  }
  if (bestRun < 14) return [];
  const pts: Pt[] = [{ x: cx, y: cy }];
  const dx = Math.cos(bestAngle);
  const dy = Math.sin(bestAngle);
  for (let t = 0; t < bestRun; t += 6) {
    const ahead = 6;
    const bx = cx + dx * (t + ahead);
    const by = cy + dy * (t + ahead);
    const px = -dy;
    const py = dx;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let o = -5; o <= 5; o++) {
      const xx = Math.round(bx + px * o);
      const yy = Math.round(by + py * o);
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      if (mask[yy * w + xx]) {
        sx += xx;
        sy += yy;
        n++;
      }
    }
    if (n) pts.push({ x: sx / n, y: sy / n });
  }
  return pts;
}
