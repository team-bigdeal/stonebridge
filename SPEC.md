# 돌다리 프로토타입 명세 (팀 빅딜)

> 이 문서는 Claude Code가 그대로 읽고 구현하는 것을 전제로 쓴 명세다.
> 마일스톤(M0~M8) 순서대로 구현하고, 각 마일스톤의 "완료 조건"을 만족하면 다음으로 넘어간다.

## 0. 한 줄 정의

자체 개발한 AI 에이전트가 브라우저를 직접 사용해 견적을 찾아 주는 **견적 탐색 브라우저** (데스크톱 앱).
핵심 질문: **"가장 싼 견적이 정말 가장 좋을까?"**

## 1. 프로토타입 목표 (해커톤 시연 기준)

시연 한 번에 아래 장면이 끊김 없이 나와야 한다.

1. 사용자가 "주문제작 도어락 필요해" 입력 → AI가 4~5개 질문으로 인터뷰
2. 에이전트가 A·B·C 업체 사이트를 **동시에** 열고, 화면에서 커서가 움직이며 탐색
3. 채널별 견적 수집: A는 웹, B는 메일 요청/회신, C는 카톡 견적서 파일 업로드
4. 통일 양식 비교표 생성, 빠진 항목은 `?`로 표시
5. **순위 역전 연출**: 처음엔 표시가 기준 A가 1등 → 숨은 비용이 하나씩 더해지며 A가 3등으로 추락
6. 확인 질문 생성 + 인터뷰 조건 기반 추천
7. 업체 선택 → 메일 또는 업체 폼을 **제출 직전까지** 자동 작성 후 멈춤 → 사용자 승인 후 메일만 앱이 발송
8. **빅딜 걸기**: 다른 업체 견적을 근거로 한 협상 메일 작성 → 승인 후 발송
9. 전 과정에서 단계 진행 바, 작업 로그, 브라우저 화면, 출처가 실시간 표시

## 2. 기술 스택 (결정 사항)

| 영역 | 선택 | 이유 |
|---|---|---|
| 앱 | Electron + React + TypeScript (electron-vite) | 브라우저 화면을 앱 안에 직접 넣기 위해 |
| 브라우저 뷰 | Electron `WebContentsView` (업체당 1개) | 업체별 독립 탭 = 병렬 탐색 공간 |
| 브라우저 조작 | `webContents.debugger` (CDP) | 외부 의존성 없이 클릭/입력/스냅샷 |
| LLM | Anthropic Claude API (tool use, PDF/이미지 입력) | 모델명은 `.env`의 `ANTHROPIC_MODEL` |
| 메일 발송 | nodemailer (SMTP, 팀 데모용 Gmail + 앱 비밀번호) | |
| 메일 수신 | imapflow (IMAP 폴링, 5초 간격) | 업체 회신 자동 회수 |
| UI | Tailwind + framer-motion (순위 역전 애니메이션) | |
| 상태 | zustand (renderer) + IPC 이벤트 | |
| 목업 업체 사이트 | `mock-vendors/` 정적 사이트 3개, 로컬 서버(포트 4101~4103) | 시연 안정성 |

참고: `citrolabs/ego-lite`의 `package/ego-browser/src` (MIT)는 스냅샷 포맷, 클릭 대상 판정, 커서 이동 모션 구현을 **참고**할 수 있다. 코드를 가져오면 LICENSE 표기 필수. ego lite 앱 자체에는 의존하지 않는다.

기존 `team-bigdeal/bigdeal-BE`(Java/Gradle)는 프로토타입 범위에서 필수가 아니다. 시간이 남으면 견적/세션 저장 API를 BE로 옮긴다 (M9, 선택).

## 3. 화면 구성

```
┌───────────────────────────────────────────────────────────────┐
│ 단계 진행 바: 인터뷰 → 수집 → 정리 → 비교 → 확인질문 → 작성        │
├──────────────────────────┬────────────────────────────────────┤
│ 왼쪽 패널 (탭)             │ 브라우저 영역                         │
│  - 대화(인터뷰/추천)        │  [A업체] [B업체] [C업체] [메일]  탭     │
│  - 비교표                  │  (WebContentsView, 에이전트 커서 표시)  │
│  - 출처                    │  썸네일 모드: 3개 뷰를 타일로 동시 표시   │
├──────────────────────────┴────────────────────────────────────┤
│ 작업 로그: "B업체 사이트에서 납기 확인 중" ... (최신이 위로)         │
└───────────────────────────────────────────────────────────────┘
```

