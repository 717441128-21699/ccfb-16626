import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type {
  BagTruth,
  ControlPoint,
  DetectedBag,
  Pt,
  Raster,
  ScoringRule,
  StageTiming,
} from '../lib/types';
import { DEFAULT_RULE } from '../lib/scoring';
import { solveHomography, reprojectionErrors, type Mat3 } from '../lib/geometry';
import { remeasure, type CoreResult } from '../detect/detectCore';
import { OUT_ORIGIN_U, OUT_ORIGIN_V, type VariantId } from '../sample/scene';
import type { GenerateResponse } from '../workers/judge.worker';
import { callWorker } from '../workers/client';
import { contestantByCode } from '../lib/roster';

export type PageId = 'import' | 'control' | 'detect' | 'results';

interface JudgeMeta {
  elapsedMs: number;
  stages: StageTiming[];
  recognized: number;
  candidateCount: number;
  totalBags: number;
}

interface Store {
  page: PageId;
  setPage: (p: PageId) => void;

  sourceKind: 'sample' | 'upload' | null;
  sourceTitle: string;
  variantId: VariantId | null;

  raw: Raster | null;
  rawW: number;
  rawH: number;
  cps: ControlPoint[];
  targetRaw: Pt | null;
  ppm: number;
  orthoW: number;
  orthoH: number;

  H: Mat3 | null;
  reproRms: number | null;
  ortho: Raster | null;

  bags: DetectedBag[];
  judgeMeta: JudgeMeta | null;
  detecting: boolean;
  busy: string | null;

  truths: BagTruth[];

  selectedBagId: string | null;
  setSelectedBagId: (id: string | null) => void;
  addMode: boolean;
  setAddMode: (v: boolean) => void;

  rule: ScoringRule;
  setRule: (r: ScoringRule) => void;
  published: boolean;
  publishedAt: string | null;
  publish: () => void;

  loadSample: (id: VariantId) => Promise<void>;
  loadUpload: (file: File) => Promise<void>;

  updateCp: (id: string, patch: Partial<ControlPoint>) => void;
  addCpAt: (px: number, py: number) => void;
  removeCp: (id: string) => void;

  correct: () => Promise<boolean>;
  runDetect: () => Promise<void>;

  moveBag: (id: string, x: number, y: number) => void;
  reassignBag: (id: string, code: string) => void;
  deleteBag: (id: string) => void;
  addBagAt: (x: number, y: number) => void;

  resetAll: () => void;
}

const Ctx = createContext<Store | null>(null);

