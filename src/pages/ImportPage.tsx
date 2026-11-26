import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { VARIANT_LIST, type VariantId } from '../sample/scene';
import { callWorker } from '../workers/client';
import type { Raster } from '../lib/types';
import { rasterToDataURL } from '../lib/canvasUtils';
import { ROSTER } from '../lib/roster';
import { showToast } from '../App';

const META: Record<VariantId, { title: string; terrain: string; light: string; desc: string; icon: string }> = {
  'morning-ridges': {
    title: '清晨玉米垄',
    terrain: '玉米垄 / 垄沟',
    light: '清晨低角度暖光 · 长影',
    desc: '竖直玉米垄与褐色垄沟，3 个袋子被庄稼完全遮住、只留飘带；东侧低太阳拉出长影。',
    icon: '🌽',
  },
  'midday-mudwater': {
    title: '正午混作田 · 泥地水沟',
    terrain: '泥地 / 水沟 / 短茬田',
    light: '正午顶光中性',
    desc: '斑块泥地与斜穿水沟，袋子落在湿泥、水边和短茬地里，考验背景颜色干扰。',
    icon: '💧',
  },
  'dusk-nearcolors': {
    title: '傍晚葡萄园 · 相近色连袋',
    terrain: '斜垄葡萄园 / 干沟',
    light: '傍晚金色逆光 · 偏暗',
    desc: '偏暗暖调斜垄，三对颜色极近的袋子紧紧相邻，必须靠编号 05/06、17/18、29/30 分开。',
    icon: '🍇',
  },
};

export default function ImportPage() {
  const { loadSample, loadUpload, busy } = useStore();
  const [thumbs, setThumbs] = useState<Partial<Record<VariantId, string>>>({});
  const [loadingThumb, setLoadingThumb] = useState(true);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      for (const id of VARIANT_LIST) {
        try {
          const p = await callWorker<{ thumb: Raster }>('thumb', { variantId: id, width: 640 });
          if (!alive) return;
          setThumbs((t) => ({ ...t, [id]: rasterToDataURL(p.thumb) }));
        } catch {
          /* 缩略图失败不阻塞 */
        }
      }
      if (alive) setLoadingThumb(false);
    })();
    return () => { alive = false; };
  }, []);

  const onFile = (f?: File | null) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      showToast('请选择图片文件（JPG / PNG 等）');
      return;
    }
    void loadUpload(f);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>① 航拍导入</h2>
          <p>
            导入无人机在目标区上空拍摄的照片。可直接使用我们程序化生成的三种赛区样例（含农田垄沟、泥地、水沟与清晨/正午/傍晚光线），
            也可上传自己的航拍照片后在下一步手动布设控制点。系统已内置 40 名选手的注册袋色与编号。
          </p>
        </div>
        <span className="pill info">本地处理 · 照片不上传</span>
      </div>

      <div className="grid import">
        <div className="card">
          <div className="card-h">
            <h3>赛区样例图（自选光线 / 地形）</h3>
            <span className="hint">点击卡片载入并进入控制点校正</span>
          </div>
          <div className="card-b">
            <div className="sample-grid">
              {VARIANT_LIST.map((id) => {
                const m = META[id];
                return (
                  <div key={id} className="sample-card" onClick={() => !busy && void loadSample(id)}>
                    <div className="thumb">
                      {thumbs[id] ? (
                        <img src={thumbs[id]} alt={m.title} />
                      ) : (
                        <div className="loading"><div className="spinner" style={{ width: 26, height: 26 }} /></div>
                      )}
                      <span className="badge">{m.icon} {m.light.split(' · ')[0]}</span>
                    </div>
                    <div className="sample-meta">
                      <h4>{m.title}</h4>
                      <div className="tags">
                        <span className="tag terrain">{m.terrain}</span>
                        <span className="tag light">{m.light}</span>
                      </div>
                      <p>{m.desc}</p>
                      <button className="btn primary sm" style={{ width: '100%', justifyContent: 'center' }}>
                        载入该样例 →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 20 }}>
              <div
                className={`upload-zone ${drag ? 'drag' : ''}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  onFile(e.dataTransfer.files?.[0]);
                }}
              >
                <div className="ico">📷</div>
                <p>
                  <b>点击选择</b> 或把自己的航拍照片拖到此处
                  <br />
                  <span style={{ fontSize: 12 }}>支持 JPG / PNG / WebP，大图会自动压缩到 2800px 以内</span>
                </p>
                <button className="btn">选择航拍照片</button>
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
        </div>

        <div className="card">
          <div className="card-h">
            <h3>参赛名册与注册袋色</h3>
            <span className="hint">40 人</span>
          </div>
          <div className="card-b">
            <div className="roster-mini">
              {ROSTER.map((c) => (
                <div className="roster-chip" key={c.code} title={`${c.name} · ${c.team} · ${c.colorName}`}>
                  <span className="swatch" style={{ background: `rgb(${c.color.join(',')})` }} />
                  <span className="code">{c.code}</span>
                  <span className="nm">{c.name}</span>
                </div>
              ))}
            </div>
            <div className="legend" style={{ marginTop: 14 }}>
              <span><i style={{ background: '#f5f5f5' }} />白色编号牌 = 主识别依据</span>
              <span><i style={{ background: '#fb7185' }} />注册袋色 = 颜色复核 / 飘带追踪</span>
            </div>
          </div>
        </div>
      </div>
      {loadingThumb && <p style={{ textAlign: 'center', color: 'var(--text-faint)', marginTop: 14 }}>正在程序化绘制样例缩略图…</p>}
    </div>
  );
}
