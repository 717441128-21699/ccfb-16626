import { generateScenario, VARIANT_LIST, type VariantId } from '../sample/scene';
import { warpToOrtho, detectBags, remeasure, type CoreResult } from '../detect/detectCore';
import type { BagTruth, ControlPoint, DetectedBag, Raster } from '../lib/types';
import type { Mat3 } from '../lib/geometry';

export interface GenerateResponse {
  variantId: string;
  title: string;
  terrain: string;
  light: string;
  description: string;
  raw: Raster;
  rawWidth: number;
  rawHeight: number;
  controlPoints: ControlPoint[];
  targetRaw: { x: number; y: number };
  ppm: number;
  orthoWidth: number;
  orthoHeight: number;
  truths: BagTruth[];
}

export type WorkerRequest =
  | { id: number; type: 'generate'; variantId: VariantId }
  | { id: number; type: 'thumb'; variantId: VariantId; width: number }
  | { id: number; type: 'warp'; raw: Raster; h: Mat3; ppm: number }
  | { id: number; type: 'detect'; ortho: Raster; ppm: number }
  | { id: number; type: 'remeasure'; bags: DetectedBag[]; ppm: number; originU: number; originV: number };

export type WorkerResponse =
  | { id: number; ok: true; type: string; payload?: unknown }
  | { id: number; ok: false; error: string };

type WorkerSelf = {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (msg: WorkerResponse) => void;
};
const ctx = self as unknown as WorkerSelf;

function downscale(src: Raster, targetW: number): Raster {
  const scale = targetW / src.width;
  const tw = targetW;
  const th = Math.round(src.height * scale);
  const out: Raster = { width: tw, height: th, data: new Uint8ClampedArray(tw * th * 4) };
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      const sy = Math.min(src.height - 1, Math.floor(y / scale));
      const si = (sy * src.width + sx) * 4;
      const di = (y * tw + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  return out;
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'generate') {
      const sc = generateScenario(req.variantId);
      const payload: GenerateResponse = {
        variantId: sc.id,
        title: sc.title,
        terrain: sc.terrain,
        light: sc.light,
        description: sc.description,
        raw: sc.raw,
        rawWidth: sc.rawWidth,
        rawHeight: sc.rawHeight,
        controlPoints: sc.controlPoints,
        targetRaw: sc.targetRaw,
        ppm: sc.pxPerMeter,
        orthoWidth: sc.orthoWidth,
        orthoHeight: sc.orthoHeight,
        truths: sc.truths,
      };
      post({ id: req.id, ok: true, type: 'generate', payload });
    } else if (req.type === 'thumb') {
      const sc = generateScenario(req.variantId);
      const thumb = downscale(sc.raw, req.width);
      post({ id: req.id, ok: true, type: 'thumb', payload: { thumb, variantId: req.variantId } });
    } else if (req.type === 'warp') {
      const ortho = warpToOrtho(req.raw, req.h, req.ppm);
      post({ id: req.id, ok: true, type: 'warp', payload: { ortho } });
    } else if (req.type === 'detect') {
      const result: CoreResult = detectBags(req.ortho, { ppm: req.ppm });
      post({ id: req.id, ok: true, type: 'detect', payload: result });
    } else if (req.type === 'remeasure') {
      const bags = remeasure(req.bags, req.ppm, req.originU, req.originV);
      post({ id: req.id, ok: true, type: 'remeasure', payload: { bags } });
    }
  } catch (err) {
    post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};

function post(msg: WorkerResponse) {
  ctx.postMessage(msg);
}

export { VARIANT_LIST };
