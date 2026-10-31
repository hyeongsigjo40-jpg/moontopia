import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { FIELD_MAP } from "./fields";

// Vercel 같은 서버리스 환경은 프로젝트 폴더에 쓸 수 없어 /tmp 를 쓴다 (임시: 인스턴스가 바뀌면 데모 데이터로 초기화됨)
const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? "/tmp/store-deal-agent" : path.join(process.cwd(), "data"));
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

declare global {
  // eslint-disable-next-line no-var
  var __db: Database.Database | undefined;
}

export function id(prefix: string) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export function now() {
  return new Date().toISOString();
}

function init(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('seller','buyer')),
    identity_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS buyer_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    budget_total INTEGER,
    regions TEXT NOT NULL DEFAULT '[]',
    industries TEXT NOT NULL DEFAULT '[]',
    target_profit INTEGER,
    work_hours INTEGER,
    experience TEXT,
    payback_months INTEGER,
    wanted_docs TEXT,
    disclose_to_seller INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    seller_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    industry TEXT NOT NULL,
    region TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    category TEXT NOT NULL,
    condition TEXT NOT NULL DEFAULT 'approval',
    extract_status TEXT NOT NULL DEFAULT 'none',
    extract_note TEXT,
    uploaded_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS datapoints (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    key TEXT NOT NULL,
    value_num REAL,
    value_text TEXT,
    period TEXT,
    source_doc_id TEXT REFERENCES documents(id),
    source_note TEXT,
    trust TEXT NOT NULL DEFAULT 'stated',
    needs_review INTEGER NOT NULL DEFAULT 0,
    condition TEXT NOT NULL,
    display TEXT NOT NULL DEFAULT 'exact',
    updated_at TEXT NOT NULL,
    UNIQUE (listing_id, key)
  );
  CREATE TABLE IF NOT EXISTS ndas (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    buyer_id TEXT NOT NULL REFERENCES users(id),
    version TEXT NOT NULL,
    signed_name TEXT NOT NULL,
    signed_at TEXT NOT NULL,
    UNIQUE (listing_id, buyer_id)
  );
  CREATE TABLE IF NOT EXISTS access_grants (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    buyer_id TEXT NOT NULL REFERENCES users(id),
    target_type TEXT NOT NULL CHECK (target_type IN ('field','doc')),
    target_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','revoked')),
    created_at TEXT NOT NULL,
    decided_at TEXT,
    UNIQUE (listing_id, buyer_id, target_type, target_key)
  );
  CREATE TABLE IF NOT EXISTS inquiries (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    buyer_id TEXT NOT NULL REFERENCES users(id),
    question TEXT NOT NULL,
    field_key TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','declined')),
    draft TEXT,
    answer TEXT,
    created_at TEXT NOT NULL,
    answered_at TEXT
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    buyer_id TEXT NOT NULL REFERENCES users(id),
    listing_id TEXT NOT NULL REFERENCES listings(id),
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS compare_items (
    buyer_id TEXT NOT NULL REFERENCES users(id),
    listing_id TEXT NOT NULL REFERENCES listings(id),
    added_at TEXT NOT NULL,
    PRIMARY KEY (buyer_id, listing_id)
  );
  CREATE TABLE IF NOT EXISTS comparison_reports (
    id TEXT PRIMARY KEY,
    buyer_id TEXT NOT NULL REFERENCES users(id),
    listing_ids TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT,
    listing_id TEXT,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    created_at TEXT NOT NULL
  );
  `);
}

export function db(): Database.Database {
  if (!global.__db) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const d = new Database(path.join(DATA_DIR, "app.db"));
    init(d);
    const count = d.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
    if (count.c === 0) seed(d);
    global.__db = d;
  }
  return global.__db;
}

export function audit(actorId: string | null, listingId: string | null, action: string, target?: string, detail?: unknown) {
  db()
    .prepare("INSERT INTO audit_log (actor_id, listing_id, action, target, detail, created_at) VALUES (?,?,?,?,?,?)")
    .run(actorId, listingId, action, target ?? null, detail === undefined ? null : JSON.stringify(detail), now());
}

export function upsertDataPoint(
  d: Database.Database,
  listingId: string,
  key: string,
  value: number | string | null,
  opts: {
    trust?: string;
    needsReview?: boolean;
    condition?: string;
    display?: string;
    sourceDocId?: string | null;
    sourceNote?: string | null;
    period?: string | null;
  } = {}
) {
  const def = FIELD_MAP[key];
  if (!def) throw new Error(`unknown field ${key}`);
  const existing = d.prepare("SELECT * FROM datapoints WHERE listing_id=? AND key=?").get(listingId, key) as
    | { id: string; condition: string; display: string }
    | undefined;
  const isNum = def.type === "number";
  const num = isNum && value !== null && value !== "" ? Number(value) : null;
  const text = !isNum && value !== null ? String(value) : null;
  if (existing) {
    d.prepare(
      `UPDATE datapoints SET value_num=?, value_text=?, trust=COALESCE(?, trust), needs_review=?, condition=COALESCE(?, condition),
       display=COALESCE(?, display), source_doc_id=COALESCE(?, source_doc_id), source_note=COALESCE(?, source_note), period=COALESCE(?, period), updated_at=? WHERE id=?`
    ).run(
      num,
      text,
      opts.trust ?? null,
      opts.needsReview ? 1 : 0,
      opts.condition ?? null,
      opts.display ?? null,
      opts.sourceDocId ?? null,
      opts.sourceNote ?? null,
      opts.period ?? null,
      now(),
      existing.id
    );
  } else {
    d.prepare(
      `INSERT INTO datapoints (id, listing_id, key, value_num, value_text, period, source_doc_id, source_note, trust, needs_review, condition, display, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id("dp"),
      listingId,
      key,
      num,
      text,
      opts.period ?? null,
      opts.sourceDocId ?? null,
      opts.sourceNote ?? null,
      opts.trust ?? "stated",
      opts.needsReview ? 1 : 0,
      opts.condition ?? def.defaultCondition,
      opts.display ?? "exact",
      now()
    );
  }
}