const DEFAULT_CPS: ControlPoint[] = [
  { id: 'U1', name: '控制点 1', gx: -18, gy: -13, px: 360, py: 300, enabled: true },
  { id: 'U2', name: '控制点 2', gx: 0, gy: -15.5, px: 1600, py: 240, enabled: true },
  { id: 'U3', name: '控制点 3', gx: 18, gy: -13, px: 2840, py: 320, enabled: true },
  { id: 'U4', name: '控制点 4', gx: -18, gy: 13, px: 380, py: 2100, enabled: true },
  { id: 'U5', name: '控制点 5', gx: 0, gy: 15.5, px: 1600, py: 2160, enabled: true },
  { id: 'U6', name: '控制点 6', gx: 18, gy: 13, px: 2820, py: 2080, enabled: true },
];

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [page, setPage] = useState<PageId>('import');
  const [sourceKind, setSourceKind] = useState<'sample' | 'upload' | null>(null);
  const [sourceTitle, setSourceTitle] = useState('');
  const [variantId, setVariantId] = useState<VariantId | null>(null);
  const [raw, setRaw] = useState<Raster | null>(null);
  const [rawW, setRawW] = useState(0);
  const [rawH, setRawH] = useState(0);
  const [cps, setCps] = useState<ControlPoint[]>([]);
  const [targetRaw, setTargetRaw] = useState<Pt | null>(null);
  const [ppm, setPpm] = useState(70);
  const [orthoW, setOrthoW] = useState(3200);
  const [orthoH, setOrthoH] = useState(2400);
  const [H, setH] = useState<Mat3 | null>(null);
  const [reproRms, setReproRms] = useState<number | null>(null);
  const [ortho, setOrtho] = useState<Raster | null>(null);
  const [bags, setBags] = useState<DetectedBag[]>([]);
  const [judgeMeta, setJudgeMeta] = useState<JudgeMeta | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [truths, setTruths] = useState<BagTruth[]>([]);
  const [selectedBagId, setSelectedBagId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [rule, setRuleState] = useState<ScoringRule>(DEFAULT_RULE);
  const [published, setPublished] = useState(false);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);

  const resetDownstream = () => {
    setH(null);
    setReproRms(null);
    setOrtho(null);
    setBags([]);
    setJudgeMeta(null);
    setPublished(false);
    setPublishedAt(null);
    setSelectedBagId(null);
  };

  const loadSample = useCallback(async (id: VariantId) => {
    setBusy('正在程序化生成赛区样例航拍图…');
    try {
      const p = await callWorker<GenerateResponse>('generate', { variantId: id });
      resetDownstream();
      setSourceKind('sample');
      setVariantId(id);
      setSourceTitle(p.title);
      setRaw(p.raw);
      setRawW(p.rawWidth);
      setRawH(p.rawHeight);
      setCps(p.controlPoints.map((c) => ({ ...c })));
      setTargetRaw(p.targetRaw);
      setPpm(p.ppm);
      setOrthoW(p.orthoWidth);
      setOrthoH(p.orthoHeight);
      setTruths(p.truths);
      setPage('control');
    } finally {
      setBusy(null);
    }
  }, []);

  const loadUpload = useCallback(async (file: File) => {
    setBusy('正在读取航拍照片…');
    try {
      const bitmap = await createImageBitmap(file);
      const maxDim = 2800;
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const w = Math.round(bitmap.width * scale);
      const h = Math.round(bitmap.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const raster: Raster = { width: w, height: h, data: new Uint8ClampedArray(img.data) };
      resetDownstream();
      setSourceKind('upload');
      setVariantId(null);
      setSourceTitle(file.name);
      setRaw(raster);
      setRawW(w);
      setRawH(h);
      setCps(
        DEFAULT_CPS.map((c) => ({
          ...c,
          px: (c.px / 3200) * w,
          py: (c.py / 2400) * h,
        })),
      );
      setTargetRaw({ x: w / 2, y: h / 2 });
      setPpm(70);
      setTruths([]);
      setPage('control');
    } finally {
      setBusy(null);
    }
  }, []);

  const updateCp = useCallback((id: string, patch: Partial<ControlPoint>) => {
    setCps((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const addCpAt = useCallback((px: number, py: number) => {
    setCps((prev) => [
      ...prev,
      { id: `U${prev.length + 1}-${Math.round(px)}`, name: `控制点 ${prev.length + 1}`, gx: 0, gy: 0, px, py, enabled: true },
    ]);
  }, []);

  const removeCp = useCallback((id: string) => {
    setCps((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const correct = useCallback(async (): Promise<boolean> => {
    const enabled = cps.filter((c) => c.enabled !== false);
    if (enabled.length < 4) return false;
    setBusy('正在解算控制点并校正正射图…');
    try {
      const ground = enabled.map((c) => ({ x: c.gx, y: c.gy }));
      const image = enabled.map((c) => ({ x: c.px, y: c.py }));
      const h = solveHomography(ground, image);
      const repro = reprojectionErrors(h, ground, image);
      setH(h);
      setReproRms(repro.rms);
      const { ortho } = await callWorker<{ ortho: Raster }>('warp', { raw, h, ppm });
      setOrtho(ortho);
      return true;
    } finally {
      setBusy(null);
    }
  }, [cps, raw, ppm]);

  const runDetect = useCallback(async () => {
    if (!ortho) return;
    setDetecting(true);
    setBags([]);
    const wall0 = performance.now();
    try {
      const res = await callWorker<CoreResult>('detect', { ortho, ppm });
      const truthByCode = new Map(truths.map((t) => [t.code, t]));
      const merged: DetectedBag[] = res.bags.map((b) => {
        const t = b.code ? truthByCode.get(b.code) : undefined;
        return {
          ...b,
          refereeCm: t ? t.refereeCm : null,
          errorCm: t ? Math.abs(b.distanceCm - t.refereeCm) : null,
        };
      });
      setBags(merged);
      setJudgeMeta({
        elapsedMs: performance.now() - wall0,
        stages: res.stages,
        recognized: res.recognized,
        candidateCount: res.candidateCount,
        totalBags: merged.length,
      });
      setPage('detect');
    } finally {
      setDetecting(false);
    }
  }, [ortho, ppm, truths]);

  const moveBag = useCallback(
    (id: string, x: number, y: number) => {
      setBags((prev) => {
        const moved = prev.map((b) => (b.id === id ? { ...b, x, y, manual: true } : b));
        return remeasure(moved, ppm, OUT_ORIGIN_U, OUT_ORIGIN_V);
      });
    },
    [ppm],
  );

  const reassignBag = useCallback(
    (id: string, code: string) => {
      setBags((prev) => {
        // 若该编号已被别的袋子占用，先清空原占用
        const cleared = prev.map((b) => (b.code === code && b.id !== id ? { ...b, code: null, contestantNo: null } : b));
        const updated = cleared.map((b) => {
          if (b.id !== id) return b;
          const c = contestantByCode(code);
          return {
            ...b,
            code: c?.code ?? code,
            contestantNo: c?.no ?? null,
            color: c?.color ?? b.color,
            colorName: c?.colorName ?? null,
            confidence: 1,
          };
        });
        return remeasure(updated, ppm, OUT_ORIGIN_U, OUT_ORIGIN_V);
      });
    },
    [ppm],
  );

  const deleteBag = useCallback((id: string) => {
    setBags((prev) => prev.filter((b) => b.id !== id));
    setSelectedBagId((cur) => (cur === id ? null : cur));
  }, []);

  const addBagAt = useCallback(
    (x: number, y: number) => {
      const id = `manual-${Date.now()}-${Math.round(x)}-${Math.round(y)}`;
      const bag: DetectedBag = {
        id,
        code: null,
        contestantNo: null,
        x,
        y,
        gx: (x - OUT_ORIGIN_U) / ppm,
        gy: (y - OUT_ORIGIN_V) / ppm,
        distanceCm: Math.hypot(x - OUT_ORIGIN_U, y - OUT_ORIGIN_V) * (100 / ppm),
        color: [255, 255, 255],
        colorName: null,
        confidence: 1,
        source: 'manual',
        manual: true,
      };
      setBags((prev) => [...prev, bag]);
      setSelectedBagId(id);
      setAddMode(false);
    },
    [ppm],
  );

  const setRule = useCallback((r: ScoringRule) => setRuleState(r), []);
  const publish = useCallback(() => {
    setPublished(true);
    setPublishedAt(new Date().toLocaleString('zh-CN', { hour12: false }));
    setPage('results');
  }, []);

  const resetAll = useCallback(() => {
    resetDownstream();
    setRaw(null);
    setCps([]);
    setTruths([]);
    setSourceKind(null);
    setSourceTitle('');
    setPage('import');
  }, []);

  const value = useMemo<Store>(
    () => ({
      page, setPage,
      sourceKind, sourceTitle, variantId,
      raw, rawW, rawH, cps, targetRaw, ppm, orthoW, orthoH,
      H, reproRms, ortho,
      bags, judgeMeta, detecting, busy, truths,
      selectedBagId, setSelectedBagId, addMode, setAddMode,
      rule, setRule, published, publishedAt, publish,
      loadSample, loadUpload, updateCp, addCpAt, removeCp, correct, runDetect,
      moveBag, reassignBag, deleteBag, addBagAt, resetAll,
    }),
    [
      page, sourceKind, sourceTitle, variantId, raw, rawW, rawH, cps, targetRaw, ppm, orthoW, orthoH,
      H, reproRms, ortho, bags, judgeMeta, detecting, busy, truths, selectedBagId, addMode,
      rule, published, publishedAt, publish, loadSample, loadUpload, updateCp, addCpAt, removeCp,
      correct, runDetect, moveBag, reassignBag, deleteBag, addBagAt, resetAll,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore 必须在 StoreProvider 内使用');
  return ctx;
}
