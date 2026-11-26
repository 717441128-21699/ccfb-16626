// 5x7 点阵数字：样例图绘制与 Worker 内 OCR 模板共用同一套字形，
// 保证“按编号分开相邻同色袋”的识别是真实模板匹配而非读取真值。
// 每个数字 7 行，每行 5 个字符，'#' 为点亮。

export const DIGIT_FONT: Record<string, string[]> = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
};

export const FONT_W = 5;
export const FONT_H = 7;

/** 把两位编号渲染成二值点阵（code 长度 1~2），返回每行 bit 数组 */
export function codeBitmap(code: string): number[][] {
  const glyphs = code.split('').map((c) => DIGIT_FONT[c] ?? DIGIT_FONT['0']);
  const gap = 1;
  const totalW = glyphs.length * FONT_W + (glyphs.length - 1) * gap;
  const rows: number[][] = [];
  for (let r = 0; r < FONT_H; r++) {
    const row: number[] = [];
    glyphs.forEach((g, gi) => {
      for (let c = 0; c < FONT_W; c++) row.push(g[r][c] === '#' ? 1 : 0);
      if (gi < glyphs.length - 1) row.push(0);
    });
    rows.push(row);
  }
  void totalW;
  return rows;
}

/** 编号点阵宽度（含字间距） */
export function codeWidth(code: string): number {
  return code.length * FONT_W + (code.length - 1);
}
