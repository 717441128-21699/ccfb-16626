import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { paintRaster, eventToCanvasPoint } from '../lib/canvasUtils';
import { applyH } from '../lib/geometry';
import { showToast } from '../App';

export default function ControlPage() {
  const {
    raw, rawW, rawH, cps, updateCp, addCpAt, removeCp,
    targetRaw, H, reproRms, ortho, correct, setPage, sourceTitle,
  } = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const orthoRef = useRef<HTMLCanvasElement>(null);
  const dragId = useRef<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [view, setView] = useState<'raw' | 'ortho'>('raw');
  const [working, setWorking] = useState(false);

  // 绘制原片 + 控制点
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !raw || view !== 'raw') return;
    const ctx = paintRaster(canvas, raw);
    if (!ctx) return;

    // 目标十字在原片上的位置（若已解算用 H，否则用样例给的 targetRaw）
    const target = H ? applyH(H, 0, 0) : targetRaw;
    if (target) {
      ctx.save();
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(target.x - 46, target.y); ctx.lineTo(target.x + 46, target.y);
      ctx.moveTo(target.x, target.y - 46); ctx.lineTo(target.x, target.y + 46);
      ctx.stroke();
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(target.x - 46, target.y); ctx.lineTo(target.x + 46, target.y);
      ctx.moveTo(target.x, target.y - 46); ctx.lineTo(target.x, target.y + 46);
      ctx.stroke();
      ctx.restore();
    }

    cps.forEach((cp, i) => {
      if (cp.enabled === false) return;
      ctx.save();
      ctx.translate(cp.px, cp.py);
      // 外圆橙
      ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,138,0,0.92)'; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
      // 棋盘
      ctx.fillStyle = '#111';
      ctx.fillRect(-11, -11, 11, 11);
      ctx.fillRect(0, 0, 11, 11);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.strokeRect(-11, -11, 22, 22);
      // 引线 + 标签
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.7)';
      const label = cp.id.startsWith('CP') ? cp.id : `P${i + 1}`;
      ctx.strokeText(label, 30, -22);
      ctx.fillStyle = '#ffd166';
      ctx.fillText(label, 30, -22);
      ctx.restore();
    });
  }, [raw, cps, H, targetRaw, view]);

  // 正射预览
  useEffect(() => {
    if (view === 'ortho' && ortho && orthoRef.current) {
      paintRaster(orthoRef.current, ortho);
    }
  }, [view, ortho]);

  if (!raw) {
    return (
      <div className="page">
        <div className="card"><div className="card-b" style={{ textAlign: 'center', padding: 60 }}>
          <p style={{ color: 'var(--text-dim)' }}>还没有航拍照片。</p>
          <button className="btn primary" onClick={() => setPage('import')}>返回导入页选择样例</button>
        </div></div>
      </div>
    );
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = eventToCanvasPoint(e, e.currentTarget);
    if (addMode) {
      addCpAt(p.x, p.y);
      setAddMode(false);
      showToast('已添加控制点，请在右侧填写其已知地面坐标（米）');
      return;
    }
    let hit: string | null = null;
    for (const cp of cps) {
      if (Math.hypot(cp.px - p.x, cp.py - p.y) < 30) { hit = cp.id; break; }
    }
    if (hit) {
      dragId.current = hit;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragId.current) return;
    const p = eventToCanvasPoint(e, e.currentTarget);
    updateCp(dragId.current, { px: Math.round(p.x * 10) / 10, py: Math.round(p.y * 10) / 10 });
  };
  const onPointerUp = () => { dragId.current = null; };

  const enabledCount = cps.filter((c) => c.enabled !== false).length;

  const doCorrect = async () => {
    if (enabledCount < 4) {
      showToast('至少需要 4 个启用的控制点');
      return;
    }
    setWorking(true);
    try {
      const ok = await correct();
      if (ok) {
        setView('ortho');
        showToast('正射校正完成，可进入标志袋识别');
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>② 控制点校正</h2>
          <p>
            照片：<b>{sourceTitle}</b>（{rawW}×{rawH}）。橙色棋盘为地面控制点，可直接在图上拖动对位；
            在右表填入测量坐标（米，原点为目标十字，x 向右、y 向下）。DLT 最小二乘解算单应矩阵后，把照片重采样为统一比例尺正射图。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`btn ${view === 'raw' ? 'primary' : ''}`} onClick={() => setView('raw')}>原片控制点</button>
          <button className={`btn ${view === 'ortho' ? 'primary' : ''}`} disabled={!ortho} onClick={() => setView('ortho')}>校正正射图</button>
        </div>
      </div>

      <div className="grid work">
        <div className="card">
          <div className="stage-hint">
            {view === 'raw'
              ? addMode ? '十字光标：在照片上点击以添加控制点' : '拖动橙色控制点使其与地面标志重合 · 也可在右侧新增'
              : '校正后的目标区正射底图（统一 70 px/m），下一步在此图上识别与量距'}
          </div>
          <div className="stage" style={{ maxHeight: 'calc(100vh - 250px)' }}>
            {view === 'raw' && (
              <canvas
                ref={canvasRef}
                style={{ width: '100%', height: 'auto', cursor: addMode ? 'crosshair' : 'default', touchAction: 'none' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              />
            )}
            {view === 'ortho' && (
              <canvas ref={orthoRef} style={{ width: '100%', height: 'auto' }} />
            )}
          </div>
        </div>

        <div>
          <div className="card side-section">
            <div className="card-h"><h3>解算</h3></div>
            <div className="card-b">
              <div className="stat-line"><span>启用控制点</span><b>{enabledCount} / {cps.length}</b></div>
              <div className="stat-line">
                <span>重投影 RMS</span>
                <b style={{ color: reproRms != null && reproRms < 2 ? 'var(--good)' : 'var(--warn)' }}>
                  {reproRms != null ? `${reproRms.toFixed(3)} px` : '未解算'}
                </b>
              </div>
              <div className="stat-line"><span>比例尺</span><b>70 px/m ≈ 1.43 cm/px</b></div>
              <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} disabled={working} onClick={doCorrect}>
                {working ? '解算/校正中…' : H ? '重新解算并校正' : '解算并生成正射图'}
              </button>
              <button
                className="btn good"
                style={{ width: '100%', justifyContent: 'center', marginTop: 9 }}
                disabled={!ortho}
                onClick={() => setPage('detect')}
              >
                进入 ③ 标志袋识别 →
              </button>
            </div>
          </div>

          <div className="card side-section">
            <div className="card-h">
              <h3>控制点坐标</h3>
              <button className="btn sm" onClick={() => setAddMode((v) => !v)}>{addMode ? '取消添加' : '＋ 图上添加'}</button>
            </div>
            <div className="card-b" style={{ padding: 0 }}>
              <div style={{ maxHeight: 360, overflow: 'auto' }}>
                <table className="cp-table">
                  <thead>
                    <tr><th>名称</th><th>X(m)</th><th>Y(m)</th><th>像素</th><th></th></tr>
                  </thead>
                  <tbody>
                    {cps.map((cp, i) => (
                      <tr key={cp.id}>
                        <td>
                          <label className="toggle" style={{ gap: 5 }}>
                            <input
                              type="checkbox"
                              checked={cp.enabled !== false}
                              onChange={(e) => updateCp(cp.id, { enabled: e.target.checked })}
                            />
                            {cp.id.startsWith('CP') ? cp.id : `P${i + 1}`}
                          </label>
                        </td>
                        <td><input type="number" step="0.1" value={cp.gx} onChange={(e) => updateCp(cp.id, { gx: parseFloat(e.target.value) || 0 })} /></td>
                        <td><input type="number" step="0.1" value={cp.gy} onChange={(e) => updateCp(cp.id, { gy: parseFloat(e.target.value) || 0 })} /></td>
                        <td style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>{Math.round(cp.px)},{Math.round(cp.py)}</td>
                        <td><button className="btn sm danger" onClick={() => removeCp(cp.id)}>删</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--text-faint)', padding: '10px 14px', margin: 0 }}>
                样例控制点已按真值预填，直接解算即可；上传照片时请拖动点位并改成实测坐标。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
