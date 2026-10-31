import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import FieldForm, { DpRow } from "@/components/FieldForm";
import { CONDITIONS, DOC_CATEGORIES, FIELD_MAP, FIELDS, INDUSTRIES } from "@/lib/fields";
import { CondBadge } from "@/components/Badges";
import { answerInquiry, approveAllPending, decideGrant, generateDraft, saveListing, setDocCondition, setListingStatus } from "@/app/actions";
import UploadBox from "./UploadBox";
import SubmitButton from "@/components/SubmitButton";
import { fmtDate, won } from "@/lib/format";
import { aiEnabled } from "@/lib/ai";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  create_listing: "매물 생성",
  update_listing: "매물 정보 저장",
  set_status: "공개 상태 변경",
  upload_document: "자료 업로드",
  extract_document: "AI 자료 추출",
  set_doc_condition: "자료 열람 조건 변경",
  view_listing: "매물 열람",
  nda_signed: "NDA 체결",
  request_approval: "항목 승인 요청",
  request_doc: "자료 승인 요청",
  ask_seller: "질문",
  grant_approved: "승인",
  grant_rejected: "거절",
  grant_revoked: "권한 회수",
  grant_approved_all: "대기 요청 모두 승인",
  inquiry_answered: "질문 답변",
  inquiry_declined: "질문 거절",
  ai_answer: "AI가 답변 제공",
  ai_compare: "AI 비교 분석에 사용",
  download_document: "자료 다운로드",
};