// ---- 데모 데이터 ----
function seed(d: Database.Database) {
  const t = now();
  const users = [
    ["u_seller_kim", "김정민 (양도인)", "seller", 1],
    ["u_seller_park", "박서연 (양도인)", "seller", 1],
    ["u_buyer_choi", "최현우 (양수인)", "buyer", 0],
    ["u_buyer_jung", "정다은 (양수인)", "buyer", 1],
  ];
  for (const u of users) d.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run(...u, t);

  d.prepare(
    `INSERT INTO buyer_profiles (user_id, budget_total, regions, industries, target_profit, work_hours, experience, payback_months, wanted_docs, disclose_to_seller, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run("u_buyer_jung", 150000000, JSON.stringify(["마포구"]), JSON.stringify(["한식", "카페·디저트"]), 5000000, 50, "카페 매니저 3년", 24, "카드매출, 임대차계약서", 1, t);

  type Seed = { id: string; seller: string; title: string; industry: string; region: string; data: Record<string, number | string>; display?: Record<string, string>; conditions?: Record<string, string> };
  const listings: Seed[] = [
    {
      id: "l_mapo_gukbap",
      seller: "u_seller_kim",
      title: "망원동 역세권 국밥집",
      industry: "한식",
      region: "마포구 망원동",
      data: {
        trade_name: "망원옥",
        address_detail: "서울 마포구 망원로 00, 1층",
        brand: "개인 매장",
        floor: "1층 / 4층",
        area_pyeong: 22,
        parking: "건물 공용 2대",
        themes: "역세권",
        deposit: 30000000,
        monthly_rent: 2800000,
        maintenance_fee: 200000,
        premium: 85000000,
        premium_basis: "영업권리금 5,000만 + 시설권리금 3,500만 (2023년 주방 리모델링)",
        avg_monthly_revenue: 42000000,
        revenue_trend: "최근 6개월 3,900만~4,500만 원, 겨울 성수기",
        delivery_share: 25,
        stated_net_profit: 8000000,
        cost_materials: 15100000,
        cost_labor: 9800000,
        cost_utilities: 1500000,
        cost_other: 1200000,
        owner_hours: 70,
        staff_count: 3,
        business_hours: "10:00~22:00, 일요일 휴무",
        lease_end: "2027-08",
        lease_terms: "2년 계약, 갱신 시 5% 이내 인상 구두 합의",
        facility_notes: "육수 솥 2기, 냉장 쇼케이스, 2023년 리모델링",
      },
      display: { avg_monthly_revenue: "range" },
    },
    {
      id: "l_mapo_cafe",
      seller: "u_seller_kim",
      title: "연남동 골목 카페",
      industry: "카페·디저트",
      region: "마포구 연남동",
      data: {
        trade_name: "카페 온결",
        brand: "개인 매장",
        floor: "1층 / 3층",
        area_pyeong: 15,
        deposit: 20000000,
        monthly_rent: 1900000,
        premium: 45000000,
        avg_monthly_revenue: 21000000,
        delivery_share: 10,
        stated_net_profit: 5500000,
        cost_materials: 6300000,
        cost_labor: 4200000,
        cost_utilities: 700000,
        cost_other: 600000,
        owner_hours: 55,
        staff_count: 2,
        business_hours: "11:00~21:00",
        lease_end: "2028-02",
      },
      conditions: { avg_monthly_revenue: "identity" },
    },
    {
      id: "l_mapo_chicken",
      seller: "u_seller_park",
      title: "합정역 프랜차이즈 치킨",
      industry: "치킨·피자",
      region: "마포구 합정동",
      data: {
        trade_name: "OO치킨 합정점",
        brand: "프랜차이즈",
        floor: "1층 / 5층",
        area_pyeong: 18,
        themes: "프랜차이즈, 급매",
        deposit: 25000000,
        monthly_rent: 2300000,
        maintenance_fee: 150000,
        premium: 60000000,
        avg_monthly_revenue: 38000000,
        delivery_share: 70,
        stated_net_profit: 6000000,
        cost_materials: 15200000,
        cost_labor: 8000000,
        cost_utilities: 1400000,
        cost_other: 3800000,
        owner_hours: 60,
        staff_count: 4,
        business_hours: "15:00~02:00",
        lease_end: "2026-12",
        franchise_terms: "가맹 잔여 1년, 양도 시 본사 승인 필요, 교육비 300만 원",
      },
    },
    {
      id: "l_gangnam_ramen",
      seller: "u_seller_park",
      title: "역삼동 오피스가 라멘",
      industry: "일식",
      region: "강남구 역삼동",
      data: {
        brand: "개인 매장",
        area_pyeong: 20,
        deposit: 50000000,
        monthly_rent: 4200000,
        premium: 120000000,
        avg_monthly_revenue: 55000000,
        owner_hours: 50,
        staff_count: 5,
        business_hours: "11:00~21:00, 주말 휴무",
      },
    },
  ];

  for (const l of listings) {
    d.prepare("INSERT INTO listings VALUES (?,?,?,?,?,?,?)").run(l.id, l.seller, l.title, l.industry, l.region, "published", t);
    for (const [k, v] of Object.entries(l.data)) {
      upsertDataPoint(d, l.id, k, v, {
        trust: ["avg_monthly_revenue", "cost_materials"].includes(k) && l.id === "l_mapo_gukbap" ? "document" : "stated",
        display: l.display?.[k],
        condition: l.conditions?.[k],
      });
    }
  }
}
