// 两遍法连通域标记（8 邻域），带并查集与统计
export interface Comp {
  id: number;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumX: number;
  sumY: number;
}

export interface CCResult {
  labels: Int32Array;
  comps: Comp[];
}

export function connectedComponents(mask: Uint8Array, w: number, h: number, conn8 = true): CCResult {
  const labels = new Int32Array(w * h);
  const parent: number[] = [0];
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== x) {
      const nxt = parent[x];
      parent[x] = r;
      x = nxt;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      if (ra < rb) parent[rb] = ra;
      else parent[ra] = rb;
    }
  };

  let next = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!mask[idx]) continue;
      const up = y > 0 ? labels[idx - w] : 0;
      const left = x > 0 ? labels[idx - 1] : 0;
      const ul = conn8 && y > 0 && x > 0 ? labels[idx - w - 1] : 0;
      const ur = conn8 && y > 0 && x < w - 1 ? labels[idx - w + 1] : 0;
      let lab = 0;
      const neigh = [up, left, ul, ur].filter((v) => v > 0);
      if (neigh.length === 0) {
        lab = next++;
        parent[lab] = lab;
        labels[idx] = lab;
      } else {
        lab = neigh[0];
        labels[idx] = lab;
        for (let k = 1; k < neigh.length; k++) union(lab, neigh[k]);
      }
    }
  }

  const rootMap = new Map<number, number>();
  const comps: Comp[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const lab = labels[idx];
      if (!lab) continue;
      const root = find(lab);
      let cid = rootMap.get(root);
      if (cid === undefined) {
        cid = comps.length;
        rootMap.set(root, cid);
        comps.push({
          id: cid,
          area: 0,
          minX: x,
          minY: y,
          maxX: x,
          maxY: y,
          sumX: 0,
          sumY: 0,
        });
      }
      labels[idx] = cid + 1; // 1-based 最终 id
      const c = comps[cid];
      c.area++;
      c.sumX += x + 0.5;
      c.sumY += y + 0.5;
      if (x < c.minX) c.minX = x;
      if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y;
      if (y > c.maxY) c.maxY = y;
    }
  }
  return { labels, comps };
}
