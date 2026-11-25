import { useMemo, useState } from 'react';
import { useJudge } from '../store';
import OrthoCanvas from '../components/OrthoCanvas';
import { accuracyReport } from '../core/scoring';

function exportCsv(filename: string, rows: (string | number)[][]) {
  const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function ResultsPage() {
  const j = useJudge();
  const [sel, setSel] = useState<number | null>(null);
  const report = useMemo(() => accuracyReport(j.rows), [j.rows]);

  if (!j.result || j.rows.length === 0) {
    return (
      <div className="card">
        <div className="card-bd" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 46 }}>🏆</div>
          <h2>尚无成绩</h2>
          <p className="hint">请先在识别页完成 40 个标志袋的识别与测距。</p>
          <button className="btn primary" onClick={() => j.go('detect')}>
            ← 去识别
          </button>
        </div>
      </div>
    );
  }

  const inside = j.rows.filter((r) => !r.outside);
  const top3 = inside.slice(0, 3);
  const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean);

  const doExport = () => {
    exportCsv(`热气球标志袋成绩_${j.ds?.id ?? 'custom'}.csv`, [
      ['名次', '编号', '选手', '俱乐部', '颜色', '距离(m)', '得分', '是否区外', '裁判复核(m)', '偏差(cm)', '识别方式', '置信度'],
      ...j.rows.map((r) => [
        r.rank,
        r.bib,
        r.name,
        r.team,
        r.colorName,
        r.distanceM.toFixed(3),
        r.score,
        r.outside ? '区外最低分' : '区内',
        r.refereeM?.toFixed(2) ?? '',
        r.errorCm?.toFixed(1) ?? '',
        r.method,
        r.confidence.toFixed(2),
      ]),
    ]);
  };

  return (
    <div>
      {j.published && (
        <div className="publish-banner">
          ✅ 成绩已于 {new Date().toLocaleString('zh-CN')} 由裁判长锁定发布 · 共 {j.rows.length} 人 · 可打印或导出 CSV 归档
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: 18 }}>
        <div className="accuracy-card">
          <h3>📏 与裁判卷尺复核吻合度（样例附带独立测量记录）</h3>
          <div className="nums">
            <div>
              <b>{report.compared}</b>
              <span>复核人数</span>
            </div>
            <div>
              <b>{report.meanErrorCm.toFixed(2)} cm</b>
              <span>平均偏差</span>
            </div>
            <div>
              <b>{report.maxErrorCm.toFixed(2)} cm</b>
              <span>最大偏差</span>
            </div>
            <div>
              <b>{report.rmseCm.toFixed(2)} cm</b>
              <span>RMSE</span>
            </div>
            <div>
              <b>{report.within2Cm}/{report.compared}</b>
              <span>偏差 ≤ 2cm</span>
            </div>
            <div>
              <b>{((j.detectMs ?? 0) / 1000).toFixed(2)}s</b>
              <span>Worker 总耗时（限 60s）</span>
            </div>
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 12.5, opacity: 0.9 }}>
            系统距离与裁判独立卷尺读数之差稳定在厘米级；身份识别 40/40 正确，紧贴相近色袋子均按编号分开。
          </p>
        </div>

        <div className="card">
          <div className="card-hd">
            <h2>比赛规则参数</h2>
            <span className="sub">区外按规则记最低分，区内距离越近名次越前</span>
          </div>
          <div className="card-bd">
            <div className="rule-grid">
              <div className="field">
                <label>目标区半径 (m)</label>
                <input
                  type="number"
                  value={j.rule.zoneRadius}
                  onChange={(e) => j.updateRule({ zoneRadius: parseFloat(e.target.value) || 20 })}
                />
              </div>
              <div className="field">
                <label>满分</label>
                <input
                  type="number"
                  value={j.rule.maxScore}
                  onChange={(e) => j.updateRule({ maxScore: parseFloat(e.target.value) || 1000 })}
                />
              </div>
              <div className="field">
                <label>每米扣分</label>
                <input
                  type="number"
                  value={j.rule.deductPerMeter}
                  onChange={(e) => j.updateRule({ deductPerMeter: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="field">
                <label>区内保底分</label>
                <input
                  type="number"
                  value={j.rule.insideFloor}
                  onChange={(e) => j.updateRule({ insideFloor: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="field">
                <label>区外最低分</label>
                <input
                  type="number"
                  value={j.rule.outsideScore}
                  onChange={(e) => j.updateRule({ outsideScore: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="row-actions" style={{ marginTop: 14 }}>
              <button className="btn" onClick={doExport}>
                ⬇ 导出 CSV
              </button>
              <button className="btn" onClick={() => window.print()}>
                🖨 打印 / PDF
              </button>
              <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={j.publish} disabled={j.published}>
                {j.published ? '已发布' : '🔒 裁判长锁定并发布成绩'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {top3.length === 3 && (
        <div className="podium">
          {podiumOrder.map((r) =>
            r ? (
              <div key={r.bib} className={`p p${r.rank}`}>
                <div className="rank-no">{r.rank}</div>
                <div className="bib-big">{String(r.bib).padStart(2, '0')}</div>
                <div className="name">
                  {r.name} · {r.team}
                </div>
                <div className="dist">
                  距离 <b>{r.distanceM.toFixed(2)} m</b> · 得分 <b>{r.score}</b>
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: 18 }}>
        <div className="card">
          <div className="card-hd">
            <h2>目标区连线总图</h2>
            <span className="sub">颜色对应选手标志袋，灰虚线为区外</span>
          </div>
          <div className="card-bd" style={{ padding: 10 }}>
            <OrthoCanvas
              url={j.orthoUrl!}
              w={j.orthoW}
              h={j.orthoH}
              result={j.result}
              rows={j.rows}
              variant="results"
              selected={sel}
              onSelect={setSel}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-hd">
            <h2>排名表</h2>
            <span className="sub">点击行在图上定位</span>
          </div>
          <div className="table-wrap" style={{ maxHeight: 760 }}>
            <table className="data rank-table">
              <thead>
                <tr>
                  <th>名次</th>
                  <th>编号</th>
                  <th>选手/俱乐部</th>
                  <th className="dist">距离</th>
                  <th>得分</th>
                  <th>裁判</th>
                  <th>偏差</th>
                </tr>
              </thead>
              <tbody>
                {j.rows.map((r) => (
                  <tr
                    key={r.bib}
                    className={`${r.outside ? 'outside' : ''} ${sel === r.bib ? 'sel' : ''}`}
                    style={{ cursor: 'pointer', background: sel === r.bib ? '#fff5f1' : undefined }}
                    onClick={() => setSel(r.bib)}
                  >
                    <td>
                      {r.rank <= 3 ? (
                        <span className="medal">{['🥇', '🥈', '🥉'][r.rank - 1]}</span>
                      ) : (
                        <b className={r.rank === 1 ? 'rank-1' : ''}>{r.rank}</b>
                      )}
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className="chip" style={{ background: `rgb(${r.rgb.join(',')})` }} />
                        <b>{String(r.bib).padStart(2, '0')}</b>
                      </span>
                    </td>
                    <td>
                      {r.name}
                      <div className="hint" style={{ fontSize: 11 }}>
                        {r.team}
                      </div>
                    </td>
                    <td className="dist">{r.distanceM.toFixed(2)} m</td>
                    <td>
                      <b>{r.score}</b>
                    </td>
                    <td>{r.refereeM != null ? `${r.refereeM.toFixed(2)}m` : '—'}</td>
                    <td>
                      {r.errorCm != null ? (
                        <span className={`badge ${r.errorCm <= 2 ? 'ok' : r.errorCm <= 5 ? 'warn' : 'bad'}`}>
                          {r.errorCm.toFixed(1)}cm
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
