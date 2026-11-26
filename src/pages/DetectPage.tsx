import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import JudgeCanvas from '../components/JudgeCanvas';
import { OUT_ORIGIN_U, OUT_ORIGIN_V } from '../sample/scene';
import { ROSTER } from '../lib/roster';
import { showToast } from '../App';

type Filter = 'all' | 'review' | 'outside';

export default function DetectPage() {
  const {
    ortho, ppm, bags, judgeMeta, detecting, runDetect,
    selectedBagId, setSelectedBagId, addMode, setAddMode,
    moveBag, reassignBag, deleteBag, addBagAt, rule, setPage,
  } = useStore();
  const [showLines, setShowLines] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showZone, setShowZone] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const autoRan = useRef(false);

  useEffect(() => {
    if (ortho && !autoRan.current && bags.length === 0 && !detecting) {
      autoRan.current = true;
      void runDetect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ortho]);

  const target = { x: OUT_ORIGIN_U, y: OUT_ORIGIN_V };
  const zoneRadiusPx = rule.zoneRadiusM * ppm;

  const refereeStats = useMemo(() => {
    const withErr = bags.filter((b) => b.errorCm != null);
    if (!withErr.length) return null;
    const errs = withErr.map((b) => b.errorCm as number);
    const max = Math.max(...errs);
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    const pass = errs.filter((e) => e <= 3).length;
    return { max, mean, pass, n: errs.length };
  }, [bags]);

  const outsideCount = bags.filter((b) => b.distanceCm / 100 > rule.zoneRadiusM).length;
  const uncoded = bags.filter((b) => !b.code).length;

  const visibleBags = useMemo(() => {
    let list = bags.slice().sort((a, b) => (a.contestantNo ?? 999) - (b.contestantNo ?? 999));
    if (filter === 'review') list = list.filter((b) => !b.code || (b.errorCm ?? 0) > 3 || b.confidence < 0.9);
    if (filter === 'outside') list = list.filter((b) => b.distanceCm / 100 > rule.zoneRadiusM);
    return list;
  }, [bags, filter, rule.zoneRadiusM]);

  const selected = bags.find((b) => b.id === selectedBagId) ?? null;

  if (!ortho) {
    return (
      <div className="page">
        <div className="card"><div className="card-b" style={{ textAlign: 'center', padding: 60 }}>
          <p style={{ color: 'var(--text-dim)' }}>尚未生成校正正射图。</p>
          <button className="btn primary" onClick={() => setPage('control')}>返回控制点校正</button>
        </div></div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>③ 标志袋识别与量距</h2>
          <p>
            Web Worker 内完成编号牌 OCR、注册颜色复核、飘带追踪与像素→地面→距离计算。
            蓝线为各袋中心到目标十字的量距连线；相邻近色袋按编号拆分。可拖动圆点修正、改派编号或手动补点。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={detecting} onClick={() => void runDetect()}>
            {detecting ? '识别计算中…' : '⟳ 重新识别'}
          </button>
          <button className="btn good" disabled={bags.length === 0} onClick={() => setPage('results')}>
            进入 ④ 成绩发布 →
          </button>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi accent">
          <div className="k-label">已判出标志袋</div>
          <div className="k-val">{bags.length}<small>/ 40</small></div>
        </div>
        <div className="kpi">
          <div className="k-label">编号 OCR 命中</div>
          <div className="k-val">{judgeMeta?.recognized ?? bags.filter((b) => b.source === 'number-label').length}<small> 个</small></div>
        </div>
        <div className="kpi good">
          <div className="k-label">识别+量距总耗时</div>
          <div className="k-val">{judgeMeta ? (judgeMeta.elapsedMs / 1000).toFixed(1) : '—'}<small> s · 限额 60s</small></div>
        </div>
        <div className={`kpi ${refereeStats && refereeStats.max <= 3 ? 'good' : 'warn'}`}>
          <div className="k-label">裁判复核最大偏差</div>
          <div className="k-val">
            {refereeStats ? refereeStats.max.toFixed(1) : '—'}<small> cm {refereeStats ? `· ${refereeStats.pass}/${refereeStats.n} ≤3cm` : ''}</small>
          </div>
        </div>
      </div>

      {detecting && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-b">
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>
              <span>Worker 正在逐像素分析 / OCR / 测距…</span><span>请稍候</span>
            </div>
            <div className="progress-wrap"><div className="progress-bar" style={{ width: '72%', animation: 'pulse 1s infinite' }} /></div>
          </div>
        </div>
      )}

      <div className="toolbar">
        <label className="toggle"><input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)} />量距连线</label>
        <label className="toggle"><input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />编号标签</label>
        <label className="toggle"><input type="checkbox" checked={showZone} onChange={(e) => setShowZone(e.target.checked)} />目标区圆（{rule.zoneRadiusM}m）</label>
        <button className={`btn sm ${addMode ? 'warn' : ''}`} onClick={() => setAddMode(!addMode)}>
          {addMode ? '✕ 取消手动补点' : '＋ 手动补一个袋'}
        </button>
        <div className="spacer" />
        <div className="toolbar" style={{ margin: 0 }}>
          {([['all', `全部 ${bags.length}`], ['review', `待复核 ${uncoded + bags.filter((b) => (b.errorCm ?? 0) > 3).length}`], ['outside', `区外 ${outsideCount}`]] as Array<[Filter, string]>).map(([k, label]) => (
            <button key={k} className={`btn sm ${filter === k ? 'primary' : ''}`} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="grid work">
        <JudgeCanvas
          ortho={ortho}
          bags={visibleBags}
          target={target}
          selectedId={selectedBagId}
          addMode={addMode}
          zoneRadiusPx={zoneRadiusPx}
          showLines={showLines}
          showLabels={showLabels}
          showZone={showZone}
          onSelect={setSelectedBagId}
          onMove={moveBag}
          onAdd={(x, y) => addBagAt(x, y)}
        />

        <div>
          {selected && (
            <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
              <div className="card-h"><h3>修正选中袋</h3>
                <button className="btn sm danger" onClick={() => deleteBag(selected.id)}>删除</button>
              </div>
              <div className="card-b">
                <div className="field" style={{ marginBottom: 12 }}>
                  <label>改派选手编号（相邻同色袋按编号拆分）</label>
                  <select
                    style={{ width: '100%' }}
                    value={selected.code ?? ''}
                    onChange={(e) => { reassignBag(selected.id, e.target.value); showToast(`已改派为 ${e.target.value} 号`); }}
                  >
                    <option value="">（未编号 / 手动）</option>
                    {ROSTER.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name} · {c.colorName}</option>)}
                  </select>
                </div>
                <div className="stat-line"><span>来源</span>
                  <b>{selected.source === 'number-label' ? '编号牌 OCR' : selected.source === 'ribbon' ? '飘带追踪' : '手动补点'}</b>
                </div>
                <div className="stat-line"><span>置信度</span><b>{(selected.confidence * 100).toFixed(0)}%</b></div>
                <div className="stat-line"><span>地面坐标</span><b>({selected.gx.toFixed(2)}, {selected.gy.toFixed(2)}) m</b></div>
                <div className="stat-line"><span>量测距离</span><b style={{ color: 'var(--accent)' }}>{(selected.distanceCm / 100).toFixed(2)} m</b></div>
                {selected.refereeCm != null && (
                  <div className="stat-line">
                    <span>裁判复核 / 偏差</span>
                    <b style={{ color: (selected.errorCm ?? 0) <= 3 ? 'var(--good)' : 'var(--bad)' }}>
                      {(selected.refereeCm / 100).toFixed(2)} m / {selected.errorCm?.toFixed(1)} cm
                    </b>
                  </div>
                )}
                <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '10px 0 0' }}>
                  可直接在左侧图上拖动圆点微调中心，距离会实时重算。
                </p>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-h"><h3>判读列表</h3><span className="hint">点击定位/选中</span></div>
            <div className="bag-list">
              {visibleBags.length === 0 && <div style={{ padding: 26, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>暂无符合条件的袋子</div>}
              {visibleBags.map((b) => {
                const c = b.code ? ROSTER.find((r) => r.code === b.code) : null;
                const outside = b.distanceCm / 100 > rule.zoneRadiusM;
                return (
                  <div key={b.id} className={`bag-row ${b.id === selectedBagId ? 'selected' : ''}`} onClick={() => setSelectedBagId(b.id)}>
                    <div className="bag-code" style={{ borderColor: b.color ? `rgb(${b.color.join(',')})` : '#94a3b8', color: '#0b1220' }}>
                      {b.code ? b.code : '?'}
                    </div>
                    <div className="bag-main">
                      <div className="t">
                        {c ? c.name : '未指派'}
                        {b.source === 'ribbon' && <span className="pill info">飘带</span>}
                        {b.manual && <span className="pill warn">手动</span>}
                        {outside && <span className="pill bad">区外</span>}
                      </div>
                      <div className="s">{c ? `${c.team} · ${c.colorName}` : '请在右侧改派编号'}</div>
                    </div>
                    <div className="bag-dist">
                      <div className="d">{(b.distanceCm / 100).toFixed(2)}m</div>
                      {b.errorCm != null
                        ? <div className="e" style={{ color: b.errorCm <= 3 ? 'var(--good)' : 'var(--bad)' }}>Δ {b.errorCm.toFixed(1)}cm</div>
                        : <div className="e">置信 {(b.confidence * 100).toFixed(0)}%</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {judgeMeta && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-h"><h3>Worker 耗时分解</h3></div>
              <div className="card-b" style={{ paddingTop: 8, paddingBottom: 8 }}>
                {judgeMeta.stages.map((s) => (
                  <div className="stat-line" key={s.name}><span>{s.name}</span><b>{s.ms.toFixed(0)} ms</b></div>
                ))}
                <div className="stat-line"><span>消息往返/渲染</span><b>{Math.max(0, judgeMeta.elapsedMs - judgeMeta.stages.reduce((a, s) => a + s.ms, 0)).toFixed(0)} ms</b></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
