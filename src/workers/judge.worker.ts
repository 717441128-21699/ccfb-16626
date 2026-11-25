/// <reference lib="webworker" />
// 计算 Worker：样例生成 / 控制点校正 warp / 标志袋识别，全部离开主线程。
import { createDataset, renderWorld, renderAerialPhoto } from '../core/scene';
import { findHomography, invert3, warpRGBA, reprojectionRmse } from '../core/geometry';
import { detectMarkers } from '../core/detect';
import type { WorkerRequest, WorkerResponse } from '../protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function send(msg: WorkerResponse, transfer?: Transferable[]) {
  if (transfer) ctx.postMessage(msg, transfer);
  else ctx.postMessage(msg);
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'generate') {
      send({ type: 'progress', id: req.id, stage: '生成赛场', percent: 20 });
      const ds = createDataset({ terrain: req.terrain, light: req.light });
      const world = renderWorld(ds);
      send({ type: 'progress', id: req.id, stage: '模拟航拍', percent: 70 });
      const photo = renderAerialPhoto(ds, world);
      const buf = photo.rgba.buffer as ArrayBuffer;
      send(
        { type: 'generated', id: req.id, dataset: ds, photo: photo.rgba, photoW: photo.width, photoH: photo.height },
        [buf],
      );
      return;
    }

    if (req.type === 'correct') {
      const { gcps, siteW, siteH, ppm } = req;
      const used = gcps.filter((g) => Number.isFinite(g.px) && Number.isFinite(g.py));
      if (used.length < 4) throw new Error('至少需要 4 个已标定的控制点');
      const src = used.map((g) => ({ x: g.px, y: g.py }));
      const dst = used.map((g) => ({ x: g.x, y: g.y }));
      const H = findHomography(src, dst); // 照片像素 -> 地面米
      const rmseM = reprojectionRmse(H, src, dst).rmse;
      const orthoW = Math.round(siteW * ppm);
      const orthoH = Math.round(siteH * ppm);
      const groundToPhoto = invert3(H);
      const ortho = warpRGBA(req.photo, req.photoW, req.photoH, orthoW, orthoH, {
        pixelToGround: (px, py) => ({ x: px / ppm, y: py / ppm }),
        groundToInput: groundToPhoto,
      });
      send(
        { type: 'corrected', id: req.id, ortho, orthoW, orthoH, rmseCm: rmseM * 100, homography: H },
        [ortho.buffer as ArrayBuffer],
      );
      return;
    }

    if (req.type === 'detect') {
      const result = detectMarkers(req.ortho, req.width, req.height, {
        players: req.players,
        ppm: req.ppm,
        target: req.target,
        zoneRadius: req.zoneRadius,
        excludeCircles: req.excludeCircles,
      });
      send({ type: 'detected', id: req.id, result });
      return;
    }
  } catch (err) {
    send({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) });
  }
};
