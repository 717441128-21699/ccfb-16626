import { STEPS, useJudge } from './store';
import ImportPage from './pages/ImportPage';
import GcpPage from './pages/GcpPage';
import DetectPage from './pages/DetectPage';
import ResultsPage from './pages/ResultsPage';

export default function App() {
  const j = useJudge();
  const stepIndex = STEPS.find((s) => s.id === j.step)?.index ?? 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-row">
          <div className="logo">🎈</div>
          <div className="brand">
            <h1>鹰眼 · 热气球标志袋视觉裁判系统</h1>
            <p>无人机航拍正射校正 · 颜色与编号识别 · 厘米级测距 · 规则计分排名</p>
          </div>
          <div className="top-meta">
            {j.ds ? (
              <>
                当前场次<br />
                <b>{j.sourceName}</b>
              </>
            ) : (
              <>
                四十人同场竞技<br />
                <b>目标区半径 {j.rule.zoneRadius} m</b>
              </>
            )}
          </div>
        </div>
        <nav className="stepper no-print">
          {STEPS.map((s) => {
            const done = s.index < stepIndex || (s.id === 'results' && j.published);
            const enabled =
              s.id === 'import' ||
              (s.id === 'gcp' && !!j.ds) ||
              (s.id === 'detect' && j.corrected) ||
              (s.id === 'results' && j.rows.length > 0);
            return (
              <button
                key={s.id}
                className={`step ${j.step === s.id ? 'active' : ''} ${done ? 'done' : ''}`}
                onClick={() => enabled && j.go(s.id)}
                style={{ opacity: enabled ? 1 : 0.45, cursor: enabled ? 'pointer' : 'not-allowed' }}
              >
                <span className="num">{done ? '✓' : s.index + 1}</span>
                {s.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="main">
        {j.error && <div className="alert">⚠ {j.error}</div>}
        {j.step === 'import' && <ImportPage />}
        {j.step === 'gcp' && <GcpPage />}
        {j.step === 'detect' && <DetectPage />}
        {j.step === 'results' && <ResultsPage />}
      </main>

      <div className="footer-note">
        核心几何 / 识别 / 评分均为 TypeScript 纯函数并运行于 Web Worker · 样例赛场与早晚光线图由程序生成 ·
        测距基准来自地面控制点解算
      </div>

      {j.busy && (
        <div className="progress-mask">
          <div className="progress-box">
            <div className="spinner" />
            <div style={{ fontWeight: 700 }}>{j.busy}</div>
            <div className="bar">
              <i style={{ width: `${j.progress || 35}%` }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
