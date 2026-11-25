import { useEffect, useMemo, useRef, useState } from 'react';
import { listPresets, renderTerrainThumbnail } from '../core/scene';
import { rgbaToDataUrl } from '../browser-image';
import { useJudge } from '../store';
import { buildPlayers } from '../core/players';

function PresetThumb({ terrain, light }: { terrain: any; light: any }) {
  const url = useMemo(() => {
    const data = renderTerrainThumbnail({ terrain, light }, 360, 250);
    return rgbaToDataUrl(data, 360, 250);
  }, [terrain, light]);
  return <img src={url} alt="" />;
}

export default function ImportPage() {
  const j = useJudge();
  const [sel, setSel] = useState(listPresets[0].id);
  const [drag, setDrag] = useState(false);
  const [wantGo, setWantGo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const players = useMemo(() => buildPlayers(), []);

  const preset = listPresets.find((p) => p.id === sel)!;

  useEffect(() => {
    if (wantGo && j.ds && j.photoUrl && !j.busy) {
      setWantGo(false);
      j.go('gcp');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [j.ds, j.photoUrl, j.busy, wantGo]);

  const onFile = (f?: File | null) => {
    if (!f) return;
    j.upload(f).then(() => j.go('gcp'));
  };

  return (
    <div>
      <section className="hero">
        <h2>① 航拍导入 · 自己生成的赛区样例与真实照片</h2>
        <p>
          内置 6 种样例：清晨 / 正午 / 傍晚 / 阴天光线，混合农田、垄沟庄稼、泥地与水沟。
          每场固定 40 名选手，刻意布置「只露飘带」「相近色紧贴靠编号分离」「半遮挡」「泥地水面」「目标区外」等考点，
          并附带控制点坐标与裁判卷尺复核记录。也可上传无人机实拍照片，手动点选控制点后解算。
        </p>
        <div className="tags">
          <span>🌾 两垄之间仅露飘带</span>
          <span>🔢 颜色 + 编号双重识别</span>
          <span>📐 DLT 单应校正正射图</span>
          <span>⚡ Web Worker 测距</span>
          <span>🎯 厘米级复核</span>
        </div>
      </section>

      <div className="grid-2">
        <div className="card">
          <div className="card-hd">
            <h2>选择样例航拍图</h2>
            <span className="sub">缩略图为实时光线/地形渲染</span>
          </div>
          <div className="card-bd">
            <div className="preset-grid">
              {listPresets.map((p) => (
                <button key={p.id} className={`preset ${sel === p.id ? 'sel' : ''}`} onClick={() => setSel(p.id)}>
                  <PresetThumb terrain={p.terrain} light={p.light} />
                  <div className="meta">
                    <b>{p.title}</b>
                    <p>{p.subtitle}</p>
                  </div>
                </button>
              ))}
            </div>
            <div className="row-actions" style={{ marginTop: 16 }}>
              <button
                className="btn primary"
                disabled={!!j.busy}
                onClick={() => {
                  setWantGo(true);
                  j.generate(preset.terrain, preset.light);
                }}
              >
                🚁 生成该样例并进入控制点校正 →
              </button>
              {j.ds && j.photoUrl && (
                <button className="btn" onClick={() => j.go('gcp')}>
                  继续当前场次：{j.ds.title}
                </button>
              )}
            </div>

            <div
              className={`dropzone ${drag ? 'drag' : ''}`}
              style={{ marginTop: 18 }}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                onFile(e.dataTransfer.files?.[0]);
              }}
            >
              <div className="big">📷</div>
              <div style={{ fontWeight: 700, color: 'var(--ink)' }}>点击或拖入无人机实拍 JPG / PNG</div>
              <div className="hint">上传后在控制点页点选目标十字与控制点，并输入其测量坐标</div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-hd">
            <h2>参赛名册（40）</h2>
            <span className="sub">标志袋颜色与编号</span>
          </div>
          <div className="card-bd" style={{ maxHeight: 720, overflow: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px' }}>
              {players.map((p) => (
                <div key={p.bib} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span className="chip" style={{ background: `rgb(${p.rgb.join(',')})` }} />
                  <span className="bib" style={{ width: 30, height: 24, fontSize: 13 }}>
                    {String(p.bib).padStart(2, '0')}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </span>
                </div>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 14 }}>
              其中 7 号大红 / 23 号橙红、12 号蓝 / 31 号靛蓝被刻意安排为紧贴袋，颜色相近，系统依据编号分开并确认身份。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
