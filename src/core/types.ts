// 全系统共享类型。核心层不依赖 DOM，Worker 与 Node 自测共用。

export interface Pt {
  x: number;
  y: number;
}

/** 选手 */
export interface Player {
  bib: number; // 参赛编号 1..40
  name: string;
  team: string;
  colorName: string;
  rgb: [number, number, number];
}

export type SurfaceKind = 'crop' | 'ridge' | 'mud' | 'water' | 'grass' | 'stubble';
export type BagKind = 'normal' | 'half' | 'hidden' | 'pair';

/** 标志袋真值（仅样例生成器与“裁判复核记录”使用，识别器不得读取） */
export interface BagTruth {
  bib: number;
  x: number; // 场地米坐标
  y: number;
  surface: SurfaceKind;
  kind: BagKind;
  angle: number; // 袋体朝向 rad
  radius: number; // m
  ribbonAngle: number;
  ribbonLen: number; // m
  pairWith?: number;
  outside: boolean;
}

/** 地面控制点：survey 坐标（米）+ 在航拍照片上的像素位置 */
export interface Gcp {
  id: string;
  name: string;
  x: number;
  y: number;
  px: number;
  py: number;
  residualCm?: number;
}

export type TerrainKind = 'mixed' | 'ridges' | 'mud' | 'wet';
export type LightKind = 'morning' | 'noon' | 'evening' | 'overcast';

export interface Preset {
  terrain: TerrainKind;
  light: LightKind;
}

/** 一个样例场次的完整数据 */
export interface SampleDataset {
  id: string;
  title: string;
  subtitle: string;
  terrain: TerrainKind;
  light: LightKind;
  seed: number;
  siteW: number; // m
  siteH: number; // m
  target: Pt; // m
  zoneRadius: number; // m
  ppm: number; // 基准正射图 像素/米
  orthoW: number;
  orthoH: number;
  photoW: number;
  photoH: number;
  /** 生成相机用的 地面米→照片像素 单应（样例附带，应用靠 GCP 重新解算） */
  trueH: number[];
  gcps: Gcp[];
  players: Player[];
  bags: BagTruth[];
  /** 裁判拉卷尺复核的距离（米，已按厘米记录，含真实测量误差） */
  referee: { bib: number; distanceM: number }[];
  refereeNote: string;
}

export type DetectMethod = 'disk-fit' | 'label' | 'ribbon-root' | 'color-blob';

export interface Detection {
  bib: number | null;
  cx: number; // 正射图像素（亚像素）
  cy: number;
  gx: number; // 米
  gy: number;
  distanceM: number;
  outside: boolean;
  confidence: number; // 0..1
  colorMatch: number; // 0..1
  ocrText: string;
  ocrMargin: number;
  method: DetectMethod;
  radiusPx: number;
  bbox: { x: number; y: number; w: number; h: number };
  /** 归一化的轮廓点（正射像素），供 Canvas 描边 */
  contour: Pt[];
  /** 飘带骨架点 */
  ribbon: Pt[];
  mergedSplit?: boolean;
  candidates?: number[];
}

export interface DetectStats {
  totalMs: number;
  maskMs: number;
  componentsMs: number;
  ocrMs: number;
  fitMs: number;
  assignMs: number;
  pixelCount: number;
  labelCount: number;
  componentCount: number;
}

export interface DetectResult {
  detections: Detection[];
  width: number;
  height: number;
  ppm: number;
  targetPx: Pt;
  stats: DetectStats;
  /** 调试/叠加用：分类掩膜（0 背景，>0 选手色索引+1，255 白标签） */
  mask?: Uint8Array;
  /** 调试：标签候选明细 */
  debugCands?: unknown;
}

export interface RankRow {
  rank: number;
  bib: number;
  name: string;
  team: string;
  colorName: string;
  rgb: [number, number, number];
  distanceM: number;
  score: number;
  outside: boolean;
  refereeM?: number;
  errorCm?: number;
  confidence: number;
  method: DetectMethod;
}

export interface ScoreRule {
  maxScore: number;
  deductPerMeter: number;
  insideFloor: number;
  outsideScore: number;
  zoneRadius: number;
}
