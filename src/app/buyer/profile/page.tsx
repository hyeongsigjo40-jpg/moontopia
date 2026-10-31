import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { saveProfile } from "@/app/actions";
import { INDUSTRIES } from "@/lib/fields";

export const dynamic = "force-dynamic";

export default async function Profile() {
  const u = await requireRole("buyer");
  const p = db().prepare("SELECT * FROM buyer_profiles WHERE user_id=?").get(u.id) as Record<string, unknown> | undefined;
  const regions = p ? (JSON.parse(String(p.regions)) as string[]).join(", ") : "";
  const industries = p ? (JSON.parse(String(p.industries)) as string[]) : [];
  const v = (k: string) => (p?.[k] ?? "") as string | number;
  return (
    <form action={saveProfile}>
      <h1>인수 조건</h1>
      <p className="lead">이 조건으로 AI가 매물을 추천하고, 수익성을 내 근무시간에 맞춰 다시 계산합니다. 다른 양수인과 공유되지 않습니다.</p>
      <div className="card">
        <div className="grid3">
          <label className="field"><span>투자 가능 총예산 (원) — 권리금+보증금+추가 투자비</span><input name="budget_total" inputMode="numeric" defaultValue={v("budget_total")} placeholder="150000000" /></label>
          <label className="field"><span>희망 지역 (쉼표로 구분)</span><input name="regions" defaultValue={regions} placeholder="마포구, 망원동" /></label>
          <label className="field"><span>목표 월순수익 (원)</span><input name="target_profit" inputMode="numeric" defaultValue={v("target_profit")} placeholder="5000000" /></label>
          <label className="field"><span>직접 근무 가능 시간 (주, 시간)</span><input name="work_hours" inputMode="numeric" defaultValue={v("work_hours")} placeholder="50" /></label>
          <label className="field"><span>희망 투자금 회수기간 (개월)</span><input name="payback_months" inputMode="numeric" defaultValue={v("payback_months")} placeholder="24" /></label>
          <label className="field"><span>관련 업종 운영 경험</span><input name="experience" defaultValue={v("experience")} placeholder="예: 카페 매니저 3년" /></label>
        </div>
        <label className="field">
          <span>선호 업종</span>
          <div className="checks">
            {INDUSTRIES.map((i) => (
              <label key={i}><input type="checkbox" name="industries" value={i} defaultChecked={industries.includes(i)} /> {i}</label>
            ))}
          </div>
        </label>
        <label className="field"><span>확인하고 싶은 문서</span><input name="wanted_docs" defaultValue={v("wanted_docs")} placeholder="카드매출 내역, 임대차계약서" /></label>
        <label className="small row" style={{ gap: 6 }}>
          <input type="checkbox" name="disclose_to_seller" defaultChecked={p ? !!p.disclose_to_seller : true} /> 내가 문의한 매물의 양도인에게 예산·경험·근무시간 공개
        </label>
      </div>
      <button className="btn btn-primary">저장하고 추천 보기</button>
    </form>
  );
}
