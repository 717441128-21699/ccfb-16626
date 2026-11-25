import React, { createContext, useContext, useMemo, useRef, useState, useCallback } from 'react';
import type { DetectResult, Gcp, RankRow, ScoreRule, SampleDataset } from './core/types';
import { buildPlayers } from './core/players';
import { buildRanking, DEFAULT_RULE } from './core/scoring';
import { rgbaToDataUrl, fileToImageData } from './browser-image';
import type { WorkerRequest, WorkerResponse } from './protocol';

export type StepId = 'import' | 'gcp' | 'detect' | 'results';
export const STEPS: { id: StepId; label: string; index: number }[] = [
  { id: 'import', label: '航拍导入', index: 0 },
  { id: 'gcp', label: '控制点校正', index: 1 },
  { id: 'detect', label: '标志袋识别', index: 2 },
  { id: 'results', label: '成绩发布', index: 3 },
];

interface StoreState {
  step: StepId;
  busy: string | null;
  progress: number;
  error: string | null;
  ds: SampleDataset | null;
  sourceName: string;
  custom: boolean;
  photoW: number;
  photoH: number;
  photoUrl: string | null;
  gcps: Gcp[];
  orthoW: number;
  orthoH: number;
  orthoUrl: string | null;
  rmseCm: number | null;
  corrected: boolean;
  result: DetectResult | null;
  rows: RankRow[];
  rule: ScoreRule;
  detectMs: number | null;
}

interface Buffers {
  photo: Uint8ClampedArray | null;
  ortho: Uint8ClampedArray | null;
}

interface StoreApi extends StoreState {
  go: (s: StepId) => void;
  generate: (terrain: SampleDataset['terrain'], light: SampleDataset['light'], title?: string) => Promise<void>;
  upload: (file: File) => Promise<void>;
  updateGcp: (id: string, patch: Partial<Gcp>) => void;
  addGcpAt: (px: number, py: number) => void;
  removeGcp: (id: string) => void;
  correct: () => Promise<void>;
  runDetect: () => Promise<void>;
  updateRule: (patch: Partial<ScoreRule>) => void;
  publish: () => void;
  published: boolean;
}

const Ctx = createContext<StoreApi | null>(null);

export function useJudge(): StoreApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('Store missing');
  return v;
}

