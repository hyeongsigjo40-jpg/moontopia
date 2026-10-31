import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SellerHome() {
  const u = await requireRole("seller");
  const rows = db()
    .prepare(
      `SELECT l.*,
        (SELECT COUNT(*) FROM access_grants g WHERE g.listing_id=l.id AND g.status='pending') AS pending,
        (SELECT COUNT(*) FROM inquiries q WHERE q.listing_id=l.id AND q.status='open') AS open_q,
        (SELECT COUNT(*) FROM ndas n WHERE n.listing_id=l.id) AS ndas,
        (SELECT COUNT(*) FROM datapoints d WHERE d.listing_id=l.id AND d.needs_review=1) AS review
       FROM listings l WHERE seller_id=? ORDER BY created_at DESC`
    )
    .all(u.id) as { id: string; title: string; region: string; industry: string; status: string; pending: number; open_q: number; ndas: number; review: number }[];
  return (
    <div>
      <div className="spread">
        <div>
          <h1>내 매물</h1>
          <p className="lead">AI가 구매자 질문에 답하고, 승인과 추가 자료가 필요할 때만 여기에 표시됩니다.</p>
        </div>
        <Link href="/seller/new" className="btn btn-primary">매물 등록</Link>
      </div>
      {rows.length === 0 && <div className="card muted">등록한 매물이 없습니다.</div>}
      <div className="grid2">
        {rows.map((l) => (
          <Link href={`/seller/listings/${l.id}`} key={l.id} className="card listing-card" style={{ color: "inherit", textDecoration: "none" }}>
            <div className="spread">
              <h3>{l.title}</h3>
              <span className={`badge ${l.status === "published" ? "b-ok" : ""}`}>{l.status === "published" ? "공개 중" : l.status === "draft" ? "작성 중" : "종료"}</span>
            </div>
            <div className="muted small">{l.region} · {l.industry}</div>
            <div className="row small" style={{ marginTop: 10 }}>
              <span className={`badge ${l.pending ? "b-approval" : ""}`}>승인 대기 {l.pending}</span>
              <span className={`badge ${l.open_q ? "b-approval" : ""}`}>답변할 질문 {l.open_q}</span>
              <span className="badge">NDA 체결 {l.ndas}</span>
              {l.review > 0 && <span className="badge b-review">확인 필요 항목 {l.review}</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
