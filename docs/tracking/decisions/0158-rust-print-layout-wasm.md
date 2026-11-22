# 0158 — 고급 인쇄 배치의 PDF 재배치·회색조 PDF·PNG 인코딩을 사전 빌드 Rust WASM으로 옮긴다

상태: 구현됨(2026-11-20).

## 맥락

고급 인쇄 배치 패키지(`@genoffice/print-layout`, 결정 0141)는 모든 문서 편집기가 공유하는 백엔드 파이프라인으로, 50~200쪽 대용량 인쇄 작업에서 세 가지 JS 병목이 확인됐다(2026-11-20 실측, Windows x64 / Node 24).

1. **공유 리소스 중복 폭증과 `pdf-lib` 직렬화 비용.** `arrangePrintJob`이 쪽마다 `out.embedPages([info.page], [info.box])`를 단건 호출해 `pdf-lib`이 매번 새 `PDFObjectCopier`를 생성했다. 공유 이미지·글꼴이 쪽 수만큼 중복 복사되어 200쪽 혼합 문서(446.6 KB)가 **37.1 MB(83배)**로 폭증했고, 모든 페이지 `/Contents`를 JS(`pako`)로 풀었다가 재압축해 200쪽 4-up에 502 ms가 걸렸다.
2. **픽셀 변환(`convertPixels`)과 PNG 인코딩(`encodePng`)이 전체 인쇄 이미지 시간의 80~91%를 차지.** PDFium 렌더 자체는 9~20%에 불과했으나, JS 픽셀 루프와 JS Up-필터 + Node `zlib.deflateSync`(기본 레벨 6)가 10쪽 300 DPI RGB 기준 1,376 ms, 2쪽 600 DPI RGB 기준 907 ms를 소비했다.
3. **회색조 PDF 생성과 가로 면 회전.** `grayscalePdf`의 면별 `deflateSync`와 `rotateLandscapeFaces`의 `pdf-lib` 전체 재파싱·재저장(100쪽 혼합 2-up 289 ms)이 누적됐다.

## 결정

- **`packages/print-layout/wasm/`에 사전 빌드 Rust WebAssembly 크레이트(`print-layout-wasm`)를 둔다.**
  - 별도 워크스페이스 패키지로 분리하지 않고 `@genoffice/print-layout` 내부에 두어 "다른 작업 공간 패키지를 가져오지 않는다"는 경계와 9개 편집기 앱의 `externalizeDepsPlugin` 설정을 그대로 유지한다.
  - `./plan`(`src/plan.ts` 이하)은 `src/wasm.ts`를 절대 import하지 않아 렌더러 번들 격리(`tests/plan-imports.test.ts`)를 100% 지킨다.
  - 면 계획 계산(`validateOptions`, `changesSheetArrangement`, `planSheets`, `PrintLayoutErrorCode`)은 기존 `./plan` TypeScript 구현을 단일 진실 원천으로 유지하고, 산출된 `PlannedFace[]`만 Rust로 넘긴다.
- **주요 Rust 구현과 크레이트 선택(모두 `deny.toml` 허용 목록 안).**
  - **`lopdf`(0.47, `default-features = false`, `features = ["wasm_js"]`, MIT)**: `read_job_page_sizes`, `arrange_pdf`, `rotate_landscape_faces`.
    - `arrange_pdf`는 문서 전체 단일 `ObjectId` 리맵 테이블로 공유 리소스(폰트·이미지·ExtGState 등)를 딱 1번만 복사하고, 단일 `/Contents` 스트림은 재압축 없이 그대로 Form XObject로 이관해 글자가 글자로 남는다.
    - `rotate_landscape_faces`는 수정할 페이지 사전의 원본 바이트에서 `/Rotate`만 패치해 PDF 증분 갱신(classic `xref` 또는 `/XRef` 스트림)으로 붙여 써서 나머지 객체와 `/MediaBox` 배정밀도 소수를 그대로 보존한다.
  - **`fdeflate`(0.3, MIT/Apache-2.0) + `crc32fast`(1.5, MIT/Apache-2.0)**: `convert_bgrx_pixels`, `encode_png`, 융합 고속 경로 `encode_bgrx_to_png`(중간 전체 픽셀 버퍼 할당 제거). PNG Up-필터와 `fdeflate`를 단일 호출로 묶는다.
  - **`flate2`(`zlib-rs`, MIT/Apache-2.0 + Zlib)**: 스트리밍 `GrayPdfBuilder`(면마다 `DeviceGray` 8-bit `FlateDecode` XObject 1개만 즉시 버퍼에 기록, 원본 비트맵 미누적). 비필터 흰 바탕(`0xFF` 연속)에 취약한 `fdeflate` 대신 `zlib-rs` fast 레벨을 사용해 출력 크기(50면 @150dpi 3.14 MB)와 속도를 함께 지킨다.
- **폴백과 비폴백 경계.**
  - `GENOFFICE_PRINT_LAYOUT_RUST=0|off` 또는 WASM 파일 부재·초기화 실패·WASM 런타임 트랩(`WebAssembly.RuntimeError`/`RangeError`) 같은 **인프라 실패 시에만** 기존 JS(`pdf-lib`·`node:zlib`) 구현으로 안전 폴백한다.
  - `PrintLayoutErrorCode`(`no-faces`, `poster-overlap-too-large` 등)와 잘못된/암호화된 PDF, 잘못된 PNG 크기 같은 **의미적 거절은 절대 폴백하지 않는다**.
