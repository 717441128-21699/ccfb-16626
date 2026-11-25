// 浏览器端图像转换小工具
export function rgbaToCanvas(data: Uint8ClampedArray | Uint8Array, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  img.data.set(data as Uint8ClampedArray);
  ctx.putImageData(img, 0, 0);
  return c;
}

export function rgbaToDataUrl(data: Uint8ClampedArray | Uint8Array, w: number, h: number): string {
  return rgbaToCanvas(data, w, h).toDataURL('image/png');
}

export function fileToImageData(file: File, maxSide = 3000): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    img.src = url;
  });
}
