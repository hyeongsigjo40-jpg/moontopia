// LLM 공급자 계층. 앱의 나머지 부분은 어떤 AI를 쓰는지 모른다.
//
// 지원하는 연결 (.env.local에서 선택):
//   AI_PROVIDER=lablup     래블업(Lablup) Continuum 게이트웨이  — LABLUP_BASE_URL, LABLUP_API_KEY, LABLUP_MODEL
//   AI_PROVIDER=anthropic  Anthropic 직접                       — ANTHROPIC_API_KEY
//   AI_PROVIDER=openai     OpenAI 직접                          — OPENAI_API_KEY
// AI_PROVIDER를 비우면 LABLUP → ANTHROPIC → OPENAI 순으로 키가 있는 것을 쓴다.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export type Provider = "lablup" | "anthropic" | "openai";
type Wire = "anthropic" | "responses" | "chat"; // 실제 호출 방식

export type Part =
  | { kind: "text"; text: string }
  | { kind: "pdf"; base64: string; filename: string }
  | { kind: "image"; base64: string; mime: "image/jpeg" | "image/png" | "image/gif" | "image/webp" };

export type ToolDef = { name: string; description: string; schema: Record<string, unknown> };
export type Msg = { role: "user" | "assistant"; content: string };

// ---------------- 설정 ----------------
type Config = { provider: Provider; wire: Wire; model: string; host?: string };

/** 게이트웨이 주소를 정리: 끝의 / 와 /v1 을 뗀다. (래블업 Token Factory: https://api.console.lablup.ai) */
export function lablupRoot(): string {
  return (process.env.LABLUP_BASE_URL || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** Anthropic 방식 경로 접두사. Token Factory는 루트에 /v1/messages 가 있다 (기본 ""). 자체 Continuum 라우터면 "/anthropic" */
const lablupAnthropicPath = () => (process.env.LABLUP_ANTHROPIC_PATH || "").trim().replace(/\/+$/, "");

/**
 * 자료(PDF·이미지)를 모델에 그대로 보낼 수 있는지.
 * 래블업의 오픈 모델(DeepSeek 등)은 파일 입력을 받지 않으므로 기본은 'text':
 * PDF는 서버에서 글자를 뽑아 보내고, 이미지는 지원하지 않는다고 안내한다.
 */
export function fileInputMode(): "native" | "text" {
  const c = config();
  if (!c || c.provider !== "lablup") return "native";
  return (process.env.LABLUP_FILE_INPUT || "text").toLowerCase() === "native" ? "native" : "text";
}

function config(): Config | null {
  const want = (process.env.AI_PROVIDER || "").toLowerCase();
  const has = {
    lablup: !!(process.env.LABLUP_API_KEY && lablupRoot()),
    anthropic: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    openai: !!process.env.OPENAI_API_KEY,
  };
  const p: Provider | null =
    want === "lablup" || want === "anthropic" || want === "openai"
      ? has[want as Provider]
        ? (want as Provider)
        : null
      : has.lablup
        ? "lablup"
        : has.anthropic
          ? "anthropic"
          : has.openai
            ? "openai"
            : null;
  if (!p) return null;
  if (p === "lablup") {
    const style = (process.env.LABLUP_API_STYLE || "anthropic").toLowerCase();
    let host = lablupRoot();
    try {
      host = new URL(lablupRoot()).host;
    } catch {}
    return { provider: p, wire: style === "openai" ? "chat" : "anthropic", model: process.env.LABLUP_MODEL || "DeepSeek-V4.1-Flash-B300", host };
  }
  if (p === "anthropic") return { provider: p, wire: "anthropic", model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5" };
  return { provider: p, wire: "responses", model: process.env.OPENAI_MODEL || "gpt-6.1-sol" };
}

export function provider(): Provider | null {
  return config()?.provider ?? null;
}

export function modelName(): string {
  return config()?.model ?? "";
}

export function providerLabel(): string {
  const c = config();
  if (!c) {
    if (process.env.LABLUP_API_KEY && !lablupRoot()) return "꺼짐 (LABLUP_BASE_URL 필요)";
    return "꺼짐 (API 키 없음)";
  }
  if (c.provider === "lablup") return `래블업 게이트웨이 (${c.host}, ${c.wire === "anthropic" ? "Anthropic 방식" : "OpenAI 방식"}) · ${c.model}`;
  return `${c.provider === "openai" ? "OpenAI" : "Anthropic"} · ${c.model}`;
}

function need(): Config {
  const c = config();
  if (!c) throw new Error("AI 연결 설정이 없습니다. .env.local을 확인하고 서버를 다시 시작하세요 (npm run ai-check 로 점검 가능).");
  return c;
}

let _a: Anthropic | null = null;
let _o: OpenAI | null = null;
function anthropic(): Anthropic {
  if (_a) return _a;
  const c = need();
  if (c.provider === "lablup") {
    const key = process.env.LABLUP_API_KEY!;
    // Token Factory 안내의 Anthropic SDK 예시와 같은 방식: base_url=루트, auth_token=키 (Bearer)
    _a = new Anthropic({ authToken: key, baseURL: `${lablupRoot()}${lablupAnthropicPath()}` });
  } else _a = new Anthropic();
  return _a;
}
function openai(): OpenAI {
  if (_o) return _o;
  const c = need();
  _o = c.provider === "lablup" ? new OpenAI({ apiKey: process.env.LABLUP_API_KEY!, baseURL: `${lablupRoot()}/v1` }) : new OpenAI();
  return _o;
}

// ---------------- 형식 변환 ----------------
function toAnthropicParts(parts: Part[]): Anthropic.ContentBlockParam[] {
  return parts.map((p) =>
    p.kind === "text"
      ? { type: "text", text: p.text }
      : p.kind === "pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.base64 } }
        : { type: "image", source: { type: "base64", media_type: p.mime, data: p.base64 } }
  );
}

function toResponsesParts(parts: Part[]): OpenAI.Responses.ResponseInputContent[] {
  return parts.map((p) =>
    p.kind === "text"
      ? { type: "input_text", text: p.text }
      : p.kind === "pdf"
        ? { type: "input_file", filename: p.filename, file_data: `data:application/pdf;base64,${p.base64}` }
        : { type: "input_image", image_url: `data:${p.mime};base64,${p.base64}`, detail: "auto" }
  );
}

function toChatParts(parts: Part[]): OpenAI.Chat.ChatCompletionContentPart[] {
  return parts.map((p) =>
    p.kind === "text"
      ? { type: "text", text: p.text }
      : p.kind === "pdf"
        ? { type: "file", file: { filename: p.filename, file_data: `data:application/pdf;base64,${p.base64}` } }
        : { type: "image_url", image_url: { url: `data:${p.mime};base64,${p.base64}` } }
  );
}

const anthropicTool = (t: ToolDef): Anthropic.Tool => ({ name: t.name, description: t.description, input_schema: t.schema as Anthropic.Tool.InputSchema });
const responsesTool = (t: ToolDef): OpenAI.Responses.FunctionTool => ({ type: "function", name: t.name, description: t.description, parameters: t.schema, strict: false });
const chatTool = (t: ToolDef): OpenAI.Chat.ChatCompletionTool => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } });

