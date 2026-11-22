# 0160 — 첨부·색인용 PDF 텍스트 추출 기본 경로를 번들된 PDFium WASM으로 전환한다

상태: 구현됨(2026-11-21).

## 맥락

첨부·파일 색인·만들기 창·지식 베이스·빠른 미리보기가 공유하는 `packages/file-parse/src/pdf.ts`의 `pdfToText(bytes)`는 순수 JS `pdfjs-dist`와 `DOMMatrixPolyfill` 우회를 사용해 왔다. 실측(Windows x64 / Node 24)에서 세 가지 한계가 확인됐다.

1. **초기화와 다쪽 추출 비용.** 단독 프로세스 콜드 스타트에 918 ms(초기화 888 ms), RSS 105.3 MB가 들었고, 한영 혼합 100쪽/300쪽 문서 추출에 각각 151 ms / 426 ms가 걸렸다.
2. **한국어 비임베드 표준 CMap 미추출과 경계 누락.** 설치본에 `cmaps/` 디렉토리를 넘기지 않아 `UniKS-UTF16-H` 같은 비임베드 한국어 표준 CMap PDF가 빈 문자열로 떨어졌고, 쪽 폭 경계 근처의 마지막 글자가 잘리는 사례가 나왔다.
3. **이미 번들된 PDFium 자산의 중복 미활용.** 앱은 이미 `@embedpdf/pdfium` (`pdfium.wasm`)을 `apps/shell/electron-builder.cjs`의 `resources/wasm/pdfium.wasm`에 싣고 `THIRD-PARTY-NOTICES.txt` 고지까지 갖춰 PDF 편집·변환·고급 인쇄에 쓰고 있었다.

## 결정

- **`packages/file-parse/src/pdf-pdfium.ts`를 신설하고 `pdfToText(bytes)`의 기본 경로를 `@embedpdf/pdfium` (`pdfium.wasm`)으로 전환한다.**
  - `pdfToText(bytes)` 공개 시그니처와 반환 계약(페이지별 `trim` 후 `\n\n` 결합)을 그대로 유지해 `parse.ts` 및 모든 호출부(첨부·파일 색인·만들기 창·지식 베이스·빠른 미리보기)가 수정 없이 새 경로를 타도록 한다.
  - 기존 워크스페이스에 호이스트된 `@embedpdf/pdfium` (`^2.15.1`)과 설치본 `resources/wasm/pdfium.wasm`을 그대로 사용해 새 바이너리·라이선스·패키징 변경을 추가하지 않는다.
- **경로 해석과 환경변수 스위치.**
  - `GENOFFICE_PDFIUM_WASM_PATH`(명시적 오버라이드) → `GENOFFICE_PDFIUM_WASM`(기존 CLI 오버라이드 호환) → `createRequire(import.meta.url).resolve('@embedpdf/pdfium/dist/pdfium.wasm')` / `@embedpdf/pdfium/pdfium.wasm` → 설치본 `join(process.resourcesPath, 'wasm', 'pdfium.wasm')` → CLI 번들 상대 경로(`../wasm/pdfium.wasm`) 순으로 찾는다.
  - `thisProgram: 'genoffice-pdf'`를 지정해 Windows 비-ASCII 경로에서 Emscripten 초기화를 보호하고, 경로별 싱글턴 `Promise` 캐시를 두어 실패 시 캐시에서 제거한다.
- **메모리·불변성·정규화 불변 규칙.**
  - 입력 `Uint8Array`는 `_malloc` + `HEAPU8.set(bytes, ptr)`로 복사만 수행해 원본 바이트와 `ArrayBuffer`를 절대 변경·이전하지 않는다.
  - `_FPDFText_ClosePage`, `_FPDF_ClosePage`, `_FPDF_CloseDocument`, `_free`를 중첩 `try/finally`로 예외 시에도 반드시 해제한다.
  - `FPDFText_GetText`의 UTF-16LE 결과에서 `\r\n`/`\r`은 `\n`으로 통일하고, PDFium이 줄 끝 하이픈-줄바꿈에 내보내는 제어문자(`U+FFFE`·`U+0002`)는 제거해 단어가 깨지지 않게 한다(일반 하이픈 `U+002D`는 유지).
