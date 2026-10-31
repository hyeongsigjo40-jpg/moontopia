"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = ["이 가게 실제로 한 달에 얼마 버는 가게예요?", "내 근무시간이면 수익이 어떻게 달라져요?", "NDA까지 했는데 비용 내역도 볼 수 있어요?", "권리금 회수는 얼마나 걸려요?"];

export default function Chat({ listingId, initial }: { listingId: string; initial: Msg[] }) {
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [msgs, busy]);

  async function send(q?: string) {
    const message = (q ?? text).trim();
    if (!message || busy) return;
    setText("");
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, message }) });
      const j = await res.json();
      const content = res.ok ? j.text + (j.actions?.length ? `\n\n[처리] ${j.actions.join(" / ")}` : "") : `오류: ${j.error}`;
      setMsgs((m) => [...m, { role: "assistant", content }]);
      if (j.actions?.length) router.refresh();
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: `오류: ${String(e)}` }]);
    }
    setBusy(false);
  }

  return (
    <div>
      <div className="chat" ref={box}>
        {msgs.length === 0 && <div className="small muted">궁금한 것을 물어보세요.</div>}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>{m.content}</div>
        ))}
        {busy && <div className="msg assistant muted">확인하는 중...</div>}
      </div>
      {msgs.length === 0 && (
        <div className="row" style={{ gap: 6, marginBottom: 8 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="btn btn-sm" onClick={() => send(s)}>{s}</button>
          ))}
        </div>
      )}
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) send(); }} placeholder="질문 입력" />
        <button className="btn btn-primary" onClick={() => send()} disabled={busy}>보내기</button>
      </div>
    </div>
  );
}
