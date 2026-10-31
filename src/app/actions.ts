"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { audit, db, id, now, upsertDataPoint } from "@/lib/db";
import { CONDITIONS, Condition, FIELDS, FIELD_MAP } from "@/lib/fields";
import { requireRole } from "@/lib/session";
import { createApprovalRequests, createDocRequest, createInquiry } from "@/lib/requests";
import { deriveMetrics, fieldViews } from "@/lib/access";
import { aiEnabled, compareSummary, describeProfile, describeViews, draftSellerAnswer, BuyerProfileRow } from "@/lib/ai";

const VALID_COND = new Set(CONDITIONS.map((c) => c.key));
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// ---------- 로그인 (데모) ----------
export async function login(formData: FormData) {
  const uid = str(formData, "uid");
  const u = db().prepare("SELECT role FROM users WHERE id=?").get(uid) as { role: string } | undefined;
  if (!u) return;
  (await cookies()).set("uid", uid, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(u.role === "seller" ? "/seller" : "/buyer");
}

export async function logout() {
  (await cookies()).delete("uid");
  redirect("/");
}

// ---------- 양도인 ----------
async function ownListing(listingId: string) {
  const u = await requireRole("seller");
  const l = db().prepare("SELECT * FROM listings WHERE id=? AND seller_id=?").get(listingId, u.id) as { id: string } | undefined;
  if (!l) throw new Error("권한이 없는 매물입니다");
  return u;
}

function readFieldForm(formData: FormData, listingId: string, confirmAll: boolean) {
  const d = db();
  for (const f of FIELDS) {
    if (!formData.has(`v_${f.key}`)) continue;
    const raw = str(formData, `v_${f.key}`).replace(/,/g, f.type === "number" ? "" : ",");
    const cond = str(formData, `c_${f.key}`) as Condition;
    const display = str(formData, `d_${f.key}`) === "range" ? "range" : "exact";
    const existing = d.prepare("SELECT id FROM datapoints WHERE listing_id=? AND key=?").get(listingId, f.key);
    if (raw === "" && !existing) continue;
    if (f.type === "number" && raw !== "" && !Number.isFinite(Number(raw))) continue;
    upsertDataPoint(d, listingId, f.key, raw === "" ? null : raw, {
      condition: VALID_COND.has(cond) ? cond : f.defaultCondition,
      display,
      needsReview: confirmAll ? false : undefined,
    });
  }
}

export async function createListing(formData: FormData) {
  const u = await requireRole("seller");
  const title = str(formData, "title");
  const industry = str(formData, "industry");
  const region = str(formData, "region");
  if (!title || !industry || !region) return;
  const lid = id("l");
  db().prepare("INSERT INTO listings VALUES (?,?,?,?,?,?,?)").run(lid, u.id, title, industry, region, "draft", now());
  readFieldForm(formData, lid, true);
  audit(u.id, lid, "create_listing", title);
  redirect(`/seller/listings/${lid}?saved=1`);
}

export async function saveListing(formData: FormData) {
  const lid = str(formData, "listing_id");
  const u = await ownListing(lid);
  const title = str(formData, "title");
  const industry = str(formData, "industry");
  const region = str(formData, "region");
  if (title && industry && region) db().prepare("UPDATE listings SET title=?, industry=?, region=? WHERE id=?").run(title, industry, region, lid);
  readFieldForm(formData, lid, true);
  audit(u.id, lid, "update_listing");
  revalidatePath(`/seller/listings/${lid}`);
  redirect(`/seller/listings/${lid}?saved=1`);
}

export async function setListingStatus(formData: FormData) {
  const lid = str(formData, "listing_id");
  const u = await ownListing(lid);
  const status = str(formData, "status");
  if (!["draft", "published", "closed"].includes(status)) return;
  db().prepare("UPDATE listings SET status=? WHERE id=?").run(status, lid);
  audit(u.id, lid, "set_status", status);
  revalidatePath(`/seller/listings/${lid}`);
}

export async function setDocCondition(formData: FormData) {
  const lid = str(formData, "listing_id");
  const u = await ownListing(lid);
  const docId = str(formData, "doc_id");
  const cond = str(formData, "condition");
  if (!VALID_COND.has(cond as Condition)) return;
  db().prepare("UPDATE documents SET condition=? WHERE id=? AND listing_id=?").run(cond, docId, lid);
  audit(u.id, lid, "set_doc_condition", docId, cond);
  revalidatePath(`/seller/listings/${lid}`);
}

export async function decideGrant(formData: FormData) {
  const lid = str(formData, "listing_id");
  const u = await ownListing(lid);
  const gid = str(formData, "grant_id");
  const decision = str(formData, "decision");
  const map: Record<string, string> = { approve: "approved", reject: "rejected", revoke: "revoked" };
  if (!map[decision]) return;
  db().prepare("UPDATE access_grants SET status=?, decided_at=? WHERE id=? AND listing_id=?").run(map[decision], now(), gid, lid);
  audit(u.id, lid, `grant_${map[decision]}`, gid);
  revalidatePath(`/seller/listings/${lid}`);
}

export async function approveAllPending(formData: FormData) {
  const lid = str(formData, "listing_id");
  const u = await ownListing(lid);
  const buyer = str(formData, "buyer_id");
  db().prepare("UPDATE access_grants SET status='approved', decided_at=? WHERE listing_id=? AND buyer_id=? AND status='pending'").run(now(), lid, buyer);
  audit(u.id, lid, "grant_approved_all", buyer);
  revalidatePath(`/seller/listings/${lid}`);
}

export async function answerInquiry(formData: FormData) {
  const lid = str(formData, "listing_id");
  const u = await ownListing(lid);
  const qid = str(formData, "inquiry_id");
  const answer = str(formData, "answer");
  const decline = str(formData, "decline") === "1";
  const d = db();
  if (decline) {
    d.prepare("UPDATE inquiries SET status='declined', answered_at=? WHERE id=? AND listing_id=?").run(now(), qid, lid);
    audit(u.id, lid, "inquiry_declined", qid);
  } else {
    if (!answer) return;
    d.prepare("UPDATE inquiries SET status='answered', answer=?, answered_at=? WHERE id=? AND listing_id=?").run(answer, now(), qid, lid);
    // 답변과 함께 항목 값을 등록하면 데이터룸에도 반영 (공개 조건은 양도인이 선택)
    const key = str(formData, "field_key");
    const value = str(formData, "field_value").replace(/,/g, FIELD_MAP[key]?.type === "number" ? "" : ",");
    const cond = str(formData, "field_condition");
    if (FIELD_MAP[key] && value && VALID_COND.has(cond as Condition)) {
      upsertDataPoint(d, lid, key, value, { condition: cond, trust: "stated" });
    }
    audit(u.id, lid, "inquiry_answered", qid);
  }
  revalidatePath(`/seller/listings/${lid}`);
}

export async function generateDraft(formData: FormData) {
  const lid = str(formData, "listing_id");
  await ownListing(lid);
  const qid = str(formData, "inquiry_id");
  const d = db();
  const q = d.prepare("SELECT * FROM inquiries WHERE id=? AND listing_id=?").get(qid, lid) as { question: string; buyer_id: string } | undefined;
  if (!q || !aiEnabled()) return;
  // 초안에는 '질문한 양수인이 이미 볼 수 있는 값'만 넣는다. 나머지는 양도인이 직접 판단한다.
  const views = fieldViews(q.buyer_id, lid);
  const ctx = describeViews(views, []);
  const draft = await draftSellerAnswer(q.question, ctx + "\n(잠긴 항목의 값은 초안에 넣지 말고 '[양도인 확인 필요]'로 표시)");
  d.prepare("UPDATE inquiries SET draft=? WHERE id=?").run(draft, qid);
  revalidatePath(`/seller/listings/${lid}`);
}

// ---------- 양수인 ----------
export async function saveProfile(formData: FormData) {
  const u = await requireRole("buyer");
  const num = (k: string) => {
    const v = str(formData, k).replace(/,/g, "");
    return v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v));
  };
  const regions = str(formData, "regions").split(/[,\s]+/).filter(Boolean);
  const industries = formData.getAll("industries").map(String);
  db()
    .prepare(
      `INSERT INTO buyer_profiles (user_id, budget_total, regions, industries, target_profit, work_hours, experience, payback_months, wanted_docs, disclose_to_seller, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET budget_total=excluded.budget_total, regions=excluded.regions, industries=excluded.industries,
       target_profit=excluded.target_profit, work_hours=excluded.work_hours, experience=excluded.experience, payback_months=excluded.payback_months,
       wanted_docs=excluded.wanted_docs, disclose_to_seller=excluded.disclose_to_seller, updated_at=excluded.updated_at`
    )
    .run(
      u.id,
      num("budget_total"),
      JSON.stringify(regions),
      JSON.stringify(industries),
      num("target_profit"),
      num("work_hours"),
      str(formData, "experience"),
      num("payback_months"),
      str(formData, "wanted_docs"),
      formData.get("disclose_to_seller") ? 1 : 0,
      now()
    );
  redirect("/buyer");
}

