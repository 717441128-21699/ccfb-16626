import type { DetectedBag, RankedRow, ScoringRule } from './types';
import { contestantByCode } from './roster';

export const DEFAULT_RULE: ScoringRule = {
  zoneRadiusM: 18,
  maxScore: 1000,
  minScore: 0,
};

/**
 * 热气球定点/标志袋科目排名规则（简化且公开）：
 * - 目标区内：得分 = round(满分 * max(0, 1 - 距离/目标区半径))；
 * - 落在目标区外：按赛事规则记最低分；
 * - 名次始终按“标志袋中心 -> 目标十字”的距离升序，越近越靠前；
 *   区外选手排在区内之后（得分同为最低分）。
 */
export function scoreForDistance(distanceCm: number, rule: ScoringRule): { score: number; outside: boolean } {
  const dM = distanceCm / 100;
  const outside = dM > rule.zoneRadiusM;
  if (outside) return { score: rule.minScore, outside: true };
  const s = Math.round(rule.maxScore * Math.max(0, 1 - dM / rule.zoneRadiusM));
  return { score: Math.max(rule.minScore, s), outside: false };
}

export function rankBags(bags: DetectedBag[], rule: ScoringRule): RankedRow[] {
  const rows = bags.map((bag) => {
    const { score, outside } = scoreForDistance(bag.distanceCm, rule);
    return {
      rank: 0,
      bag,
      contestant: contestantByCode(bag.code),
      distanceCm: bag.distanceCm,
      score,
      outside,
      refereeCm: bag.refereeCm ?? null,
      errorCm: bag.errorCm ?? null,
    };
  });

  // 区内按距离升序在前，区外按距离升序在后
  rows.sort((a, b) => {
    if (a.outside !== b.outside) return a.outside ? 1 : -1;
    return a.distanceCm - b.distanceCm;
  });

  // 并列名次（标准竞赛排名 1224）：距离相同（厘米）同名次
  let rank = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i === 0 || rows[i].distanceCm !== rows[i - 1].distanceCm) {
      rank = i + 1;
    }
    rows[i].rank = rank;
  }
  return rows;
}
