import type { Pt } from './types';

/** 3x3 单应矩阵，行优先 9 元素 */
export type Mat3 = number[];

export function applyH(h: Mat3, x: number, y: number): Pt {
  const z = h[6] * x + h[7] * y + h[8];
  const iz = 1 / z;
  return {
    x: (h[0] * x + h[1] * y + h[2]) * iz,
    y: (h[3] * x + h[4] * y + h[5]) * iz,
  };
}

/** 3x3 求逆 */
export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, hh, i] = m;
  const A = e * i - f * hh;
  const B = -(d * i - f * g);
  const C = d * hh - e * g;
  const D = -(b * i - c * hh);
  const E = a * i - c * g;
  const F = -(a * hh - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  const id = 1 / det;
  return [A * id, D * id, G * id, B * id, E * id, H * id, C * id, F * id, I * id];
}

/** Jacobi 特征分解：对称矩阵 a（n*n），返回特征值与特征向量（列） */
function jacobiEigen(aIn: number[], n: number): { values: number[]; vectors: number[][] } {
  const a = aIn.slice();
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let iter = 0; iter < 60; iter++) {
    // 找最大非对角元
    let p = 0;
    let q = 1;
    let max = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const abs = Math.abs(a[i * n + j]);
        if (abs > max) {
          max = abs;
          p = i;
          q = j;
        }
      }
    }
    if (max < 1e-13) break;
    const app = a[p * n + p];
    const aqq = a[q * n + q];
    const apq = a[p * n + q];
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    for (let k = 0; k < n; k++) {
      const akp = a[k * n + p];
      const akq = a[k * n + q];
      a[k * n + p] = c * akp - s * akq;
      a[k * n + q] = s * akp + c * akq;
    }
    for (let k = 0; k < n; k++) {
      const apk = a[p * n + k];
      const aqk = a[q * n + k];
      a[p * n + k] = c * apk - s * aqk;
      a[q * n + k] = s * apk + c * aqk;
    }
    for (let k = 0; k < n; k++) {
      const vkp = v[k][p];
      const vkq = v[k][q];
      v[k][p] = c * vkp - s * vkq;
      v[k][q] = s * vkp + c * vkq;
    }
  }
  const values: number[] = [];
  for (let i = 0; i < n; i++) values.push(a[i * n + i]);
  return { values, vectors: v };
}

/**
 * DLT 求单应 src -> dst。至少 4 对对应点；多于 4 对时最小二乘。
 * 做各向同性归一化以保证数值稳定。
 */
export function solveHomography(src: Pt[], dst: Pt[]): Mat3 {
  const n = Math.min(src.length, dst.length);
  if (n < 4) throw new Error('求解单应矩阵至少需要 4 个控制点');

  const normalize = (pts: Pt[]) => {
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p.x;
      cy += p.y;
    }
    cx /= pts.length;
    cy /= pts.length;
    let meanDist = 0;
    for (const p of pts) meanDist += Math.hypot(p.x - cx, p.y - cy);
    meanDist /= pts.length || 1;
    const scale = meanDist > 1e-9 ? Math.SQRT2 / meanDist : 1;
    // T = [[s,0,-s cx],[0,s,-s cy],[0,0,1]]
    const T: Mat3 = [scale, 0, -scale * cx, 0, scale, -scale * cy, 0, 0, 1];
    const out = pts.map((p) => ({ x: scale * (p.x - cx), y: scale * (p.y - cy) }));
    return { T, out };
  };

  const ns = normalize(src.slice(0, n));
  const nd = normalize(dst.slice(0, n));

  const rows: number[] = [];
  for (let i = 0; i < n; i++) {
    const { x, y } = ns.out[i];
    const { x: X, y: Y } = nd.out[i];
    rows.push(-x, -y, -1, 0, 0, 0, X * x, X * y, X);
    rows.push(0, 0, 0, -x, -y, -1, Y * x, Y * y, Y);
  }
  const m = n * 2;
  // AtA 9x9
  const ata = new Array(81).fill(0);
  for (let r = 0; r < m; r++) {
    for (let i = 0; i < 9; i++) {
      const rv = rows[r * 9 + i];
      for (let j = 0; j < 9; j++) {
        ata[i * 9 + j] += rv * rows[r * 9 + j];
      }
    }
  }
  const eig = jacobiEigen(ata, 9);
  let minIdx = 0;
  for (let i = 1; i < 9; i++) if (eig.values[i] < eig.values[minIdx]) minIdx = i;
  // 最小特征值对应特征向量（jacobi 返回 vectors[k][col]？这里 v 行是坐标、列是特征向量）
  const hn: number[] = [];
  for (let k = 0; k < 9; k++) hn.push(eig.vectors[k][minIdx]);

  // 反归一化：H = T_dst^-1 * Hn * T_src
  const Hn = hn as Mat3;
  const H = mul3(mul3(invert3(nd.T), Hn), ns.T);
  // 归一化 h8 = 1
  const s = H[8] || 1;
  return H.map((v) => v / s);
}

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] =
        a[r * 3 + 0] * b[0 * 3 + c] +
        a[r * 3 + 1] * b[1 * 3 + c] +
        a[r * 3 + 2] * b[2 * 3 + c];
    }
  }
  return o;
}

/** 控制点重投影误差（像素，RMS 与逐点） */
export function reprojectionErrors(
  groundToImage: Mat3,
  ground: Pt[],
  image: Pt[],
): { rms: number; perPoint: number[] } {
  const perPoint: number[] = [];
  let sum = 0;
  for (let i = 0; i < ground.length; i++) {
    const p = applyH(groundToImage, ground[i].x, ground[i].y);
    const e = Math.hypot(p.x - image[i].x, p.y - image[i].y);
    perPoint.push(e);
    sum += e * e;
  }
  return { rms: Math.sqrt(sum / Math.max(1, ground.length)), perPoint };
}

/** 地面距离（厘米），地面坐标单位为米 */
export function distanceCm(gx: number, gy: number): number {
  return Math.hypot(gx, gy) * 100;
}
