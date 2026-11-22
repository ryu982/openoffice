# 0161. 설정 ▸ 연동의 통합 커넥터 6종과 내장 Obsidian 볼트

- 날짜: 2026-11-21
- 상태: 확정

## 맥락

사용자 MCP 서버(결정 0100)와 Google 드라이브(결정 0033, 0085)가 각각 따로 설정 ▸ 연동에 놓여 있었고, 자주 쓰는 외부 서비스(Notion, Canva, Obsidian 볼트, 국가법령, kordoc)를 붙이려면 매번 주소를 찾아 넣거나 설정 글을 붙여 넣어야 했다. 또 AI 창 입력칸에는 연결된 서버가 0개일 때 단추가 보이지 않아 새 서비스를 연결하는 길과 Google 드라이브를 대화별로 끄는 길이 한곳에 모이지 않았다.

## 결정

1. **설정 ▸ 연동 상단 통합(하위 탭 없음).** `설정 ▸ 연동` 맨 위에 6개 서비스(Google 드라이브, Notion, Canva, Obsidian 볼트, Korean Law MCP, kordoc MCP)를 순서대로 두고, 그 아래에 직접 추가한 MCP 서버(`presetId === null`)와 기존 코딩 에이전트 연결을 둔다. Google 드라이브의 내부 구현은 바꾸지 않으며, AI를 끈 경우에도 파일 열기·저장용으로 유지하고 AI 읽기 토글만 숨긴다.
2. **Obsidian 볼트는 앱 내장 커넥터(`kind: 'vault'`, `localOnly: true`)로 구현한다.** 외부 MCP 서버나 Obsidian 앱 없이 로컬 `.md` 파일만 직접 읽고 쓴다. 볼트 안에 `.ieumoffice/` 등 관리 파일을 만들지 않고, `.obsidian`·숨김 파일·심볼릭 링크·하드링크·볼트 바깥 경로·열린 탭 쓰기/삭제·미저장 열린 탭 읽기를 막으며, 삭제(`delete_note`)는 휴지통(`shell.trashItem`)만 쓴다.
3. **비대칭 보안 가드.** 내장 볼트(`localOnly: true`)는 인터넷 도구 스위치 꺼짐·드라이브 읽기 뒤에도 유지되지만, `keepResultsInside: true`가 기본이므로 볼트를 읽은 뒤에는 바깥 도구를 막고 볼트 결과의 URL은 확인된 주소로 치지 않는다. 에이전트 창에서 프로젝트 폴더 밖 볼트가 켜져 있으면 시작 때 경고한다.
4. **로컬 프리셋 안전 장치 유지.** Korean Law MCP(`npx -y korean-law-mcp`, `LAW_OC` 봉인, `keepResultsInside: false`)와 kordoc MCP(`npx -y kordoc mcp`, 가리기 미적용 명시, `keepResultsInside: true`)는 모두 기존 실행 명령 확인(`LaunchReview`)과 Node.js 내려받기 동의를 그대로 거친다.
5. **통합 첨부 메뉴와 상시 연결 단추.** 첨부 가능 편집기 8곳의 `+` 첨부 메뉴(`AiAttachMenu`)에 Obsidian 볼트 노트·Notion 페이지 직접 첨부 창(최대 20개)을 더한다. 10개 편집기와 홈 AI 질문 창 모두 `<McpServerButton>`을 항상 표시하고, 편집기에서는 Google 드라이브 대화별 토글(`windowDriveState`)·Obsidian 볼트별 토글·MCP 서버·`+ 연결 관리…`를 한 팝오버에서 다룬다(홈 AI 질문은 드라이브 제외).

## 버린 대안

- **설정 ▸ 연동 안에 별도 "커넥터" 하위 탭 추가:** 이동 단계만 늘어나고 Google 드라이브와 MCP 서버가 여전히 분리된다.
- **Slack · NotebookLM MCP 포함:** Slack 공식 원격 MCP의 인증·워크스페이스 제약과 NotebookLM 비공식 경로의 정책 위험 때문에 이번 범위에서 제외한다.
- **Obsidian을 외부 로컬 MCP 프로세스로 실행:** Node/uv 설치와 프로세스 관리가 필요하고, 열린 탭·가리기·휴지통 삭제·볼트 무침투 같은 앱 경계를 강제하기 어렵다.

## 결과

- 자주 쓰는 6개 서비스를 한 화면에서 일관된 보안 모델과 22개 언어 안내로 연결·관리할 수 있다.
- 타사 회사 로고를 쓰지 않고(결정 0052) 단색 선 아이콘만 사용한다.
- `docs/security.md`, `docs/business-rules.md`, `docs/contracts.md`, `docs/architecture.md`, `PRIVACY.md`와 22개 언어 도움말을 함께 갱신한다.
