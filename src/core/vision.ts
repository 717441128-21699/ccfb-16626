// 视觉基础：HSV 颜色、连通域标记（迭代 flood-fill）、亚像素边缘中心。
// 全部操作 RGBA TypedArray，可在 Worker / Node 运行。

export interface HSV {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..255
}

export function rgbToHsv(r: number, g: number, b: number): HSV {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max * 255 };
}

export function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export interface Component {
  id: number;
  count: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumX: number;
  sumY: number;
  seedX: number;
  seedY: number;
}

/**
 * 对 0/非0 掩膜做 8 连通标记。
 * labels 由调用方提供（长度 = w*h），返回连通域统计。
 */
export function labelComponents(
  mask: Uint8Array,
  w: number,
  h: number,
  labels: Int32Array,
  minArea = 1,
  conn: 4 | 8 = 8,
): Component[] {
  labels.fill(0);
  const comps: Component[] = [];
  const stack = new Int32Array(w * h);
  let sp = 0;
  let nextId = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (labels[start] !== 0 || mask[start] === 0) continue;
      const id = ++nextId;
      const c: Component = {
        id,
        count: 0,
        minX: x,
        minY: y,
        maxX: x,
        maxY: y,
        sumX: 0,
        sumY: 0,
        seedX: x,
        seedY: y,
      };
      labels[start] = id;
      stack[sp++] = start;
      while (sp > 0) {
        const p = stack[--sp];
        const px = p % w;
        const py = (p / w) | 0;
        c.count++;
        c.sumX += px;
        c.sumY += py;
        if (px < c.minX) c.minX = px;
        if (px > c.maxX) c.maxX = px;
        if (py < c.minY) c.minY = py;
        if (py > c.maxY) c.maxY = py;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = py + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (conn === 4 && dx !== 0 && dy !== 0) continue;
            const nx = px + dx;
            if (nx < 0 || nx >= w) continue;
            const q = ny * w + nx;
            if (labels[q] === 0 && mask[q] !== 0) {
              labels[q] = id;
              stack[sp++] = q;
            }
          }
        }
      }
      if (c.count >= minArea) comps.push(c);
    }
  }
  return comps;
}

/** 白色标签像素的“白度” 0..1（对早晚暖光做了宽容标定） */
export function whiteScore(r: number, g: number, b: number): number {
  const mn = Math.min(r, g, b);
  const mx = Math.max(r, g, b);
  if (mn < 150) return 0;
  const chroma = mx - mn;
  const light = Math.max(0, Math.min(1, (mn - 150) / 35));
  const neutral = 1 - Math.max(0, Math.min(1, (chroma - 55) / 85));
  return Math.max(0, Math.min(1, light * (0.45 + 0.55 * neutral)));
}

/** 连通域用的宽松白判定 */
export function isWhitePixel(r: number, g: number, b: number): boolean {
  const mn = Math.min(r, g, b);
  const mx = Math.max(r, g, b);
  return mn > 150 && mx - mn < 128;
}

export function isDarkDigit(r: number, g: number, b: number): boolean {
  // 相对白标签的深墨
  return Math.max(r, g, b) < 125;
}

/** 构建积分图（Float64，步长 w+1） */
export function integralImage(prob: Float32Array, w: number, h: number): Float64Array {
  const W = w + 1;
  const ii = new Float64Array(W * (h + 1));
  for (let y = 1; y <= h; y++) {
    let rowSum = 0;
    for (let x = 1; x <= w; x++) {
      rowSum += prob[(y - 1) * w + (x - 1)];
      ii[y * W + x] = ii[(y - 1) * W + x] + rowSum;
    }
  }
  return ii;
}

function iiRect(ii: Float64Array, W: number, x0: number, y0: number, x1: number, y1: number): number {
  return ii[y1 * W + x1] - ii[y0 * W + x1] - ii[y1 * W + x0] + ii[y0 * W + x0];
}

