import { useMemo } from 'react';
import { useStore } from '../state/store';
import { rankBags } from '../lib/scoring';
import { ROSTER } from '../lib/roster';
import { showToast } from '../App';
import type { RankedRow } from '../lib/types';

export default function ResultsPage() {
  const { bags, rule, setRule, published, publishedAt, publish, setPage, sourceTitle } = useStore();

  const rows = useMemo(() => rankBags(bags, rule), [bags, rule]);
  const inZone = rows.filter((r) => !r.outside).length;
  const outside = rows.length - inZone;

  if (bags.length === 0) {
    return (
      <div className="page">
        <div className="card"><div className="card-b" style={{ textAlign: 'center', padding: 60 }}>
          <p style={{ color: 'var(--text-dim)' }}>还没有判读成绩。</p>
          <button className="btn primary" onClick={() => setPage('detect')}>前往标志袋识别</button>
        </div></div>
      </div>
    );
  }

  const podium = rows.slice(0, 3);
  const podiumOrder = [podium[1], podium[0], podium[2]].filter(Boolean) as RankedRow[];

  const exportCsv = () => {
    const header = ['名次', '编号', '选手', '俱乐部', '袋色', '距离(m)', '得分', '是否目标区外', '裁判复核(m)', '偏差(cm)'];
    const lines = rows.map((r) => [
      r.rank,
      r.bag.code ?? '',
      r.contestant?.name ?? '未指派',
      r.contestant?.team ?? '',
      r.contestant?.colorName ?? '',
      (r.distanceCm / 100).toFixed(2),
      r.score,
      r.outside ? '区外(最低分)' : '区内',
      r.refereeCm != null ? (r.refereeCm / 100).toFixed(2) : '',
      r.errorCm != null ? r.errorCm.toFixed(1) : '',
    ]);
    const csv = [header, ...lines]
      .map((cols) => cols.map((c) => {
        const s = String(c);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `热气球标志袋成绩_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('已导出 CSV（可直接用 Excel 打开）');
  };

  const exportJson = () => {
    const payload = {
      event: '热气球定点赛 · 标志袋科目',
      source: sourceTitle,
      rule,
      publishedAt,
      results: rows.map((r) => ({
        rank: r.rank, code: r.bag.code, name: r.contestant?.name ?? null,
        team: r.contestant?.team ?? null, distanceM: +(r.distanceCm / 100).toFixed(3),
        score: r.score, outside: r.outside,
        refereeM: r.refereeCm != null ? +(r.refereeCm / 100).toFixed(2) : null,
        errorCm: r.errorCm ?? null,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'results.json';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('已导出 JSON');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>④ 成绩发布</h2>
          <p>
            按“标志袋中心 → 目标十字”的距离升序排名，越近名次越前；落在目标区（默认 {rule.zoneRadiusM} m）外的选手按规则记最低分 {rule.minScore} 分。
            样例成绩附裁判卷尺复核与厘米偏差。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }} className="no-print">
          <button className="btn" onClick={exportCsv}>⬇ 导出 CSV</button>
          <button className="btn" onClick={exportJson}>⬇ JSON</button>
          <button className="btn" onClick={() => window.print()}>🖨 打印</button>
          <button className="btn primary" onClick={publish}>📢 发布成绩</button>
        </div>
      </div>

      {published && (
        <div className="publish-banner">
          <div className="ico">✅</div>
          <div>
            <h3>成绩已发布</h3>
            <p>发布时间 {publishedAt} · 共 {rows.length} 人 · 区内 {inZone} 人 / 区外 {outside} 人 · 可导出或打印公告</p>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-b">
          <div className="rule-grid">
            <div className="field">
              <label>目标区半径（米）</label>
              <input
                type="number" min={5} max={40} step={0.5}
                value={rule.zoneRadiusM}
                onChange={(e) => setRule({ ...rule, zoneRadiusM: parseFloat(e.target.value) || 15 })}
              />
            </div>
            <div className="field">
              <label>满分</label>
              <input type="number" value={rule.maxScore} onChange={(e) => setRule({ ...rule, maxScore: parseInt(e.target.value) || 1000 })} />
            </div>
            <div className="field">
              <label>区外最低分</label>
              <input type="number" value={rule.minScore} onChange={(e) => setRule({ ...rule, minScore: parseInt(e.target.value) || 0 })} />
            </div>
            <div className="stat-line" style={{ border: 'none', paddingBottom: 8 }}>
              <span>计分公式</span>
              <b style={{ fontSize: 12.5 }}>区内 {rule.maxScore}×(1−d/{rule.zoneRadiusM}m)</b>
            </div>
          </div>
        </div>
      </div>

      {podium.length === 3 && (
        <div className="podium">
          {podiumOrder.map((r, idx) => {
            const place = r.rank;
            const cls = place === 1 ? 'first' : place === 2 ? 'second' : 'third';
            const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉';
            return (
              <div key={r.bag.id} className={`podium-card ${cls}`} style={place === 1 ? { order: 2 } : { order: idx === 0 ? 1 : 3 }}>
                <div className="medal">{medal}</div>
                <div className="p-rank">第 {place} 名</div>
                <div className="p-name">{r.contestant?.name ?? r.bag.code}</div>
                <div className="p-team">{r.contestant?.team}</div>
                <div className="p-dist">{(r.distanceCm / 100).toFixed(2)} m</div>
                <div className="p-score">{r.score} 分</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <div className="card-h">
          <h3>完整排名</h3>
          <span className="hint">{sourceTitle} · {rows.length} 名选手</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>名次</th><th>编号 / 选手</th><th>注册袋色</th>
                <th className="num">量测距离</th><th className="num">得分</th><th>判定</th>
                <th className="num">裁判复核</th><th className="num">偏差</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.bag.id} className={r.outside ? 'outside-row' : ''}>
                  <td><span className={`rank-badge ${r.rank <= 3 ? `r${r.rank}` : ''}`}>{r.rank}</span></td>
                  <td>
                    <div className="contestant-cell">
                      <span className="cc-code">{r.bag.code ?? '—'}</span>
                      <div>
                        <div className="cc-name">{r.contestant?.name ?? '未指派'}</div>
                        <div className="cc-team">{r.contestant?.team ?? '手动目标'}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {r.contestant && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
                        <span className="swatch" style={{ background: `rgb(${r.contestant.color.join(',')})` }} />
                        {r.contestant.colorName}
                      </span>
                    )}
                  </td>
                  <td className="num"><b>{(r.distanceCm / 100).toFixed(2)} m</b></td>
                  <td className="num" style={{ color: 'var(--gold)', fontWeight: 800 }}>{r.score}</td>
                  <td>{r.outside ? <span className="pill bad">目标区外 · 最低分</span> : <span className="pill ok">目标区内</span>}</td>
                  <td className="num" style={{ color: 'var(--text-dim)' }}>{r.refereeCm != null ? `${(r.refereeCm / 100).toFixed(2)} m` : '—'}</td>
                  <td className="num" style={{ color: r.errorCm == null ? 'var(--text-faint)' : r.errorCm <= 3 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>
                    {r.errorCm != null ? `${r.errorCm.toFixed(1)} cm` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 14 }}>
        排名规则：距离越近名次越前；距离相同（厘米）记为并列。计分与目标区半径可由裁判调整，导出/打印以当前规则为准。
        花名册共 {ROSTER.length} 人，当前判出 {rows.length} 个目标。
      </p>
    </div>
  );
}
