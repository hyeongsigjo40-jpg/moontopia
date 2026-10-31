# 점포 실사 에이전트 (MVP v0.3)

PRD v0.3 기준 MVP입니다. 양도인은 웹 폼으로 매물을 등록하고 항목마다 열람 조건을 정합니다. 양수인은 조건만 입력하고, AI 거래 에이전트 하나가 추천·비교·질의응답·요청 전달을 합니다. 누가 무엇을 볼 수 있는지는 **서버(`src/lib/access.ts`)가 먼저 판단**하고, AI는 그 결과만 받습니다.

## 실행

Node.js 20 이상이 필요합니다 (`node -v`로 확인).

```bash
cd ~/Desktop/store-deal-agent
npm install
cp .env.example .env.local     # 그다음 .env.local에 AI 연결 정보 입력 (아래 'AI 연결' 참고)
npm run dev
```

브라우저에서 http://localhost:3000 을 엽니다. 첫 실행 때 `data/app.db`가 만들어지고 데모 매물 4개와 사용자 4명이 들어갑니다.
데모 데이터를 처음 상태로 돌리려면 서버를 끄고 `npm run reset-db` 후 다시 `npm run dev`.

## AI 연결 (래블업 게이트웨이 / Claude / GPT)

`.env.local`에서 한 가지를 고릅니다.

| 연결 | `.env.local`에 넣을 값 |
| --- | --- |
| 래블업 Token Factory (해커톤) | `AI_PROVIDER=lablup`, `LABLUP_BASE_URL=https://api.console.lablup.ai`, `LABLUP_API_KEY=chk_...`, `LABLUP_MODEL=DeepSeek-V4.1-Flash-B300` |
| Anthropic 직접 | `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=sk-ant-...` |
| OpenAI 직접 | `AI_PROVIDER=openai`, `OPENAI_API_KEY=sk-...` |

래블업 게이트웨이는 Token Factory 안내의 Anthropic SDK 예시와 같은 방식(주소 루트의 `/v1/messages`, Bearer 키)으로 호출합니다. 쓸 수 있는 모델은 console.lablup.ai → 내 워크스페이스 → 연결(Connect)에서 확인합니다.

현재 해커톤 티어 모델(DeepSeek)은 PDF·이미지를 직접 읽지 못해서, PDF는 서버에서 글자를 뽑아 보내고(`LABLUP_FILE_INPUT=text`), 사진이나 스캔 PDF는 값을 직접 입력하도록 안내합니다.

연결을 점검하려면:

```bash
npm run ai-check
```

게이트웨이에 붙는지, 쓸 수 있는 모델 목록, Anthropic 방식과 OpenAI 방식 중 무엇이 되는지 알려줍니다. OpenAI 방식만 된다면 `LABLUP_API_STYLE=openai`를 넣으세요. 첫 페이지 아래에 지금 연결된 AI가 표시됩니다.

## Vercel 배포

1. 이 저장소를 Vercel에 연결합니다 (Framework: Next.js, 설정 변경 없음).
2. Settings → Environment Variables에 아래 값을 넣습니다. `LABLUP_API_KEY`는 Sensitive로 표시하세요.
   ```
   AI_PROVIDER=lablup
   LABLUP_BASE_URL=https://api.console.lablup.ai
   LABLUP_API_KEY=chk_...
   LABLUP_MODEL=DeepSeek-V4.1-Flash-B300
   LABLUP_API_STYLE=anthropic
   LABLUP_FILE_INPUT=text
   ```
3. 주의: 지금은 SQLite 파일과 업로드 파일을 서버의 `/tmp`에 저장합니다. Vercel에서는 서버 인스턴스가 바뀔 때마다 데모 데이터로 초기화되고, 사용자마다 다른 데이터를 볼 수 있습니다. 시연용으로만 쓰고, 계속 운영하려면 Postgres(Neon/Supabase)와 Vercel Blob으로 옮겨야 합니다.

## 둘러보기 (5분)

1. **양수인 최현우**로 들어가 `망원동 역세권 국밥집`을 엽니다. 공개 항목만 보이고 나머지는 잠겨 있습니다.
2. 본인확인 → NDA 서명 순서로 진행하면 항목이 단계별로 열립니다. 월평균 매출은 양도인이 '구간으로만' 공개하게 해 두어서 범위로 보입니다.
3. 오른쪽 AI에게 "NDA까지 했는데 비용 내역도 볼 수 있어요?"라고 묻고, "요청해줘"라고 하면 승인 요청이 갑니다.
4. 상단 **전환** → **양도인 김정민** → 매물 → 구매자 관리에서 승인합니다. 기록 탭에서 누가 무엇을 봤는지, AI가 어떤 항목으로 답했는지 확인할 수 있습니다.
5. 다시 양수인으로 돌아가 비교표에 2~3개를 담고 **AI로 비교 분석**을 누릅니다.
6. 양도인으로 새 매물을 등록하고 매출 엑셀·PDF·사진을 올리면 AI가 값을 찾아 '확인 필요'로 채웁니다.

## 구조

| 경로 | 역할 |
| --- | --- |
| `src/lib/access.ts` | 접근제어 엔진. 열람 조건(공개/본인확인/NDA/승인/비공개) 판단, 구간 공개, 파생 지표(구간 연산) |
| `src/lib/llm.ts` | AI 연결 계층 (래블업 게이트웨이 / Anthropic / OpenAI 공통 인터페이스) |
| `scripts/ai-check.mjs` | AI 연결 점검 (`npm run ai-check`) |
| `src/lib/ai.ts` | 단일 AI 에이전트: 자료 추출, 양수인 질의응답(도구: 승인 요청·질문 전달), 비교 요약, 답변 초안 |
| `src/lib/requests.ts` | 승인 요청·질문 생성. 화면 버튼과 AI 도구가 같은 함수를 씀 |
| `src/lib/recommend.ts` | 조건별 추천 (양수인에게 열린 값만 사용) |
| `src/lib/db.ts` | SQLite 스키마, 감사 로그, 데모 데이터 |
| `src/app/seller/*` | 양도인: 등록 폼, 데이터룸(항목·자료·열람 조건), 구매자 관리, 기록 |
| `src/app/buyer/*` | 양수인: 인수 조건, 추천, 매물 상세 + AI 질의, 비교표 |

## 보안 원칙 (PRD 6장 구현)

- 잠긴 항목의 값은 `fieldViews()` 밖으로 나가지 않습니다. 화면·AI·추천·비교가 모두 이 함수 결과만 씁니다.
- 구간 공개 값에서 나온 계산은 구간 연산으로 처리해 원래 값을 역산할 수 없게 합니다.
- 원본 파일 다운로드도 서버가 조건을 확인합니다 (`/api/documents/[id]`).
- 양수인별 대화·조건·질문은 분리 저장되고, AI는 요청한 양수인의 것만 받습니다.
- 열람, 다운로드, AI 답변(사용 항목 포함), 승인·회수는 모두 `audit_log`에 남습니다.

## 아직 데모인 부분

- 로그인과 본인확인은 버튼 한 번으로 처리하는 데모입니다. 실서비스 전 실제 인증·본인인증 연동이 필요합니다.
- NDA 문안은 예시이며 법률 검토가 필요합니다. 전자서명은 이름 입력 + 동의 기록 수준입니다.
