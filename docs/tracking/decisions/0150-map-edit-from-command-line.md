# 0150 — 터미널 명령어로 마인드맵을 읽고 고치고 만든다. 고치기는 앱 편집과 같은 길을 탄다

[0014](0014-own-xmind-engine.md)가 마인드맵 파일을 위한 엔진(`packages/xmind-engine`)을 만들 때 앱의 편집 화면만 쓰기로 했다. 이번에는 터미널 명령어와 그 MCP에 한해 `.xmind`를 읽고 고치고 만들 수 있게 한다.

## 맥락

명령어는 워드·엑셀·파워포인트·한글·다이어그램을 읽고 고치지만, 마인드맵(`.xmind`)은 `info` 수준의 정보만 알 수 있었다. 코딩 에이전트에게 "이 마인드맵의 가지 이름을 고쳐 달라", "아웃라인에서 마인드맵을 만들어 달라"고 하면 막혔다.

이미 갖춘 것:

- 엔진은 0014의 규칙 그대로다. 원본 바이트 보존, 모르는 키 보존, `reconcileSheet`가 편집 화면의 상태(`sheetToView`)를 원본 나무에 맞춘다. 앱의 `MapController`(`apps/mindmap/src/renderer/map/controller.ts`)는 모든 편집을 이 한 길로 보낸다.
- 보존 요소 세기(`preserved.ts`)에는 "지우면 안 되는 것"의 판이 있다. 앱의 AI는 `countPreservedWithTopics`가 0이 아닐 때 지우기를 거절하고 개수를 알린다(0014의 결정).
- 개요 글(`outline.ts`, `outline-parse.ts`)은 마인드맵과 마크다운 아웃라인을 오간다. 읽기·검색·AI 첨부가 이미 이것을 쓴다.
- 다이어그램 명령(0079와 같은 계열)이 "편집기 AI의 연산을 그대로 쓰는 명령어"의 모습을 이미 보여 준다. 마인드맵 명령의 연산 이름과 입력은 앱 AI의 편집 도구(`add`, `set_title`, `move`, `delete` 등)와 다르다. 같은 것은 고치는 길(`sheetToView` → 편집 → `reconcileSheet`)과 지우기 거절 규칙이다.

## 결정

