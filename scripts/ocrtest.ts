import { createDataset, renderWorld, renderAerialPhoto } from '../src/core/scene';
import { findHomography, invert3, warpRGBA } from '../src/core/geometry';
import { readLabel, bibOcrSimilarity } from '../src/core/ocr';

const ds = createDataset({ terrain: 'mixed', light: 'morning' });
const world = renderWorld(ds);
const photo = renderAerialPhoto(ds, world);
const H = findHomography(
  ds.gcps.map((g) => ({ x: g.px, y: g.py })),
  ds.gcps.map((g) => ({ x: g.x, y: g.y })),
);
const ortho = warpRGBA(photo.rgba, photo.width, photo.height, ds.orthoW, ds.orthoH, {
  pixelToGround: (px, py) => ({ x: px / ds.ppm, y: py / ds.ppm }),
  groundToInput: invert3(H),
});

let correctLen = 0;
let correctBib = 0;
for (const b of ds.bags) {
  const cx = b.x * ds.ppm - 1.5; // 约定偏移
  const cy = b.y * ds.ppm - 1.5;
  const truthLen = String(b.bib).length as 1 | 2;
  const r1 = readLabel(ortho, ds.orthoW, ds.orthoH, cx, cy, 18, 1);
  const r2 = readLabel(ortho, ds.orthoW, ds.orthoH, cx, cy, 18, 2);
  const guessLen = (r2 && r1 && r2.total > r1.total + 0.03 ? 2 : 1) as 1 | 2;
  const chosen = guessLen === 2 ? r2 : r1;
  const text = chosen ? chosen.digits.map((d) => d.best).join('') : '?';
  // 用正确长度的 bibOcr 相似度
  const simTruth = bibOcrSimilarity(truthLen === 2 ? r2 : r1, b.bib);
  if (guessLen === truthLen) correctLen++;
  if (text === String(b.bib)) correctBib++;
  if (text !== String(b.bib)) {
    console.log(`bib ${String(b.bib).padStart(2)} len${truthLen} -> guess len${guessLen} text="${text}" t1=${r1?.total.toFixed(2)} t2=${r2?.total.toFixed(2)} simTruth=${simTruth.toFixed(2)}`);
  }
}
console.log(`长度判断正确 ${correctLen}/40, 号码完全正确 ${correctBib}/40`);
