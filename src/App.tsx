import { useEffect, useState } from 'react';
import { useStore, type PageId } from './state/store';
import ImportPage from './pages/ImportPage';
import ControlPage from './pages/ControlPage';
import DetectPage from './pages/DetectPage';
import ResultsPage from './pages/ResultsPage';

const STEPS: Array<{ id: PageId; no: number; label: string }> = [
  { id: 'import', no: 1, label: '航拍导入' },
  { id: 'control', no: 2, label: '控制点校正' },
  { id: 'detect', no: 3, label: '标志袋识别' },
  { id: 'results', no: 4, label: '成绩发布' },
];

export default function App() {
  const { page, setPage, busy, ortho, bags, published } = useStore();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => setToast((e as CustomEvent<string>).detail);
    window.addEventListener('app-toast', handler as EventListener);
    return () => window.removeEventListener('app-toast', handler as EventListener);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const canGo = (id: PageId): boolean => {
    if (id === 'import') return true;
    if (id === 'control') return true;
    if (id === 'detect') return !!ortho;
    if (id === 'results') return bags.length > 0;
    return false;
  };

  const statusOf = (id: PageId): 'active' | 'done' | '' => {
    if (page === id) return 'active';
    if (id === 'control' && ortho) return 'done';
    if (id === 'detect' && bags.length > 0) return 'done';
    if (id === 'results' && published) return 'done';
    if (id === 'import' && ortho) return 'done';
    return '';
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-logo">🎈</div>
          <div>
            <h1>云眸 · 标志袋判读系统</h1>
            <div className="sub">无人机正射校正 · 颜色/编号识别 · 厘米级量距 · 赛事排名</div>
          </div>
        </div>
        <nav className="stepper">
          {STEPS.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center' }}>
              <button
                className={`step ${statusOf(s.id)}`}
                disabled={!canGo(s.id)}
                onClick={() => canGo(s.id) && setPage(s.id)}
                title={canGo(s.id) ? s.label : '请先完成上一步'}
              >
                <span className="num">{s.no}</span>
                {s.label}
              </button>
              {i < STEPS.length - 1 && <span className="step-line" />}
            </div>
          ))}
        </nav>
        <div className="top-actions">
          <span className="pill info">Web Worker 计算</span>
        </div>
      </header>

      <main style={{ flex: 1, width: '100%' }}>
        {page === 'import' && <ImportPage />}
        {page === 'control' && <ControlPage />}
        {page === 'detect' && <DetectPage />}
        {page === 'results' && <ResultsPage />}
      </main>

      <div className="footer-note">
        样例赛区与早晚光线图均由程序在本地生成 · 控制点 DLT 解算 + 透视重采样 · 识别/量距运行于 Web Worker
      </div>

      {busy && (
        <div className="busy-overlay">
          <div className="busy-box">
            <div className="spinner" />
            <div className="bt">{busy}</div>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast-wrap">
          <div className="toast">{toast}</div>
        </div>
      )}
    </div>
  );
}

export function showToast(msg: string) {
  window.dispatchEvent(new CustomEvent('app-toast', { detail: msg }));
}