export interface PanelPeak {
  x: number;
  y: number;
  w: number;
  h: number;
  n: 1 | 2;
  score: number;
}

/**
 * 积分图 + 多模板（1/2 位、3 个尺度）全图搜索编号面板，再做贪心 NMS。
 * 不依赖白色连通域，数字笔画切碎底色也能检出。
 */
export function searchPanels(prob: Float32Array, w: number, h: number, threshold = 0.5): PanelPeak[] {
  const ii = integralImage(prob, w, h);
  const IW = w + 1;
  const templates: Array<{ n: 1 | 2; tw: number; th: number }> = [];
  for (const n of [1, 2] as const) {
    for (const s of [0.92, 1, 1.08]) {
      templates.push({ n, tw: Math.round((n === 1 ? 15 : 27) * s), th: Math.round(18 * s) });
    }
  }
  const hits: PanelPeak[] = [];
  const stride = 2;
  for (const t of templates) {
    const { tw, th, n } = t;
    for (let y = 0; y + th <= h; y += stride) {
      for (let x = 0; x + tw <= w; x += stride) {
        const sum = iiRect(ii, IW, x, y, x + tw, y + th);
        const mean = sum / (tw * th);
        if (mean >= threshold) hits.push({ x: x + tw / 2, y: y + th / 2, w: tw, h: th, n, score: mean });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score);
  const peaks: PanelPeak[] = [];
  for (const p of hits) {
    if (peaks.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 13)) peaks.push(p);
  }
  return peaks;
}

/**
 * 二值掩膜闭运算（先膨胀后腐蚀），可分离滑窗 O(N)。
 * 把被粗数字笔画/虚化光晕切碎的标签底合并成完整面板。
 */
export function closeMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return erode(dilate(mask, w, h, r), w, h, r);
}

function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let cnt = 0;
    for (let k = 0; k <= Math.min(w - 1, r); k++) cnt += src[row + k];
    for (let x = 0; x < w; x++) {
      if (cnt > 0) tmp[row + x] = 1;
      const add = x + r + 1;
      if (add < w) cnt += src[row + add];
      const leave = x - r;
      if (leave >= 0) cnt -= src[row + leave];
    }
  }
  for (let x = 0; x < w; x++) {
    let cnt = 0;
    for (let k = 0; k <= Math.min(h - 1, r); k++) cnt += tmp[k * w + x];
    for (let y = 0; y < h; y++) {
      if (cnt > 0) out[y * w + x] = 1;
      const add = y + r + 1;
      if (add < h) cnt += tmp[add * w + x];
      const leave = y - r;
      if (leave >= 0) cnt -= tmp[leave * w + x];
    }
  }
  return out;
}

function erode(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < src.length; i++) inv[i] = src[i] ? 0 : 1;
  const di = dilate(inv, w, h, r);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < src.length; i++) out[i] = di[i] ? 0 : 1;
  return out;
}

/**
 * 利用标签轴对齐直边，把 bbox 中心精修到亚像素。
 * 用投影 + 50% 跨越点线性插值。
 */
