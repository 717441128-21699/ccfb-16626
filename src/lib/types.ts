// 共享领域类型：像素坐标 / 地面坐标（米，相对目标十字；y 沿图像向下为正）

export interface Pt {
  x: number;
  y: number;
}

export interface GroundPt {
  /** 相对目标十字的东向坐标（米） */
  x: number;
  /** 相对目标十字的南向坐标（米，与校正图 y 同向） */
  y: number;
}

export type RGB = [number, number, number];

export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Contestant {
  /** 序号 1..40 */
  no: number;
  /** 两位编号 "01".."40" */
  code: string;
  name: string;
  team: string;
  /** 标志袋/飘带的注册颜色 */
  color: RGB;
  colorName: string;
}

export interface ControlPoint {
  id: string;
  name: string;
  /** 已知测量坐标（米，相对目标十字） */
  gx: number;
  gy: number;
  /** 在导入航拍原片中的像素位置 */
  px: number;
  py: number;
  /** 是否参与解算（可临时停用） */
  enabled?: boolean;
}

export interface BagTruth {
  code: string;
  gx: number;
  gy: number;
  /** 裁判卷尺复核距离（厘米，整厘米） */
  refereeCm: number;
  /** 特殊工况标记，用于验证 */
  kind: 'normal' | 'ribbon-only' | 'half-covered' | 'adjacent-pair' | 'outside';
  pairId?: string;
}

export interface SampleScenario {
  id: string;
  title: string;
  terrain: string;
  light: string;
  description: string;
  /** 航拍原片 */
  raw: Raster;
  rawWidth: number;
  rawHeight: number;
  /** 原片 -> 地面（米）单应矩阵，行优先 9 元素，h33=1 */
  hGroundToRaw: number[];
  controlPoints: ControlPoint[];
  targetRaw: Pt;
  pxPerMeter: number;
  orthoWidth: number;
  orthoHeight: number;
  truths: BagTruth[];
  seed: number;
}

export type DetectionSource = 'number-label' | 'color-blob' | 'ribbon' | 'manual';

export interface DetectedBag {
  id: string;
  /** 识别出的两位编号；无法识别时为 null */
  code: string | null;
  contestantNo: number | null;
  /** 校正正射图像素中心 */
  x: number;
  y: number;
  gx: number;
  gy: number;
  distanceCm: number;
  color: RGB | null;
  colorName: string | null;
  /** 0..1 综合置信度 */
  confidence: number;
  source: DetectionSource;
  /** 与同色邻袋粘连，靠编号拆分 */
  splitByNumber?: boolean;
  /** 编号标签框（校正图像素），叠加层用 */
  labelBox?: { x: number; y: number; w: number; h: number };
  /** 飘带主轴/端点（ribbon-only 时用于叠加） */
  ribbon?: { x1: number; y1: number; x2: number; y2: number };
  /** 与裁判复核的偏差（厘米），样例数据才有 */
  refereeCm?: number | null;
  errorCm?: number | null;
  manual?: boolean;
}

export interface StageTiming {
  name: string;
  ms: number;
}

export interface JudgeResult {
  bags: DetectedBag[];
  width: number;
  height: number;
  pxPerMeter: number;
  target: Pt;
  elapsedMs: number;
  stages: StageTiming[];
  /** 自动识别出的编号数量 */
  recognized: number;
  /** 检测到的候选标记总数（含未配对） */
  candidateCount: number;
}

export interface ScoringRule {
  /** 目标区半径（米），区外记最低分 */
  zoneRadiusM: number;
  maxScore: number;
  minScore: number;
}

export interface RankedRow {
  rank: number;
  bag: DetectedBag;
  contestant: Contestant | null;
  distanceCm: number;
  score: number;
  outside: boolean;
  refereeCm: number | null;
  errorCm: number | null;
}