- 수집 단계에서는 브라우저 영역을 **3분할 타일**로 보여 준다 (병렬 탐색이 눈에 보이도록).
- 제출 직전 멈춤 상태에서는 해당 뷰 위에 노란 배너: "AI가 여기까지 작성했습니다. 확인 후 직접 제출하세요."

## 4. 데이터 모델

```ts
type Stage = 'interview' | 'collect' | 'normalize' | 'compare' | 'questions' | 'draft';

interface Requirements {          // 인터뷰 결과
  item: string;                   // "주문제작 도어락"
  quantity: number;
  budgetMax: number;              // 원
  deadline: string;               // ISO date, "언제까지 받아야"
  needInstall: boolean;
  minWarrantyMonths: number;      // A/S 최소 기간
  notes?: string;
}

type Channel = 'web' | 'mail' | 'file';

interface Source {
  channel: Channel;
  ref: string;                    // URL | mail messageId | 파일명
  snippet: string;                // 근거 원문 (최대 200자)
  capturedAt: string;
}

interface Field<T> {
  value: T | null;                // null = 견적에 없음 → 누락 항목
  source?: Source;
  status: 'found' | 'missing' | 'asked' | 'answered';
}

interface Quote {
  vendorId: 'A' | 'B' | 'C';
  vendorName: string;
  channel: Channel;
  listedPrice: Field<number>;     // 표시가 (처음 순위 기준)
  installFee: Field<number>;      // 0 = 포함
  shippingFee: Field<number>;
  warrantyMonths: Field<number>;
  warrantyExtraFee: Field<number>;// 요구 A/S 기간 맞추는 데 드는 추가비
  leadTimeDays: Field<number>;
  totalPrice: number | null;      // 계산값, 누락 있으면 null + 추정치 별도
  missing: string[];              // 누락 필드 키 목록
}

interface AgentEvent {            // main → renderer IPC
  type: 'stage' | 'log' | 'quote_update' | 'source' | 'handoff' | 'error';
  vendorId?: 'A' | 'B' | 'C';
  message?: string;               // 작업 로그 한 줄 (한국어)
  payload?: unknown;
  at: string;
}
```

**총액 계산 규칙**: `total = listedPrice + installFee(needInstall일 때만) + shippingFee + warrantyExtraFee`.
하나라도 `missing`이면 총액 옆에 `?` 배지, 정렬은 "현재 확인된 금액 합계" 기준. 값이 새로 확정될 때마다 재정렬한다. (이게 순위 역전의 원천)

## 5. 시연 시드 데이터 (목업 업체)

발표 대본(A는 설치비 별도, B는 납기 3주, C는 A/S 없음)과 맞춘 값. 숫자는 바꿔도 되지만 **최종 순위에서 A가 3등**이 되도록 유지한다.

| | A업체 (웹) | B업체 (메일) | C업체 (카톡 파일) |
|---|---|---|---|
| 표시가 | 390,000 (최저) | 450,000 | 420,000 |
| 설치비 | **별도 80,000** (상세 페이지 하단 "설치 안내"에 숨김) | 포함 | 50,000 |
| 배송비 | 15,000 | 무료 | 무료 |
| A/S | 1년 → 2년 연장 30,000 | 2년 | **견적서에 없음** → 메일 회신으로 "1년 무상, 1년 연장 20,000" |
| 납기 | 10일 | **21일** | 7일 |
| 최종 총액 | 515,000 (3등) | 450,000 (1등) | 490,000 (2등) |

인터뷰 데모 답변: 예산 50만 원, 2주 안에 필요, 설치 필요, A/S 2년.
→ 추천: **C업체** (B가 총액 최저지만 납기 21일로 조건 위반). 빅딜 걸기: C에 "B업체는 설치 포함 45만 원인데, 설치비 조정 가능할까요?"