export default async function SellerListing({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; saved?: string }> }) {
  const u = await requireRole("seller");
  const { id } = await params;
  const { tab = "data", saved } = await searchParams;
  const d = db();
  const listing = d.prepare("SELECT * FROM listings WHERE id=? AND seller_id=?").get(id, u.id) as
    | { id: string; title: string; industry: string; region: string; status: string }
    | undefined;
  if (!listing) notFound();

  const dps = d.prepare("SELECT * FROM datapoints WHERE listing_id=?").all(id) as DpRow[];
  const rows = Object.fromEntries(dps.map((r) => [r.key, r]));
  const docs = d.prepare("SELECT * FROM documents WHERE listing_id=? ORDER BY uploaded_at DESC").all(id) as {
    id: string;
    filename: string;
    category: string;
    condition: string;
    extract_status: string;
    extract_note: string | null;
    uploaded_at: string;
  }[];
  const docNames = Object.fromEntries(docs.map((x) => [x.id, x.filename]));
  const grants = d
    .prepare("SELECT g.*, u.name FROM access_grants g JOIN users u ON u.id=g.buyer_id WHERE g.listing_id=? ORDER BY g.created_at DESC")
    .all(id) as { id: string; buyer_id: string; name: string; target_type: string; target_key: string; status: string; created_at: string }[];
  const inquiries = d
    .prepare("SELECT q.*, u.name FROM inquiries q JOIN users u ON u.id=q.buyer_id WHERE q.listing_id=? ORDER BY q.status='open' DESC, q.created_at DESC")
    .all(id) as { id: string; buyer_id: string; name: string; question: string; field_key: string | null; status: string; draft: string | null; answer: string | null; created_at: string }[];
  const ndas = d.prepare("SELECT n.*, u.name FROM ndas n JOIN users u ON u.id=n.buyer_id WHERE n.listing_id=?").all(id) as { buyer_id: string; name: string; signed_at: string; version: string }[];
  const log = d
    .prepare("SELECT a.*, u.name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE a.listing_id=? ORDER BY a.id DESC LIMIT 200")
    .all(id) as { id: number; name: string | null; action: string; target: string | null; detail: string | null; created_at: string }[];

  const buyerIds = [...new Set([...grants.map((g) => g.buyer_id), ...inquiries.map((q) => q.buyer_id), ...ndas.map((n) => n.buyer_id)])];
  const pendingCount = grants.filter((g) => g.status === "pending").length;
  const openQ = inquiries.filter((q) => q.status === "open").length;
  const review = dps.filter((r) => r.needs_review).length;

  const targetName = (g: { target_type: string; target_key: string }) =>
    g.target_type === "field" ? FIELD_MAP[g.target_key]?.label ?? g.target_key : `자료: ${docNames[g.target_key] ?? g.target_key}`;

  const tabs = [
    ["data", `매물 정보·공개 조건${review ? ` (확인 ${review})` : ""}`],
    ["docs", `자료 (${docs.length})`],
    ["buyers", `구매자 관리${pendingCount + openQ ? ` (${pendingCount + openQ})` : ""}`],
    ["log", "기록"],
  ];

  return (
    <div>
      <div className="spread">
        <div>
          <h1>{listing.title}</h1>
          <p className="muted">{listing.region} · {listing.industry}</p>
        </div>
        <form action={setListingStatus} className="row">
          <input type="hidden" name="listing_id" value={id} />
          <span className={`badge ${listing.status === "published" ? "b-ok" : ""}`}>{listing.status === "published" ? "공개 중" : listing.status === "draft" ? "작성 중 (비공개)" : "종료"}</span>
          {listing.status !== "published" ? (
            <button name="status" value="published" className="btn btn-primary btn-sm">매물 공개</button>
          ) : (
            <button name="status" value="draft" className="btn btn-sm">공개 중지</button>
          )}
        </form>
      </div>
      {saved && <div className="okbox">저장했습니다.</div>}
      <div className="tabs">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`?tab=${k}`} className={tab === k ? "on" : ""}>{label}</Link>
        ))}
      </div>

      {tab === "data" && (
        <form action={saveListing}>
          <input type="hidden" name="listing_id" value={id} />
          <div className="card">
            <div className="grid3">
              <label className="field"><span>매물 제목</span><input name="title" defaultValue={listing.title} /></label>
              <label className="field">
                <span>업종</span>
                <select name="industry" defaultValue={listing.industry}>
                  {INDUSTRIES.map((i) => <option key={i}>{i}</option>)}
                </select>
              </label>
              <label className="field"><span>지역 (항상 공개)</span><input name="region" defaultValue={listing.region} /></label>
            </div>
          </div>
          {review > 0 && <div className="warnbox">AI가 자료에서 채운 항목 {review}개가 &lsquo;확인 필요&rsquo; 상태입니다. 값을 확인하고 저장하면 확인 완료로 바뀝니다.</div>}
          <div className="card">
            <div className="spread">
              <h2>항목과 열람 조건</h2>
              <button className="btn btn-primary">저장</button>
            </div>
            <p className="small muted">열람 조건과 보여주는 방식은 양도인이 정합니다. AI와 화면은 서버가 허용한 값만 받습니다.</p>
            <FieldForm rows={rows} docNames={docNames} />
          </div>
          <button className="btn btn-primary">저장</button>
        </form>
      )}

      {tab === "docs" && (
        <div>
          <UploadBox listingId={id} categories={DOC_CATEGORIES} conditions={CONDITIONS} aiOn={aiEnabled()} />
          <div className="card">
            <h2>올린 자료</h2>
            {docs.length === 0 && <p className="muted">아직 올린 자료가 없습니다.</p>}
            <table>
              <tbody>
                {docs.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <a href={`/api/documents/${doc.id}`}>{doc.filename}</a>
                      <div className="tiny">{DOC_CATEGORIES.find((c) => c.key === doc.category)?.label} · {fmtDate(doc.uploaded_at)}</div>
                    </td>
                    <td className="small">
                      {doc.extract_status === "done" && <span className="badge b-ok">AI 추출 완료</span>}
                      {doc.extract_status === "failed" && <span className="badge b-danger">추출 실패</span>}
                      {doc.extract_status === "none" && <span className="badge">추출 안 함</span>}
                      {doc.extract_note && <div className="tiny">{doc.extract_note}</div>}
                    </td>
                    <td>
                      <form action={setDocCondition} className="row">
                        <input type="hidden" name="listing_id" value={id} />
                        <input type="hidden" name="doc_id" value={doc.id} />
                        <select name="condition" defaultValue={doc.condition} style={{ width: "auto" }}>
                          {CONDITIONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                        <button className="btn btn-sm">변경</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "buyers" && (
        <div>
          {buyerIds.length === 0 && <div className="card muted">아직 NDA를 맺거나 요청한 구매자가 없습니다.</div>}
          {buyerIds.map((bid) => {
            const name = grants.find((g) => g.buyer_id === bid)?.name ?? inquiries.find((q) => q.buyer_id === bid)?.name ?? ndas.find((n) => n.buyer_id === bid)?.name;
            const profile = d.prepare("SELECT * FROM buyer_profiles WHERE user_id=? AND disclose_to_seller=1").get(bid) as
              | { budget_total: number | null; experience: string | null; work_hours: number | null }
              | undefined;
            const nda = ndas.find((n) => n.buyer_id === bid);
            const bg = grants.filter((g) => g.buyer_id === bid);
            const bq = inquiries.filter((q) => q.buyer_id === bid);
            return (
              <div className="card" key={bid}>
                <div className="spread">
                  <h2>{name}</h2>
                  <span className={`badge ${nda ? "b-ok" : ""}`}>{nda ? `NDA ${nda.version} 체결 · ${fmtDate(nda.signed_at)}` : "NDA 미체결"}</span>
                </div>
                <p className="small muted">
                  {profile
                    ? `공개한 구매 조건: 예산 ${profile.budget_total ? won(profile.budget_total) : "미입력"} · 경험 ${profile.experience || "미입력"} · 근무 가능 주 ${profile.work_hours ?? "?"}시간`
                    : "구매 조건을 공개하지 않은 구매자입니다."}
                </p>
                {bg.length > 0 && (
                  <>
                    <div className="spread">
                      <h3>열람 승인 요청</h3>
                      {bg.some((g) => g.status === "pending") && (
                        <form action={approveAllPending}>
                          <input type="hidden" name="listing_id" value={id} />
                          <input type="hidden" name="buyer_id" value={bid} />
                          <button className="btn btn-sm">대기 중인 요청 모두 승인</button>
                        </form>
                      )}
                    </div>
                    <table>
                      <tbody>
                        {bg.map((g) => (
                          <tr key={g.id}>
                            <td>{targetName(g)}</td>
                            <td className="small">
                              <span className={`badge ${g.status === "approved" ? "b-ok" : g.status === "pending" ? "b-approval" : "b-danger"}`}>
                                {{ pending: "대기", approved: "승인됨", rejected: "거절", revoked: "회수됨" }[g.status]}
                              </span>{" "}
                              <span className="tiny">{fmtDate(g.created_at)}</span>
                            </td>
                            <td>
                              <form action={decideGrant} className="row">
                                <input type="hidden" name="listing_id" value={id} />
                                <input type="hidden" name="grant_id" value={g.id} />
                                {g.status === "pending" && (
                                  <>
                                    <button name="decision" value="approve" className="btn btn-sm btn-primary">승인</button>
                                    <button name="decision" value="reject" className="btn btn-sm btn-danger">거절</button>
                                  </>
                                )}
                                {g.status === "approved" && <button name="decision" value="revoke" className="btn btn-sm btn-danger">권한 회수</button>}
                                {(g.status === "rejected" || g.status === "revoked") && <button name="decision" value="approve" className="btn btn-sm">다시 승인</button>}
                              </form>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
                {bq.length > 0 && <h3>AI가 전달한 질문</h3>}
                {bq.map((q) => (
                  <div key={q.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10 }}>
                    <div className="spread">
                      <div>
                        <b>Q.</b> {q.question}
                        {q.field_key && <span className="badge" style={{ marginLeft: 6 }}>{FIELD_MAP[q.field_key]?.label}</span>}
                      </div>
                      <span className="tiny">{fmtDate(q.created_at)}</span>
                    </div>
                    {q.status === "answered" && <p className="small"><b>A.</b> {q.answer}</p>}
                    {q.status === "declined" && <p className="small muted">답변하지 않기로 함</p>}
                    {q.status === "open" && (
                      <>
                        {aiEnabled() && (
                          <form action={generateDraft} style={{ margin: "6px 0" }}>
                            <input type="hidden" name="listing_id" value={id} />
                            <input type="hidden" name="inquiry_id" value={q.id} />
                            <SubmitButton className="btn btn-sm" label="AI 답변 초안 만들기" pending="초안 작성 중..." />
                          </form>
                        )}
                        <form action={answerInquiry}>
                          <input type="hidden" name="listing_id" value={id} />
                          <input type="hidden" name="inquiry_id" value={q.id} />
                          <textarea name="answer" defaultValue={q.draft ?? ""} placeholder="이 구매자에게만 전달됩니다" />
                          <details className="small" style={{ margin: "6px 0" }}>
                            <summary>답변 내용을 매물 항목으로도 등록 (선택)</summary>
                            <div className="row" style={{ marginTop: 6 }}>
                              <select name="field_key" defaultValue={q.field_key ?? ""} style={{ width: "auto" }}>
                                <option value="">항목 선택</option>
                                {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                              </select>
                              <input name="field_value" placeholder="값" style={{ width: 160 }} />
                              <select name="field_condition" defaultValue="nda" style={{ width: "auto" }}>
                                {CONDITIONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                              </select>
                            </div>
                          </details>
                          <div className="row">
                            <button className="btn btn-primary btn-sm">답변 보내기</button>
                            <button name="decline" value="1" className="btn btn-sm">답변하지 않음</button>
                          </div>
                        </form>
                      </>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {tab === "log" && (
        <div className="card">
          <h2>접근·제공 기록</h2>
          <p className="small muted">누가 언제 무엇을 보고 요청했는지, AI가 어떤 항목으로 답했는지 모두 남습니다.</p>
          <table>
            <thead><tr><th>시각</th><th>누가</th><th>무엇을</th><th>대상</th></tr></thead>
            <tbody>
              {log.map((a) => {
                let detail = "";
                try {
                  const p = a.detail ? JSON.parse(a.detail) : null;
                  if (p?.fields) detail = `사용 항목: ${(p.fields as string[]).map((k) => FIELD_MAP[k]?.label ?? k).join(", ")}`;
                  else if (typeof p === "string") detail = p;
                } catch {}
                return (
                  <tr key={a.id}>
                    <td className="small">{fmtDate(a.created_at)}</td>
                    <td className="small">{a.name ?? "-"}</td>
                    <td className="small">{ACTION_LABEL[a.action] ?? a.action}</td>
                    <td className="small">{a.target && FIELD_MAP[a.target] ? FIELD_MAP[a.target].label : a.target}{detail && <div className="tiny">{detail}</div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="tiny" style={{ marginTop: 20 }}>열람 조건 안내: {CONDITIONS.map((c) => <span key={c.key} style={{ marginRight: 8 }}><CondBadge c={c.key} /> {c.label}</span>)}</p>
    </div>
  );
}
