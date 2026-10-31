import { FieldView } from "@/lib/access";
import { fmtInterval } from "@/lib/format";
import { askSeller, requestApproval } from "@/app/actions";
import { CondBadge, TrustBadge, stepsText } from "./Badges";

// 양수인 화면의 칸 하나. 값은 서버가 허용한 경우에만 view에 들어 있다.
export default function FieldCell({ v, listingId, canRequest, compact = false }: { v: FieldView; listingId: string; canRequest: boolean; compact?: boolean }) {
  if (v.state === "visible") {
    return (
      <div>
        <span className="value">{v.interval ? fmtInterval(v.interval, v.unit) : v.text}</span>
        <div className="row" style={{ gap: 4, marginTop: 3 }}>
          <TrustBadge t={v.trust} />
          {v.display === "range" && <span className="badge">구간 공개</span>}
          {v.needsReview && <span className="badge b-review">양도인 확인 전</span>}
          {!compact && v.sourceDocName && <span className="tiny">출처: {v.sourceDocName}</span>}
        </div>
      </div>
    );
  }
  if (v.state === "private") return <span className="locked small">양도인 비공개</span>;
  if (v.state === "missing") {
    return (
      <div className="row" style={{ gap: 6 }}>
        <span className="locked small">미확인</span>
        <form action={askSeller}>
          <input type="hidden" name="listing_id" value={listingId} />
          <input type="hidden" name="field_key" value={v.key} />
          <button className="btn btn-sm">요청하기</button>
        </form>
      </div>
    );
  }
  // locked
  const onlyApprovalLeft = v.missingSteps.length === 1 && v.missingSteps[0] === "approval";
  return (
    <div>
      <div className="row" style={{ gap: 4 }}>
        <CondBadge c={v.condition} />
        <span className="locked small">{stepsText(v.missingSteps)} 필요</span>
      </div>
      {onlyApprovalLeft && canRequest && (
        <div style={{ marginTop: 4 }}>
          {v.grantStatus === "pending" ? (
            <span className="badge b-approval">승인 요청 대기 중</span>
          ) : (
            <form action={requestApproval}>
              <input type="hidden" name="listing_id" value={listingId} />
              <input type="hidden" name="field_key" value={v.key} />
              <button className="btn btn-sm">{v.grantStatus === "rejected" ? "다시 요청" : "승인 요청"}</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