export async function verifyIdentity(formData: FormData) {
  const u = await requireRole("buyer");
  db().prepare("UPDATE users SET identity_verified=1 WHERE id=?").run(u.id);
  audit(u.id, null, "identity_verified", "demo");
  const back = str(formData, "back") || "/buyer";
  revalidatePath(back);
  redirect(back);
}

export async function signNda(formData: FormData) {
  const u = await requireRole("buyer");
  const lid = str(formData, "listing_id");
  const name = str(formData, "signed_name");
  if (!u.identity_verified || !name || !formData.get("agree")) return;
  db().prepare("INSERT OR IGNORE INTO ndas VALUES (?,?,?,?,?,?)").run(id("nda"), lid, u.id, "v1.0", name, now());
  audit(u.id, lid, "nda_signed", "v1.0");
  redirect(`/buyer/listings/${lid}`);
}

export async function requestApproval(formData: FormData) {
  const u = await requireRole("buyer");
  const lid = str(formData, "listing_id");
  const keys = formData.getAll("field_key").map(String);
  createApprovalRequests(u.id, lid, keys);
  revalidatePath(`/buyer/listings/${lid}`);
  revalidatePath(`/buyer/compare`);
}

export async function requestDoc(formData: FormData) {
  const u = await requireRole("buyer");
  const lid = str(formData, "listing_id");
  createDocRequest(u.id, lid, str(formData, "doc_id"));
  revalidatePath(`/buyer/listings/${lid}`);
}

