import { useMemo, useState } from 'react';
import { useJudge } from '../store';
import OrthoCanvas from '../components/OrthoCanvas';

const METHOD_LABEL: Record<string, string> = {
  'disk-fit': '圆盘拟合',
  label: '编号定位',
  'ribbon-root': '飘带根部',
  'color-blob': '颜色兜底',
};

export default function DetectPage() {
  const j = useJudge();
  const [sel, setSel] = useState<number | null>(null);
  const [lines, setLines] = useState(true);
  const [contours, setContours] = useState(true);
  const [ribbon, setRibbon] = useState(true);
  const [filter, setFilter] = useState<'all' | 'special'>('all');

  const stats = j.result?.stats;
  const found = j.result?.detections.length ?? 0;
  const specialCount = useMemo(
    () => (j.ds?.bags.filter((b) => b.kind !== 'normal').length ?? 0),
    [j.ds],
  );

  if (!j.corrected || !j.orthoUrl || !j.result) {
    return (
      <div className="card">
        <div className="card-bd" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 46 }}>🛰️</div>
          <h2>识别与测距在 Web Worker 中运行</h2>
          <p className="hint" style={{ maxWidth: 620, margin: '8px auto 20px' }}>
            管线：HSV 颜色分割 → 编号面板检测 → 5×7 点阵 OCR → 颜色/编号全局唯一分配（匈牙利 + 高置信锁定）
            → 圆盘模板亚像素中心 → 同帧十字基准测距。40 人样例在普通笔记本上约 1 秒内完成，远低于 60 秒限时。
          </p>
          {!j.corrected ? (
            <button className="btn primary" onClick={() => j.go('gcp')}>
              ← 先完成控制点校正
            </button>
          ) : (
            <button className="btn primary" disabled={!!j.busy} onClick={j.runDetect}>
              ▶ 开始识别 40 个标志袋
            </button>
          )}
        </div>
      </div>
    );
  }

  const dets = [...j.result.detections].sort((a, b) => (a.bib ?? 999) - (b.bib ?? 999));
  const shown = filter === 'special' ? dets.filter((d) => d.mergedSplit || d.method === 'ribbon-root') : dets;
  const budgetPct = Math.min(100, ((j.detectMs ?? stats?.totalMs ?? 0) / 1000 / 60) * 100);

  return (
    <div>
      <div className="kpi" style={{ marginBottom: 16 }}>
        <div className="item">
          <div className="v ok">{found}/40</div>
          <div className="l">检出 / 选手数</div>
        </div>
        <div className="item">
          <div className="v brand">{((j.detectMs ?? stats?.totalMs ?? 0) / 1000).toFixed(2)}s</div>
          <div className="l">Worker 识别+测距耗时</div>
        </div>
        <div className="item" style={{ minWidth: 240 }}>
          <div className="v" style={{ fontSize: 16, paddingTop: 4 }}>
            60 秒预算占用 {budgetPct.toFixed(2)}%
          </div>
          <div className="bar" style={{ marginTop: 8 }}>
            <i style={{ width: `${Math.max(2, budgetPct)}%`, background: 'linear-gradient(90deg,#22c55e,#16a34a)' }} />
          </div>
        </div>
        <div className="item">
          <div className="v">{specialCount}</div>
          <div className="l">隐藏/半遮/紧贴考点</div>
        </div>
        <div className="item">
          <div className="v">{stats?.labelCount ?? 0}</div>
          <div className="l">候选面板</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn" disabled={!!j.busy} onClick={j.runDetect}>
            ↻ 重新识别
          </button>
          <button className="btn primary" onClick={() => j.go('results')}>
            核对成绩并发布 →
          </button>
        </div>
      </div>

      <div className="detect-layout">
        <div className="card">
          <div className="card-hd">
            <h2>正射叠加 · 轮廓 / 飘带 / 袋心—十字连线</h2>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <span className={`toggle-chip ${lines ? 'on' : ''}`} onClick={() => setLines((v) => !v)}>连线</span>
              <span className={`toggle-chip ${contours ? 'on' : ''}`} onClick={() => setContours((v) => !v)}>轮廓</span>
              <span className={`toggle-chip ${ribbon ? 'on' : ''}`} onClick={() => setRibbon((v) => !v)}>飘带</span>
            </span>
          </div>
          <div className="card-bd" style={{ padding: 10 }}>
            <OrthoCanvas
              url={j.orthoUrl}
              w={j.orthoW}
              h={j.orthoH}
              result={j.result}
              variant="detect"
              selected={sel}
              onSelect={setSel}
              showLines={lines}
              showContours={contours}
              showRibbon={ribbon}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-hd">
            <h2>识别清单</h2>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className={`btn sm ${filter === 'all' ? 'primary' : ''}`} onClick={() => setFilter('all')}>
                全部
              </button>
              <button className={`btn sm ${filter === 'special' ? 'primary' : ''}`} onClick={() => setFilter('special')}>
                考点
              </button>
            </span>
          </div>
          <div className="det-list">
            {shown.map((d) => {
              const p = j.ds?.players.find((x) => x.bib === d.bib);
              const active = sel === d.bib;
              return (
                <div key={d.bib} className={`det-row ${active ? 'sel' : ''}`} onClick={() => setSel(d.bib)}>
                  <span className="bib">{String(d.bib ?? '?').padStart(2, '0')}</span>
                  <div className="det-main">
                    <b>
                      {p?.name ?? '未知'} <span className="chip" style={{ background: p ? `rgb(${p.rgb.join(',')})` : '#999' }} />
                    </b>
                    <div className="sub">
                      <span>{METHOD_LABEL[d.method]}</span>
                      {d.mergedSplit && <span className="badge info">紧贴拆分</span>}
                      {d.outside && <span className="badge bad">区外</span>}
                      <span className="conf">
                        <i style={{ width: `${Math.round(d.confidence * 100)}%` }} />
                      </span>
                      <span>{(d.confidence * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                    {d.distanceM.toFixed(2)}
                    <span style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 600 }}> m</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
