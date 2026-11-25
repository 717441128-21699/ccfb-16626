// 编号识别：按标签几何把数字窗口归一化到 5x7，与内置字体模板比对。
// 生成端与识别端共用 font5x7，保证合成样例上的可信度。

import { DIGITS, DIGIT_H, DIGIT_W } from './font5x7';

export interface DigitObs {
  /** 0..9 每个数字的相似度 0..1 */
  scores: number[];
  best: number;
  bestScore: number;
  margin: number;
  mask: Uint8Array;
}

const TEMPLATES: Uint8Array[] = Array.from({ length: 10 }, (_, d) => {
  const rows = DIGITS[String(d)];
  const m = new Uint8Array(DIGIT_W * DIGIT_H);
  for (let y = 0; y < DIGIT_H; y++)
    for (let x = 0; x < DIGIT_W; x++) m[y * DIGIT_W + x] = rows[y][x] === '1' ? 1 : 0;
  return m;
});

function luminance(data: Uint8ClampedArray | Uint8Array, i: number): number {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

/**
 * 在以 (cx,cy) 为中心、标签高 bboxH 的白标签内识别 n 位数字。
 * 允许窗口有 ±2 物理像素的微小平移。
 */
export function readLabel(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  bboxH: number,
  n: 1 | 2,
): { digits: DigitObs[]; total: number } | null {
  const baseCell = bboxH / 9.2;
  if (baseCell < 1.1 || baseCell > 7) return null;

  let best: { digits: DigitObs[]; total: number } | null = null;
  // 尺度 × 平移联合搜索，提升 9/4/7 等相近字形在二次重采样后的区分度
  for (const mul of [0.9, 0.97, 1.04, 1.11]) {
    const cell = baseCell * mul;
    const digitW = DIGIT_W * cell;
    const digitH = DIGIT_H * cell;
    const gap = cell;
    const totalW = n * digitW + (n - 1) * gap;
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        const xStart = cx + ox - totalW / 2;
        const yTop = cy + oy - digitH / 2;
        const digits: DigitObs[] = [];
        let total = 0;
        let valid = true;
        for (let k = 0; k < n; k++) {
          const wx = xStart + k * (digitW + gap);
          const obs = readDigitWindow(data, w, h, wx, yTop, digitW, digitH);
          if (!obs) {
            valid = false;
            break;
          }
          digits.push(obs);
          total += obs.bestScore;
        }
        if (valid) {
          total /= n;
          if (!best || total > best.total) best = { digits, total };
        }
      }
    }
  }
  return best;
}

function readDigitWindow(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  wx: number,
  wy: number,
  ww: number,
  wh: number,
): DigitObs | null {
  const ink = new Float32Array(DIGIT_W * DIGIT_H);
  for (let gy = 0; gy < DIGIT_H; gy++) {
    for (let gx = 0; gx < DIGIT_W; gx++) {
      const x0 = Math.floor(wx + (gx / DIGIT_W) * ww);
      const x1 = Math.max(x0 + 1, Math.floor(wx + ((gx + 1) / DIGIT_W) * ww));
      const y0 = Math.floor(wy + (gy / DIGIT_H) * wh);
      const y1 = Math.max(y0 + 1, Math.floor(wy + ((gy + 1) / DIGIT_H) * wh));
      let dark = 0;
      let cnt = 0;
      for (let y = y0; y < y1; y++) {
        if (y < 0 || y >= h) continue;
        for (let x = x0; x < x1; x++) {
          if (x < 0 || x >= w) continue;
          const i = (y * w + x) * 4;
          if (luminance(data, i) < 130) dark++;
          cnt++;
        }
      }
      ink[gy * DIGIT_W + gx] = cnt ? dark / cnt : 0;
    }
  }
  const scores = TEMPLATES.map((tpl) => {
    let s = 0;
    for (let i = 0; i < tpl.length; i++) {
      s += tpl[i] ? ink[i] : 1 - ink[i];
    }
    return s / tpl.length;
  });
  let best = 0;
  let second = 0;
  let bi = 0;
  for (let d = 0; d < 10; d++) {
    if (scores[d] > best) {
      second = best;
      best = scores[d];
      bi = d;
    } else if (scores[d] > second) second = scores[d];
  }
  const mask = new Uint8Array(DIGIT_W * DIGIT_H);
  for (let i = 0; i < mask.length; i++) mask[i] = ink[i] > 0.42 ? 1 : 0;
  return { scores, best: bi, bestScore: best, margin: best - second, mask };
}

/** 某标签 OCR 结果对某个参赛编号的相似度（0..1），位数不符给长度惩罚 */
export function bibOcrSimilarity(
  result: { digits: DigitObs[]; total: number } | null,
  bib: number,
): number {
  if (!result) return 0;
  const chars = String(bib).split('').map(Number);
  if (chars.length !== result.digits.length) {
    // 允许 1/2 位轻微不符，但重罚
    return result.total * 0.25;
  }
  let s = 0;
  for (let k = 0; k < chars.length; k++) s += result.digits[k].scores[chars[k]];
  return s / chars.length;
}
