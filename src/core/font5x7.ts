// 5x7 点阵数字：样例编号绘制与 OCR 归一化模板共用同一份定义。

export const DIGIT_W = 5;
export const DIGIT_H = 7;

// 每行 5 位，'1' 为亮
export const DIGITS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01100'],
};

export function digitMask(ch: string): Uint8Array {
  const rows = DIGITS[ch] ?? DIGITS['0'];
  const m = new Uint8Array(DIGIT_W * DIGIT_H);
  for (let y = 0; y < DIGIT_H; y++) {
    for (let x = 0; x < DIGIT_W; x++) m[y * DIGIT_W + x] = rows[y][x] === '1' ? 1 : 0;
  }
  return m;
}

/** 把数字串画到光栅上的参数（供生成与识别共用尺寸约定） */
export function labelLayout(text: string, cellPx: number) {
  const n = text.length;
  const gap = Math.max(1, Math.round(cellPx));
  const digitW = DIGIT_W * cellPx;
  const digitH = DIGIT_H * cellPx;
  const totalW = n * digitW + (n - 1) * gap;
  return { n, gap, digitW, digitH, totalW, totalH: digitH };
}
