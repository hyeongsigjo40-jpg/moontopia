import fs from "node:fs";
import { NextResponse } from "next/server";
import { audit, db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { canReadDoc } from "@/lib/access";

export const runtime = "nodejs";

// 원본 자료 다운로드: 서버가 열람 조건을 확인한 뒤에만 파일을 보낸다
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const u = await currentUser();
  if (!u || !canReadDoc(u.id, id)) return NextResponse.json({ error: "열람 권한이 없습니다" }, { status: 403 });
  const doc = db().prepare("SELECT * FROM documents WHERE id=?").get(id) as { stored_path: string; mime: string; filename: string; listing_id: string };
  audit(u.id, doc.listing_id, "download_document", doc.filename);
  return new NextResponse(fs.readFileSync(doc.stored_path), {
    headers: {
      "Content-Type": doc.mime,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
    },
  });
}