function stepFromHash(): StepId {
  const h = location.hash.replace('#/', '').replace('#', '') as StepId;
  return (['import', 'gcp', 'detect', 'results'] as StepId[]).includes(h) ? h : 'import';
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StoreState>({
    step: stepFromHash(),
    busy: null,
    progress: 0,
    error: null,
    ds: null,
    sourceName: '',
    custom: false,
    photoW: 0,
    photoH: 0,
    photoUrl: null,
    gcps: [],
    orthoW: 0,
    orthoH: 0,
    orthoUrl: null,
    rmseCm: null,
    corrected: false,
    result: null,
    rows: [],
    rule: DEFAULT_RULE,
    detectMs: null,
  });
  const [published, setPublished] = useState(false);
  const buf = useRef<Buffers>({ photo: null, ortho: null });
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(1);
  const stateRef = useRef(state);
  stateRef.current = state;

  const patch = useCallback((p: Partial<StoreState>) => setState((s) => ({ ...s, ...p })), []);

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const w = new Worker(new URL('./workers/judge.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        patch({ progress: msg.percent, busy: msg.stage });
      } else if (msg.type === 'generated') {
        buf.current.photo = msg.photo;
        const ds = msg.dataset;
        setState((s) => ({
          ...s,
          busy: null,
          progress: 100,
          ds,
          sourceName: `${ds.title} · 样例航拍`,
          custom: false,
          photoW: msg.photoW,
          photoH: msg.photoH,
          photoUrl: rgbaToDataUrl(msg.photo, msg.photoW, msg.photoH),
          gcps: ds.gcps.map((g) => ({ ...g })),
          orthoUrl: null,
          corrected: false,
          result: null,
          rows: [],
          rmseCm: null,
          published: false,
        }));
        setPublished(false);
      } else if (msg.type === 'corrected') {
        buf.current.ortho = msg.ortho;
        patch({
          busy: null,
          orthoW: msg.orthoW,
          orthoH: msg.orthoH,
          orthoUrl: rgbaToDataUrl(msg.ortho, msg.orthoW, msg.orthoH),
          rmseCm: msg.rmseCm,
          corrected: true,
        });
      } else if (msg.type === 'detected') {
        const cur = stateRef.current;
        const rows = buildRanking(
          msg.result.detections,
          cur.ds?.players ?? buildPlayers(),
          cur.rule,
          cur.ds?.referee,
        );
        patch({ busy: null, result: msg.result, rows, detectMs: msg.result.stats.totalMs });
      } else if (msg.type === 'error') {
        patch({ busy: null, error: msg.message });
      }
    };
    w.onerror = (ev) => patch({ busy: null, error: ev.message || 'Worker 运行错误' });
    workerRef.current = w;
    return w;
  }, [patch]);

  const call = useCallback(
    (req: Omit<WorkerRequest, 'id'>) => {
      const w = ensureWorker();
      const id = reqId.current++;
      w.postMessage({ ...req, id } as WorkerRequest);
    },
    [ensureWorker],
  );

  const go = useCallback((s: StepId) => {
    location.hash = `/${s}`;
    setState((st) => ({ ...st, step: s, error: null }));
  }, []);

  const generate = useCallback(
    async (terrain: SampleDataset['terrain'], light: SampleDataset['light']) => {
      patch({ busy: '正在生成样例赛区与航拍图…', progress: 15, error: null });
      call({ type: 'generate', terrain, light } as Omit<WorkerRequest, 'id'> as WorkerRequest);
    },
    [call, patch],
  );

  const upload = useCallback(
    async (file: File) => {
      try {
        patch({ busy: '读取航拍照片…', error: null });
        const img = await fileToImageData(file, 3200);
        buf.current.photo = img.data;
        const players = buildPlayers();
        // 自定义照片：默认按 80×60m 目标赛区，6 个待点选控制点
        const gcps: Gcp[] = [
          { id: 'T', name: '目标十字', x: 40, y: 30, px: NaN, py: NaN },
          { id: 'C1', name: '控制点 1', x: 5, y: 5, px: NaN, py: NaN },
          { id: 'C2', name: '控制点 2', x: 75, y: 5, px: NaN, py: NaN },
          { id: 'C3', name: '控制点 3', x: 75, y: 55, px: NaN, py: NaN },
          { id: 'C4', name: '控制点 4', x: 5, y: 55, px: NaN, py: NaN },
        ];
        const fakeDs = {
          players,
          target: { x: 40, y: 30 },
          zoneRadius: state.rule.zoneRadius,
          ppm: 40,
          referee: [],
        } as unknown as SampleDataset;
        setState((s) => ({
          ...s,
          busy: null,
          ds: fakeDs,
          custom: true,
          sourceName: file.name,
          photoW: img.width,
          photoH: img.height,
          photoUrl: rgbaToDataUrl(img.data, img.width, img.height),
          gcps,
          orthoUrl: null,
          corrected: false,
          result: null,
          rows: [],
        }));
      } catch (e) {
        patch({ busy: null, error: e instanceof Error ? e.message : '上传失败' });
      }
    },
    [patch, state.rule.zoneRadius],
  );

  const updateGcp = useCallback(
    (id: string, p: Partial<Gcp>) =>
      setState((s) => ({ ...s, gcps: s.gcps.map((g) => (g.id === id ? { ...g, ...p } : g)) })),
    [],
  );
  const addGcpAt = useCallback(
    (px: number, py: number) =>
      setState((s) => ({
        ...s,
        gcps: [
          ...s.gcps,
          { id: `N${s.gcps.length + 1}`, name: `新增控制点 ${s.gcps.length + 1}`, x: 40, y: 30, px, py },
        ],
      })),
    [],
  );
  const removeGcp = useCallback(
    (id: string) => setState((s) => ({ ...s, gcps: s.gcps.filter((g) => g.id !== id || g.id === 'T') })),
    [],
  );

  const correct = useCallback(async () => {
    if (!buf.current.photo || !state.ds) return;
    patch({ busy: 'DLT 解算单应并校正正射图…', error: null });
    call({
      type: 'correct',
      photo: buf.current.photo,
      photoW: state.photoW,
      photoH: state.photoH,
      gcps: state.gcps,
      siteW: state.ds.siteW ?? 80,
      siteH: state.ds.siteH ?? 60,
      ppm: 40,
    } as unknown as WorkerRequest);
  }, [call, patch, state.ds, state.gcps, state.photoW, state.photoH]);

  const runDetect = useCallback(async () => {
    if (!buf.current.ortho || !state.ds) return;
    patch({ busy: 'Worker 正在识别 40 个标志袋…', error: null });
    const ppm = 40;
    const exclude = state.gcps
      .filter((g) => Number.isFinite(g.px) && Number.isFinite(g.py))
      .map((g) => ({ x: g.x * ppm, y: g.y * ppm, r: g.id === 'T' ? 30 : 46 }));
    call({
      type: 'detect',
      ortho: buf.current.ortho,
      width: state.orthoW,
      height: state.orthoH,
      ppm,
      target: state.ds.target,
      zoneRadius: state.rule.zoneRadius,
      players: state.ds.players,
      excludeCircles: exclude,
    } as unknown as WorkerRequest);
  }, [call, patch, state.ds, state.gcps, state.orthoW, state.orthoH, state.rule.zoneRadius]);

  const updateRule = useCallback(
    (p: Partial<ScoreRule>) =>
      setState((s) => {
        const rule = { ...s.rule, ...p };
        const rows = s.result
          ? buildRanking(s.result.detections, s.ds?.players ?? buildPlayers(), rule, s.ds?.referee)
          : s.rows;
        return { ...s, rule, rows };
      }),
    [],
  );

  const publish = useCallback(() => setPublished(true), []);

  // 监听浏览器前进后退
  React.useEffect(() => {
    const onHash = () => setState((s) => ({ ...s, step: stepFromHash() }));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const api = useMemo<StoreApi>(
    () => ({
      ...state,
      published,
      go,
      generate,
      upload,
      updateGcp,
      addGcpAt,
      removeGcp,
      correct,
      runDetect,
      updateRule,
      publish,
    }),
    [
      state,
      published,
      go,
      generate,
      upload,
      updateGcp,
      addGcpAt,
      removeGcp,
      correct,
      runDetect,
      updateRule,
      publish,
    ],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