export async function askSeller(formData: FormData) {
  const u = await requireRole("buyer");
  const lid = str(formData, "listing_id");
  const key = str(formData, "field_key");
  const q = str(formData, "question") || (FIELD_MAP[key] ? `${FIELD_MAP[key].label} 정보를 알려주실 수 있을까요?` : "");
  createInquiry(u.id, lid, q, key || undefined);
  revalidatePath(`/buyer/listings/${lid}`);
  revalidatePath(`/buyer/compare`);
}

export async function toggleCompare(formData: FormData) {
  const u = await requireRole("buyer");
  const lid = str(formData, "listing_id");
  const d = db();
  const exists = d.prepare("SELECT 1 FROM compare_items WHERE buyer_id=? AND listing_id=?").get(u.id, lid);
  if (exists) d.prepare("DELETE FROM compare_items WHERE buyer_id=? AND listing_id=?").run(u.id, lid);
  else {
    const n = (d.prepare("SELECT COUNT(*) c FROM compare_items WHERE buyer_id=?").get(u.id) as { c: number }).c;
    if (n >= 3) return;
    d.prepare("INSERT INTO compare_items VALUES (?,?,?)").run(u.id, lid, now());
  }
  revalidatePath("/buyer");
  revalidatePath("/buyer/compare");
}

export async function runCompareSummary() {
  const u = await requireRole("buyer");
  const d = db();
  const items = d
    .prepare("SELECT listings.id, listings.title, listings.region, listings.industry FROM compare_items JOIN listings ON listings.id=compare_items.listing_id WHERE buyer_id=? AND listings.status='published' ORDER BY added_at")
    .all(u.id) as { id: string; title: string; region: string; industry: string }[];
  if (!items.length || !aiEnabled()) return;
  const profile = d.prepare("SELECT * FROM buyer_profiles WHERE user_id=?").get(u.id) as BuyerProfileRow | undefined;
  const blocks = items.map((l) => {
    const views = fieldViews(u.id, l.id); // 서버 권한 필터 통과 데이터만
    return { title: `${l.title} (${l.region}, ${l.industry})`, context: describeViews(views, deriveMetrics(views, profile?.work_hours ?? null)) };
  });
  const result = await compareSummary(describeProfile(profile), blocks);
  d.prepare("INSERT INTO comparison_reports VALUES (?,?,?,?,?)").run(id("r"), u.id, JSON.stringify(items.map((i) => i.id)), result, now());
  for (const l of items) audit(u.id, l.id, "ai_compare", undefined, { fields: fieldViews(u.id, l.id).filter((v) => v.state === "visible").map((v) => v.key) });
  revalidatePath("/buyer/compare");
}

