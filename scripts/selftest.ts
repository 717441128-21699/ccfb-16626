/* 自测：生成样例 -> GCP 解算 -> 校正 -> Worker 同款检测 -> 对照真值/裁判。
   运行：npm run selftest [presetId]
*/
import path from 'node:path';
import { createDataset, renderWorld, renderAerialPhoto, listPresets } from '../src/core/scene';
import { findHomography, invert3, warpRGBA, reprojectionRmse, applyH } from '../src/core/geometry';
import { detectMarkers } from '../src/core/detect';
import { Raster } from '../src/core/raster';
import { writePNG, downscale } from './png';
import type { SampleDataset } from '../src/core/types';

const OUT = path.resolve(process.cwd(), '.selftest');
const only = process.argv[2];

function runOne(presetId: string) {
  const preset = listPresets.find((p) => p.id === presetId) ?? listPresets[0];
  const ds: SampleDataset = createDataset({ terrain: preset.terrain, light: preset.light });
  console.log(`\n================ ${ds.id}  ${ds.title} ================`);

  const t0 = Date.now();
  const world = renderWorld(ds);
  const photo = renderAerialPhoto(ds, world);
  console.log(`渲染 world ${ds.orthoW}x${ds.orthoH}, photo ${photo.width}x${photo.height}，用时 ${Date.now() - t0}ms`);

  // GCP：照片像素 -> 地面米
  const src = ds.gcps.map((g) => ({ x: g.px, y: g.py }));
  const dst = ds.gcps.map((g) => ({ x: g.x, y: g.y }));
  const H = findHomography(src, dst);
  const reproj = reprojectionRmse(H, src, dst);
  console.log(`GCP 重投影 RMSE = ${(reproj.rmse * 100).toFixed(3)} cm（地面单位）`);

  const Hgp = invert3(H);
  const ortho = warpRGBA(photo.rgba, photo.width, photo.height, ds.orthoW, ds.orthoH, {
    pixelToGround: (px, py) => ({ x: px / ds.ppm, y: py / ds.ppm }),
    groundToInput: Hgp,
  });

  const t1 = Date.now();
  const res = detectMarkers(ortho, ds.orthoW, ds.orthoH, {
    players: ds.players,
    ppm: ds.ppm,
    target: ds.target,
    zoneRadius: ds.zoneRadius,
    excludeCircles: ds.gcps.map((g) => ({
      x: g.x * ds.ppm,
      y: g.y * ds.ppm,
      r: g.id === 'T' ? 34 : 48,
    })),
  });
  console.log(`检测用时 ${Date.now() - t1}ms（管线自报 ${res.stats.totalMs.toFixed(0)}ms），候选标签 ${res.stats.labelCount}，色连通域 ${res.stats.componentCount}`);

  const truth = new Map(ds.bags.map((b) => [b.bib, b]));
  const ref = new Map(ds.referee.map((r) => [r.bib, r.distanceM]));

  // 几何最近真值匹配（独立于编号）
  const posErrs: number[] = [];
  const refErrs: number[] = [];
  let idCorrect = 0;
  let idWrong = 0;
  const worst: Array<{ bib: number | null; near: number; posCm: number; refCm?: number; method: string; ocr: string }> = [];

  for (const d of res.detections) {
    let near = ds.bags[0];
    let nd = Infinity;
    for (const b of ds.bags) {
      const dd = Math.hypot(d.gx - b.x, d.gy - b.y);
      if (dd < nd) {
        nd = dd;
        near = b;
      }
    }
    const posCm = nd * 100;
    posErrs.push(posCm);
    const bibOk = d.bib === near.bib;
    if (bibOk) idCorrect++;
    else idWrong++;
    const refD = d.bib != null ? ref.get(d.bib) : undefined;
    let refCm: number | undefined;
    if (refD != null) {
      refCm = Math.abs(d.distanceM - refD) * 100;
      refErrs.push(refCm);
    }
    worst.push({ bib: d.bib, near: near.bib, posCm, refCm, method: d.method, ocr: d.ocrText });
  }

  const detectedBibs = new Set(res.detections.map((d) => d.bib));
  const missing = ds.bags.map((b) => b.bib).filter((b) => !detectedBibs.has(b));
  console.log(`检出 ${res.detections.length}/40，编号几何一致 ${idCorrect}，错号 ${idWrong}，缺号 ${missing.join(',') || '无'}`);

  const sorted = [...worst].sort((a, b) => b.posCm - a.posCm);
  console.log('位置误差最差 12 个：');
  for (const w of sorted.slice(0, 12)) {
    console.log(
      `  bib=${String(w.bib).padStart(3)} near=${String(w.near).padStart(3)} pos=${w.posCm.toFixed(2)}cm refΔ=${w.refCm != null ? w.refCm.toFixed(2) : '  -  '} ${w.method.padEnd(12)} ocr="${w.ocr}"`,
    );
  }
  const pct = (arr: number[], q: number) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
  };
  console.log(
    `位置误差 cm: mean=${(posErrs.reduce((a, b) => a + b, 0) / posErrs.length).toFixed(2)} p95=${pct(posErrs, 0.95).toFixed(2)} max=${Math.max(...posErrs).toFixed(2)}`,
  );
  if (refErrs.length)
    console.log(
      `对裁判测距偏差 cm: mean=${(refErrs.reduce((a, b) => a + b, 0) / refErrs.length).toFixed(2)} p95=${pct(refErrs, 0.95).toFixed(2)} max=${Math.max(...refErrs).toFixed(2)} ≤1cm:${refErrs.filter((e) => e <= 1).length}/40 ≤2cm:${refErrs.filter((e) => e <= 2).length}/40`,
    );

  // 特殊考点
  for (const bib of [7, 23, 12, 31, 3, 19, 27, 9, 4, 29]) {
    const d = res.detections.find((x) => x.bib === bib);
    const t = truth.get(bib)!;
    if (!d) {
      console.log(`  考点 bib ${bib}: 未识别`);
      continue;
    }
    console.log(
      `  考点 ${String(bib).padStart(2)} ${t.kind.padEnd(6)} ${t.surface.padEnd(7)} 位置误差=${(Math.hypot(d.gx - t.x, d.gy - t.y) * 100).toFixed(2)}cm 裁判Δ=${(Math.abs(d.distanceM - ref.get(bib)!) * 100).toFixed(2)}cm ${d.method} split=${d.mergedSplit ? 'Y' : 'N'} conf=${d.confidence.toFixed(2)}`,
    );
  }

  // ---------- 调试图 ----------
  const dir = path.join(OUT, ds.id);
  const ph = downscale(photo.rgba, photo.width, photo.height, 1400);
  writePNG(path.join(dir, 'photo.png'), ph.data, ph.w, ph.h);

  const ov = new Raster(ds.orthoW, ds.orthoH, ortho);
  // 真值红叉
  for (const b of ds.bags) {
    const x = b.x * ds.ppm;
    const y = b.y * ds.ppm;
    ov.line(x - 7, y - 7, x + 7, y + 7, 2, [255, 60, 60], 0.9);
    ov.line(x - 7, y + 7, x + 7, y - 7, 2, [255, 60, 60], 0.9);
  }
  // 检测绿圈 + 到十字连线 + 编号
  const tx = ds.target.x * ds.ppm;
  const ty = ds.target.y * ds.ppm;
  for (const d of res.detections) {
    ov.line(tx, ty, d.cx, d.cy, 2, [255, 220, 60], 0.55);
    for (let i = 0; i < d.contour.length; i++) {
      const a = d.contour[i];
      const b2 = d.contour[(i + 1) % d.contour.length];
      ov.line(a.x, a.y, b2.x, b2.y, 1.6, [40, 255, 120], 0.95);
    }
    ov.circle(d.cx, d.cy, 4, [0, 255, 120], 1);
    ov.digitText(String(d.bib ?? '?'), d.cx, d.cy - 20, 2, [0, 255, 120], 1);
  }
  const small = downscale(ov.data, ds.orthoW, ds.orthoH, 1600);
  writePNG(path.join(dir, 'overlay.png'), small.data, small.w, small.h);

  // 关键区域 1:1 裁剪
  const crops: Array<[string, number, number]> = [
    ['pair7_23', 33, 24],
    ['pair12_31', 48, 36],
    ['hidden3', 12, 8.5],
    ['hidden19', 25, 15.5],
  ];
  for (const [name, mx, my] of crops) {
    const cx = mx * ds.ppm;
    const cy = my * ds.ppm;
    const S = 170;
    const x0 = Math.max(0, Math.round(cx - S / 2));
    const y0 = Math.max(0, Math.round(cy - S / 2));
    const cw = Math.min(S, ds.orthoW - x0);
    const ch = Math.min(S, ds.orthoH - y0);
    const crop = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
      ortho.subarray((y0 + y) * ds.orthoW * 4 + x0 * 4, (y0 + y) * ds.orthoW * 4 + (x0 + cw) * 4)
        .forEach((v, i) => (crop[y * cw * 4 + i] = v));
    }
    writePNG(path.join(dir, `crop_${name}.png`), crop, cw, ch);
  }

  return { id: ds.id, count: res.detections.length, missing, maxRef: refErrs.length ? Math.max(...refErrs) : 999 };
}

const ids = only ? [only] : listPresets.map((p) => p.id);
const summaries = ids.map(runOne);
console.log('\n######## 汇总 ########');
for (const s of summaries) console.log(`${s.id.padEnd(16)} 检出=${s.count}/40 缺=${s.missing.length ? s.missing.join(',') : '无'} 最大裁判Δ=${s.maxRef.toFixed(2)}cm`);