const anthropicText = (res: Anthropic.Message) =>
  res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();

function parseArgs(s: string | undefined): Record<string, unknown> {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}

// 도구 호출을 지원하지 않는 모델이 JSON을 글로 답한 경우를 대비
function jsonFromText<T>(text: string): T | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

// 첫 메시지는 user, 같은 역할이 이어지면 합친다
function normalize(history: Msg[]): Msg[] {
  const out: Msg[] = [];
  for (const m of history) {
    if (!out.length && m.role !== "user") continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content += `\n\n${m.content}`;
    else out.push({ ...m });
  }
  return out;
}

// ---------------- 1. 텍스트 생성 ----------------
export async function generateText(opts: { system: string; parts: Part[]; maxTokens?: number }): Promise<string> {
  const c = need();
  const max = opts.maxTokens ?? 2000;
  if (c.wire === "anthropic") {
    const res = await anthropic().messages.create({ model: c.model, max_tokens: max, system: opts.system, messages: [{ role: "user", content: toAnthropicParts(opts.parts) }] });
    return anthropicText(res);
  }
  if (c.wire === "chat") {
    const res = await openai().chat.completions.create({
      model: c.model,
      max_tokens: max,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: toChatParts(opts.parts) },
      ],
    });
    return (res.choices[0]?.message?.content || "").trim();
  }
  const res = await openai().responses.create({
    model: c.model,
    instructions: opts.system,
    input: [{ role: "user", content: toResponsesParts(opts.parts) }],
    max_output_tokens: Math.max(4000, max * 3), // 추론 토큰 여유
  });
  return (res.output_text || "").trim();
}

