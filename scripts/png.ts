// 极简 PNG 编码（Node zlib），仅用于自测调试图输出。
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

export function writePNG(filePath: string, rgba: Uint8Array | Uint8ClampedArray, w: number, h: number) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, png);
}

/** 最近邻缩小到指定宽度，返回新 RGBA */
export function downscale(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  newW: number,
): { data: Uint8ClampedArray; w: number; h: number } {
  const newH = Math.round((h * newW) / w);
  const out = new Uint8ClampedArray(newW * newH * 4);
  for (let y = 0; y < newH; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / newH));
    for (let x = 0; x < newW; x++) {
      const sx = Math.min(w - 1, Math.floor((x * w) / newW));
      const si = (sy * w + sx) * 4;
      const di = (y * newW + x) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = 255;
    }
  }
  return { data: out, w: newW, h: newH };
}
