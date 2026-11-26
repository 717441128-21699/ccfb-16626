/* 端到端精度校验：Node + tsx 运行，不依赖浏览器 DOM。
 * 用法：npm run validate [variantId]
 */
import { generateScenario, VARIANT_LIST, type VariantId } from '../src/sample/scene';
import { solveHomography, reprojectionErrors } from '../src/lib/geometry';
import { warpToOrtho, detectBags } from '../src/detect/detectCore';
import type { Pt } from '../src/lib/types';

const only = process.argv[2] as VariantId | undefined;
const variants = only ? [only] : VARIANT_LIST;

let anyFail = false;

for (const id of variants) {
  console.log('\n==================================================');
  console.log('场景:', id);
  console.log('==================================================');
  const tGen = performance.now();
  const sc = generateScenario(id);
  console.log(`生成样例耗时 ${(performance.now() - tGen).toFixed(0)}ms，原片 ${sc.rawWidth}x${sc.rawHeight}`);

  // 用 6 个控制点的已知地面坐标 + 原片像素位置解算 H（与 App 同一链路）
  const ground: Pt[] = sc.controlPoints.map((c) => ({ x: c.gx, y: c.gy }));
  const image: Pt[] = sc.controlPoints.map((c) => ({ x: c.px, y: c.py }));
  const H = solveHomography(ground, image);
  const repro = reprojectionErrors(H, ground, image);
  console.log(`控制点重投影 RMS = ${repro.rms.toFixed(4)} px`);

  const tWarp = performance.now();
  const ortho = warpToOrtho(sc.raw, H, sc.pxPerMeter);
  console.log(`校正 warp 耗时 ${(performance.now() - tWarp).toFixed(0)}ms`);

  const tDet = performance.now();
  const result = detectBags(ortho, { ppm: sc.pxPerMeter });
  const detMs = performance.now() - tDet;
  console.log(`检测+测距耗时 ${detMs.toFixed(0)}ms；阶段:`, result.stages.map((s) => `${s.name} ${s.ms.toFixed(0)}ms`).join('，'));
  console.log(`输出袋子 ${result.bags.length}/40；其中编号牌 OCR ${result.recognized}；候选牌 ${result.candidateCount}`);

  const truthByCode = new Map(sc.truths.map((t) => [t.code, t]));
  let maxErr = 0;
  let sumErr = 0;
  let n = 0;
  const rows: string[] = [];
  const missing: string[] = [];
  const bad: string[] = [];

  for (const truth of sc.truths) {
    const bag = result.bags.find((b) => b.code === truth.code);
    if (!bag) {
      missing.push(truth.code);
      rows.push(`${truth.code}  ✗ 未检出`);
      continue;
    }
    const detCm = bag.distanceCm;
    const err = Math.abs(detCm - truth.refereeCm);
    const posErrCm = Math.hypot(bag.gx - truth.gx, bag.gy - truth.gy) * 100;
    maxErr = Math.max(maxErr, err);
    sumErr += err;
    n++;
    const flag = err > 3 ? '⚠' : ' ';
    if (err > 3) bad.push(truth.code);
    rows.push(
      `${truth.code} ${flag} ${bag.source === 'ribbon' ? '飘带' : '编号'} conf=${bag.confidence.toFixed(2)} ` +
        `检测=${detCm.toFixed(1)}cm 裁判=${truth.refereeCm}cm 距离差=${err.toFixed(1)}cm 点位差=${posErrCm.toFixed(1)}cm ${truth.kind}`,
    );
  }
  console.log(rows.join('\n'));
  console.log('--------------------------------------------------');
  console.log(`检出 ${n}/40，缺失 [${missing.join(',') || '无'}]`);
  console.log(`距离误差：最大 ${maxErr.toFixed(2)}cm，平均 ${n ? (sumErr / n).toFixed(2) : '-'}cm；>3cm 编号 [${bad.join(',') || '无'}]`);

  const pass = n === 40 && maxErr <= 3 && missing.length === 0;
  if (!pass) anyFail = true;
  console.log(pass ? '✅ 场景通过（40/40，最大误差≤3cm）' : '❌ 场景未达标');
}

console.log('\n总判定:', anyFail ? '失败' : '全部通过');
process.exit(anyFail ? 1 : 0);
