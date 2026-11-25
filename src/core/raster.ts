// 轻量软件光栅：直接写 RGBA。浏览器端可 putImageData，Node 自测可编码 PNG。
// 只实现样例生成需要的图元，边缘做 1px 羽化抗锯齿。

import { DIGITS, DIGIT_H, DIGIT_W } from './font5x7';

export type RGBA = Uint8ClampedArray;

export class Raster {
  w: number;
  h: number;
  data: RGBA;

  constructor(w: number, h: number, data?: RGBA) {
    this.w = w;
    this.h = h;
    this.data = data ?? new Uint8ClampedArray(w * h * 4);
    if (!data) {
      // 默认不透明白底
      for (let i = 3; i < this.data.length; i += 4) this.data[i] = 255;
    }
  }

  clear(r: number, g: number, b: number, a = 255) {
    const d = this.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = a;
    }
  }

  /** alpha 混合单个像素，fa 为额外覆盖强度 0..1 */
  blend(x: number, y: number, r: number, g: number, b: number, alpha: number) {
    const xi = x | 0;
    const yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h || alpha <= 0) return;
    const i = (yi * this.w + xi) * 4;
    const a = Math.min(1, alpha);
    const ia = 1 - a;
    const d = this.data;
    d[i] = d[i] * ia + r * a;
    d[i + 1] = d[i + 1] * ia + g * a;
    d[i + 2] = d[i + 2] * ia + b * a;
    d[i + 3] = 255;
  }

  fillRect(x0: number, y0: number, w: number, h: number, rgb: [number, number, number], alpha = 1) {
    const x1 = Math.max(0, Math.floor(x0));
    const y1 = Math.max(0, Math.floor(y0));
    const x2 = Math.min(this.w, Math.ceil(x0 + w));
    const y2 = Math.min(this.h, Math.ceil(y0 + h));
    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) this.blend(x, y, rgb[0], rgb[1], rgb[2], alpha);
    }
  }

  /** 圆角矩形（含圆角覆盖） */
  roundRect(cx: number, cy: number, w: number, h: number, rad: number, rgb: [number, number, number], alpha = 1) {
    const left = cx - w / 2;
    const top = cy - h / 2;
    const r = Math.min(rad, w / 2, h / 2);
    const x0 = Math.max(0, Math.floor(left) - 1);
    const x1 = Math.min(this.w - 1, Math.ceil(left + w) + 1);
    const y0 = Math.max(0, Math.floor(top) - 1);
    const y1 = Math.min(this.h - 1, Math.ceil(top + h) + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        // 到内部矩形的距离
        const qx = Math.max(left + r - px, 0, px - (left + w - r));
        const qy = Math.max(top + r - py, 0, py - (top + h - r));
        const outside = Math.hypot(qx, qy);
        let cov = 0;
        if (outside <= r - 0.5) cov = 1;
        else if (outside <= r + 0.5) cov = r + 0.5 - outside;
        if (cov > 0) this.blend(x, y, rgb[0], rgb[1], rgb[2], alpha * cov);
      }
    }
  }

  circle(cx: number, cy: number, rad: number, rgb: [number, number, number], alpha = 1) {
    const x0 = Math.max(0, Math.floor(cx - rad) - 1);
    const x1 = Math.min(this.w - 1, Math.ceil(cx + rad) + 1);
    const y0 = Math.max(0, Math.floor(cy - rad) - 1);
    const y1 = Math.min(this.h - 1, Math.ceil(cy + rad) + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        let cov = 0;
        if (d <= rad - 0.5) cov = 1;
        else if (d <= rad + 0.5) cov = rad + 0.5 - d;
        if (cov > 0) this.blend(x, y, rgb[0], rgb[1], rgb[2], alpha * cov);
      }
    }
  }

  /** 椭圆（允许旋转 angle），用局部坐标距离近似羽化 */
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    angle: number,
    rgb: [number, number, number],
    alpha = 1,
  ) {
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const R = Math.max(rx, ry) + 1;
    const x0 = Math.max(0, Math.floor(cx - R));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + R));
    const y0 = Math.max(0, Math.floor(cy - R));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + R));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const lx = dx * ca + dy * sa;
        const ly = -dx * sa + dy * ca;
        const d = (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry);
        // d≈1 边界，做宽度羽化
        let cov = 0;
        const edge = 1 / Math.min(rx, ry);
        if (d <= 1 - edge) cov = 1;
        else if (d <= 1 + edge) cov = (1 + edge - d) / (2 * edge);
        if (cov > 0) this.blend(x, y, rgb[0], rgb[1], rgb[2], alpha * Math.max(0, Math.min(1, cov)));
      }
    }
  }

  /** 粗线段（圆头），距离场羽化 */
  line(x0: number, y0: number, x1: number, y1: number, width: number, rgb: [number, number, number], alpha = 1) {
    const hw = width / 2;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - hw - 1));
    const maxX = Math.min(this.w - 1, Math.ceil(Math.max(x0, x1) + hw + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - hw - 1));
    const maxY = Math.min(this.h - 1, Math.ceil(Math.max(y0, y1) + hw + 1));
    const vx = x1 - x0;
    const vy = y1 - y0;
    const len2 = vx * vx + vy * vy || 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let t = ((px - x0) * vx + (py - y0) * vy) / len2;
        t = Math.max(0, Math.min(1, t));
        const cx = x0 + t * vx;
        const cy = y0 + t * vy;
        const d = Math.hypot(px - cx, py - cy);
        let cov = 0;
        if (d <= hw - 0.5) cov = 1;
        else if (d <= hw + 0.5) cov = hw + 0.5 - d;
        if (cov > 0) this.blend(x, y, rgb[0], rgb[1], rgb[2], alpha * cov);
      }
    }
  }

  polyline(pts: { x: number; y: number }[], width: number, rgb: [number, number, number], alpha = 1) {
    for (let i = 0; i < pts.length - 1; i++) {
      this.line(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, width, rgb, alpha);
    }
    // 关节圆点
    for (const p of pts) this.circle(p.x, p.y, width / 2, rgb, alpha);
  }

  /** 填充多边形（扫描线），支持凸/凹简单多边形 */
  polygon(pts: { x: number; y: number }[], rgb: [number, number, number], alpha = 1) {
    if (pts.length < 3) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.h - 1, Math.ceil(maxY));
    const xs: number[] = [];
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a.y <= py && b.y > py) || (b.y <= py && a.y > py)) {
          const t = (py - a.y) / (b.y - a.y);
          xs.push(a.x + t * (b.x - a.x));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const l = Math.max(0, Math.ceil(xs[k] - 0.5));
        const r = Math.min(this.w - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = l; x <= r; x++) this.blend(x, y, rgb[0], rgb[1], rgb[2], alpha);
      }
    }
  }

  /** 5x7 数字串，cell 为每个点阵像素的边长（物理像素） */
  digitText(
    text: string,
    cx: number,
    cy: number,
    cell: number,
    rgb: [number, number, number],
    alpha = 1,
    angle = 0,
  ) {
    const layout = (() => {
      const n = text.length;
      const gap = Math.max(1, Math.round(cell));
      const digitW = DIGIT_W * cell;
      const digitH = DIGIT_H * cell;
      const totalW = n * digitW + (n - 1) * gap;
      return { n, gap, digitW, digitH, totalW };
    })();
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    let cursor = -layout.totalW / 2;
    for (const ch of text) {
      const rows = DIGITS[ch] ?? DIGITS['0'];
      for (let ry = 0; ry < DIGIT_H; ry++) {
        for (let rx = 0; rx < DIGIT_W; rx++) {
          if (rows[ry][rx] !== '1') continue;
          // 单元中心相对文本中心
          const lx = cursor + rx * cell + cell / 2;
          const ly = -layout.digitH / 2 + ry * cell + cell / 2;
          const wx = cx + lx * ca - ly * sa;
          const wy = cy + lx * sa + ly * ca;
          if (angle === 0) {
            this.fillRect(wx - cell / 2 + 0.4, wy - cell / 2 + 0.4, cell - 0.8, cell - 0.8, rgb, alpha);
          } else {
            // 旋转时用小方块近似为圆
            this.circle(wx, wy, cell * 0.42, rgb, alpha);
          }
        }
      }
      cursor += layout.digitW + layout.gap;
    }
  }

  /** 整体亮度/色温分级（乘性 + 加性 + 暗角 + 颗粒） */
  grade(opts: {
    mul: [number, number, number];
    add?: [number, number, number];
    vignette?: number; // 0..1
    grain?: number;
    seed?: number;
  }) {
    const { mul, add = [0, 0, 0], vignette = 0, grain = 0, seed = 7 } = opts;
    const d = this.data;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const maxD = Math.hypot(cx, cy);
    let s = seed >>> 0;
    const rnd = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        let vg = 1;
        if (vignette > 0) {
          const dd = Math.hypot(x - cx, y - cy) / maxD;
          vg = 1 - vignette * dd * dd;
        }
        const nz = grain ? (rnd() - 0.5) * grain : 0;
        d[i] = clamp255((d[i] * mul[0] + add[0] + nz) * vg);
        d[i + 1] = clamp255((d[i + 1] * mul[1] + add[1] + nz) * vg);
        d[i + 2] = clamp255((d[i + 2] * mul[2] + add[2] + nz) * vg);
      }
    }
  }

  /** 3x3 盒式模糊一遍（可重复），用于轻微柔化点阵边缘 */
  boxBlur(radius = 1) {
    const src = new Uint8ClampedArray(this.data);
    const d = this.data;
    const w = this.w;
    const h = this.h;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let cnt = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const i = (yy * w + xx) * 4;
            r += src[i];
            g += src[i + 1];
            b += src[i + 2];
            a += src[i + 3];
            cnt++;
          }
        }
        const i = (y * w + x) * 4;
        d[i] = r / cnt;
        d[i + 1] = g / cnt;
        d[i + 2] = b / cnt;
        d[i + 3] = a / cnt;
      }
    }
  }
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
