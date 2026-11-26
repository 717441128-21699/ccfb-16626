import type { Raster } from '../lib/types';
import { codeBitmap } from '../lib/digitFont';
import { ROSTER } from '../lib/roster';

export interface OcrResult {
  code: string;
  confidence: number;
  scale: number;
  ox: number;
  oy: number;
  runnerUp: string;
  margin: number;
}

function isDark(d: Uint8ClampedArray, w: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= w) return false;
  const i = (y * w + x) * 4;
  const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return lum < 112;
}

/** 连续墨迹度 0..1：越深越接近 1，兼容 warp 后的灰边；高饱和彩色（飘带）不计为墨迹 */
function inkAt(d: Uint8ClampedArray, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  const i = (y * w + x) * 4;
  const r = d[i];
  const g = d[i + 1];
  const b = d[i + 2];
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const sat = mx === 0 ? 0 : (mx - mn) / mx;
  // 深色高饱和 = 彩色飘带/袋体而非黑墨，判为无墨
  if (sat > 0.5 && lum < 150) return 0;
  return Math.max(0, Math.min(1, (176 - lum) / 95));
}

/** 把某个编号在 origin、scale 下的点阵与栅格暗像素比对，返回 0..1 命中率（连续软打分） */
function scoreCodeAt(r: Raster, code: string, s: number, ox: number, oy: number): number {
  const bm = codeBitmap(code);
  const d = r.data;
  const w = r.width;
  let score = 0;
  let total = 0;
  for (let row = 0; row < bm.length; row++) {
    for (let col = 0; col < bm[row].length; col++) {
      const bit = bm[row][col];
      let ink = 0;
      let cnt = 0;
      const x0 = ox + col * s;
      const y0 = oy + row * s;
      for (let yy = 0; yy < s; yy++) {
        for (let xx = 0; xx < s; xx++) {
          const px = x0 + xx;
          const py = y0 + yy;
          ink += inkAt(d, w, r.height, px, py);
          cnt++;
        }
      }
      if (cnt === 0) continue;
      const f = ink / cnt;
      // 模板为亮格时奖励“无墨”，暗格时奖励墨迹（连续，避免二值抖动）
      score += bit ? f : 1 - f;
      total++;
    }
  }
  return total ? score / total : 0;
}

interface CodeScore {
  code: string;
  acc: number;
  scale: number;
  ox: number;
  oy: number;
}

/** 对一个疑似编号牌连通域，给全部 40 个编号打分并排序 */
export function rankLabel(
  raster: Raster,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
): CodeScore[] {
  const h = bbox.maxY - bbox.minY + 1;
  const sEst = Math.round((h - 10) / 7);
  const scales = Array.from(new Set([3, sEst, sEst - 1, sEst + 1].filter((s) => s >= 2 && s <= 5)));

  const scores: CodeScore[] = [];
  // 以连通域“中心”为基准反推模板原点：即使 bbox 边缘被杂色撑宽，中心仍稳定
  const ccx = (bbox.minX + bbox.maxX + 1) / 2;
  const ccy = (bbox.minY + bbox.maxY + 1) / 2;
  for (const c of ROSTER) {
    let best: CodeScore = { code: c.code, acc: 0, scale: 3, ox: 0, oy: 0 };
    for (const s of scales) {
      const baseOx = Math.round(ccx - (11 * s) / 2);
      const baseOy = Math.round(ccy - (7 * s) / 2);
      for (let oy = baseOy - 3; oy <= baseOy + 3; oy++) {
        for (let ox = baseOx - 4; ox <= baseOx + 4; ox++) {
          const acc = scoreCodeAt(raster, c.code, s, ox, oy);
          if (acc > best.acc) best = { code: c.code, acc, scale: s, ox, oy };
        }
      }
    }
    scores.push(best);
  }
  scores.sort((a, b) => b.acc - a.acc);
  return scores;
}

/** 判定一个编号牌：置信度足够且冠亚军差距明显 */
export function decodeLabel(
  raster: Raster,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
): OcrResult | null {
  const ranked = rankLabel(raster, bbox);
  const top = ranked[0];
  const second = ranked[1];
  const margin = top.acc - (second?.acc ?? 0);
  if (top.acc >= 0.84 && margin >= 0.02) {
    return {
      code: top.code,
      confidence: top.acc,
      scale: top.scale,
      ox: top.ox,
      oy: top.oy,
      runnerUp: second?.code ?? '',
      margin,
    };
  }
  return null;
}
