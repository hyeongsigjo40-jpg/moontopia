// 단일 AI 거래 에이전트. 이 모듈은 '이미 권한 필터를 통과한' 데이터만 받는다.
// 공급자(Anthropic/OpenAI)는 llm.ts가 감춘다.
import fs from "node:fs";
import * as XLSX from "xlsx";
import { FIELDS, FIELD_MAP, TRUST_LABEL } from "./fields";
import { Derived, FieldView, STEP_LABEL } from "./access";
import { fmtInterval } from "./format";
import { agentLoop, fileInputMode, forcedToolCall, generateText, Part, provider, providerLabel } from "./llm";

export const MODEL = providerLabel();

export function aiEnabled() {
  return provider() !== null;
}

// ---------- 1. 자료 추출 (양도인 본인 자료 → 폼 자동 채움) ----------
export type Extracted = { key: string; value: number | string; period?: string; evidence?: string };

function decodeText(buf: Buffer) {
  const utf = buf.toString("utf8");
  if (!utf.includes("�")) return utf;
  try {
    return new TextDecoder("euc-kr").decode(buf);
  } catch {
    return utf;
  }
}

async function pdfText(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map((t, i) => `--- ${i + 1}쪽 ---\n${t}`).join("\n");
}

async function fileToPart(filePath: string, mime: string, filename: string): Promise<Part> {
  const buf = fs.readFileSync(filePath);
  const lower = filename.toLowerCase();
  const textOnly = fileInputMode() === "text";
  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    if (!textOnly) return { kind: "pdf", base64: buf.toString("base64"), filename };
    const t = await pdfText(buf);
    if (t.replace(/--- \d+쪽 ---/g, "").trim().length < 20)
      throw new Error("PDF에서 글자를 찾지 못했습니다 (스캔 이미지 PDF). 지금 연결된 모델은 이미지를 읽지 못하니 엑셀·CSV로 올리거나 값을 직접 입력해 주세요.");
    return { kind: "text", text: `파일 ${filename} 내용 (PDF 글자 추출):\n${t.slice(0, 80000)}` };
  }
  if (textOnly && /^image\//.test(mime))
    throw new Error("지금 연결된 모델은 이미지를 읽지 못합니다. 엑셀·CSV·글자가 있는 PDF로 올리거나 값을 직접 입력해 주세요.");
  const imageTypes: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
    "image/jpeg": "image/jpeg",
    "image/jpg": "image/jpeg",
    "image/png": "image/png",
    "image/gif": "image/gif",
    "image/webp": "image/webp",
  };
  if (imageTypes[mime]) return { kind: "image", base64: buf.toString("base64"), mime: imageTypes[mime] };
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const wb = XLSX.read(buf, { type: "buffer" });
    const text = wb.SheetNames.map((n) => `### 시트: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join("\n\n");
    return { kind: "text", text: `파일 ${filename} 내용 (CSV 변환):\n${text.slice(0, 80000)}` };
  }
  return { kind: "text", text: `파일 ${filename} 내용:\n${decodeText(buf).slice(0, 80000)}` };
}

export async function extractFromDocument(filePath: string, mime: string, filename: string, category: string) {
  const numberKeys = FIELDS.filter((f) => f.type === "number").map((f) => `${f.key} (${f.label}, 단위 ${f.unit})`);
  const textKeys = FIELDS.filter((f) => f.type === "text").map((f) => `${f.key} (${f.label})`);
  const result = await forcedToolCall<{ fields: Extracted[]; summary: string }>({
    system:
      "너는 점포 양도양수 플랫폼의 자료 정리 담당이다. 양도인이 올린 자료에서 정해진 항목의 값만 추출한다. " +
      "자료에 명시적으로 나온 값만 기록하고, 추측하거나 계산해서 만들지 않는다. 월 단위 금액은 원 단위 정수로 쓴다. " +
      "여러 달 자료라면 월평균을 계산해도 되지만 evidence에 계산 근거(어느 달 몇 개)를 적는다. 확신이 없는 항목은 넣지 않는다.",
    tool: {
      name: "record_fields",
      description: "자료에서 찾은 항목 값을 기록한다",
      schema: {
        type: "object",
        properties: {
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string", enum: FIELDS.map((f) => f.key) },
                value: { type: ["number", "string"] },
                period: { type: "string", description: "기준 기간, 예: 2026-04~2026-09" },
                evidence: { type: "string", description: "자료의 어느 부분에서 찾았는지 한 줄" },
              },
              required: ["key", "value", "evidence"],
            },
          },
          summary: { type: "string", description: "자료가 무엇인지 한 문장" },
        },
        required: ["fields", "summary"],
      },
    },
    parts: [
      await fileToPart(filePath, mime, filename),
      {
        kind: "text",
        text: `자료 분류: ${category}\n숫자 항목: ${numberKeys.join(", ")}\n텍스트 항목: ${textKeys.join(", ")}\n위 자료에서 해당 항목 값을 찾아 record_fields로 기록해줘. 도구를 쓸 수 없으면 {"fields":[{"key":"...","value":...,"evidence":"..."}],"summary":"..."} 형태의 JSON만 답해줘.`,
      },
    ],
  });
  const input = result ?? { fields: [], summary: "" };
  const fields = (input.fields || []).filter((f) => {
    const def = FIELD_MAP[f.key];
    if (!def) return false;
    if (def.type === "number") return Number.isFinite(Number(f.value));
    return String(f.value).trim().length > 0;
  });
  return { fields, summary: input.summary || "" };
}

// ---------- 2. 권한 필터된 데이터 → 컨텍스트 ----------
export function describeViews(views: FieldView[], derived: Derived[]) {
  const lines: string[] = [];
  for (const v of views) {
    if (v.state === "visible") {
      const val = v.interval ? fmtInterval(v.interval, v.unit) : v.text;
      const meta = [v.trust ? `신뢰수준: ${TRUST_LABEL[v.trust]}` : "", v.display === "range" ? "양도인이 구간으로만 공개" : "", v.sourceDocName ? `출처: ${v.sourceDocName}` : "", v.needsReview ? "양도인 확인 전" : ""]
        .filter(Boolean)
        .join(", ");
      lines.push(`- ${v.label}: ${val}${meta ? ` (${meta})` : ""}`);
    } else if (v.state === "locked") {
      lines.push(`- ${v.label}: [잠김 — 남은 절차: ${v.missingSteps.map((s) => STEP_LABEL[s]).join(" → ")}${v.grantStatus === "pending" ? ", 승인 요청 대기 중" : ""}]`);
    } else if (v.state === "private") {
      lines.push(`- ${v.label}: [양도인 비공개 항목]`);
    } else {
      lines.push(`- ${v.label}: [미등록 — 양도인에게 질문 가능]`);
    }
  }
  lines.push("", "계산 지표 (서버 계산, 구간은 범위 공개 값에서 나온 결과):");
  for (const d of derived) {
    if (d.interval) lines.push(`- ${d.label}: ${fmtInterval(d.interval, d.unit)} (계산식: ${d.formula})`);
    else if (d.note) lines.push(`- ${d.label}: ${d.note}`);
    else lines.push(`- ${d.label}: 계산 불가 (확인 안 된 입력: ${d.missingInputs.join(", ")})`);
  }
  return lines.join("\n");
}

export type BuyerProfileRow = {
  budget_total: number | null;
  regions: string;
  industries: string;
  target_profit: number | null;
  work_hours: number | null;
  experience: string | null;
  payback_months: number | null;
  wanted_docs: string | null;
};

export function describeProfile(p: BuyerProfileRow | undefined) {
  if (!p) return "양수인이 아직 인수 조건을 입력하지 않았다.";
  return [
    `총예산: ${p.budget_total ? p.budget_total.toLocaleString() + "원" : "미입력"}`,
    `희망 지역: ${JSON.parse(p.regions).join(", ") || "미입력"}`,
    `선호 업종: ${JSON.parse(p.industries).join(", ") || "미입력"}`,
    `목표 월순수익: ${p.target_profit ? p.target_profit.toLocaleString() + "원" : "미입력"}`,
    `직접 근무 가능 시간: ${p.work_hours ? `주 ${p.work_hours}시간` : "미입력"}`,
    `관련 경험: ${p.experience || "미입력"}`,
    `희망 회수기간: ${p.payback_months ? p.payback_months + "개월" : "미입력"}`,
    `확인하고 싶은 문서: ${p.wanted_docs || "미입력"}`,
  ].join("\n");
}

const AGENT_RULES = `너는 점포 양도양수 플랫폼의 중립적인 'AI 거래 에이전트'다. 양도인과 양수인 사이에서 정보 수집·질의응답·비교·실사를 돕는다.
규칙:
1. 아래 [매물 데이터]에 있는 값만 사용한다. 거기 없는 숫자를 만들거나 추측하지 않는다. 잠긴 항목의 값은 너도 모른다.
2. 숫자를 말할 때는 신뢰수준(점주 진술/자료 제출 등)을 함께 말한다. '자료 제출'을 '인증된 매출'이라고 표현하지 않는다.
3. 잠긴 항목을 물으면 남은 절차를 정확히 안내하고, 사용자가 원하면 도구로 승인 요청이나 질문을 보낸다. 사용자가 명시적으로 원할 때만 도구를 쓴다.
4. 미등록 항목은 '미확인'이라고 말하고 양도인에게 질문을 보낼 수 있다고 안내한다.
5. 권리금은 정답 가격을 제시하지 않고 회수기간 같은 시나리오로 설명한다. 수익을 보장하지 않는다.
6. 가격 협상, 계약 체결, 중개 행위는 하지 않는다. 그런 요청은 플랫폼 밖에서 진행해야 한다고 안내한다.
7. 한국어로 짧고 명확하게 답한다.`;

// ---------- 3. 양수인 대화 ----------
export type ChatTools = {
  requestApproval: (fieldKeys: string[]) => string;
  askSeller: (question: string, fieldKey?: string) => string;
};

export async function buyerChat(opts: {
  listingTitle: string;
  listingMeta: string;
  dataContext: string;
  profile: string;
  answeredInquiries: string;
  history: { role: "user" | "assistant"; content: string }[];
  tools: ChatTools;
}) {
  const system = `${AGENT_RULES}

[양수인 조건 — 이 양수인 본인 정보]
${opts.profile}

[매물: ${opts.listingTitle}] ${opts.listingMeta}
[매물 데이터 — 서버가 이 양수인에게 허용한 범위만 포함]
${opts.dataContext}

[이 양수인이 양도인에게 받은 답변]
${opts.answeredInquiries || "없음"}`;

  const keyHint = ` 항목 키: ${FIELDS.map((f) => `${f.key}=${f.label}`).join(", ")}`;
  return agentLoop({
    system,
    history: opts.history,
    maxTokens: 1500,
    tools: [
      {
        name: "request_approval",
        description: "양도인 개별 승인이 필요한 잠긴 항목의 열람 승인을 양도인에게 요청한다. 사용자가 요청을 원할 때만 사용." + keyHint,
        schema: {
          type: "object",
          properties: { field_keys: { type: "array", items: { type: "string", enum: FIELDS.map((f) => f.key) } } },
          required: ["field_keys"],
        },
      },
      {
        name: "ask_seller",
        description: "미등록 정보나 추가 자료를 양도인에게 질문으로 보낸다. 사용자가 원할 때만 사용." + keyHint,
        schema: {
          type: "object",
          properties: {
            question: { type: "string" },
            field_key: { type: "string", enum: FIELDS.map((f) => f.key) },
          },
          required: ["question"],
        },
      },
    ],
    execute: (name, input) => {
      if (name === "request_approval") return opts.tools.requestApproval(Array.isArray(input.field_keys) ? input.field_keys.map(String) : []);
      if (name === "ask_seller") return opts.tools.askSeller(String(input.question ?? ""), input.field_key ? String(input.field_key) : undefined);
      return "알 수 없는 도구";
    },
  });
}

// ---------- 4. 비교 요약 ----------
export async function compareSummary(profile: string, blocks: { title: string; context: string }[]) {
  return generateText({
    system: `${AGENT_RULES}\n출력 형식: 마크다운 없이 짧은 문단과 '- ' 목록만 쓴다. 매물마다 3줄 이내.`,
    maxTokens: 2500,
    parts: [
      {
        kind: "text",
        text: `[양수인 조건]\n${profile}\n\n${blocks.map((b) => `[매물: ${b.title}]\n${b.context}`).join("\n\n")}\n\n이 양수인 조건에서 매물들을 비교해줘. 순서: 1) 한 줄 결론 (순위를 매긴다면 기준을 명시) 2) 매물별 강점·위험 3) 결정 전에 확인해야 할 미확인·잠긴 항목과 필요한 절차.`,
      },
    ],
  });
}

// ---------- 5. 양도인 답변 초안 ----------
export async function draftSellerAnswer(question: string, ownerContext: string) {
  return generateText({
    system:
      "너는 양도인의 답변 초안을 쓰는 보조다. 양도인이 등록한 정보만 근거로 짧게 쓴다. 등록되지 않은 사실은 '[양도인 확인 필요]'로 남긴다. 양도인이 검토 후 보낸다.",
    maxTokens: 600,
    parts: [{ kind: "text", text: `[양도인 등록 정보]\n${ownerContext}\n\n[양수인 질문]\n${question}\n\n답변 초안:` }],
  });
}
