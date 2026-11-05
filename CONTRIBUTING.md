# 같이 작업하기

해커톤 속도 우선. 규칙은 최소로, 대신 아래 몇 가지는 꼭 지킨다. AI 에이전트 규칙은 [AGENTS.md](AGENTS.md).

## 시작

```bash
git clone https://github.com/team-bigdeal/stonebridge.git
cd stonebridge
npm install      # git 훅(.githooks)도 이때 켜진다
npm run dev
```

API 키는 팀 공용 키를 팀 비밀번호 관리자에서 받아 앱 ⚙️ 설정 창에 넣는다. `.env`는 커밋하지 않는다.

## 흐름 (GitHub Flow)

1. 최신 main에서 브랜치: `git switch main && git pull && git switch -c feat/견적서-pdf`
   (브랜치 이름은 영어 권장: `feat/quote-pdf`, `fix/view-zoom`, `chore/…`, `docs/…`)
2. 커밋: `feat(quote): 통합 견적서 PDF 저장` — 접두어는 영어, 설명은 한국어
3. 푸시하고 PR: `git push -u origin HEAD && gh pr create --fill`
4. CI(typecheck·build·검사)는 참고용. 합치기를 막지 않는다. 빨간불인데 합칠 거면 PR에 이유 한 줄.
5. 합칠 때는 **Squash and merge** 권장, 합친 브랜치는 지운다.

main에 직접 푸시하지 않는다. 충돌은 브랜치에서 `git pull --rebase origin main`으로 풀고 올린다.

## 금지

- **AI 공동작업 표기**: `Co-Authored-By: Claude …`, `🤖 Generated with Claude Code` 같은 줄을 커밋·PR에 넣지 않는다.
  커밋 훅이 자동으로 지우고, PR 본문에 있으면 CI가 빨간불을 띄운다.
- **비밀값 커밋**: `.env`, API 키, 앱 비밀번호. CI가 키 형태 문자열을 찾으면 빨간불.
- **차단 우회 코드**: 자동화 흔적 숨기기, CAPTCHA 풀이, 프록시 우회.

## 커밋 타입

| type | 쓰는 때 |
|---|---|
| feat | 새 기능 |
| fix | 버그 수정 |
| refactor | 동작 그대로 구조만 |
| chore | 설정·의존성·CI |
| docs | 문서 |
| test | 테스트·목업 |
| style | UI 스타일만 |