export function refineRectCenter(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  b: { minX: number; minY: number; maxX: number; maxY: number },
): { x: number; y: number } {
  const pad = 5;
  const x0 = Math.max(0, b.minX - pad);
  const x1 = Math.min(w - 1, b.maxX + pad);
  const y0 = Math.max(0, b.minY - pad);
  const y1 = Math.min(h - 1, b.maxY + pad);

  // 列投影：中间 60% 行带的白度均值
  const ry0 = Math.round(b.minY + (b.maxY - b.minY) * 0.2);
  const ry1 = Math.round(b.minY + (b.maxY - b.minY) * 0.8);
  const colProf: number[] = [];
  for (let x = x0; x <= x1; x++) {
    let s = 0;
    let n = 0;
    for (let y = ry0; y <= ry1; y++) {
      const i = (y * w + x) * 4;
      s += whiteScore(data[i], data[i + 1], data[i + 2]);
      n++;
    }
    colProf.push(n ? s / n : 0);
  }
  const rowProf: number[] = [];
  const rx0 = Math.round(b.minX + (b.maxX - b.minX) * 0.2);
  const rx1 = Math.round(b.minX + (b.maxX - b.minX) * 0.8);
  for (let y = y0; y <= y1; y++) {
    let s = 0;
    let n = 0;
    for (let x = rx0; x <= rx1; x++) {
      const i = (y * w + x) * 4;
      s += whiteScore(data[i], data[i + 1], data[i + 2]);
      n++;
    }
    rowProf.push(n ? s / n : 0);
  }

  const left = crossing(colProf, x0, true);
  const right = crossing(colProf, x0, false);
  const top = crossing(rowProf, y0, true);
  const bottom = crossing(rowProf, y0, false);

  if (left != null && right != null && right - left > 4) {
    // 用边中点
  }
  return {
    x: left != null && right != null ? (left + right) / 2 : (b.minX + b.maxX) / 2,
    y: top != null && bottom != null ? (top + bottom) / 2 : (b.minY + b.maxY) / 2,
  };
}

/** 在投影剖面上找 50% 跨越的亚像素位置；first=true 找左/上沿，否则右/下沿 */
function crossing(prof: number[], origin: number, first: boolean): number | null {
  if (prof.length < 6) return null;
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of prof) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const thr = mn + (mx - mn) * 0.45;
  if (mx - mn < 0.25) return null;
  if (first) {
    for (let i = 1; i < prof.length; i++) {
      if (prof[i - 1] < thr && prof[i] >= thr) {
        const t = (thr - prof[i - 1]) / (prof[i] - prof[i - 1] || 1e-6);
        return origin + i - 1 + t;
      }
    }
  } else {
    for (let i = prof.length - 2; i >= 0; i--) {
      if (prof[i + 1] < thr && prof[i] >= thr) {
        const t = (thr - prof[i]) / (prof[i + 1] - prof[i] || 1e-6);
        return origin + i + t;
      }
    }
  }
  return null;
}

/** 在给定中心附近，用圆盘模板在颜色概率图上做亚像素匹配，精修袋心 */
export function fitDiskCenter(
  prob: Float32Array,
  w: number,
  h: number,
  seedX: number,
  seedY: number,
  radius: number,
  search = 5,
): { x: number; y: number; score: number } {
  const r = Math.max(6, Math.round(radius));
  let bestX = seedX;
  let bestY = seedY;
  let bestScore = -Infinity;
  // 整数网格搜索
  for (let dy = -search; dy <= search; dy += 1) {
    for (let dx = -search; dx <= search; dx += 1) {
      const cx = Math.round(seedX) + dx;
      const cy = Math.round(seedY) + dy;
      const s = diskScore(prob, w, h, cx, cy, r);
      if (s > bestScore) {
        bestScore = s;
        bestX = cx;
        bestY = cy;
      }
    }
  }
  // 抛物线亚像素
  const sxL = diskScore(prob, w, h, bestX - 1, bestY, r);
  const sxR = diskScore(prob, w, h, bestX + 1, bestY, r);
  const syU = diskScore(prob, w, h, bestX, bestY - 1, r);
  const syD = diskScore(prob, w, h, bestX, bestY + 1, r);
  const fx = parabola(sxL, bestScore, sxR);
  const fy = parabola(syU, bestScore, syD);
  return { x: bestX + fx, y: bestY + fy, score: bestScore };
}

function parabola(left: number, mid: number, right: number): number {
  const den = left - 2 * mid + right;
  if (Math.abs(den) < 1e-9) return 0;
  const t = (left - right) / (2 * den);
  return Math.max(-1, Math.min(1, t));
}

/**
 * 用矩形模板在软概率图上做位置+尺度匹配，返回亚像素中心。
 * 得分 = 模板内平均概率（数字暗区随模板一起移动，不影响对准峰值）。
 */