### 목업 사이트 요구사항 (`mock-vendors/`)
- `vendor-a/`: 상품 목록 → 상세 페이지(가격, 배송비) → 하단 접힌 "설치 안내" 섹션(설치비 별도 80,000) → 견적 문의 폼(이름, 연락처, 수량, 희망 납기, 문의 내용, 제출 버튼)
- `vendor-b/`: 상품 소개만 있고 "정확한 견적은 메일로 문의: (데모 업체 메일)" 안내. 가격 비공개
- `vendor-c/`: 상품 소개 + "카카오톡 채널로 견적서를 보내드립니다" 안내. 견적서 파일은 `demo-assets/C업체_견적서.pdf` (A/S 항목 없음)
- 세 사이트는 디자인과 표기 방식을 일부러 다르게 (예: "VAT 별도" vs "부가세 포함", "납기 3주" vs "21일") 해서 정규화가 의미 있게 보이도록.
- 폼 제출 시 `/submitted` 페이지로 이동 (실제 전송 없음).

## 6. 에이전트 설계

### 6.1 루프
- Electron main 프로세스에서 실행. 업체마다 독립 에이전트 인스턴스, `Promise.all`로 병렬.
- Claude tool use 루프: 시스템 프롬프트(목표 + Requirements + 추출 스키마) → 도구 호출 → 결과 → 반복. 업체당 최대 15스텝.
- 매 도구 호출마다 `AgentEvent{type:'log'}`를 한국어 한 줄로 발행 (예: "A업체 상세 페이지에서 설치 조건 확인 중").

### 6.2 브라우저 도구 (CDP 기반)
| 도구 | 동작 |
|---|---|
| `navigate(url)` | `Page.navigate` 후 load 대기 |
| `snapshot()` | `Accessibility.getFullAXTree` → 압축 텍스트 트리, 인터랙티브 노드에 `[ref=N]` 부여 (ref ↔ backendDOMNodeId 매핑 보관) |
| `click(ref)` | `DOM.getBoxModel`로 중심 좌표 → 커서 오버레이 이동 애니메이션(300ms) → `Input.dispatchMouseEvent` |
| `fill(ref, text)` | `DOM.focus` → 기존 값 지우기 → `Input.insertText` |
| `expand_all()` | `<details>`/아코디언 펼치기 (숨은 설치비 찾기용) |
| `report_quote(fields)` | 추출 결과 제출. 각 필드에 `snippet` 필수 |
| `handoff(reason)` | 제출 직전 멈춤. 이후 이 뷰에 대한 click/fill 금지 |

- **커서 오버레이**: 뷰에 주입한 고정 위치 div(빨간 원 + 클릭 시 퍼지는 링). 시연 임팩트 핵심이므로 M2에서 반드시 구현.
- **금지 규칙 (코드로 강제)**: submit 버튼(type=submit 또는 텍스트 "제출/보내기/전송/문의하기")에 대한 `click`은 도구 레벨에서 거부하고 에이전트에게 `handoff`를 쓰라고 반환.

### 6.3 채널별 수집
- **웹 (A)**: 위 도구로 탐색 → `report_quote`.
- **메일 (B)**: 에이전트가 견적 요청 메일 초안 작성 → UI에 미리보기 → 사용자 "보내기" 클릭 시에만 nodemailer 발송 → IMAP 폴링이 같은 스레드 회신 감지 → 본문/첨부를 Claude로 파싱 → `quote_update`. 로그: "B업체 회신 도착, 견적 분석 중".
- **파일 (C)**: 대화창에 PDF/이미지 드래그앤드롭 → Claude에 document/image 블록으로 전달 → 스키마 추출 → 누락 필드는 `missing`.

### 6.4 정규화
- 모든 채널의 추출은 같은 JSON 스키마(`Quote`)로 강제 (tool input schema 사용).
- 금액은 원 단위 정수, VAT 포함으로 통일. "3주" → 21일 같은 변환은 프롬프트 규칙 + 후처리 함수로 이중 처리.

## 7. 기능 명세