// ---------------- 2. 지정한 도구를 반드시 한 번 호출 (구조화 추출) ----------------
export async function forcedToolCall<T>(opts: { system: string; parts: Part[]; tool: ToolDef; maxTokens?: number }): Promise<T | null> {
  const c = need();
  const max = opts.maxTokens ?? 4000;
  if (c.wire === "anthropic") {
    const res = await anthropic().messages.create({
      model: c.model,
      max_tokens: max,
      system: opts.system,
      tools: [anthropicTool(opts.tool)],
      tool_choice: { type: "tool", name: opts.tool.name },
      messages: [{ role: "user", content: toAnthropicParts(opts.parts) }],
    });
    const tu = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    return (tu?.input as T) ?? jsonFromText<T>(anthropicText(res));
  }
  if (c.wire === "chat") {
    const res = await openai().chat.completions.create({
      model: c.model,
      max_tokens: max,
      tools: [chatTool(opts.tool)],
      tool_choice: { type: "function", function: { name: opts.tool.name } },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: toChatParts(opts.parts) },
      ],
    });
    const call = res.choices[0]?.message?.tool_calls?.find((t) => t.type === "function");
    return call && call.type === "function" ? (parseArgs(call.function.arguments) as T) : jsonFromText<T>(res.choices[0]?.message?.content || "");
  }
  const res = await openai().responses.create({
    model: c.model,
    instructions: opts.system,
    input: [{ role: "user", content: toResponsesParts(opts.parts) }],
    tools: [responsesTool(opts.tool)],
    tool_choice: { type: "function", name: opts.tool.name },
    max_output_tokens: Math.max(8000, max * 2),
  });
  const call = res.output.find((i): i is OpenAI.Responses.ResponseFunctionToolCall => i.type === "function_call");
  return call ? (parseArgs(call.arguments) as T) : null;
}

// ---------------- 3. 도구를 쓰는 대화 (최대 4회 왕복) ----------------
export async function agentLoop(opts: {
  system: string;
  history: Msg[];
  tools: ToolDef[];
  execute: (name: string, input: Record<string, unknown>) => string;
  maxTokens?: number;
}): Promise<{ text: string; actions: string[] }> {
  const c = need();
  const actions: string[] = [];
  const history = normalize(opts.history);
  const max = opts.maxTokens ?? 1500;

  if (c.wire === "anthropic") {
    const tools = opts.tools.map(anthropicTool);
    const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
    for (let i = 0; i < 4; i++) {
      const res = await anthropic().messages.create({ model: c.model, max_tokens: max, system: opts.system, tools, messages });
      if (res.stop_reason !== "tool_use") return { text: anthropicText(res), actions };
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const b of res.content) {
        if (b.type !== "tool_use") continue;
        const out = opts.execute(b.name, (b.input ?? {}) as Record<string, unknown>);
        actions.push(out);
        results.push({ type: "tool_result", tool_use_id: b.id, content: out });
      }
      messages.push({ role: "user", content: results });
    }
    return { text: "요청을 처리했습니다.", actions };
  }

  if (c.wire === "chat") {
    const tools = opts.tools.map(chatTool);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: opts.system }, ...history.map((m) => ({ role: m.role, content: m.content }))];
    for (let i = 0; i < 4; i++) {
      const res = await openai().chat.completions.create({ model: c.model, max_tokens: max, tools, messages });
      const msg = res.choices[0]?.message;
      const calls = (msg?.tool_calls ?? []).filter((t) => t.type === "function");
      if (!msg || !calls.length) return { text: (msg?.content || "").trim(), actions };
      messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });
      for (const call of calls) {
        if (call.type !== "function") continue;
        const out = opts.execute(call.function.name, parseArgs(call.function.arguments));
        actions.push(out);
        messages.push({ role: "tool", tool_call_id: call.id, content: out });
      }
    }
    return { text: "요청을 처리했습니다.", actions };
  }

  // OpenAI Responses API: 도구 결과는 previous_response_id로 이어 붙인다
  const tools = opts.tools.map(responsesTool);
  let input: OpenAI.Responses.ResponseInput = history.map((m) => ({ role: m.role, content: m.content }));
  let previous: string | undefined;
  for (let i = 0; i < 4; i++) {
    const res = await openai().responses.create({ model: c.model, instructions: opts.system, input, tools, previous_response_id: previous, max_output_tokens: Math.max(6000, max * 4) });
    const calls = res.output.filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === "function_call");
    if (!calls.length) return { text: (res.output_text || "").trim(), actions };
    input = calls.map((call) => {
      const out = opts.execute(call.name, parseArgs(call.arguments));
      actions.push(out);
      return { type: "function_call_output" as const, call_id: call.call_id, output: out };
    });
    previous = res.id;
  }
  return { text: "요청을 처리했습니다.", actions };
}
