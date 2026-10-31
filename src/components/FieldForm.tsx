import { CONDITIONS, FIELDS, GROUPS, TRUST_LABEL } from "@/lib/fields";

export type DpRow = {
  key: string;
  value_num: number | null;
  value_text: string | null;
  condition: string;
  display: string;
  trust: string;
  needs_review: number;
  source_doc_id: string | null;
  source_note: string | null;
};

// 양도인용 항목 입력 + 항목별 공개 조건 설정 폼 (웹 폼, AI 대화 없음)
export default function FieldForm({ rows, docNames }: { rows: Record<string, DpRow>; docNames: Record<string, string> }) {
  return (
    <div>
      {GROUPS.map((g) => (
        <div key={g}>
          <h3>{g}</h3>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>항목</th>
                  <th style={{ width: "34%" }}>값</th>
                  <th>누가 볼 수 있나 (열람 조건)</th>
                  <th>보여주는 방식</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {FIELDS.filter((f) => f.group === g).map((f) => {
                  const r = rows[f.key];
                  const val = r ? (f.type === "number" ? (r.value_num ?? "") : (r.value_text ?? "")) : "";
                  return (
                    <tr key={f.key} className="field-row">
                      <td className="label">
                        {f.label}
                        {f.unit && <span className="tiny"> ({f.unit})</span>}
                        {f.hint && <div className="tiny">{f.hint}</div>}
                      </td>
                      <td>
                        {f.type === "text" && f.key.match(/basis|terms|notes|trend/) ? (
                          <textarea name={`v_${f.key}`} defaultValue={String(val)} style={{ minHeight: 44 }} />
                        ) : (
                          <input name={`v_${f.key}`} defaultValue={String(val)} inputMode={f.type === "number" ? "numeric" : undefined} placeholder={f.type === "number" ? "숫자만" : ""} />
                        )}
                      </td>
                      <td>
                        <select name={`c_${f.key}`} defaultValue={r?.condition ?? f.defaultCondition}>
                          {CONDITIONS.map((c) => (
                            <option key={c.key} value={c.key}>{c.label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {f.type === "number" ? (
                          <select name={`d_${f.key}`} defaultValue={r?.display ?? "exact"}>
                            <option value="exact">정확한 값</option>
                            <option value="range">구간으로만</option>
                          </select>
                        ) : (
                          <span className="tiny">원문</span>
                        )}
                      </td>
                      <td className="small">
                        {r?.needs_review ? <span className="badge b-review">확인 필요</span> : null}{" "}
                        {r && (r.value_num !== null || r.value_text) ? <span className="badge">{TRUST_LABEL[r.trust as keyof typeof TRUST_LABEL]}</span> : <span className="tiny">미입력</span>}
                        {r?.source_doc_id && <div className="tiny">출처: {docNames[r.source_doc_id] ?? "자료"}{r.source_note ? ` · ${r.source_note}` : ""}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
