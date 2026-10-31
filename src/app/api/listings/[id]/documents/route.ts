import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { audit, db, id as newId, now, UPLOAD_DIR, upsertDataPoint } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { CONDITIONS, DOC_CATEGORIES, FIELD_MAP } from "@/lib/fields";
import { aiEnabled, extractFromDocument } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 120;

const ALLOWED = /\.(pdf|xlsx|xls|csv|txt|png|jpe?g|webp)$/i;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: listingId } = await ctx.params;
  const u = await currentUser();
  const d = db();
  const listing = d.prepare("SELECT id FROM listings WHERE id=? AND seller_id=?").get(listingId, u?.id ?? "");
  if (!u || u.role !== "seller" || !listing) return NextResponse.json({ error: "권한 없음" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "파일 없음" }, { status: 400 });
  if (!ALLOWED.test(file.name)) return NextResponse.json({ error: "지원하지 않는 형식" }, { status: 400 });
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "20MB 이하만 가능" }, { status: 400 });
  const category = DOC_CATEGORIES.some((c) => c.key === form.get("category")) ? String(form.get("category")) : "etc";
  const condition = CONDITIONS.some((c) => c.key === form.get("condition")) ? String(form.get("condition")) : "approval";

  const docId = newId("doc");
  const dir = path.join(UPLOAD_DIR, listingId);
  fs.mkdirSync(dir, { recursive: true });
  const stored = path.join(dir, `${docId}${path.extname(file.name).toLowerCase()}`);
  fs.writeFileSync(stored, Buffer.from(await file.arrayBuffer()));
  d.prepare("INSERT INTO documents (id, listing_id, filename, mime, stored_path, category, condition, extract_status, uploaded_at) VALUES (?,?,?,?,?,?,?,?,?)").run(
    docId, listingId, file.name, file.type || "application/octet-stream", stored, category, condition, "none", now()
  );
  audit(u.id, listingId, "upload_document", file.name);

  if (form.get("extract") !== "1" || !aiEnabled()) return NextResponse.json({ message: "업로드 완료" });

  try {
    const { fields, summary } = await extractFromDocument(stored, file.type, file.name, category);
    const filled: string[] = [];
    for (const f of fields) {
      upsertDataPoint(d, listingId, f.key, f.value, {
        trust: "document",
        needsReview: true,
        sourceDocId: docId,
        sourceNote: f.evidence?.slice(0, 200) ?? null,
        period: f.period ?? null,
      });
      filled.push(FIELD_MAP[f.key].label);
    }
    const note = `${summary}${filled.length ? ` · 채운 항목: ${filled.join(", ")}` : " · 찾은 항목 없음"}`;
    d.prepare("UPDATE documents SET extract_status='done', extract_note=? WHERE id=?").run(note.slice(0, 500), docId);
    audit(u.id, listingId, "extract_document", file.name, filled.join(", "));
    return NextResponse.json({ message: filled.length ? `AI가 ${filled.length}개 항목을 채웠습니다 (확인 필요): ${filled.join(", ")}` : "자료에서 해당 항목을 찾지 못했습니다" });
  } catch (e) {
    d.prepare("UPDATE documents SET extract_status='failed', extract_note=? WHERE id=?").run(String(e).slice(0, 300), docId);
    return NextResponse.json({ message: `업로드는 됐지만 AI 추출 실패: ${String(e).slice(0, 200)}` });
  }
}
