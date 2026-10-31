"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Opt = { key: string; label: string };

export default function UploadBox({ listingId, categories, conditions, aiOn }: { listingId: string; categories: Opt[]; conditions: Opt[]; aiOn: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("sales");
  const [condition, setCondition] = useState("approval");
  const [extract, setExtract] = useState(aiOn);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function upload() {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) return setMsg("파일을 선택하세요.");
    setBusy(true);
    setMsg(extract ? "업로드하고 AI가 자료를 읽는 중입니다 (파일당 10~40초)..." : "업로드 중...");
    const results: string[] = [];
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("category", category);
      fd.append("condition", condition);
      fd.append("extract", extract ? "1" : "0");
      try {
        const res = await fetch(`/api/listings/${listingId}/documents`, { method: "POST", body: fd });
        const j = await res.json();
        results.push(res.ok ? `${f.name}: ${j.message}` : `${f.name}: 실패 - ${j.error}`);
      } catch (e) {
        results.push(`${f.name}: 실패 - ${String(e)}`);
      }
    }
    setBusy(false);
    setMsg(results.join("\n"));
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <div className="card">
      <h2>자료 올리기</h2>
      <p className="small muted">PDF, 엑셀(xlsx), CSV, 이미지(JPG·PNG)를 올리면 AI가 값을 찾아 매물 정보에 &lsquo;확인 필요&rsquo;로 채워 둡니다. 원본 자료의 열람 조건은 따로 정합니다.</p>
      <div className="grid3">
        <label className="field">
          <span>자료 종류</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>원본 자료 열람 조건</span>
          <select value={condition} onChange={(e) => setCondition(e.target.value)}>
            {conditions.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>파일</span>
          <input ref={fileRef} type="file" multiple accept=".pdf,.xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg,.webp" />
        </label>
      </div>
      <div className="row">
        <label className="small row" style={{ gap: 5 }}>
          <input type="checkbox" checked={extract} disabled={!aiOn} onChange={(e) => setExtract(e.target.checked)} /> AI로 값 추출해서 폼 채우기 {!aiOn && "(API 키 필요)"}
        </label>
        <button className="btn btn-primary" onClick={upload} disabled={busy}>{busy ? "처리 중..." : "올리기"}</button>
      </div>
      {msg && <div className="notice pre" style={{ marginTop: 12 }}>{msg}</div>}
    </div>
  );
}
