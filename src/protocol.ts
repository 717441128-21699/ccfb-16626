// Worker 消息协议（主线程与 judge.worker 共用）
import type { DetectResult, Gcp, Player, Pt, SampleDataset, ScoreRule } from './core/types';

export type WorkerRequest =
  | { type: 'generate'; id: number; terrain: SampleDataset['terrain']; light: SampleDataset['light'] }
  | {
      type: 'correct';
      id: number;
      photo: Uint8ClampedArray;
      photoW: number;
      photoH: number;
      gcps: Gcp[];
      siteW: number;
      siteH: number;
      ppm: number;
    }
  | {
      type: 'detect';
      id: number;
      ortho: Uint8ClampedArray;
      width: number;
      height: number;
      ppm: number;
      target: Pt;
      zoneRadius: number;
      players: Player[];
      excludeCircles?: { x: number; y: number; r: number }[];
    };

export type WorkerResponse =
  | { type: 'progress'; id: number; stage: string; percent: number }
  | {
      type: 'generated';
      id: number;
      dataset: SampleDataset;
      photo: Uint8ClampedArray;
      photoW: number;
      photoH: number;
    }
  | {
      type: 'corrected';
      id: number;
      ortho: Uint8ClampedArray;
      orthoW: number;
      orthoH: number;
      rmseCm: number;
      homography: number[];
    }
  | { type: 'detected'; id: number; result: DetectResult }
  | { type: 'error'; id: number; message: string };

export interface RuntimeSession {
  dataset: SampleDataset | null;
  photo: { data: Uint8ClampedArray; w: number; h: number } | null;
  photoUrl: string | null;
  ortho: { data: Uint8ClampedArray; w: number; h: number } | null;
  orthoUrl: string | null;
  homography: number[] | null;
  rmseCm: number | null;
  result: DetectResult | null;
  ranking: import('./core/types').RankRow[] | null;
  rule: ScoreRule;
  sourceName: string;
  custom: boolean;
}
