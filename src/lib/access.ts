// 서버 측 접근제어. AI와 화면은 모두 이 모듈이 돌려준 값만 사용한다.
// 원칙: 권한 판단은 AI 프롬프트가 아니라 여기서 한다. 잠긴 항목은 값 자체가 이 함수 밖으로 나가지 않는다.
import { db } from "./db";
import { CONDITION_RANK, Condition, Display, FIELDS, FIELD_MAP, FieldDef, Trust } from "./fields";

export type Step = "identity" | "nda" | "approval";
export const STEP_LABEL: Record<Step, string> = {
  identity: "본인확인",
  nda: "NDA 체결",
  approval: "양도인 승인",
};

export type Interval = { lo: number; hi: number };

export type FieldView = {
  key: string;
  label: string;
  group: string;
  unit?: string;
  type: "number" | "text";
  condition: Condition | null;
  state: "visible" | "locked" | "private" | "missing";
  missingSteps: Step[];
  grantStatus?: string; // 승인 요청 상태 (approval 항목)
  // visible일 때만 채워진다
  text?: string;
  interval?: Interval;
  display?: Display;
  trust?: Trust;
  needsReview?: boolean;
  sourceDocId?: string | null;
  sourceDocName?: string | null;
  sourceNote?: string | null;
};

export type DocView = {
  id: string;
  filename: string;
  category: string;
  condition: Condition;
  state: "visible" | "locked" | "private";
  missingSteps: Step[];
  grantStatus?: string;
};

export type ViewerState = {
  buyerId: string | null;
  identityVerified: boolean;
  ndaSigned: boolean;
  approvedFields: Set<string>;
  approvedDocs: Set<string>;
  grantStatus: Map<string, string>;
};

type DpRow = {
  key: string;
  value_num: number | null;
  value_text: string | null;
  condition: Condition;
  display: Display;
  trust: Trust;
  needs_review: number;
  source_doc_id: string | null;
  source_note: string | null;
};

export function viewerState(buyerId: string | null, listingId: string): ViewerState {
  const d = db();
  if (!buyerId)
    return { buyerId: null, identityVerified: false, ndaSigned: false, approvedFields: new Set(), approvedDocs: new Set(), grantStatus: new Map() };
  const u = d.prepare("SELECT identity_verified FROM users WHERE id=?").get(buyerId) as { identity_verified: number } | undefined;
  const nda = d.prepare("SELECT 1 FROM ndas WHERE listing_id=? AND buyer_id=?").get(listingId, buyerId);
  const grants = d
    .prepare("SELECT target_type, target_key, status FROM access_grants WHERE listing_id=? AND buyer_id=?")
    .all(listingId, buyerId) as { target_type: string; target_key: string; status: string }[];
  const approvedFields = new Set<string>();
  const approvedDocs = new Set<string>();
  const grantStatus = new Map<string, string>();
  for (const g of grants) {
    grantStatus.set(`${g.target_type}:${g.target_key}`, g.status);
    if (g.status === "approved") (g.target_type === "field" ? approvedFields : approvedDocs).add(g.target_key);
  }
  return { buyerId, identityVerified: !!u?.identity_verified, ndaSigned: !!nda, approvedFields, approvedDocs, grantStatus };
}

/** 조건을 충족하기 위해 남은 단계. 빈 배열 = 열람 가능. null = 비공개(열람 불가) */
export function missingSteps(cond: Condition, v: ViewerState, approved: boolean): Step[] | null {
  if (cond === "private") return null;
  const steps: Step[] = [];
  if (CONDITION_RANK[cond] >= CONDITION_RANK.identity && !v.identityVerified) steps.push("identity");
  if (CONDITION_RANK[cond] >= CONDITION_RANK.nda && !v.ndaSigned) steps.push("nda");
  if (cond === "approval" && !approved) steps.push("approval");
  return steps;
}

export function toRange(v: number): Interval {
  if (v === 0) return { lo: 0, hi: 0 };
  const sign = v < 0 ? -1 : 1;
  const a = Math.abs(v);
  const step = Math.pow(10, Math.floor(Math.log10(a))) / 2;
  const lo = Math.floor(a / step) * step;
  const hi = lo + step;
  return sign > 0 ? { lo, hi } : { lo: -hi, hi: -lo };
}

function sourceName(docId: string | null) {
  if (!docId) return null;
  const r = db().prepare("SELECT filename FROM documents WHERE id=?").get(docId) as { filename: string } | undefined;
  return r?.filename ?? null;
}

