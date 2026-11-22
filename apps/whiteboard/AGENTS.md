# apps/whiteboard (`@genoffice/whiteboard`)

범용 로컬 화이트보드 편집기다. `.whiteboard` ZIP 컨테이너를 열고 고치고 저장하며, Excalidraw(`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`) 가져오기, PDF 쪽 배경 가져오기(`pdfjs-dist`), 발표 모드(`F5`), PNG·SVG·PDF 내보내기·인쇄, 그리고 공용 AI 패널을 제공한다. 문서 모델·ZIP 저장/검증·편집 계획·선언형 템플릿 배치·Excalidraw 변환은 순수 Rust(WebAssembly) 엔진(`packages/whiteboard-engine`)이 맡는다.

## 맡은 범위

- 메인 프로세스(`src/main/`). 셸이 상대 경로로 가져와 셸 번들 안에서 돈다.
  - `whiteboard-main.ts`: 보기 만들기(`createWhiteboardView`, `createWhiteboardHiddenWindow`), 열기·거절, 저장 두 단계(`whiteboard:save-target` → `whiteboard:save`, 원자적 쓰기·저장 충돌 검사·변경 없을 때 무쓰기), 닫기 확인(`requestWhiteboardClose`), Excalidraw 가져오기(제목 없는 탭, `dirty: false`, 첫 저장 시 원본 옆 `<이름>.whiteboard` 제안, 원본 무수정), PDF/그림 파일 고르기 및 드롭 읽기, 링크 열기(`safeExternalUrl`, `http:`/`https:`/`mailto:`만), 메뉴·내보내기·인쇄 전달, 복구 사본 계약 등록.
  - `link-preview.ts`: 링크 카드의 선택적 미리보기 가져오기(기본 꺼짐, 체크 시에만 1회 `fetchWithSsrfGuard`, 쿠키 없음, 래스터 이미지만 `.whiteboard` 안에 내장).
  - `export-main.ts`·`export-paths.ts`·`print-document.ts`: PNG·SVG·PDF 내보내기 및 인쇄(밝은 용지 색 고정, 앱 다크 테마와 무관).
  - `headless-main.ts`: `--headless-export <file.whiteboard> --to pdf|png|svg --out <path> [--page <n>]` 처리(`exportWhiteboardHeadless`).
  - `open-check.ts`: 셸이 탭을 열기 전에 묻는 `.whiteboard`·`.excalidraw*` 검사(`whiteboardOpenRefusal`, `excalidrawOpenRefusal`).
  - `mcp-queries.ts`: 앱 안 MCP용 읽기/적용/바이트 조회(`whiteboardReadText`, `whiteboardReadPage`, `whiteboardApplyOps`, `whiteboardReadBytes`).
  - `recovery-main.ts`·`ai-attachments.ts`·`ai-image.ts`·`handoff-main.ts`·`i18n-main.ts`.
- preload(`src/preload/index.ts`): `window.whiteboardApi`와 공용 셸 다리(`aiOfficeEditorChoice`, `aiOfficeSplit`, `projectApi` 등)를 노출한다.
- 화면(`src/renderer/`):
  - `App.tsx`·`components/WhiteboardEditor.tsx`: React + SVG 인터랙티브 캔버스(자유형 + 고정형 페이지 혼합, 9종 오브젝트, 도형 8종, 스티커 19종, 필압 펜/형광펜, PDF 쪽 배경 가져오기, 링크 카드 클릭 시 기본 브라우저 열기, Excalidraw 생략 배너, 발표 모드 `F5`).
  - `document/session.ts`: Rust WASM 아카이브 세션, 실행 취소/다시 하기 스택(AI 턴 되돌리기·사용자 편집 보호 포함), 무변경 저장 감지.
  - `canvas/selection.ts`: 여러 개체 선택의 순수 함수. 영역(사각형) 판정은 사각형 안에 온전히 들어간 개체만 고른다(돌린 개체는 돌린 모서리, 연결선은 끝점과 꺾은 점으로 잰다). 묶음 이동·복제·앞뒤 순서는 편집 연산 목록으로 만들어 `session.applyEditorOps`로 실행 취소 1단계에 넣는다. 묶음 이동에서 연결선의 붙은 끝은 붙은 채 따라가고 자유로운 끝과 꺾은 점만 옮긴다. 복제한 연결선은 함께 복제한 개체의 사본에 다시 붙고, 남겨 둔 개체에 붙었던 끝은 같은 거리만큼 옮긴 자유로운 끝이 된다.
  - 선택 조작: 선택 도구로 빈 곳을 끌면 영역 선택, 왼쪽 레일의 영역 선택 도구(`M`)는 개체 위에서도 끌기를 시작하고 끝나면 선택 도구로 돌아간다. Shift·Ctrl/⌘+클릭은 넣고 빼기, Shift·Ctrl/⌘+끌기는 더하기, Ctrl/⌘+A는 지금 페이지 전체 선택이다. 여러 개를 고르면 손잡이 대신 묶음 점선 틀과 개수·앞뒤 순서·복제·삭제 막대를 보인다.
  - `export/render-svg.ts`·`export/pdf-import.ts`: 테마 불변 밝은 SVG/PNG 렌더러 및 지연 로드 `pdfjs-dist` PDF 페이지 래스터라이저.
  - `ai/`: `@genoffice/ui` 공용 AI 패널(`useAiSendGate`, `AiChangesCard`, `AiModelPicker`, `aiVisible`), `<whiteboard_page>` 텍스트 표 + 비전 지원 모델일 때 밝은 PNG 자동 첨부(미지원 모델은 조용히 텍스트 전용 폴백), 6개 도구(`read_board`, `edit_board`, `apply_template`, `search_images`, `insert_image`, `generate_image`), 도구 1회 호출 = 실행 취소 1단계(all-or-nothing) + 비파괴 강조 표시.
  - `i18n/`: 22개 언어(`app/`·`ai/` 각 22개 파일).

