import type { RGB } from './types';

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

export function colorDist(a: RGB, b: RGB): number {
  // 加权欧氏距离（近似人眼）
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

export function medianColor(pixels: Uint8ClampedArray, indices: number[]): RGB {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (const idx of indices) {
    rs.push(pixels[idx]);
    gs.push(pixels[idx + 1]);
    bs.push(pixels[idx + 2]);
  }
  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const m = rs.length >> 1;
  return [rs[m], gs[m], bs[m]];
}

/** 在候选注册色中找最接近者，返回编号下标与距离 */
export function nearestColor(
  c: RGB,
  palette: Array<{ code: string; color: RGB }>,
): { code: string; dist: number } {
  let best = palette[0]?.code ?? '';
  let bd = Infinity;
  for (const p of palette) {
    const d = colorDist(c, p.color);
    if (d < bd) {
      bd = d;
      best = p.code;
    }
  }
  return { code: best, dist: bd };
}
