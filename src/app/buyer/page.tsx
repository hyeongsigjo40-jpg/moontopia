import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { recommend } from "@/lib/recommend";
import { BuyerProfileRow } from "@/lib/ai";
import { toggleCompare } from "@/app/actions";
import { fmtInterval } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BuyerHome() {
  const u = await requireRole("buyer");
  const d = db();
  const profile = d.prepare("SELECT * FROM buyer_profiles WHERE user_id=?").get(u.id) as BuyerProfileRow | undefined;
  const recs = recommend(u.id, profile);
  const compare = new Set((d.prepare("SELECT listing_id FROM compare_items WHERE buyer_id=?").all(u.id) as { listing_id: string }[]).map((r) => r.listing_id));

  const show = (rec: (typeof recs)[number], key: string) => {
    const v = rec.views.find((x) => x.key === key);
    if (!v || v.state === "missing") return "미확인";
    if (v.state !== "visible") return "잠김";
    return v.interval ? fmtInterval(v.interval, v.unit) : v.text;
  };

  return (
    <div>
      <div className="spread">
        <div>
          <h1>추천 매물</h1>
          <p className="lead">인수 조건과 지금 열람할 수 있는 정보만으로 정렬했습니다. 비교표에는 최대 3개까지 담을 수 있습니다.</p>
        </div>
        <Link href="/buyer/compare" className="btn btn-primary">비교표 보기 ({compare.size}/3)</Link>
      </div>
      {!profile && (
        <div className="warnbox">
          인수 조건을 아직 입력하지 않았습니다. <Link href="/buyer/profile">조건 입력하기</Link>
        </div>
      )}
      {!u.identity_verified && <div className="notice">본인확인을 하면 관리비·근무시간 같은 정보가 더 열리고, 매물별 NDA를 체결할 수 있습니다. 매물 상세에서 진행하세요.</div>}
      <div className="grid2">
        {recs.map((r) => (
          <div className="card listing-card" key={r.id}>
            <div className="spread">
              <h3><Link href={`/buyer/listings/${r.id}`} style={{ color: "inherit" }}>{r.title}</Link></h3>
              {r.score >= 50 && <span className="badge b-ok">추천</span>}
            </div>
            <div className="muted small">{r.region} · {r.industry}</div>
            <dl className="kv">
              <dt>희망 권리금</dt><dd>{show(r, "premium")}</dd>
              <dt>보증금 / 월세</dt><dd>{show(r, "deposit")} / {show(r, "monthly_rent")}</dd>
              <dt>월평균 매출</dt><dd>{show(r, "avg_monthly_revenue")}</dd>
            </dl>
            {r.reasons.length > 0 && <div className="small" style={{ color: "var(--accent)" }}>맞는 점: {r.reasons.join(", ")}</div>}
            {r.cautions.length > 0 && <div className="small" style={{ color: "var(--warn)" }}>확인할 점: {r.cautions.join(", ")}</div>}
            <div className="row" style={{ marginTop: 10 }}>
              <Link href={`/buyer/listings/${r.id}`} className="btn btn-sm">자세히 · AI에게 묻기</Link>
              <form action={toggleCompare}>
                <input type="hidden" name="listing_id" value={r.id} />
                <button className="btn btn-sm" disabled={!compare.has(r.id) && compare.size >= 3}>{compare.has(r.id) ? "비교에서 빼기" : "비교에 담기"}</button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
