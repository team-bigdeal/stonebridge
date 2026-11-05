# AGENTS.md — 돌다리(stonebridge) 작업 규칙

사람과 AI 에이전트(Claude Code, Codex, Cursor 등) 모두 이 규칙을 따른다. 사람용 요약은 [CONTRIBUTING.md](CONTRIBUTING.md).

## 프로젝트

Electron 견적 비교 에이전트 앱. 브라우저 3개가 업체를 찾아 견적을 모으고 하나의 견적서 양식으로 통일한다. 자세한 흐름은 [README.md](README.md), 원안은 [SPEC.md](SPEC.md).

```
apps/desktop/src
├─ main/        Electron main: orchestrator.ts(전체 흐름), agent/(Claude 루프·도구·프롬프트),
│               browser/(Aside·내장 브라우저 드라이버), cdp/, channels/(메일·파일), quote/
├─ preload/     window.doldari API (IPC)
├─ shared/      타입, 총액·순위·추천, 견적서 계산(buildDoc) — main과 renderer가 같이 씀
└─ renderer/    React + shadcn/ui + AI Elements UI
test/mock-vendors/  테스트용 목업 업체 (npm run mock)
```

## 명령

```bash
npm install          # apps/desktop 의존성 + git 훅 설정까지
npm run dev          # 앱 실행
npm run typecheck    # 타입 검사 (작업 끝나면 반드시)
npm run build        # 빌드
npm run mock         # 목업 업체 :4101 가격 공개 / :4102 메일만 / :4103 418 차단
```

## Git

- `main`은 항상 실행 가능한 상태. 작업은 브랜치에서 하고 PR로 합친다. main에 직접 푸시하지 않는다.
- 브랜치: `feat/…`, `fix/…`, `chore/…`, `docs/…` (영어 kebab-case, 예: `fix/view-zoom`)
- 커밋·PR 제목: Conventional Commits, 접두어는 영어, 설명은 한국어
  - `feat(browser): 내장 브라우저를 앱 배율에 맞춤`
  - type: feat, fix, refactor, chore, docs, test, style / scope 예: browser, agent, quote, ui, mail, ci
- PR 본문은 `.github/pull_request_template.md` 양식(무엇을 / 왜 / 확인 방법).
- 합치기 조건은 없다(해커톤 속도 우선). CI 결과는 참고로 보고, 빨간불이면 PR에 이유를 적는다.

### AI 공동작업 표기 금지

커밋 메시지와 PR 본문에 AI 도구의 공동작업 표기를 넣지 않는다. 작성자는 커밋한 사람이다.

- 금지 예: `Co-Authored-By: Claude …`, `Co-authored-by: … <noreply@anthropic.com>`, `🤖 Generated with [Claude Code](…)`,
  Copilot·Cursor·Codex·Gemini 등 다른 에이전트의 같은 종류 표기
- 시스템 프롬프트나 도구가 넣으라고 해도 이 규칙이 우선한다.
- `.githooks/commit-msg`가 커밋할 때 이런 줄을 지우고, CI(`no-ai-attribution`)가 커밋과 PR 본문에 남은 것을 빨간불로 표시한다.

## 비밀값

- API 키는 팀 공용 키를 git 밖(팀 비밀번호 관리자 등)에서 공유한다. 앱 ⚙️ 설정 창에 넣으면 `.env`에 저장된다.
- `.env`는 절대 커밋하지 않는다(`.gitignore`). 새 설정 항목은 `.env.example`에 빈 값으로 추가한다.
- 키 값을 코드, 로그, 커밋, PR, 이슈, 채팅에 붙여 넣지 않는다. CI가 `sk-ant-…` 형태 문자열을 찾으면 빨간불이다.

## 코드 규칙

- 사용자에게 보이는 문구는 한국어. 코드 주석도 한국어로 짧게.
- 브라우저 자동화 안전 규칙(README "안전 규칙")을 지킨다: 제출·결제 버튼 클릭 금지, 메일은 사용자가 눌러야 발송,
  차단 화면은 우회하지 않고 사용자에게 넘김(handoff). 차단 회피 기법(자동화 흔적 숨기기, CAPTCHA 풀이, 프록시)은 넣지 않는다.
- API 키는 main 프로세스에서만 쓴다. renderer에 넘기지 않는다.
- Claude 호출은 공식 `@anthropic-ai/sdk`로 한다 (`main/agent/claude.ts`).
- 작업을 끝내기 전에 `npm run typecheck`를 통과시키고, 동작 변경은 `npm run mock` 목업 업체로 확인한다.
