import { NextResponse } from "next/server";
import { audit, db, id, now } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { deriveMetrics, fieldViews, docViews, STEP_LABEL } from "@/lib/access";
import { aiEnabled, buyerChat, describeProfile, describeViews, BuyerProfileRow } from "@/lib/ai";
import { createApprovalRequests, createInquiry } from "@/lib/requests";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const u = await currentUser();
  if (!u || u.role !== "buyer") return NextResponse.json({ error: "양수인만 사용할 수 있습니다" }, { status: 403 });
  if (!aiEnabled()) return NextResponse.json({ error: "AI 연결 설정이 없습니다. .env.local을 확인하세요 (npm run ai-check)" }, { status: 400 });
  const { listingId, message } = (await req.json()) as { listingId: string; message: string };
  const text = String(message ?? "").trim().slice(0, 2000);
  const d = db();
  const listing = d.prepare("SELECT * FROM listings WHERE id=? AND status='published'").get(listingId) as
    | { id: string; title: string; region: string; industry: string }
    | undefined;
  if (!listing || !text) return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });

  d.prepare("INSERT INTO chat_messages VALUES (?,?,?,?,?,?)").run(id("m"), u.id, listingId, "user", text, now());

  // 1) 서버가 먼저 이 양수인에게 허용된 데이터만 고른다 (AI는 잠긴 값을 아예 받지 못한다)
  const profile = d.prepare("SELECT * FROM buyer_profiles WHERE user_id=?").get(u.id) as BuyerProfileRow | undefined;
  const views = fieldViews(u.id, listingId);
  const derived = deriveMetrics(views, profile?.work_hours ?? null);
  const docs = docViews(u.id, listingId);
  const docLines = docs.map((x) =>
    x.state === "visible" ? `- 자료 ${x.filename}: 열람 가능` : x.state === "locked" ? `- 자료 ${x.filename}: 잠김 (남은 절차: ${x.missingSteps.map((s) => STEP_LABEL[s]).join(" → ")})` : `- 비공개 자료 1건`
  );
  const answered = d
    .prepare("SELECT question, answer, status FROM inquiries WHERE listing_id=? AND buyer_id=? AND status!='open'")
    .all(listingId, u.id) as { question: string; answer: string | null; status: string }[];
  const open = d.prepare("SELECT question FROM inquiries WHERE listing_id=? AND buyer_id=? AND status='open'").all(listingId, u.id) as { question: string }[];
  const history = (
    d.prepare("SELECT role, content FROM chat_messages WHERE buyer_id=? AND listing_id=? ORDER BY created_at DESC LIMIT 20").all(u.id, listingId) as {
      role: "user" | "assistant";
      content: string;
    }[]
  ).reverse();

  try {
    const result = await buyerChat({
      listingTitle: listing.title,
      listingMeta: `(${listing.region}, ${listing.industry})`,
      dataContext: `${describeViews(views, derived)}\n\n자료 목록:\n${docLines.join("\n") || "없음"}\n\n양수인 상태: 본인확인 ${u.identity_verified ? "완료" : "전"}`,
      profile: describeProfile(profile),
      answeredInquiries: [
        ...answered.map((q) => `Q: ${q.question}\nA: ${q.status === "answered" ? q.answer : "양도인이 답하지 않기로 함"}`),
        ...open.map((q) => `Q: ${q.question} (답변 대기 중)`),
      ].join("\n"),
      history,
      tools: {
        requestApproval: (keys) => createApprovalRequests(u.id, listingId, keys),
        askSeller: (q, key) => createInquiry(u.id, listingId, q, key),
      },
    });
    d.prepare("INSERT INTO chat_messages VALUES (?,?,?,?,?,?)").run(id("m"), u.id, listingId, "assistant", result.text + (result.actions.length ? `\n\n[처리] ${result.actions.join(" / ")}` : ""), now());
    audit(u.id, listingId, "ai_answer", undefined, { fields: views.filter((v) => v.state === "visible").map((v) => v.key) });
    return NextResponse.json({ text: result.text, actions: result.actions });
  } catch (e) {
    return NextResponse.json({ error: `AI 호출 실패: ${String(e).slice(0, 300)}` }, { status: 500 });
  }
}
