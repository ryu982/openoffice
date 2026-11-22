# hwp5-wasm

## 맡은 범위

HWP 5 OLE2 복합 문서 컨테이너를 읽고 고쳐 쓰는 Rust WebAssembly 코어다. `inspect_hwp5`, `read_stream`, `parse_records`, `rewrite_streams`, `strip_tracked_changes` 다섯 함수를 순수 메모리 연산(`&[u8]` 입력)으로 제공한다. JS `cfb` 라이브러리 대신 Rust `cfb` 크레이트를 써서 `' Sh33tJ5'` 표지 스트림과 잘못된 FAT/MiniFAT 꼬리 문제 없이 표준 OLE2 컨테이너를 만든다.

## 맡지 않는 것 (경계)

- HWP 5 문서 본문의 의미 해석(탭 너비, 꼬리 복구, 미리보기 생성 등)은 호출 쪽(`apps/hwp` 등)이 맡는다.
- 네트워크 호출이나 파일 시스템 접근을 Rust 코드에 두지 않는다.
- 일반 앱 빌드(`npm run build:all`)와 CI는 `wasm-pack`을 돌리지 않고 저장소에 커밋된 `pkg/` 산출물을 그대로 쓴다.

## 항상 지켜야 하는 것

- `src/index.ts`에는 `node:*` import를 두지 않는다. 브라우저·Vite 번들에서도 안전하게 불러올 수 있어야 하며, Node·Electron 메인용 자동 초기화는 `src/node.ts`에 둔다.
- `Cargo.toml`, `Cargo.lock`, `src/**/*.rs`를 고쳤으면 반드시 `node tools/build-hwp5-wasm.mjs`로 `pkg/`와 `pkg/manifest.json`을 다시 만든다. `tests/freshness.test.ts`가 소스와 바이너리 해시 일치를 검사한다.
- `pkg/hwp5_wasm_bg.wasm`에는 개발자 PC의 로컬 경로(홈 폴더, 저장소 경로 등)가 남으면 안 된다. 빌드 스크립트와 `freshness.test.ts`가 이를 막는다.
- 의존성 라이선스는 `deny.toml` 허용 목록을 지켜야 한다.
- `rewrite_streams`와 `strip_tracked_changes`는 결과를 다시 열어 경로·바이트·OLE2 빈 슬롯(`0xffffffff`)을 확인한 뒤에만 돌려준다.

## 테스트

- Rust 단위 테스트: `cargo test --manifest-path packages/hwp5-wasm/Cargo.toml`
- WASM 재빌드: `node tools/build-hwp5-wasm.mjs`
- TypeScript 테스트(신선도·경로 누출·WASM 엔드투엔드): 패키지 폴더에서 `npx vitest run` 및 `npx tsc --noEmit`