## 맡지 않는 것 (경계)

- `.whiteboard` ZIP I/O, 안전 관문, 편집 계획, 선언형 템플릿 레이아웃, 마크다운 개요 추출, Excalidraw 변환은 `packages/whiteboard-engine`의 범위다.
- 탭·창·메뉴·홈 카드·빠른 미리보기·만들기 창·앱 안 MCP 서버 등록·OS 파일 연결은 `apps/shell`의 범위다.

## 항상 지켜야 하는 것

- **열기·편집·내보내기·인쇄·발표 중 외부 네트워크 요청 0건.** 링크 카드도 기본은 로컬 메타데이터뿐이며, 사용자가 "미리보기 이미지·제목 가져오기"를 명시적으로 체크했을 때만 1회 SSRF 가드 요청을 보낸다.
- **링크 클릭은 `http:`·`https:`·`mailto:`만 허용한다.** 메인 프로세스가 `safeExternalUrl`로 다시 검사한다.
- **Excalidraw 원본은 절대 덮어쓰지 않는다.** 가져온 탭은 `dirty: false`·제목 없음으로 시작하고, 첫 저장은 같은 폴더의 `<이름>.whiteboard`를 제안한다.
- **UI 크롬은 `@genoffice/ui` 토큰만 쓰고(`check:theme-colors`), 보드 용지·오브젝트·PNG·SVG·PDF·인쇄 출력은 앱 다크 테마와 무관하게 항상 밝은 색을 유지한다.**
- **창구 이름은 `whiteboard:`로 시작한다.** 공용 `ai:*`·구독 창구는 여기서 등록하지 않는다.
- **AI 끄기(`aiVisible(useAppChoice(window.aiOfficeEditorChoice))`)를 따른다.** AI가 꺼지면 AI 패널과 레일을 그리지 않는다.
- **사용자가 한 편집은 `applyEditorOps`·`addObject`·`updateObject`·`insertEditorImage` 같은 사용자 단계로, AI 도구의 편집은 `applyOps`·`insertImage`로 넣는다.** 이 둘은 AI 단계로 기록되므로 사용자 편집을 그리로 넣으면 AI 차례 되돌리기(`undoBatches`)가 그 편집까지 되돌린다.
- **`useAutoSavePref`에는 늘 같은 객체를 넘긴다(`AUTO_SAVE_API`).** 렌더마다 새 객체를 넘기면 기본값 묻기와 다시 그리기가 끝없이 돈다.
- 문구는 22개 언어 모두 채우고, 제품 이름은 `GenOffice`로 적는다.

## 테스트

- `npm run test -w @genoffice/whiteboard`, `npm run typecheck -w @genoffice/whiteboard`, `npm run build -w @genoffice/whiteboard`.
- 보안/저장 불변량(`tests/main-security.test.ts`), 캔버스 세션/무변경 저장/링크/다크테마(`tests/canvas.test.ts`), AI 도구/실행취소/비전 폴백(`tests/ai-tools.test.ts`), 영역 선택·묶음 이동·복제·앞뒤 순서와 사용자 단계 보호(`tests/selection.test.ts`).
