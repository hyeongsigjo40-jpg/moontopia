import Link from "next/link";
import { notFound } from "next/navigation";
import { audit, db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { deriveMetrics, docViews, fieldViews, viewerState } from "@/lib/access";
import { BuyerProfileRow, aiEnabled } from "@/lib/ai";
import { DOC_CATEGORIES, FIELD_MAP, GROUPS } from "@/lib/fields";
import FieldCell from "@/components/FieldCell";
import { CondBadge, stepsText } from "@/components/Badges";
import { askSeller, requestApproval, requestDoc, signNda, toggleCompare, verifyIdentity } from "@/app/actions";
import { fmtDate, fmtInterval } from "@/lib/format";
import Chat from "./Chat";

export const dynamic = "force-dynamic";

export default async function BuyerListing({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRole("buyer");
  const { id } = await params;
  const d = db();
  const listing = d.prepare("SELECT * FROM listings WHERE id=? AND status='published'").get(id) as
    | { id: string; title: string; region: string; industry: string }
    | undefined;
  if (!listing) notFound();

  // 열람 기록 (10분 내 중복 제외)
  const last = d.prepare("SELECT created_at FROM audit_log WHERE actor_id=? AND listing_id=? AND action='view_listing' ORDER BY id DESC LIMIT 1").get(u.id, id) as
    | { created_at: string }
    | undefined;
  if (!last || Date.now() - Date.parse(last.created_at) > 10 * 60 * 1000) audit(u.id, id, "view_listing");

  const profile = d.prepare("SELECT * FROM buyer_profiles WHERE user_id=?").get(u.id) as BuyerProfileRow | undefined;
  const vs = viewerState(u.id, id);
  const views = fieldViews(u.id, id);
  const derived = deriveMetrics(views, profile?.work_hours ?? null);
  const docs = docViews(u.id, id);
  const inquiries = d.prepare("SELECT * FROM inquiries WHERE listing_id=? AND buyer_id=? ORDER BY created_at DESC").all(id, u.id) as {
    id: string;
    question: string;
    field_key: string | null;
    status: string;
    answer: string | null;
    created_at: string;
  }[];
  const history = d.prepare("SELECT role, content FROM chat_messages WHERE buyer_id=? AND listing_id=? ORDER BY created_at").all(u.id, id) as {
    role: "user" | "assistant";
    content: string;
  }[];
  const inCompare = !!d.prepare("SELECT 1 FROM compare_items WHERE buyer_id=? AND listing_id=?").get(u.id, id);
  const canRequest = vs.identityVerified && vs.ndaSigned;
  const approvalLocked = views.filter((v) => v.state === "locked" && v.missingSteps.length === 1 && v.missingSteps[0] === "approval" && v.grantStatus !== "pending");
  const lockedCount = views.filter((v) => v.state === "locked").length;

  return (
    <div>
      <div className="spread">
        <div>
          <h1>{listing.title}</h1>
          <p className="muted">{listing.region} · {listing.industry}</p>
        </div>
        <form action={toggleCompare}>
          <input type="hidden" name="listing_id" value={id} />
          <button className="btn">{inCompare ? "비교에서 빼기" : "비교에 담기"}</button>
        </form>
      </div>

      <div className="card">
        <h2>열람 절차</h2>
        <p className="small muted">양도인이 항목마다 열람 조건을 정했습니다. 조건 충족 여부는 AI가 아니라 시스템이 확인합니다. 현재 잠긴 항목 {lockedCount}개.</p>
        <div className="steps">
          <span className={`step ${vs.identityVerified ? "done" : ""}`}>1. 본인확인 {vs.identityVerified ? "완료" : ""}</span>
          <span className={`step ${vs.ndaSigned ? "done" : ""}`}>2. 이 매물 NDA {vs.ndaSigned ? "체결" : ""}</span>
          <span className="step">3. 항목별 양도인 승인 ({views.filter((v) => v.condition === "approval" && v.state === "visible").length}개 열림)</span>
        </div>
        {!vs.identityVerified && (
          <form action={verifyIdentity} style={{ marginTop: 10 }}>
            <input type="hidden" name="back" value={`/buyer/listings/${id}`} />
            <button className="btn btn-primary">본인확인 하기 (데모: 바로 완료)</button>
          </form>
        )}
        {vs.identityVerified && !vs.ndaSigned && (
          <form action={signNda} style={{ marginTop: 12 }}>
            <input type="hidden" name="listing_id" value={id} />
            <details open>
              <summary className="small"><b>비밀유지계약(NDA) v1.0</b></summary>
              <div className="small muted" style={{ margin: "8px 0", padding: 10, background: "#faf9f6", borderRadius: 8 }}>
                1. 본 매물에서 열람한 영업정보(매출, 비용, 계약 조건, 상호, 주소 등)를 인수 검토 목적 외로 사용하지 않습니다.<br />
                2. 양도인의 동의 없이 제3자(직원, 고객, 건물주 포함)에게 공개하지 않습니다.<br />
                3. 열람 기록은 플랫폼에 남으며, 양도인은 언제든 열람 권한을 회수할 수 있습니다.<br />
                <span className="tiny">※ 데모용 문안입니다. 실서비스 전 법률 검토가 필요합니다.</span>
              </div>
            </details>
            <div className="row">
              <input name="signed_name" placeholder="서명할 이름" required style={{ width: 200 }} defaultValue={u.name.replace(/ \(.*\)/, "")} />
              <label className="small row" style={{ gap: 4 }}><input type="checkbox" name="agree" required /> 내용에 동의합니다</label>
              <button className="btn btn-primary">NDA 서명</button>
            </div>
          </form>
        )}
        {canRequest && approvalLocked.length > 0 && (
          <form action={requestApproval} style={{ marginTop: 10 }}>
            <input type="hidden" name="listing_id" value={id} />
            {approvalLocked.map((v) => <input key={v.key} type="hidden" name="field_key" value={v.key} />)}
            <button className="btn">승인이 필요한 항목 {approvalLocked.length}개 모두 요청</button>
          </form>
        )}
      </div>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div>
          <div className="card">
            <h2>매물 정보</h2>
            {GROUPS.map((g) => (
              <div key={g}>
                <h3>{g}</h3>
                <table>
                  <tbody>
                    {views.filter((v) => v.group === g).map((v) => (
                      <tr key={v.key}>
                        <td className="label">{v.label}</td>
                        <td><FieldCell v={v} listingId={id} canRequest={canRequest} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="card">
            <h2>AI 실사 질의</h2>
            <p className="small muted">AI는 서버가 이 화면에 허용한 정보만 받습니다. &ldquo;NDA까지 했는데 비용 내역도 볼 수 있어요?&rdquo;처럼 물으면 남은 절차를 알려주고, 원하면 요청까지 보냅니다.</p>
            {aiEnabled() ? <Chat listingId={id} initial={history} /> : <div className="warnbox">API 키가 없어 AI 질의를 쓸 수 없습니다.</div>}
          </div>
          <div className="card">
            <h2>내 조건 기준 계산</h2>
            <table>
              <tbody>
                {derived.map((x) => (
                  <tr key={x.key}>
                    <td className="label">{x.label}<div className="tiny">{x.formula}</div></td>
                    <td>
                      {x.interval ? <span className="value">{fmtInterval(x.interval, x.unit)}</span> : x.note ? <span className="small muted">{x.note}</span> : <span className="locked small">계산 불가 · 확인 필요: {x.missingInputs.join(", ")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="tiny" style={{ marginTop: 8 }}>범위로 공개된 값이 있으면 결과도 범위로 표시합니다. 수익을 보장하지 않으며, 현장 실사를 대신하지 않습니다.</p>
          </div>
          <div className="card">
            <h2>자료</h2>
            {docs.length === 0 && <p className="small muted">등록된 자료가 없습니다.</p>}
            <table>
              <tbody>
                {docs.map((x) => (
                  <tr key={x.id}>
                    <td>
                      {x.state === "visible" ? <a href={`/api/documents/${x.id}`} target="_blank">{x.filename}</a> : <span className="locked">{x.filename}</span>}
                      <div className="tiny">{DOC_CATEGORIES.find((c) => c.key === x.category)?.label}</div>
                    </td>
                    <td className="small">
                      {x.state === "visible" && <span className="badge b-ok">열람 가능</span>}
                      {x.state === "private" && <span className="badge b-private">비공개</span>}
                      {x.state === "locked" && (
                        <div>
                          <CondBadge c={x.condition} /> <span className="locked">{stepsText(x.missingSteps)} 필요</span>
                          {x.missingSteps.length === 1 && x.missingSteps[0] === "approval" && (
                            x.grantStatus === "pending" ? (
                              <div><span className="badge b-approval">요청 대기 중</span></div>
                            ) : (
                              <form action={requestDoc} style={{ marginTop: 4 }}>
                                <input type="hidden" name="listing_id" value={id} />
                                <input type="hidden" name="doc_id" value={x.id} />
                                <button className="btn btn-sm">열람 승인 요청</button>
                              </form>
                            )
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h2>양도인에게 질문</h2>
            <form action={askSeller}>
              <input type="hidden" name="listing_id" value={id} />
              <textarea name="question" placeholder="예: 겨울과 여름 매출 차이가 어느 정도인가요?" required />
              <button className="btn btn-sm" style={{ marginTop: 6 }}>보내기</button>
            </form>
            {inquiries.map((q) => (
              <div key={q.id} className="small" style={{ borderTop: "1px solid var(--line)", marginTop: 10, paddingTop: 8 }}>
                <div><b>Q.</b> {q.question} {q.field_key && <span className="badge">{FIELD_MAP[q.field_key]?.label}</span>} <span className="tiny">{fmtDate(q.created_at)}</span></div>
                <div className={q.status === "open" ? "muted" : ""}>
                  <b>A.</b> {q.status === "open" ? "양도인 답변 대기 중" : q.status === "declined" ? "양도인이 답하지 않기로 했습니다" : q.answer}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="tiny"><Link href="/buyer">← 추천 매물</Link></p>
    </div>
  );
}
