// 二维几何 / 单应矩阵（DLT + Hartley 归一化）/ 双线性重采样。
// 纯 TS，可在 Worker 与 Node 自测中运行。

import type { Pt } from './types';

export type Mat3 = number[]; // length 9, row-major

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function applyH(H: Mat3, x: number, y: number): Pt {
  const w = H[6] * x + H[7] * y + H[8];
  const iw = 1 / w;
  return {
    x: (H[0] * x + H[1] * y + H[2]) * iw,
    y: (H[3] * x + H[4] * y + H[5]) * iw,
  };
}

export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  const id = 1 / det;
  return [A * id, D * id, G * id, B * id, E * id, H * id, C * id, F * id, I * id];
}

/** 高斯消元解线性方程组 A x = b（n 阶） */
function solveSquare(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error('单应求解失败：矩阵奇异（控制点可能共线/重合）');
    [M[col], M[piv]] = [M[piv], M[col]];
    const pv = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

interface Norm {
  T: Mat3;
  pts: Pt[];
}

/** Hartley 归一化：质心到原点，平均距离 sqrt(2) */
function normalize(pts: Pt[]): Norm {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  let md = 0;
  for (const p of pts) md += Math.hypot(p.x - cx, p.y - cy);
  md /= pts.length;
  const s = Math.SQRT2 / Math.max(md, 1e-9);
  const T: Mat3 = [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
  return {
    T,
    pts: pts.map((p) => ({ x: s * (p.x - cx), y: s * (p.y - cy) })),
  };
}

/**
 * 由对应点求单应 src -> dst。至少 4 组；>4 用最小二乘（法方程 + 归一化）。
 */
export function findHomography(src: Pt[], dst: Pt[]): Mat3 {
  const n = src.length;
  if (n < 4) throw new Error('解算单应至少需要 4 个控制点');
  const ns = normalize(src);
  const nd = normalize(dst);
  const s = ns.pts;
  const d = nd.pts;

  // 未知量 h1..h8，h9=1
  const A: number[][] = [];
  const b: number[] = [];
  for (let k = 0; k < n; k++) {
    const u = s[k].x;
    const v = s[k].y;
    const x = d[k].x;
    const y = d[k].y;
    A.push([u, v, 1, 0, 0, 0, -x * u, -x * v]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -y * u, -y * v]);
    b.push(y);
  }

  let h8: number[];
  if (n === 4) {
    h8 = solveSquare(A, b);
  } else {
    const m = 8;
    const AtA: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
    const Atb: number[] = new Array(m).fill(0);
    for (let r = 0; r < A.length; r++) {
      const row = A[r];
      for (let i = 0; i < m; i++) {
        Atb[i] += row[i] * b[r];
        for (let j = 0; j < m; j++) AtA[i][j] += row[i] * row[j];
      }
    }
    h8 = solveSquare(AtA, Atb);
  }
  const Hn: Mat3 = [h8[0], h8[1], h8[2], h8[3], h8[4], h8[5], h8[6], h8[7], 1];
  // H_raw = inv(T_dst) * Hn * T_src
  const H = mul3(invert3(nd.T), mul3(Hn, ns.T));
  // 归一化 H[8]=1
  const z = H[8] || 1;
  return H.map((v) => v / z) as Mat3;
}

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] =
        a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return r as Mat3;
}

/** 重投影误差（像素 / 米由坐标单位决定） */
export function reprojectionRmse(H: Mat3, src: Pt[], dst: Pt[]): { rmse: number; residuals: number[] } {
  const residuals: number[] = [];
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    const p = applyH(H, src[i].x, src[i].y);
    const e = Math.hypot(p.x - dst[i].x, p.y - dst[i].y);
    residuals.push(e);
    sum += e * e;
  }
  return { rmse: Math.sqrt(sum / src.length), residuals };
}

function bilinearSample(
  src: Uint8ClampedArray | Uint8Array,
  sw: number,
  sh: number,
  u: number,
  v: number,
  out: Uint8ClampedArray,
  oi: number,
): void {
  if (u < 0 || v < 0 || u > sw - 1 || v > sh - 1) {
    // 越界：透明/黑边
    out[oi] = 18;
    out[oi + 1] = 22;
    out[oi + 2] = 20;
    out[oi + 3] = 255;
    return;
  }
  const x0 = u | 0;
  const y0 = v | 0;
  const fx = u - x0;
  const fy = v - y0;
  const x1 = Math.min(x0 + 1, sw - 1);
  const y1 = Math.min(y0 + 1, sh - 1);
  const i00 = (y0 * sw + x0) * 4;
  const i10 = (y0 * sw + x1) * 4;
  const i01 = (y1 * sw + x0) * 4;
  const i11 = (y1 * sw + x1) * 4;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  for (let c = 0; c < 3; c++) {
    out[oi + c] =
      src[i00 + c] * w00 + src[i10 + c] * w10 + src[i01 + c] * w01 + src[i11 + c] * w11;
  }
  out[oi + 3] = 255;
}

export interface WarpOptions {
  /** 输出像素中心 -> 地面米 */
  pixelToGround: (px: number, py: number) => Pt;
  /** 地面米 -> 输入照片像素 */
  groundToInput: Mat3;
  bg?: [number, number, number];
}

/** 把输入 RGBA 按单应反采样到输出 RGBA */
export function warpRGBA(
  src: Uint8ClampedArray | Uint8Array,
  sw: number,
  sh: number,
  outW: number,
  outH: number,
  opts: WarpOptions,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(outW * outH * 4);
  const H = opts.groundToInput;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const g = opts.pixelToGround(x + 0.5, y + 0.5);
      const ph = H[6] * g.x + H[7] * g.y + H[8];
      const u = (H[0] * g.x + H[1] * g.y + H[2]) / ph;
      const v = (H[3] * g.x + H[4] * g.y + H[5]) / ph;
      bilinearSample(src, sw, sh, u, v, out, (y * outW + x) * 4);
    }
  }
  return out;
}

/** 米坐标 -> 正射像素 */
export function groundToOrthoPx(g: Pt, siteMinX: number, siteMinY: number, ppm: number): Pt {
  return { x: (g.x - siteMinX) * ppm, y: (g.y - siteMinY) * ppm };
}
