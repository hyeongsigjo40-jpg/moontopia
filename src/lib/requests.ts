// 양수인 → 양도인 요청 생성 (화면 버튼과 AI 도구가 같은 함수를 쓴다)
import { audit, db, id, now } from "./db";
import { FIELD_MAP } from "./fields";
import { STEP_LABEL, viewerState, missingSteps } from "./access";

export function createApprovalRequests(buyerId: string, listingId: string, fieldKeys: string[]): string {
  const d = db();
  const v = viewerState(buyerId, listingId);
  const created: string[] = [];
  const skipped: string[] = [];
  for (const key of fieldKeys) {
    const def = FIELD_MAP[key];
    if (!def) continue;
    const dp = d.prepare("SELECT condition FROM datapoints WHERE listing_id=? AND key=?").get(listingId, key) as { condition: string } | undefined;
    if (!dp) {
      skipped.push(`${def.label}(미등록 — 질문으로 요청하세요)`);
      continue;
    }
    if (dp.condition !== "approval") {
      const steps = missingSteps(dp.condition as never, v, false);
      skipped.push(
        steps === null
          ? `${def.label}(양도인 비공개 항목)`
          : steps.length
            ? `${def.label}(승인 대상 아님, 남은 절차: ${steps.map((s) => STEP_LABEL[s]).join(", ")})`
            : `${def.label}(이미 열람 가능)`
      );
      continue;
    }
    if (!v.identityVerified || !v.ndaSigned) {
      skipped.push(`${def.label}(먼저 ${!v.identityVerified ? "본인확인" : ""}${!v.identityVerified && !v.ndaSigned ? "과 " : ""}${!v.ndaSigned ? "NDA 체결" : ""}이 필요)`);
      continue;
    }
    const existing = d
      .prepare("SELECT id, status FROM access_grants WHERE listing_id=? AND buyer_id=? AND target_type='field' AND target_key=?")
      .get(listingId, buyerId, key) as { id: string; status: string } | undefined;
    if (existing && (existing.status === "approved" || existing.status === "pending")) {
      skipped.push(`${def.label}(이미 ${existing.status === "approved" ? "승인됨" : "요청 대기 중"})`);
      continue;
    }
    if (existing) d.prepare("UPDATE access_grants SET status='pending', created_at=?, decided_at=NULL WHERE id=?").run(now(), existing.id);
    else d.prepare("INSERT INTO access_grants VALUES (?,?,?,?,?,?,?,?)").run(id("g"), listingId, buyerId, "field", key, "pending", now(), null);
    created.push(def.label);
  }
  if (created.length) audit(buyerId, listingId, "request_approval", created.join(", "));
  return [created.length ? `승인 요청 보냄: ${created.join(", ")}` : "", skipped.length ? `요청하지 않음: ${skipped.join("; ")}` : ""].filter(Boolean).join("\n") || "요청할 항목이 없습니다.";
}

export function createDocRequest(buyerId: string, listingId: string, docId: string): string {
  const d = db();
  const v = viewerState(buyerId, listingId);
  const doc = d.prepare("SELECT condition, filename FROM documents WHERE id=? AND listing_id=?").get(docId, listingId) as { condition: string; filename: string } | undefined;
  if (!doc || doc.condition !== "approval") return "승인 요청 대상 자료가 아닙니다.";
  if (!v.identityVerified || !v.ndaSigned) return "먼저 본인확인과 NDA 체결이 필요합니다.";
  const existing = d
    .prepare("SELECT id, status FROM access_grants WHERE listing_id=? AND buyer_id=? AND target_type='doc' AND target_key=?")
    .get(listingId, buyerId, docId) as { id: string; status: string } | undefined;
  if (existing && ["approved", "pending"].includes(existing.status)) return "이미 요청했습니다.";
  if (existing) d.prepare("UPDATE access_grants SET status='pending', created_at=?, decided_at=NULL WHERE id=?").run(now(), existing.id);
  else d.prepare("INSERT INTO access_grants VALUES (?,?,?,?,?,?,?,?)").run(id("g"), listingId, buyerId, "doc", docId, "pending", now(), null);
  audit(buyerId, listingId, "request_doc", doc.filename);
  return `자료 열람 승인 요청 보냄: ${doc.filename}`;
}

export function createInquiry(buyerId: string, listingId: string, question: string, fieldKey?: string): string {
  const q = question.trim();
  if (!q) return "질문 내용이 비어 있습니다.";
  const key = fieldKey && FIELD_MAP[fieldKey] ? fieldKey : null;
  db().prepare("INSERT INTO inquiries (id, listing_id, buyer_id, question, field_key, status, created_at) VALUES (?,?,?,?,?,?,?)").run(id("q"), listingId, buyerId, q.slice(0, 1000), key, "open", now());
  audit(buyerId, listingId, "ask_seller", key ?? undefined, q.slice(0, 200));
  return `양도인에게 질문을 보냈습니다: "${q.slice(0, 80)}"`;
}