- **엄격한 폴백 경계.**
  - `GENOFFICE_PDF_PDFIUM=0|off`이거나 `pdfium.wasm` 부재·초기화 실패·WASM 런타임 트랩/OOM(`PdfiumInfraError`) **일 때만** 기존 `pdfjs-dist` (`DOMMatrixPolyfill` 포함)로 안전 폴백한다.
  - 암호화 PDF(`FPDF_ERR_PASSWORD` → `password-required`), 지원하지 않는 보안 핸들러(`FPDF_ERR_SECURITY` → `unsupported`), 손상·빈 PDF(`FPDF_ERR_FORMAT`/`FILE`/`UNKNOWN` → `corrupt`)는 `PdfDocumentError`로 즉시 거절하며 절대 `pdfjs-dist`로 폴백하지 않는다. 오류 문구에 `Password-protected` / `Encrypted`를 담아 빠른 미리보기 분류(`/password|encrypted|암호/i`)와 맞춘다.

## 버린 대안

- **별도 Rust PDF 파서 크레이트(`lopdf`/`pdf-extract` 등)를 `ieum-parse-sidecar`에 추가하기.** PDF 폰트 인코딩·CMap·서브셋·ToUnicode·암호화 규격 전체를 유지보수하는 비용이 크고 바이너리·라이선스 범위가 늘어난다. 앱에 이미 실린 Chromium/PDFium WASM이 CJK CMap과 실전 PDF 호환성에서 월등히 안정적이다.
- **기존 `pdfjs-dist` 폴백 코드를 즉시 삭제하기.** `ulimit -v` 가상 메모리 제한이나 예기치 않은 환경에서 `GENOFFICE_PDF_PDFIUM=0`으로 우회할 안전 출구를 남긴다.
- **`FPDFText_GetText` 대신 content-stream 순서로 문자를 수동 재조립하기.** PDFium의 시각 좌→우 읽기 순서 정렬과 단어 간격 추론을 버리는 결과가 된다. 같은 줄 역순 런(`x=300` 후 `x=72`)은 PDFium의 시각 순서(`Hello World`)를 기본 기대값으로 삼고, 기존 스트림 순서(`World Hello`)는 `GENOFFICE_PDF_PDFIUM=0` 폴백 테스트로 보존한다.

## 결과

- 추가·변경 위치:
  - `packages/file-parse/src/pdf-pdfium.ts`, `packages/file-parse/src/pdf.ts`
  - `packages/file-parse/tests/pdf.test.ts`, `packages/file-parse/tests/pdf-pdfium.test.ts`
  - `packages/file-parse/AGENTS.md`, `docs/operations.md`, `docs/tracking/status.md`, `docs/tracking/decisions/{0160-pdfium-file-parse.md,index.md}`
- 실측 결과(Windows x64 / Node 24, `pdfjs-dist` 대비 `pdfium.wasm`):
  - 콜드 스타트(`plain-sample.pdf`): **918.3 ms → 41.1 ms (22.3×)**, RSS **105.3 MB → 79.0 MB**
  - 다쪽 한영 혼합 웜 실행(5회 평균): 10쪽 **21.4 ms → 5.3 ms (4.1×)**, 100쪽 **151.0 ms → 35.0 ms (4.3×)**, 300쪽 **426.2 ms → 101.3 ms (4.2×)**
  - 비임베드 한국어 표준 CMap(`UniKS-UTF16-H`): 기존 빈 문자열 → 정상 추출
  - 메모리 안정성: 10쪽 PDF 100회 + 암호/손상 PDF 100회 반복 후 `WASM HEAPU8` 증가 0 바이트
- `parse.ts`, `ieum-parse-sidecar`, `electron-builder.cjs`, 원본 문서 엔진(`packages/pdf2docx` 포함), UI·22개 언어 문구는 건드리지 않았다.
