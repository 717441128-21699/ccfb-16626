import { useEffect, useRef } from 'react';
import type { DetectResult, RankRow } from '../core/types';

interface Props {
  url: string;
  w: number;
  h: number;
  result: DetectResult | null;
  rows?: RankRow[];
  variant: 'detect' | 'results';
  selected?: number | null;
  onSelect?: (bib: number | null) => void;
  showLines?: boolean;
  showContours?: boolean;
  showRibbon?: boolean;
}

const METHOD_LABEL: Record<string, string> = {
  'disk-fit': '圆盘拟合',
  label: '编号定位',
  'ribbon-root': '飘带根部',
  'color-blob': '颜色斑块',
};

export default function OrthoCanvas({
  url,
  w,
  h,
  result,
  rows,
  variant,
  selected,
  onSelect,
  showLines = true,
  showContours = true,
  showRibbon = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !result) return;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    const t = result.targetPx;
    const rowByBib = new Map(rows?.map((r) => [r.bib, r]));

    // 袋心 -> 十字连线
    if (showLines) {
      for (const d of result.detections) {
        const row = d.bib != null ? rowByBib.get(d.bib) : undefined;
        const isSel = selected != null && d.bib === selected;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(d.cx, d.cy);
        if (variant === 'results') {
          ctx.strokeStyle = row?.outside ? 'rgba(148,163,184,0.55)' : `rgba(${row?.rgb.join(',') ?? '255,210,63'},0.75)`;
          ctx.lineWidth = isSel ? 5 : 2.2;
          ctx.setLineDash(row?.outside ? [10, 8] : []);
        } else {
          ctx.strokeStyle = isSel ? 'rgba(255,90,60,0.95)' : 'rgba(255,214,64,0.5)';
          ctx.lineWidth = isSel ? 4.5 : 1.6;
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 目标十字高亮圈
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 30, 0, Math.PI * 2);
    ctx.stroke();

    for (const d of result.detections) {
      const isSel = selected != null && d.bib === selected;
      const rgb = rowByBib.get(d.bib!)?.rgb ?? [46, 220, 140];

      if (showContours && d.contour.length > 2) {
        ctx.beginPath();
        ctx.moveTo(d.contour[0].x, d.contour[0].y);
        for (let i = 1; i < d.contour.length; i++) ctx.lineTo(d.contour[i].x, d.contour[i].y);
        ctx.closePath();
        ctx.strokeStyle = isSel ? '#ff5a3c' : 'rgba(52,255,150,0.9)';
        ctx.lineWidth = isSel ? 4 : 2.4;
        ctx.stroke();
      }
      if (showRibbon && d.ribbon.length > 1) {
        ctx.beginPath();
        ctx.moveTo(d.ribbon[0].x, d.ribbon[0].y);
        for (const p of d.ribbon.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = 'rgba(56,224,255,0.85)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(d.cx, d.cy, isSel ? 11 : 7, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${rgb.join(',')})`;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke();

      // 编号标签
      const label = d.bib != null ? String(d.bib) : '?';
      ctx.font = `800 ${isSel ? 30 : 24}px "PingFang SC", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(8,12,22,0.85)';
      ctx.strokeText(label, d.cx, d.cy - 16);
      ctx.fillStyle = isSel ? '#ffd23f' : '#ffffff';
      ctx.fillText(label, d.cx, d.cy - 16);

      if (isSel) {
        ctx.font = '600 18px system-ui, sans-serif';
        const m = METHOD_LABEL[d.method] ?? d.method;
        const txt = `${m} · ${d.distanceM.toFixed(2)}m`;
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(8,12,22,0.82)';
        ctx.fillRect(d.cx - tw / 2 - 10, d.cy + 14, tw + 20, 28);
        ctx.fillStyle = '#9ff0c8';
        ctx.fillText(txt, d.cx, d.cy + 34);
      }
    }
  }, [result, rows, selected, variant, showLines, showContours, showRibbon, w, h]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!result || !onSelect) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * w;
    const y = ((e.clientY - rect.top) / rect.height) * h;
    let best: number | null = null;
    let bd = 26;
    for (const d of result.detections) {
      const dd = Math.hypot(d.cx - x, d.cy - y);
      if (dd < bd) {
        bd = dd;
        best = d.bib;
      }
    }
    onSelect(best);
  };

  return (
    <div className="viewer">
      <img className="base" src={url} alt="正射底图" draggable={false} />
      <canvas
        ref={canvasRef}
        className="overlay"
        width={w}
        height={h}
        onClick={handleClick}
        style={{ cursor: onSelect ? 'pointer' : 'default' }}
      />
    </div>
  );
}
