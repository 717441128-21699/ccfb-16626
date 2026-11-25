// 匈牙利算法（最小权完美匹配，e-maxx O(n^3)）。
// 输入方阵 cost，返回每行分配到的列 ans[row]=col。
export function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else if (minv[j] !== Infinity) {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const ans = new Array(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] !== 0) ans[p[j] - 1] = j - 1;
  return ans;
}

/**
 * 矩形二分图最大权匹配（候选 × 编号）。
 * 返回 Map<candidateIndex, bibIndex>。用虚拟行列允许任一侧不匹配。
 */
export function assignMaxWeight(weights: number[][]): Map<number, number> {
  const C = weights.length;
  const B = weights[0]?.length ?? 0;
  const m = Math.max(C, B);
  const cost: number[][] = Array.from({ length: m }, () => new Array(m).fill(1));
  for (let i = 0; i < C; i++) {
    for (let j = 0; j < B; j++) {
      // 权重截断到 [0,1]，转代价
      cost[i][j] = 1 - Math.max(0, Math.min(1, weights[i][j]));
    }
  }
  const ans = hungarian(cost);
  const result = new Map<number, number>();
  for (let ci = 0; ci < C; ci++) {
    const bj = ans[ci];
    if (bj >= 0 && bj < B) result.set(ci, bj);
  }
  return result;
}

/**
 * 稳健分配：OCR 极高置信且冠亚军有明显间隔的配对先锁定（防止一个歧义编号
 * 在全局最优里把多个正确编号挤成换号链）；其余行列再做匈牙利匹配。
 */
export function assignRobust(weights: number[][], ocrMat: number[][]): Map<number, number> {
  const C = weights.length;
  const B = weights[0]?.length ?? 0;
  const result = new Map<number, number>();
  const lockedC = new Set<number>();
  const lockedB = new Set<number>();

  interface Lock {
    ci: number;
    bi: number;
    s: number;
  }
  const candidates: Lock[] = [];
  for (let ci = 0; ci < C; ci++) {
    let best = -1;
    let second = -1;
    let bi = -1;
    for (let j = 0; j < B; j++) {
      const s = ocrMat[ci][j];
      if (s > best) {
        second = best;
        best = s;
        bi = j;
      } else if (s > second) second = s;
    }
    if (best >= 0.82 && best - second >= 0.05) candidates.push({ ci, bi, s: best });
  }
  candidates.sort((a, b) => b.s - a.s);
  for (const lk of candidates) {
    if (lockedC.has(lk.ci) || lockedB.has(lk.bi)) continue;
    lockedC.add(lk.ci);
    lockedB.add(lk.bi);
    result.set(lk.ci, lk.bi);
  }

  // 剩余子问题
  const remC: number[] = [];
  const remB: number[] = [];
  for (let ci = 0; ci < C; ci++) if (!lockedC.has(ci)) remC.push(ci);
  for (let bi = 0; bi < B; bi++) if (!lockedB.has(bi)) remB.push(bi);
  if (remC.length && remB.length) {
    const sub = remC.map((ci) => remB.map((bi) => weights[ci][bi]));
    const pairing = assignMaxWeight(sub);
    for (const [sci, sbi] of pairing) {
      const ci = remC[sci];
      const bi = remB[sbi];
      if (ci == null || bi == null) continue;
      result.set(ci, bi);
    }
  }
  return result;
}
