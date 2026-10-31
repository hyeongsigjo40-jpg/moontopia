// 매물 데이터 항목 카탈로그. 모든 매물 정보는 이 키를 가진 DataPoint로 저장된다.
// defaultCondition은 '기본 템플릿'일 뿐이고, 양도인이 항목마다 바꿀 수 있다.

export type Condition = "public" | "identity" | "nda" | "approval" | "private";
export type Display = "exact" | "range";
export type Trust = "stated" | "document" | "cross" | "external" | "estimate";

export const CONDITIONS: { key: Condition; label: string; short: string }[] = [
  { key: "public", label: "누구나 열람", short: "공개" },
  { key: "identity", label: "본인확인 후 열람", short: "본인확인" },
  { key: "nda", label: "본인확인 + NDA 체결 후 열람", short: "NDA" },
  { key: "approval", label: "NDA + 양도인 개별 승인 후 열람", short: "승인" },
  { key: "private", label: "비공개 (양도인 전용)", short: "비공개" },
];

export const CONDITION_RANK: Record<Condition, number> = {
  public: 0,
  identity: 1,
  nda: 2,
  approval: 3,
  private: 4,
};

export const TRUST_LABEL: Record<Trust, string> = {
  stated: "점주 진술",
  document: "자료 제출",
  cross: "교차 확인",
  external: "외부 검증",
  estimate: "AI 추정",
};

export type FieldDef = {
  key: string;
  label: string;
  group: string;
  type: "number" | "text";
  unit?: string;
  defaultCondition: Condition;
  hint?: string;
};

export const GROUPS = ["기본", "금액", "매출", "비용", "운영", "임대차·계약", "시설"] as const;

export const FIELDS: FieldDef[] = [
  // 기본
  { key: "trade_name", label: "상호명", group: "기본", type: "text", defaultCondition: "nda" },
  { key: "address_detail", label: "상세 주소", group: "기본", type: "text", defaultCondition: "nda" },
  { key: "brand", label: "브랜드", group: "기본", type: "text", defaultCondition: "public", hint: "프랜차이즈명 또는 개인 매장" },
  { key: "floor", label: "층수 (현재/전체)", group: "기본", type: "text", defaultCondition: "public" },
  { key: "area_pyeong", label: "면적", group: "기본", type: "number", unit: "평", defaultCondition: "public" },
  { key: "parking", label: "주차", group: "기본", type: "text", defaultCondition: "public" },
  { key: "themes", label: "매물 테마", group: "기본", type: "text", defaultCondition: "public", hint: "무권리, 급매, 프랜차이즈 등" },
  // 금액
  { key: "deposit", label: "보증금", group: "금액", type: "number", unit: "원", defaultCondition: "public" },
  { key: "monthly_rent", label: "월세", group: "금액", type: "number", unit: "원", defaultCondition: "public" },
  { key: "maintenance_fee", label: "관리비 (월)", group: "금액", type: "number", unit: "원", defaultCondition: "identity" },
  { key: "premium", label: "희망 권리금", group: "금액", type: "number", unit: "원", defaultCondition: "public" },
  { key: "premium_basis", label: "권리금 구성·산정 근거", group: "금액", type: "text", defaultCondition: "identity", hint: "영업·시설·바닥 권리금 구분" },
  // 매출
  { key: "avg_monthly_revenue", label: "월평균 매출", group: "매출", type: "number", unit: "원", defaultCondition: "nda" },
  { key: "revenue_trend", label: "최근 매출 추이", group: "매출", type: "text", defaultCondition: "nda" },
  { key: "delivery_share", label: "배달 매출 비중", group: "매출", type: "number", unit: "%", defaultCondition: "nda" },
  { key: "stated_net_profit", label: "점주 제시 월순수익", group: "매출", type: "number", unit: "원", defaultCondition: "nda" },
  // 비용
  { key: "cost_materials", label: "재료비 (월)", group: "비용", type: "number", unit: "원", defaultCondition: "approval" },
  { key: "cost_labor", label: "인건비 (월)", group: "비용", type: "number", unit: "원", defaultCondition: "approval" },
  { key: "cost_utilities", label: "공과금 (월)", group: "비용", type: "number", unit: "원", defaultCondition: "approval" },
  { key: "cost_other", label: "기타 운영비 (월)", group: "비용", type: "number", unit: "원", defaultCondition: "approval" },
  // 운영
  { key: "owner_hours", label: "점주 근무시간 (주)", group: "운영", type: "number", unit: "시간", defaultCondition: "identity" },
  { key: "staff_count", label: "직원 수", group: "운영", type: "number", unit: "명", defaultCondition: "identity" },
  { key: "business_hours", label: "영업시간", group: "운영", type: "text", defaultCondition: "public" },
  // 임대차·계약
  { key: "lease_end", label: "임대차 만료일", group: "임대차·계약", type: "text", defaultCondition: "nda" },
  { key: "lease_terms", label: "임대차 계약 조건", group: "임대차·계약", type: "text", defaultCondition: "approval" },
  { key: "franchise_terms", label: "프랜차이즈 계약 조건", group: "임대차·계약", type: "text", defaultCondition: "approval" },
  // 시설
  { key: "facility_notes", label: "시설·설비 현황", group: "시설", type: "text", defaultCondition: "identity" },
];

export const FIELD_MAP: Record<string, FieldDef> = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

export const INDUSTRIES = ["한식", "중식", "일식", "양식", "분식", "치킨·피자", "카페·디저트", "주점", "기타 외식"];

export const DOC_CATEGORIES = [
  { key: "sales", label: "매출 자료 (POS·카드·배달앱)" },
  { key: "cost", label: "비용 자료" },
  { key: "contract", label: "계약 자료 (임대차·프랜차이즈)" },
  { key: "facility", label: "시설 자료" },
  { key: "etc", label: "기타 증빙" },
];