- **빌드·패키징·CI·고지 정책(`packages/hwp5-wasm` 패턴 준용).**
  - 일반 앱 빌드와 CI가 `wasm-pack`을 요구하지 않도록 `node tools/build-print-layout-wasm.mjs`(`--remap-path-prefix`, 로컬 경로 누출 0건 검사, `wasm/pkg/manifest.json` SHA-256)로 생성한 `wasm/pkg/`를 커밋하고 `tests/wasm-freshness.test.ts`로 신선도를 강제한다.
  - 설치본은 `apps/shell/electron-builder.cjs`를 통해 `resources/wasm/print_layout_bg.wasm`으로 싣고, `tools/gen-third-party-notices.mjs`에 6번 Rust 섹션(`RUST_COMPONENTS = 5`)을 추가한다.
  - CI는 `cargo-deny`로 `packages/print-layout/wasm/Cargo.toml`의 라이선스를 검사하고, Windows·macOS·Linux 빌드 워크플로는 패키징된 `resources/wasm/print_layout_bg.wasm` 존재를 검증한다.

## 버린 대안

- **독립 네이티브 사이드카 바이너리로 분리하기.** `print-layout`의 모든 작업은 이미 전용 `worker_threads` 안에서 도는 순수 메모리 연산이며, 매 면마다 수십 MB 픽셀 버퍼를 프로세스 간 파이프로 넘기는 비용과 3개 OS 크로스 빌드(macOS universal `lipo`, Linux `cargo zigbuild` glibc 2.28, Windows x64/ARM64) 부담이 불필요하게 커진다.
- **별도 npm 워크스페이스(`@genoffice/print-layout-wasm`)로 분리하기.** 9개 편집기 앱과 `electron-utils`의 `externalizeDepsPlugin` `exclude` 목록과 `package.json`/`package-lock.json`을 모두 수정해야 하고, `@genoffice/print-layout`의 무의존 경계도 깨진다.
- **PDF `DeviceGray` 스트림에 `fdeflate` 쓰기.** `fdeflate`는 `0x00` 연속(PNG 필터 출력)에 특화돼 있어 비필터 흰 바탕(`0xFF`) 50면 PDF가 51 MB까지 커졌다. `zlib-rs` fast 레벨로 교체해 3.14 MB로 줄였다.
- **기존 JS(`pdf-lib`) 구현 즉시 삭제하기.** `ulimit -v` 가상 메모리 제한이나 예기치 않은 환경 문제에서 `GENOFFICE_PRINT_LAYOUT_RUST=0`으로 우회할 안전 출구를 유지한다.

## 결과

- 추가·변경한 주요 위치:
  - `packages/print-layout/wasm/`(`print-layout-wasm` Rust 크레이트, `deny.toml`, 사전 빌드 `pkg/`), `tools/build-print-layout-wasm.mjs`
  - `packages/print-layout/src/{wasm,arrange,grayscale,raster,raster-job,png}.ts`, `packages/print-layout/tests/{wasm-freshness,rust-equivalence}.test.ts`
  - `apps/shell/electron-builder.cjs`, `tools/gen-third-party-notices.mjs`, `apps/shell/tests/{third-party-notices,packaged-cli-version}.test.ts`
  - `.github/workflows/{ci,windows-build,mac-build,linux-build}.yml`, `eslint.config.mjs`, `.prettierignore`
- 실측 결과(Windows x64 / Node 24, JS 대비 Rust WASM):
  - `arrangePrintJob` 200쪽 혼합 4-up: **502.2 ms → 20.7 ms (24.3×)**, 출력 크기 **37.1 MB → 638 KB (58× 감소)**
  - `arrangePrintJob` 100쪽 혼합 2-up: **242.9 ms → 8.6 ms (28.2×)**, 출력 크기 **18.6 MB → 420 KB (44× 감소)**
  - `arrangePrintJob` 200쪽 텍스트 역순: **437.0 ms → 14.9 ms (29.3×)**
  - `rotateLandscapeFaces` 100쪽 혼합 2-up: **289.1 ms → 2.9 ms (100×)**
  - `readJobPageSizes` 200쪽 텍스트: **60.9 ms → 4.5 ms (13.5×)**
  - `encodeBgrxToPng` 10쪽 300 DPI RGB: **1,376.2 ms → 326.4 ms (4.2×)**, 10쪽 150 DPI Gray: **283.6 ms → 45.8 ms (6.2×)**, 2쪽 600 DPI RGB: **906.6 ms → 229.2 ms (4.0×)**
  - `grayscalePdf` 50면(100쪽 혼합 2-up) `@auto`: **1,694.4 ms → 1,005.3 ms (1.7×)**
- 원본 GenOffice 문서 엔진과 UI·`app-settings.json`·22개 언어 문구·`apps/pdf/src/main`·Quick Look·`file-parse`·`hwp5-wasm`은 건드리지 않았다.
