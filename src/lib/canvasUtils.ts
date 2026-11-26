import type { Raster } from './types';

export function rasterToImageData(r: Raster): ImageData {
  return new ImageData(new Uint8ClampedArray(r.data), r.width, r.height);
}

export function paintRaster(canvas: HTMLCanvasElement, r: Raster): CanvasRenderingContext2D | null {
  if (canvas.width !== r.width) canvas.width = r.width;
  if (canvas.height !== r.height) canvas.height = r.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = rasterToImageData(r);
  ctx.putImageData(img, 0, 0);
  return ctx;
}

export function rasterToDataURL(r: Raster): string {
  const c = document.createElement('canvas');
  c.width = r.width;
  c.height = r.height;
  const ctx = c.getContext('2d');
  if (ctx) ctx.putImageData(rasterToImageData(r), 0, 0);
  return c.toDataURL('image/png');
}

/** 指针事件 -> canvas 内部像素坐标（考虑 CSS 缩放） */
export function eventToCanvasPoint(
  e: { clientX: number; clientY: number; currentTarget: EventTarget | null },
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
  return { x, y };
}

export function cmToM(cm: number): string {
  return (cm / 100).toFixed(2);
}

export function formatCm(cm: number): string {
  return `${cm.toFixed(1)} cm`;
}