/** 양수인(또는 비로그인) 기준 매물 데이터. buyerId=null 이면 공개 정보만. */
export function fieldViews(buyerId: string | null, listingId: string): FieldView[] {
  const v = viewerState(buyerId, listingId);
  const rows = db().prepare("SELECT * FROM datapoints WHERE listing_id=?").all(listingId) as DpRow[];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return FIELDS.map((f) => buildView(f, byKey.get(f.key), v));
}

function buildView(f: FieldDef, r: DpRow | undefined, v: ViewerState): FieldView {
  const base = { key: f.key, label: f.label, group: f.group, unit: f.unit, type: f.type };
  if (!r || (r.value_num === null && (r.value_text === null || r.value_text === "")))
    return { ...base, condition: r?.condition ?? null, state: "missing", missingSteps: [] };
  const gs = v.grantStatus.get(`field:${f.key}`);
  const steps = missingSteps(r.condition, v, v.approvedFields.has(f.key));
  if (steps === null) return { ...base, condition: r.condition, state: "private", missingSteps: [] };
  if (steps.length > 0) return { ...base, condition: r.condition, state: "locked", missingSteps: steps, grantStatus: gs };
  const view: FieldView = {
    ...base,
    condition: r.condition,
    state: "visible",
    missingSteps: [],
    grantStatus: gs,
    display: r.display,
    trust: r.trust,
    needsReview: !!r.needs_review,
    sourceDocId: r.source_doc_id,
    sourceDocName: sourceName(r.source_doc_id),
    sourceNote: r.source_note,
  };
  if (f.type === "number" && r.value_num !== null) {
    view.interval = r.display === "range" ? toRange(r.value_num) : { lo: r.value_num, hi: r.value_num };
  } else {
    view.text = r.value_text ?? "";
  }
  return view;
}

/** 양도인 본인용: 모든 값 그대로 */
export function ownerFieldViews(listingId: string): FieldView[] {
  const rows = db().prepare("SELECT * FROM datapoints WHERE listing_id=?").all(listingId) as DpRow[];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const owner: ViewerState = {
    buyerId: null,
    identityVerified: true,
    ndaSigned: true,
    approvedFields: new Set(FIELDS.map((f) => f.key)),
    approvedDocs: new Set(),
    grantStatus: new Map(),
  };
  return FIELDS.map((f) => {
    const r = byKey.get(f.key);
    if (!r) return buildView(f, undefined, owner);
    // 양도인은 비공개 항목과 실제 값을 본다
    return buildView(f, { ...r, condition: r.condition === "private" ? "public" : r.condition, display: "exact" }, owner);
  });
}

export function docViews(buyerId: string | null, listingId: string): DocView[] {
  const v = viewerState(buyerId, listingId);
  const docs = db()
    .prepare("SELECT id, filename, category, condition FROM documents WHERE listing_id=? ORDER BY uploaded_at")
    .all(listingId) as { id: string; filename: string; category: string; condition: Condition }[];
  return docs.map((d) => {
    const steps = missingSteps(d.condition, v, v.approvedDocs.has(d.id));
    const gs = v.grantStatus.get(`doc:${d.id}`);
    if (steps === null) return { ...d, filename: "비공개 자료", state: "private", missingSteps: [] };
    if (steps.length) return { ...d, state: "locked", missingSteps: steps, grantStatus: gs };
    return { ...d, state: "visible", missingSteps: [], grantStatus: gs };
  });
}

export function canReadDoc(userId: string, docId: string): boolean {
  const d = db();
  const doc = d
    .prepare("SELECT documents.*, listings.seller_id FROM documents JOIN listings ON listings.id = documents.listing_id WHERE documents.id=?")
    .get(docId) as { listing_id: string; condition: Condition; seller_id: string } | undefined;
  if (!doc) return false;
  if (doc.seller_id === userId) return true;
  const v = viewerState(userId, doc.listing_id);
  const steps = missingSteps(doc.condition, v, v.approvedDocs.has(docId));
  return steps !== null && steps.length === 0;
}

// ---- 파생 지표 (구간 연산: 범위로 공개된 값에서 더 좁은 값을 역산할 수 없게 한다) ----
const add = (a: Interval, b: Interval): Interval => ({ lo: a.lo + b.lo, hi: a.hi + b.hi });
const sub = (a: Interval, b: Interval): Interval => ({ lo: a.lo - b.hi, hi: a.hi - b.lo });
const mul = (a: Interval, c: number): Interval => (c >= 0 ? { lo: a.lo * c, hi: a.hi * c } : { lo: a.hi * c, hi: a.lo * c });

