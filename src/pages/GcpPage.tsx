import { useMemo, useRef, useState } from 'react';
import { useJudge } from '../store';
import { findHomography, applyH, reprojectionRmse } from '../core/geometry';
import type { Gcp } from '../core/types';

const PPM = 40;

export default function GcpPage() {
  const j = useJudge();
  const svgRef = useRef<SVGSVGElement>(null);
  const [addMode, setAddMode] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const valid = j.gcps.filter((g) => Number.isFinite(g.px) && Number.isFinite(g.py));
  const homography = useMemo(() => {
    if (valid.length < 4) return null;
    try {
      return findHomography(
        valid.map((g) => ({ x: g.px, y: g.py })),
        valid.map((g) => ({ x: g.x, y: g.y })),
      );
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [j.gcps]);

  const residuals = useMemo(() => {
    const map = new Map<string, number>();
    if (!homography) return map;
    for (const g of valid) {
      const p = applyH(homography, g.px, g.py);
      map.set(g.id, Math.hypot(p.x - g.x, p.y - g.y) * 100);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homography]);

  const rmse = useMemo(() => {
    if (!homography) return null;
    return reprojectionRmse(
      homography,
      valid.map((g) => ({ x: g.px, y: g.py })),
      valid.map((g) => ({ x: g.x, y: g.y })),
    ).rmse * 100;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homography]);

  const toImage = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const onMove = (e: React.PointerEvent) => {
    if (!dragId) return;
    const p = toImage(e.clientX, e.clientY);
    if (p) j.updateGcp(dragId, { px: p.x, py: p.y });
  };

  const onBgClick = (e: React.MouseEvent) => {
    if (!addMode) return;
    const p = toImage(e.clientX, e.clientY);
    if (p) {
      j.addGcpAt(p.x, p.y);
      setAddMode(false);
    }
  };

  if (!j.ds || !j.photoUrl) {
    return (
      <div className="card">
        <div className="card-bd">
          <p>还没有航拍图。</p>
          <button className="btn primary" onClick={() => j.go('import')}>
            ← 去导入 / 生成样例
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid-2">
      <div className="card">
        <div className="card-hd">
          <h2>航拍原片 · 控制点标定</h2>
          <span className="sub">拖动十字标使其对准地面标志；{j.custom ? '实拍照片请手动点选' : '样例已自动精确标定'}</span>
          <button
            className={`btn sm ${addMode ? 'primary' : ''}`}
            style={{ marginLeft: 'auto' }}
            onClick={() => setAddMode((v) => !v)}
          >
            {addMode ? '请在图上点击新控制点…' : '＋ 增加控制点'}
          </button>
        </div>
        <div className="card-bd">
          <div className="viewer" style={{ cursor: addMode ? 'crosshair' : 'default' }}>
            <img className="base" src={j.photoUrl} alt="航拍" draggable={false} />
            <svg
              ref={svgRef}
              className="overlay"
              viewBox={`0 0 ${j.photoW} ${j.photoH}`}
              preserveAspectRatio="none"
              onPointerMove={onMove}
              onPointerUp={() => setDragId(null)}
              onPointerLeave={() => setDragId(null)}
              onClick={onBgClick}
            >
              {j.gcps.filter((g) => Number.isFinite(g.px)).map((g) => (
                <GcpMarker key={g.id} g={g} onDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); setDragId(g.id); }} />
              ))}
            </svg>
          </div>
          <div className="row-actions" style={{ marginTop: 14 }}>
            <button className="btn primary" disabled={valid.length < 4 || !!j.busy} onClick={j.correct}>
              📐 解算单应并生成正射校正图
            </button>
            {j.corrected && (
              <button className="btn success" onClick={() => j.go('detect')}>
                进入标志袋识别 →
              </button>
            )}
            {rmse != null && (
              <span className={`badge ${rmse < 2 ? 'ok' : rmse < 10 ? 'warn' : 'bad'}`}>
                重投影 RMSE {rmse.toFixed(2)} cm
              </span>
            )}
          </div>
          {j.orthoUrl && (
            <div style={{ marginTop: 16 }}>
              <div className="hint" style={{ marginBottom: 6 }}>
                校正后目标区正射底图（{j.orthoW}×{j.orthoH}，{PPM} px/m）
              </div>
              <img src={j.orthoUrl} alt="正射图" style={{ width: '100%', borderRadius: 10, border: '1px solid var(--line)' }} />
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <h2>控制点坐标（场地米坐标系）</h2>
          <span className="sub">至少 4 点，建议 6+1 十字</span>
        </div>
        <div className="card-bd">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>编号</th>
                  <th>名称</th>
                  <th>X(m)</th>
                  <th>Y(m)</th>
                  <th>图上 px</th>
                  <th>残差</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {j.gcps.map((g) => {
                  const res = residuals.get(g.id);
                  return (
                    <tr key={g.id}>
                      <td>
                        <b>{g.id}</b>
                      </td>
                      <td>{g.name}</td>
                      <td>
                        <input
                          type="number"
                          step="0.1"
                          value={Number.isFinite(g.x) ? g.x : ''}
                          onChange={(e) => j.updateGcp(g.id, { x: parseFloat(e.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.1"
                          value={Number.isFinite(g.y) ? g.y : ''}
                          onChange={(e) => j.updateGcp(g.id, { y: parseFloat(e.target.value) })}
                        />
                      </td>
                      <td>
                        {Number.isFinite(g.px) ? (
                          <span className="hint">
                            {g.px.toFixed(0)},{g.py.toFixed(0)}
                          </span>
                        ) : (
                          <span className="badge bad">待点选</span>
                        )}
                      </td>
                      <td>
                        {res != null ? (
                          <span className={`badge ${res < 2 ? 'ok' : res < 8 ? 'warn' : 'bad'}`}>{res.toFixed(1)}cm</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {g.id !== 'T' && (
                          <button className="btn sm" onClick={() => j.removeGcp(g.id)}>
                            删
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginTop: 12 }}>
            目标十字 T 坐标固定为 (40, 30)。单应采用 DLT + Hartley 归一化与最小二乘；样例控制点由模拟相机精确投影，残差接近 0。
            测距时在同一正射像素帧内比较袋心与检出的十字中心，自动抵消半像素与坐标原点约定误差。
          </p>
        </div>
      </div>
    </div>
  );
}

function GcpMarker({ g, onDown }: { g: Gcp; onDown: (e: React.PointerEvent) => void }) {
  const color = g.id === 'T' ? '#f5b301' : '#22d3ee';
  return (
    <g
      transform={`translate(${g.px} ${g.py})`}
      onPointerDown={onDown}
      style={{ cursor: 'grab' }}
    >
      <circle r={17} fill="rgba(0,0,0,0.35)" />
      <circle r={13} fill="rgba(255,255,255,0.92)" stroke={color} strokeWidth={3} />
      <line x1={-19} y1={0} x2={19} y2={0} stroke={color} strokeWidth={3} />
      <line x1={0} y1={-19} x2={0} y2={19} stroke={color} strokeWidth={3} />
      <circle r={4} fill={color} />
      <text x={16} y={-14} fontSize={20} fontWeight={800} fill="#fff" stroke="#0b1220" strokeWidth={4} paintOrder="stroke">
        {g.id}
      </text>
    </g>
  );
}