### F1. 인터뷰
- 첫 입력(품목)을 받으면 Claude가 Requirements의 빈 필드를 채우기 위한 질문 4~5개를 하나씩 던진다.
- 답변마다 Requirements를 갱신하고 왼쪽 상단에 "요구 조건 카드"로 표시.
- 데모 안정성용: `DEMO_MODE=1`이면 고정 질문 5개 사용.

### F2. 견적 수집
- 인터뷰 종료 → stage `collect` → 브라우저 영역 3분할 → A·B·C 에이전트 병렬 시작.
- B는 메일 요청 초안 승인 대기, C는 파일 업로드 대기 상태를 로그와 대화창에 표시.

### F3. 통일 양식 + 비교표
- 열: 업체 / 표시가 / 설치비 / 배송비 / A/S / 납기 / **총액** / 조건 충족 / 누락
- 누락 셀은 주황 `?`, 조건 위반(납기 초과, 예산 초과)은 빨간 텍스트.
- 각 셀 클릭 시 출처 팝오버 (채널 아이콘 + snippet + 링크/메일/파일 열기).

### F4. 순위 역전 연출 (킥 1)
- 초기 정렬 = 표시가 기준 → A 1등 배지 "최저가".
- 필드가 확정될 때마다: 해당 셀이 노랗게 플래시 → 총액 카운트업 애니메이션 → framer-motion `layout`으로 행 재정렬.
- A가 1등에서 내려가는 순간 로그에 강조 메시지: "숨은 비용 반영: A업체 1위 → 3위".
- `DEMO_MODE`에서는 필드 확정 사이에 최소 1.2초 간격을 둬서 역전이 눈에 보이게 한다.

### F5. 확인 질문 + 추천
- 누락 필드마다 업체별 확인 질문 생성 (예: "C업체: A/S 기간과 연장 비용이 어떻게 되나요?").
- 추천 = 조건 충족 업체 중 총액 최저. 추천 카드에 이유 3줄 (예: "B는 총액 최저지만 납기 21일로 요청 기한 초과").

### F6. 제출 직전까지 자동 작성
- 업체 선택 시 채널에 따라:
  - **메일**: 인터뷰 답변 + 확인 질문으로 메일 작성 → 미리보기 모달(수정 가능) → "보내기" 클릭 시 발송.
  - **업체 폼 (A)**: 에이전트가 해당 뷰에서 폼을 채움 → `handoff` → 노란 배너 → 사용자가 직접 제출.
- 어떤 경우에도 사용자 클릭 없이 전송/제출되면 안 된다.

### F7. 빅딜 걸기 (킥 2)
- 비교표에서 선택 업체 행의 "빅딜 걸기" 버튼.
- 다른 업체 견적 중 선택 업체보다 유리한 조건을 근거로 협상 메일 생성 (근거 출처 포함).
- 미리보기 모달 → 승인 시 발송 → 회신은 F2의 IMAP 흐름으로 다시 비교표에 반영.

### F8. 실시간 작업 흐름
- 단계 진행 바: 현재 stage 강조, 완료 단계 체크.
- 작업 로그: AgentEvent `log` 실시간 append, 업체별 색상 태그.
- 출처 탭: 모든 Source를 시간순 목록으로.

## 8. 디렉터리 구조

```
doldari/
├─ SPEC.md
├─ .env.example          # ANTHROPIC_API_KEY, ANTHROPIC_MODEL, SMTP_*, IMAP_*, VENDOR_B_EMAIL, DEMO_MODE
├─ apps/desktop/
│  ├─ src/main/
│  │  ├─ index.ts        # 창, WebContentsView 관리
│  │  ├─ views.ts        # 업체 뷰 생성/레이아웃(탭, 3분할)
│  │  ├─ cdp/            # snapshot.ts, actions.ts, cursor-overlay.ts
│  │  ├─ agent/          # loop.ts, tools.ts, prompts.ts, schema.ts
│  │  ├─ channels/       # mail-send.ts, mail-poll.ts, file-parse.ts
│  │  ├─ quote/          # normalize.ts, total.ts, recommend.ts
│  │  └─ events.ts       # AgentEvent 발행
│  ├─ src/preload/
│  └─ src/renderer/      # React: StageBar, Chat, CompareTable, SourcePanel, LogPanel, HandoffBanner, DraftModal
├─ mock-vendors/         # vendor-a, vendor-b, vendor-c + serve.mjs
└─ demo-assets/          # C업체_견적서.pdf, 시연 스크립트
```

