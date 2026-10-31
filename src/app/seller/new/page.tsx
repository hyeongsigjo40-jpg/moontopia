import { requireRole } from "@/lib/session";
import { createListing } from "@/app/actions";
import FieldForm from "@/components/FieldForm";
import { INDUSTRIES } from "@/lib/fields";

export default async function NewListing() {
  await requireRole("seller");
  return (
    <form action={createListing}>
      <h1>매물 등록</h1>
      <p className="lead">아는 항목만 입력해도 됩니다. 저장 후 매출·비용·계약 자료를 올리면 AI가 빈 칸을 채워 두고, 확인이 필요한 항목은 표시합니다.</p>
      <div className="card">
        <div className="grid3">
          <label className="field"><span>매물 제목 *</span><input name="title" required placeholder="예: 망원동 역세권 국밥집" /></label>
          <label className="field">
            <span>업종 *</span>
            <select name="industry" required defaultValue="">
              <option value="" disabled>선택</option>
              {INDUSTRIES.map((i) => <option key={i}>{i}</option>)}
            </select>
          </label>
          <label className="field"><span>지역 (구·동) * — 항상 공개</span><input name="region" required placeholder="예: 마포구 망원동" /></label>
        </div>
      </div>
      <div className="card">
        <h2>항목과 열람 조건</h2>
        <p className="small muted">열람 조건은 기본 템플릿입니다. 항목마다 누가 볼 수 있는지, 정확한 값을 보여줄지 구간만 보여줄지 정하세요.</p>
        <FieldForm rows={{}} docNames={{}} />
      </div>
      <button className="btn btn-primary">저장하고 자료 올리기</button>
    </form>
  );
}