export function fitRectCenter(
  prob: Float32Array,
  w: number,
  h: number,
  seedX: number,
  seedY: number,
  baseW: number,
  baseH: number,
  search = 9,
): { x: number; y: number; score: number; cw: number; ch: number } {
  let best = { x: seedX, y: seedY, score: -1, cw: baseW, ch: baseH };
  for (const scale of [0.92, 1, 1.08]) {
    const rw = Math.max(8, Math.round(baseW * scale));
    const rh = Math.max(8, Math.round(baseH * scale));
    let bx = Math.round(seedX);
    let by = Math.round(seedY);
    let bs = -1;
    for (let dy = -search; dy <= search; dy++) {
      for (let dx = -search; dx <= search; dx++) {
        const cx = Math.round(seedX) + dx;
        const cy = Math.round(seedY) + dy;
        const s = rectScore(prob, w, h, cx, cy, rw, rh);
        if (s > bs) {
          bs = s;
          bx = cx;
          by = cy;
        }
      }
    }
    if (bs > best.score) best = { x: bx, y: by, score: bs, cw: rw, ch: rh };
  }
  const sxL = rectScore(prob, w, h, Math.round(best.x) - 1, Math.round(best.y), best.cw, best.ch);
  const sxR = rectScore(prob, w, h, Math.round(best.x) + 1, Math.round(best.y), best.cw, best.ch);
  const syU = rectScore(prob, w, h, Math.round(best.x), Math.round(best.y) - 1, best.cw, best.ch);
  const syD = rectScore(prob, w, h, Math.round(best.x), Math.round(best.y) + 1, best.cw, best.ch);
  const fx = parabola(sxL, best.score, sxR);
  const fy = parabola(syU, best.score, syD);
  return { ...best, x: best.x + fx, y: best.y + fy };
}

function rectScore(prob: Float32Array, w: number, h: number, cx: number, cy: number, rw: number, rh: number): number {
  const x0 = Math.max(0, Math.round(cx - rw / 2));
  const y0 = Math.max(0, Math.round(cy - rh / 2));
  const x1 = Math.min(w, Math.round(cx + rw / 2));
  const y1 = Math.min(h, Math.round(cy + rh / 2));
  let sum = 0;
  let cnt = 0;
  for (let y = y0; y < y1; y += 1) {
    let row = y * w + x0;
    for (let x = x0; x < x1; x++) {
      sum += prob[row++];
      cnt++;
    }
  }
  return cnt ? sum / cnt : 0;
}

function diskScore(prob: Float32Array, w: number, h: number, cx: number, cy: number, r: number): number {
  let sum = 0;
  let cnt = 0;
  const r2 = r * r;
  const rin2 = (r * 0.92) ** 2;
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy;
    if (y < 1 || y >= h - 1) continue;
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      if (x < 1 || x >= w - 1) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const p = prob[y * w + x];
      // 圆内鼓励颜色，边缘外环轻微惩罚，使峰值对准完整圆盘
      if (d2 <= rin2) sum += p;
      else sum += p * 0.4;
      cnt++;
    }
  }
  return cnt ? sum / cnt : 0;
}

/** 从中心沿各方向射线，求颜色掩膜边缘，生成径向轮廓点 */
export function radialContour(
  mask: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  maxR: number,
  rays = 28,
) {
  const pts: { x: number; y: number }[] = [];
  for (let k = 0; k < rays; k++) {
    const a = (k / rays) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let edge = maxR;
    let seen = 0;
    for (let t = 1; t <= maxR; t++) {
      const x = Math.round(cx + dx * t);
      const y = Math.round(cy + dy * t);
      if (x < 0 || y < 0 || x >= w || y >= h) {
        edge = t;
        break;
      }
      if (mask[y * w + x]) seen = t;
      else if (seen > 0 && t - seen > 3) {
        edge = seen;
        break;
      }
    }
    if (seen > 0) edge = seen;
    pts.push({ x: cx + dx * edge, y: cy + dy * edge });
  }
  return pts;
}