## 9. 마일스톤 (구현 순서)

| # | 내용 | 완료 조건 |
|---|---|---|
| M0 | 프로젝트 세팅, `.env`, 목업 사이트 3개 + 로컬 서버 | `npm run dev`로 앱이 뜨고, 4101~4103에 업체 사이트가 열림 |
| M1 | 레이아웃 + WebContentsView 3개 (탭/3분할 전환) | 앱 안에서 세 업체 사이트가 동시에 보임 |
| M2 | CDP 도구 (snapshot/click/fill/expand_all) + 커서 오버레이 | 스크립트로 A업체 상세 → 설치 안내 펼치기가 커서 애니메이션과 함께 동작 |
| M3 | 에이전트 루프 + A업체 웹 수집 + 작업 로그 | A의 Quote가 출처 포함으로 추출되고 로그가 실시간 표시 |
| M4 | 인터뷰(F1) + 단계 진행 바 | 대화로 Requirements가 채워지고 수집 단계로 자동 전환 |
| M5 | 비교표 + 총액 + **순위 역전 애니메이션**(F3, F4) | 시드 데이터로 A가 1등 → 3등으로 내려가는 장면 재현 |
| M6 | 파일 채널(C) + 메일 채널(B: 발송, IMAP 회신 반영) | C 파일 업로드, B 회신 메일이 비교표에 자동 반영 |
| M7 | 확인 질문/추천(F5) + 제출 직전 작성(F6) + handoff 배너 | A 폼이 채워진 채 멈추고, 메일은 승인 후에만 발송 |
| M8 | 빅딜 걸기(F7) + 출처 탭 + DEMO_MODE 다듬기 | 시연 시나리오 전체가 3분 안에 한 번에 통과 |
| M9 (선택) | bigdeal-BE 연동 (세션/견적 저장) | |

M5까지가 "최소 시연 가능" 라인이다. 시간이 부족하면 M6의 메일 수신은 DEMO_MODE의 가짜 회신 이벤트로 대체한다.

## 10. 시연 시나리오 (3분)

1. "주문제작 도어락 필요해" 입력 → 인터뷰 5문항 (예산 50만, 2주, 설치 필요, A/S 2년)
2. 3분할 화면에서 A·B·C 동시 탐색 시작. A는 커서가 설치 안내를 펼침
3. B 견적 요청 메일 승인 → 발송 / C 카톡 견적서 PDF 드래그
4. 비교표: A "최저가" 1등 → 설치비·배송비·A/S 연장비가 더해지며 **3등으로 추락**
5. 팀원이 무대에서 폰으로 B 메일에 회신 → 몇 초 뒤 B 행 채워짐, C A/S 확인 질문 발송/회신
6. 추천 카드: C (B는 납기 초과) → "빅딜 걸기" → 협상 메일 미리보기 → 승인
7. A 폼 자동 작성 → 노란 배너에서 멈춤 → "최종 제출은 사용자가 합니다"로 마무리

## 11. 범위 밖 (프로토타입에서 안 함)

- 실제 업체 사이트 크롤링 (목업만. 시간이 남으면 실제 쇼핑 사이트 1곳 추가)
- 카카오톡 API 연동 (파일 업로드로 대체)
- 로그인/계정, 다중 사용자, 결제
- 사업자 상태조회 등 신뢰도 체크

## 12. 비기능 요구사항

- API 키는 main 프로세스에서만 사용, renderer로 노출 금지 (`contextIsolation: true`).
- 모든 외부 전송(메일 발송, 폼 제출)은 사용자 클릭이 있어야만 실행.
- 에이전트 실패 시 해당 업체 행에 "수집 실패, 재시도" 버튼. 다른 업체 진행은 계속.
- `DEMO_MODE=1`: 고정 인터뷰 질문, 이벤트 간 최소 간격, 메일 회신 타임아웃 시 가짜 회신 주입 (현장 와이파이 대비).
