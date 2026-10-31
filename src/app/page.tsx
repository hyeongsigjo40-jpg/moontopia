import { db } from "@/lib/db";
import { login } from "./actions";
import { aiEnabled, MODEL } from "@/lib/ai";

export const dynamic = "force-dynamic";

export default function Home() {
  const users = db().prepare("SELECT id, name, role, identity_verified FROM users ORDER BY role DESC, id").all() as {
    id: string;
    name: string;
    role: string;
    identity_verified: number;
  }[];
  return (
    <div>
      <h1>AI 점포 양도양수 실사 에이전트</h1>
      <p className="lead">
        양도인은 자료를 올리고 공개 조건만 정합니다. 양수인은 조건만 입력합니다. 그 사이의 정보 수집·질의응답·비교는 AI 에이전트 하나가 처리하고,
        누가 무엇을 볼 수 있는지는 서버가 먼저 판단합니다.
      </p>
      {!aiEnabled() && (
        <div className="warnbox">
          AI API 키가 없어 AI 기능(자료 추출, 질의응답, 비교 요약)이 꺼져 있습니다. 프로젝트 폴더의 .env.local에 AI 연결 정보를 넣고 서버를 다시 시작하세요 (README의 AI 연결 참고).
        </div>
      )}
      <div className="grid2">
        {(["seller", "buyer"] as const).map((role) => (
          <div className="card" key={role}>
            <h2>{role === "seller" ? "양도인으로 시작" : "양수인으로 시작"}</h2>
            <p className="muted small">
              {role === "seller" ? "매물 등록, 자료 업로드, 공개 조건 설정, 열람 승인" : "인수 조건 입력, 추천 매물, 비교표, AI 실사 질의"}
            </p>
            {users
              .filter((u) => u.role === role)
              .map((u) => (
                <form action={login} key={u.id} style={{ marginTop: 8 }}>
                  <input type="hidden" name="uid" value={u.id} />
                  <button className="btn" style={{ width: "100%", textAlign: "left" }}>
                    {u.name}
                    {role === "buyer" && <span className="tiny"> · {u.identity_verified ? "본인확인 완료" : "본인확인 전"}</span>}
                  </button>
                </form>
              ))}
          </div>
        ))}
      </div>
      <p className="tiny">데모 로그인입니다. 실제 서비스에서는 본인인증과 계정 로그인으로 교체해야 합니다. AI: {MODEL}</p>
    </div>
  );
}
