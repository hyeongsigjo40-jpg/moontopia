import Link from "next/link";
import { Fragment } from "react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { deriveMetrics, fieldViews, viewerState } from "@/lib/access";
import { BuyerProfileRow, aiEnabled } from "@/lib/ai";
import { FIELDS, GROUPS } from "@/lib/fields";
import FieldCell from "@/components/FieldCell";
import { runCompareSummary, toggleCompare } from "@/app/actions";
import { fmtDate, fmtInterval } from "@/lib/format";
import SubmitButton from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function Compare() {
  const u = await requireRole("buyer");
  const d = db();
  const profile = d.prepare("SELECT * FROM buyer_profiles WHERE user_id=?").get(u.id) as BuyerProfileRow | undefined;
  const items = d
    .prepare("SELECT l.id, l.title, l.region, l.industry FROM compare_items c JOIN listings l ON l.id=c.listing_id WHERE c.buyer_id=? AND l.status='published' ORDER BY c.added_at")
    .all(u.id) as { id: string; title: string; region: string; industry: string }[];
  const cols = items.map((l) => {
    const views = fieldViews(u.id, l.id);
    const vs = viewerState(u.id, l.id);
    return { ...l, views, derived: deriveMetrics(views, profile?.work_hours ?? null), canRequest: vs.identityVerified && vs.ndaSigned, vs };
  });
  const report = d.prepare("SELECT * FROM comparison_reports WHERE buyer_id=? ORDER BY created_at DESC LIMIT 1").get(u.id) as { result: string; created_at: string } | undefined;

  return (
    <div>
      <h1>매물 비교표</h1>
      <p className="lead">모든 값은 같은 기준으로 표시하고, 칸마다 신뢰수준을 붙였습니다. 잠긴 칸은 남은 절차를, 없는 칸은 &lsquo;미확인&rsquo;과 요청 버튼을 보여줍니다.</p>
      {items.length === 0 && (
        <div className="card muted">
          비교할 매물이 없습니다. <Link href="/buyer">추천 매물</Link>에서 최대 3개를 담으세요.
        </div>
      )}
      {items.length > 0 && (
        <>
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="cmp">
              <thead>
                <tr>
                  <th>항목</th>
                  {cols.map((c) => (
                    <th key={c.id}>
                      <Link href={`/buyer/listings/${c.id}`}>{c.title}</Link>
                      <div className="tiny">{c.region} · {c.industry}</div>
                      <div className="tiny">{c.vs.identityVerified ? "본인확인 ✓" : "본인확인 전"} · {c.vs.ndaSigned ? "NDA ✓" : "NDA 전"}</div>
                      <form action={toggleCompare}>
                        <input type="hidden" name="listing_id" value={c.id} />
                        <button className="btn btn-sm" style={{ marginTop: 4 }}>빼기</button>
                      </form>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr><td colSpan={cols.length + 1} style={{ background: "#faf9f6" }}><b>내 조건 기준 계산</b></td></tr>
                {cols[0].derived.map((dm, i) => (
                  <tr key={dm.key}>
                    <td className="label">{dm.label}<div className="tiny">{dm.formula}</div></td>
                    {cols.map((c) => {
                      const x = c.derived[i];
                      return (
                        <td key={c.id}>
                          {x.interval ? <span className="value">{fmtInterval(x.interval, x.unit)}</span> : x.note ? <span className="small muted">{x.note}</span> : <span className="locked small">확인 필요: {x.missingInputs.join(", ")}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {GROUPS.map((g) => (
                  <Fragment key={g}>
                    <tr><td colSpan={cols.length + 1} style={{ background: "#faf9f6" }}><b>{g}</b></td></tr>
                    {FIELDS.filter((f) => f.group === g).map((f) => (
                      <tr key={f.key}>
                        <td className="label">{f.label}</td>
                        {cols.map((c) => (
                          <td key={c.id}><FieldCell v={c.views.find((v) => v.key === f.key)!} listingId={c.id} canRequest={c.canRequest} compact /></td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <div className="spread">
              <h2>AI 비교 분석</h2>
              {aiEnabled() && (
                <form action={runCompareSummary}>
                  <SubmitButton label={report ? "다시 분석" : "AI로 비교 분석"} pending="분석 중..." />
                </form>
              )}
            </div>
            {report ? (
              <>
                <div className="pre">{report.result}</div>
                <p className="tiny" style={{ marginTop: 8 }}>{fmtDate(report.created_at)} 기준 · 그 시점에 열람 가능했던 정보만 사용</p>
              </>
            ) : (
              <p className="small muted">{aiEnabled() ? "버튼을 누르면 지금 열람 가능한 정보로 비교 분석합니다." : "API 키가 없어 AI 분석을 쓸 수 없습니다."}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
