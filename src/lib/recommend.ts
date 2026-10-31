// 조건별 매물 추천. 양수인에게 허용된 값만 사용한다 (잠긴 값으로 순위를 매기면 간접 유출이 되므로).
import { db } from "./db";
import { deriveMetrics, fieldViews, FieldView, Derived } from "./access";
import { BuyerProfileRow } from "./ai";
import { won } from "./format";

export type Rec = {
  id: string;
  title: string;
  region: string;
  industry: string;
  score: number;
  reasons: string[];
  cautions: string[];
  views: FieldView[];
  derived: Derived[];
};

export function recommend(buyerId: string, profile: BuyerProfileRow | undefined): Rec[] {
  const listings = db().prepare("SELECT id, title, region, industry FROM listings WHERE status='published' ORDER BY created_at DESC").all() as {
    id: string;
    title: string;
    region: string;
    industry: string;
  }[];
  const regions: string[] = profile ? JSON.parse(profile.regions) : [];
  const industries: string[] = profile ? JSON.parse(profile.industries) : [];

  return listings
    .map((l) => {
      const views = fieldViews(buyerId, l.id);
      const derived = deriveMetrics(views, profile?.work_hours ?? null);
      const reasons: string[] = [];
      const cautions: string[] = [];
      let score = 0;
      if (industries.length) {
        if (industries.includes(l.industry)) {
          score += 30;
          reasons.push(`선호 업종(${l.industry})`);
        }
      }
      if (regions.length) {
        if (regions.some((r) => l.region.includes(r))) {
          score += 30;
          reasons.push(`희망 지역(${l.region})`);
        }
      }
      const inv = derived.find((x) => x.key === "initial_investment");
      if (profile?.budget_total && inv?.interval) {
        if (inv.interval.hi <= profile.budget_total) {
          score += 25;
          reasons.push(`초기 투자금 ${won(inv.interval.hi)} 이하로 예산 안`);
        } else if (inv.interval.lo > profile.budget_total) {
          score -= 40;
          cautions.push(`초기 투자금이 예산(${won(profile.budget_total)})을 넘음`);
        }
      } else if (profile?.budget_total) cautions.push("투자금 미확인");
      const adj = derived.find((x) => x.key === "adjusted_profit");
      if (profile?.target_profit && adj?.interval) {
        if (adj.interval.lo >= profile.target_profit) {
          score += 15;
          reasons.push("내 조건 반영 순수익이 목표 이상");
        } else if (adj.interval.hi < profile.target_profit) {
          cautions.push("내 조건 반영 순수익이 목표보다 낮음");
        }
      } else if (profile?.target_profit) cautions.push("수익성은 절차 진행 후 확인 가능");
      return { ...l, score, reasons, cautions, views, derived };
    })
    .sort((a, b) => b.score - a.score);
}