- `ieumoffice map read <파일>`(MCP `map_read`)은 시트마다 `# ` 머리글이 있는 개요 글을 인쇄하고, `--json`은 주제마다 id·제목·메모·연결·자식 id를 담은 구조를 돌려준다. 연산이 겨냥하는 id는 여기서 나온다.
- `ieumoffice map apply <파일> --ops`(MCP `map_apply`)는 연산 여섯 개로 고친다: `add_topic`, `rename_topic`, `move_topic`, `delete_topic`, `set_note`, `set_link`. 모두 주제 id를 겨냥하고, 쓰기는 모두 `reconcileSheet`로만 간다(상태를 `sheetToView`로 받아 고치고 되돌리는 길 — 앱의 편집과 같은 길). 그래서 고치지 않은 `content.json`의 키와 다른 압축 항목은 바이트 그대로 남는다. 트리를 통째로 다시 만들지 않는다.
- `add_topic`·`move_topic`로 들어오는 토픽은 결정 0102의 "들어오는 토픽은 부모의 서식을 받는다"를 그대로 따른다. 새 부모에게 직접 적힌 선 값 가운데 엔진이 쓰는 것을 그 토픽과 그 아래 가지에 적고, 부모에 적힌 값이 없으면 들어온 토픽의 서식을 그대로 둔다.
- `delete_topic`은 지우면 보존 요소(경계, 부유 주제, 부름말, 요약 아래 가지, 그 아래의 모든 것)를 잃는 주제를 개수와 함께 거절한다. 앱의 AI 거절과 같은 규칙이고, 같은 `countPreservedWithTopics`를 쓴다. 물을 사람이 없는 명령어에서 "그래도 지울까요"는 없다.
- 묶음은 다른 문서 명령처럼 기본이 "하나라도 거절되면 아무것도 쓰지 않음"이고, `--best-effort`·`--stop-on-error`를 받는다. 빈 묶음(`--ops []`)은 아무것도 고치지 않으므로 아무것도 쓰지 않는다(`--out`으로 다른 파일을 가리킬 때만 그대로 복사해 쓴다). 연산이 새로 만든 주제의 id는 `detail.results[].created`로 돌려준다.
- `ieumoffice map create --outline <파일|->`(MCP `map_create`)는 개요 글에서 새 `.xmind`를 만든다(`createXmindDocumentFromOutline`). 명령어에서 `--out`이 없으면 개요 파일 이름에 `.xmind`를 붙인다. MCP `map_create`는 `out`을 반드시 받는다: 개요 글이 서버의 임시 폴더에 파일로 풀려 쓰이는데 그 폴더는 호출이 끝나면 통째로 지워지므로, 거기에 곁들여 만든 기본 이름의 지도는 클라이언트에 돌아가지 않는다. 다른 만들기 도구(`create_docx` 등)의 `out` 규칙과 같다. 인자 검사에서 `--out`에 값이 없으면(예: `map create --outline x --out --json`) 아무것도 쓰기 전에 `missing_argument`로 거절한다(`map apply`와 같은 거절).
- `guide map`은 연산 목록을 같은 정의에서 만든다(`src/formats/map.ts`의 `MAP_OP_FIELDS`와 JSON 스키마). MCP는 이 목록으로 연산마다 형식을 알린다(`map-ops`). 주제 id는 한 시트 안에서만 하나이므로, 같은 id가 여러 시트에 있으면 어느 쪽인지 못 박지 못해 거절한다. 그런 id는 지금 겨냥할 방법이 아예 없고(시트를 가리키는 옵션이 없으므로), 시트 선택 옵션이 생겨야 고칠 수 있다.
- 저장은 `XmindDocument.save`로만 간다. 바뀐 게 없으면 원본 바이트가 그대로 나가고, 있으면 `content.json`만 다시 쓴다.

## 택하지 않은 것

- **명령어 쪽에 편집 로직을 따로 만든다.** 앱과 명령어가 같은 파일을 다르게 고칠 수 있다. 0014의 엔진이 이미 하는 일이고, 이번에는 아무것도 고치지 않았다.
- **트리를 통째로 다시 쓴다.** 모르는 키와 보존 요소가 사라진다. 0014의 첫 번째 규칙에 어긋난다.
- **숨겨진 주제(부유 주제, 부름말, 요약 아래 가지)까지 연산으로 고친다.** 앱의 편집 화면도 이것을 가지로 다루지 않는다. 개요 글에서 읽을 수는 있고, 지우기만 guard가 지킨다. 필요해지면 그때 연산을 더한다.
- **시트를 가리키는 옵션을 둔다.** 연산이 모두 주제 id를 겨냥하므로, id가 한 곳에만 있으면 시트는 저절로 정해진다. 여러 시트에 같은 id가 있으면 거절한다.
- **앱을 창 없이 띄워 고친다.** 다이어그램의 그림 내보내기 같은 예외가 없다. 전부 엔진으로 돈다.

## 결과

- `packages/cli`에 `src/commands/map.ts`, `src/formats/map.ts`, 테스트(`tests/map-read.test.ts`, `tests/map-apply.test.ts`, 견본은 엔진으로 만든 임시 파일)가 있다. `guide map`·MCP 도구 `map_read`·`map_apply`·`map_create`는 같은 정의에서 나온다.
- 검증: 견본 파일에 연산을 돌려 고치지 않은 항목이 바이트 그대로임을 항목별로 견주어 보았고, 지우기 거절의 개수를 보았다. 실제 사용자의 `.xmind` 사본으로도 같은 확인을 했(원본은 건드리지 않는다).
- `packages/cli/README.md`와 `skills/ieumoffice/SKILL.md`, `packages/cli/AGENTS.md`에 적었다.
