// AI 연결 점검: npm run ai-check
// .env.local 설정으로 게이트웨이에 실제로 붙는지, 어떤 방식(Anthropic/OpenAI)이 되는지, 쓸 수 있는 모델이 뭔지 확인한다.
import fs from "node:fs";

const env = { ...process.env };
for (const f of [".env", ".env.local"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const key = env.LABLUP_API_KEY;
const root = (env.LABLUP_BASE_URL || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
const model = env.LABLUP_MODEL || "DeepSeek-V4.1-Flash-B300";
if (!key) { console.log("✗ .env.local에 LABLUP_API_KEY가 없습니다."); process.exit(1); }
if (!root) { console.log("✗ .env.local에 LABLUP_BASE_URL(게이트웨이 주소)이 없습니다."); process.exit(1); }
console.log(`게이트웨이: ${root}\n모델: ${model}\n키: ${key.slice(0, 4)}…(${key.length}자)\n`);

const headers = { "content-type": "application/json", authorization: `Bearer ${key}`, "x-api-key": key, "anthropic-version": "2023-06-01" };
async function call(method, path, body) {
  try {
    const r = await fetch(root + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text: text.slice(0, 300) };
  } catch (e) { return { status: 0, text: String(e) }; }
}

for (const p of ["/v1/models"]) {
  const r = await call("GET", p);
  const ids = r.json?.data?.map((m) => m.id) ?? [];
  console.log(`${r.status === 200 ? "✓" : "✗"} GET ${p} → ${r.status}${ids.length ? `\n   모델: ${ids.join(", ")}` : ` ${r.status === 200 ? "" : r.text}`}`);
}

let aOk = false, aPath = "";
for (const prefix of ["", "/anthropic"]) {
  const a = await call("POST", `${prefix}/v1/messages`, { model, max_tokens: 200, messages: [{ role: "user", content: "한 단어로 인사해줘" }] });
  const ok = a.status === 200 && Array.isArray(a.json?.content);
  console.log(`${ok ? "✓" : "✗"} Anthropic 방식 (${prefix}/v1/messages) → ${a.status} ${ok ? a.json.content.filter((c) => c.type === "text").map((c) => c.text).join("") : a.text}`);
  if (ok) { aOk = true; aPath = prefix; break; }
}
// 도구 호출 지원 여부 (승인 요청·질문 전달, 자료 추출에 필요)
if (aOk) {
  const t = await call("POST", `${aPath}/v1/messages`, {
    model, max_tokens: 400,
    tools: [{ name: "ask_seller", description: "양도인에게 질문을 보낸다", input_schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } }],
    messages: [{ role: "user", content: "양도인에게 '겨울 매출이 얼마인가요?'라고 질문을 보내줘" }],
  });
  const used = t.json?.content?.some((c) => c.type === "tool_use");
  console.log(`${used ? "✓" : "△"} 도구 호출 → ${t.status} ${used ? "지원됨" : "도구를 쓰지 않음 (질의응답은 되지만 AI가 요청을 대신 보내지 못할 수 있음)"}`);
}

const o = await call("POST", "/v1/chat/completions", { model, max_tokens: 30, messages: [{ role: "user", content: "한 단어로 인사해줘" }] });
const oOk = o.status === 200 && o.json?.choices?.length;
console.log(`${oOk ? "✓" : "✗"} OpenAI 방식 (/v1/chat/completions) → ${o.status} ${oOk ? o.json.choices[0].message?.content : o.text}`);

console.log("");
if (aOk) console.log(`→ 그대로 쓰면 됩니다. (.env.local: LABLUP_API_STYLE=anthropic${aPath ? `, LABLUP_ANTHROPIC_PATH=${aPath}` : ""})`);
else if (oOk) console.log("→ .env.local에 LABLUP_API_STYLE=openai 를 넣으세요.");
else console.log("→ 둘 다 실패했습니다. 주소·키·모델 이름을 확인하세요. 위 모델 목록에 있는 이름을 LABLUP_MODEL에 넣어 보세요.");
