# whiteboard-engine

## 맡은 범위

`.whiteboard` 문서의 핵심 엔진을 순수 Rust로 작성해 WebAssembly(`pkg/whiteboard_engine_bg.wasm`)로 묶은 패키지다.

- `.whiteboard` ZIP 컨테이너 읽기·검증·안전 관문(경로 탈출·암호화·크기/엔트리 상한)·미지 필드/항목 보존 저장·바뀜 없는 저장 시 원본 바이트 반환.
- 도메인 모델(`schemaVersion == 1`, 페이지 형식 5종, 오브젝트 9종, 도형 8종, 래스터 이미지 매직 바이트 판정 4종, 리치 텍스트, 표 패치, 분수 순서 키, 필압 획 윤곽 경로, 자유형 보드 경계 계산).
- AI·앱 안 MCP·CLI 공용 일괄 편집 계획기(`plan_board_edit`), 자동 빈자리 배치(`place_free`/`place_near`), 선언형 JSON 템플릿 검증·배치기(`apply_template`), 구조화 텍스트 표(`read_board_table`), 결정적 마크다운 추출(`board_to_markdown`).
- Excalidraw 가져오기(`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`) 순수 메모리 변환기.

## 맡지 않는 것 (경계)

- 네트워크 요청, 파일 시스템 쓰기, OS 클립보드, PDF 렌더링(`pdfjs-dist`), UI 렌더링은 맡지 않는다. 모든 함수는 메모리 바이트(`Uint8Array`)와 JSON 구조만 다룬다.
- 일반 빌드(`npm run build:all`)와 CI는 `wasm-pack`을 실행하지 않고 저장소에 커밋된 `pkg/`를 그대로 사용한다.

## 항상 지켜야 하는 것

- `src/index.ts`와 `src/types.ts`에는 `node:*` import, `Buffer`, `require`를 두지 않는다(`tests/browser-safety.test.ts`). Node·Electron 메인용 자동 초기화는 `src/node.ts`에 둔다.
- `rust/Cargo.toml`, `rust/Cargo.lock`, `rust/src/**/*.rs`를 고쳤으면 반드시 `node tools/build-whiteboard-engine.mjs`를 실행해 `pkg/`와 `pkg/manifest.json`을 갱신한다(`tests/freshness.test.ts`).
- `pkg/whiteboard_engine_bg.wasm`에 개발자 PC의 로컬 경로가 남지 않아야 한다.
- 모든 Rust 크레이트 의존성은 `rust/deny.toml` 허용 라이선스 안에 있어야 한다.

## 테스트

- Rust 단위 테스트: `cargo test --manifest-path packages/whiteboard-engine/rust/Cargo.toml`
- WASM 재빌드: `node tools/build-whiteboard-engine.mjs`
- TypeScript 테스트 및 타입 검사: `npm run test -w @genoffice/whiteboard-engine && npm run typecheck -w @genoffice/whiteboard-engine`