export type Derived = {
  key: string;
  label: string;
  unit: string;
  interval?: Interval;
  note?: string;
  formula: string;
  inputs: string[];
  missingInputs: string[]; // 잠겼거나 없는 입력 항목 이름
};

export const HOURLY_LABOR_COST = Number(process.env.HOURLY_LABOR_COST || 13000);

export function deriveMetrics(views: FieldView[], buyerWorkHours: number | null): Derived[] {
  const m = new Map(views.map((v) => [v.key, v]));
  const get = (k: string) => {
    const v = m.get(k);
    return v && v.state === "visible" && v.interval ? v.interval : null;
  };
  const label = (k: string) => FIELD_MAP[k]?.label ?? k;
  const make = (key: string, lbl: string, unit: string, formula: string, inputs: string[], fn: (g: Record<string, Interval>) => Interval | { note: string }): Derived => {
    const missing = inputs.filter((k) => !get(k));
    const out: Derived = { key, label: lbl, unit, formula, inputs, missingInputs: missing.map(label) };
    if (missing.length) return out;
    const g = Object.fromEntries(inputs.map((k) => [k, get(k)!]));
    const r = fn(g);
    if ("note" in r) out.note = r.note;
    else out.interval = r;
    return out;
  };

  const costKeys = ["cost_materials", "cost_labor", "cost_utilities", "cost_other", "monthly_rent"];
  const totalCost = (g: Record<string, Interval>) => {
    let t = costKeys.map((k) => g[k]).reduce(add);
    if (get("maintenance_fee")) t = add(t, get("maintenance_fee")!);
    return t;
  };
  const extraLabor = (g: Record<string, Interval>): Interval => {
    if (buyerWorkHours == null) return { lo: 0, hi: 0 };
    const gap = sub(g.owner_hours, { lo: buyerWorkHours, hi: buyerWorkHours });
    return mul({ lo: Math.max(0, gap.lo), hi: Math.max(0, gap.hi) }, 4.345 * HOURLY_LABOR_COST);
  };

  const list: Derived[] = [
    make("initial_investment", "초기 투자금 (권리금+보증금)", "원", "희망 권리금 + 보증금", ["premium", "deposit"], (g) => add(g.premium, g.deposit)),
    make("total_cost", "월 운영비 합계", "원", "재료비+인건비+공과금+기타+월세(+관리비)", costKeys, totalCost),
    make("est_profit", "확인된 비용 기준 월순수익", "원", "월평균 매출 − 월 운영비 합계", ["avg_monthly_revenue", ...costKeys], (g) => sub(g.avg_monthly_revenue, totalCost(g))),
    make(
      "extra_labor",
      "내 근무시간 기준 추가 인건비",
      "원",
      `(점주 주당 근무시간 − 내 근무 가능 시간) × 4.345주 × 시간당 ${HOURLY_LABOR_COST.toLocaleString()}원`,
      ["owner_hours"],
      (g) => (buyerWorkHours == null ? { note: "인수 조건에 근무 가능 시간을 입력하면 계산됩니다" } : extraLabor(g))
    ),
    make(
      "adjusted_profit",
      "내 조건 반영 월순수익",
      "원",
      "확인된 비용 기준 월순수익 − 추가 인건비",
      ["avg_monthly_revenue", ...costKeys, "owner_hours"],
      (g) => sub(sub(g.avg_monthly_revenue, totalCost(g)), extraLabor(g))
    ),
  ];
  const adj = list.find((x) => x.key === "adjusted_profit")!;
  const payback: Derived = {
    key: "payback",
    label: "권리금 회수기간",
    unit: "개월",
    formula: "희망 권리금 ÷ 내 조건 반영 월순수익",
    inputs: ["premium", ...adj.inputs],
    missingInputs: [...new Set([...(get("premium") ? [] : [label("premium")]), ...adj.missingInputs])],
  };
  if (!payback.missingInputs.length && adj.interval) {
    const p = get("premium")!;
    if (adj.interval.lo <= 0) payback.note = "월순수익이 0 이하일 수 있어 회수기간을 계산할 수 없습니다";
    else payback.interval = { lo: p.lo / adj.interval.hi, hi: p.hi / adj.interval.lo };
  }
  list.push(payback);
  return list;
}

export function listingConditionSummary(views: FieldView[]) {
  const steps = new Set<Step>();
  for (const v of views) if (v.state === "locked") v.missingSteps.forEach((s) => steps.add(s));
  return [...steps];
}
