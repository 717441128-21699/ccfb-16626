import { useEffect, useRef, useState } from 'react';
import type { DetectedBag, Pt, Raster } from '../lib/types';
import { paintRaster, eventToCanvasPoint } from '../lib/canvasUtils';

interface Props {
  ortho: Raster;
  bags: DetectedBag[];
  target: Pt;
  selectedId: string | null;
  addMode: boolean;
  zoneRadiusPx?: number;
  showLines: boolean;
  showLabels: boolean;
  showZone: boolean;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onAdd: (x: number, y: number) => void;
}

export default function JudgeCanvas(props: Props) {
  const { ortho, bags, target, selectedId, addMode, zoneRadiusPx, showLines, showLabels, showZone } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);
  const [zoom, setZoom] = useState(0.62);

  // 首次拿到正射图后，把滚动位置居中到目标十字
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const z = zoom;
    const tx = target.x * z;
    const ty = target.y * z;
    requestAnimationFrame(() => {
      el.scrollLeft = tx - el.clientWidth / 2;
      el.scrollTop = ty - el.clientHeight / 2;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ortho]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = paintRaster(canvas, ortho);
    if (!ctx) return;
    const W = canvas.width;

    // 目标区圆圈
    if (showZone && zoneRadiusPx) {
      ctx.save();
      ctx.strokeStyle = 'rgba(251,191,36,0.75)';
      ctx.lineWidth = 4;
      ctx.setLineDash([18, 12]);
      ctx.beginPath();
      ctx.arc(target.x, target.y, zoneRadiusPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 连线 bag -> 十字
    if (showLines) {
      for (const b of bags) {
        const sel = b.id === selectedId;
        ctx.save();
        ctx.strokeStyle = sel ? '#38bdf8' : 'rgba(56,189,248,0.55)';
        ctx.lineWidth = sel ? 5 : 2.5;
        if (!sel && selectedId) ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 目标十字
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(target.x - 40, target.y); ctx.lineTo(target.x + 40, target.y);
    ctx.moveTo(target.x, target.y - 40); ctx.lineTo(target.x, target.y + 40);
    ctx.stroke();
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(target.x - 40, target.y); ctx.lineTo(target.x + 40, target.y);
    ctx.moveTo(target.x, target.y - 40); ctx.lineTo(target.x, target.y + 40);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(target.x, target.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444'; ctx.fill();
    ctx.restore();

    // 飘带辅助线
    for (const b of bags) {
      if (!b.ribbon) continue;
      ctx.save();
      ctx.strokeStyle = 'rgba(251,113,133,0.9)';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(b.ribbon.x1, b.ribbon.y1);
      ctx.lineTo(b.ribbon.x2, b.ribbon.y2);
      ctx.stroke();
      ctx.restore();
    }

    // 袋子标记
    for (const b of bags) {
      const sel = b.id === selectedId;
      const col = b.color ? `rgb(${b.color[0]},${b.color[1]},${b.color[2]})` : '#e2e8f0';
      ctx.save();
      if (sel) {
        ctx.beginPath(); ctx.arc(b.x, b.y, 27, 0, Math.PI * 2);
        ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 6; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(b.x, b.y, 17, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = '#ffffff'; ctx.stroke();

      if (showLabels) {
        const text = b.code ?? '?';
        ctx.font = 'bold 24px ui-monospace, Menlo, Consolas, monospace';
        const tw = ctx.measureText(text).width;
        const bx = b.x - tw / 2 - 10;
        const by = b.y - 52;
        ctx.fillStyle = 'rgba(8,13,24,0.88)';
        roundRect(ctx, bx, by, tw + 20, 32, 8); ctx.fill();
        ctx.strokeStyle = sel ? '#38bdf8' : 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2; roundRect(ctx, bx, by, tw + 20, 32, 8); ctx.stroke();
        ctx.fillStyle = b.code ? '#7dd3fc' : '#fbbf24';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, bx + 10, by + 17);
      }
      ctx.restore();
    }
    void W;
  }, [ortho, bags, target, selectedId, showLines, showLabels, showZone, zoneRadiusPx]);

  const hitTest = (p: Pt): DetectedBag | null => {
    for (let i = bags.length - 1; i >= 0; i--) {
      const b = bags[i];
      if (Math.hypot(b.x - p.x, b.y - p.y) < 24) return b;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = eventToCanvasPoint(e, e.currentTarget);
    if (addMode) {
      props.onAdd(p.x, p.y);
      return;
    }
    const hit = hitTest(p);
    if (hit) {
      props.onSelect(hit.id);
      dragId.current = hit.id;
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      props.onSelect(null);
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragId.current) return;
    const p = eventToCanvasPoint(e, e.currentTarget);
    props.onMove(dragId.current, p.x, p.y);
  };
  const endDrag = () => { dragId.current = null; };

  return (
    <div className="stage" ref={stageRef} style={{ maxHeight: 'calc(100vh - 250px)' }}>
      <div className="stage-hint">
        {addMode ? '十字光标：在图上点击放置一个手动标志袋' : '圆点为识别中心，蓝线为到目标十字的量距连线；可拖动圆点修正中心，点击右侧可改派编号'}
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: ortho.width * zoom, height: ortho.height * zoom, cursor: addMode ? 'crosshair' : dragId.current ? 'grabbing' : 'default', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
      />
      <div className="zoom-bar">
        <button className="btn sm" onClick={() => setZoom((z) => Math.max(0.2, +(z - 0.15).toFixed(2)))}>－</button>
        <button className="btn sm" onClick={() => setZoom(0.62)}>{Math.round(zoom * 100)}%</button>
        <button className="btn sm" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.15).toFixed(2)))}>＋</button>
      </div>
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
