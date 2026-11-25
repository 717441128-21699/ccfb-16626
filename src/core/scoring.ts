// 热气球标志袋科目计分与排名。
// 规则要点（可在成绩页调整参数）：
//  1) 目标区外的袋子按赛事规则记最低分；
//  2) 区内按距离越近名次越前；
//  3) 距离线性扣分，满分 1000。

import type { Detection, Player, RankRow, ScoreRule } from './types';

export const DEFAULT_RULE: ScoreRule = {
  maxScore: 1000,
  deductPerMeter: 12,
  insideFloor: 120,
  outsideScore: 0,
  zoneRadius: 20,
};

export function scoreDistance(distanceM: number, outside: boolean, rule: ScoreRule): number {
  if (outside) return rule.outsideScore;
  const raw = rule.maxScore - distanceM * rule.deductPerMeter;
  return Math.max(rule.insideFloor, Math.round(raw));
}

/**
 * 生成排名：区内按距离升序；区外记最低分并排在后面（仍按距离列出）。
 * 名次采用顺序排名（无并列时 1..N）。
 */
export function buildRanking(
  detections: Detection[],
  players: Player[],
  rule: ScoreRule,
  referee?: { bib: number; distanceM: number }[],
): RankRow[] {
  const refMap = new Map(referee?.map((r) => [r.bib, r.distanceM]));
  const rows = detections
    .filter((d) => d.bib != null)
    .map((d) => {
      const p = players.find((pl) => pl.bib === d.bib)!;
      const outside = d.distanceM > rule.zoneRadius || d.outside;
      const score = scoreDistance(d.distanceM, outside, rule);
      const ref = refMap.get(d.bib!);
      return {
        rank: 0,
        bib: d.bib!,
        name: p?.name ?? `编号 ${d.bib}`,
        team: p?.team ?? '',
        colorName: p?.colorName ?? '',
        rgb: p?.rgb ?? [120, 120, 120],
        distanceM: d.distanceM,
        score,
        outside,
        refereeM: ref,
        errorCm: ref != null ? Math.abs(d.distanceM - ref) * 100 : undefined,
        confidence: d.confidence,
        method: d.method,
      } satisfies RankRow;
    });

  rows.sort((a, b) => {
    if (a.outside !== b.outside) return a.outside ? 1 : -1;
    return a.distanceM - b.distanceM;
  });
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export interface AccuracyReport {
  compared: number;
  within1Cm: number;
  within2Cm: number;
  within3Cm: number;
  maxErrorCm: number;
  meanErrorCm: number;
  rmseCm: number;
}

export function accuracyReport(rows: RankRow[]): AccuracyReport {
  const errs = rows.filter((r) => r.errorCm != null).map((r) => r.errorCm!);
  if (!errs.length) {
    return { compared: 0, within1Cm: 0, within2Cm: 0, within3Cm: 0, maxErrorCm: 0, meanErrorCm: 0, rmseCm: 0 };
  }
  const sum = errs.reduce((a, b) => a + b, 0);
  const sq = errs.reduce((a, b) => a + b * b, 0);
  return {
    compared: errs.length,
    within1Cm: errs.filter((e) => e <= 1).length,
    within2Cm: errs.filter((e) => e <= 2).length,
    within3Cm: errs.filter((e) => e <= 3).length,
    maxErrorCm: Math.max(...errs),
    meanErrorCm: sum / errs.length,
    rmseCm: Math.sqrt(sq / errs.length),
  };
}
