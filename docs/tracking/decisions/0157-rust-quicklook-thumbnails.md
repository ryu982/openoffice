# 0157 빠른 미리보기 썸네일 추출은 HWP 5 WASM과 Rust 스트리밍 사이드카로 옮기고, stdin EOF 시 진행 작업도 즉시 취소한다

## 맥락

결정 0156에서 첨부·색인의 ZIP 문서 텍스트 추출을 `ieum-parse-sidecar`로, HWP 5 OLE2 컨테이너 처리를 `@genoffice/hwp5-wasm`으로 옮긴 뒤에도 빠른 미리보기(Quick Look, `apps/shell/src/main/quick-look/extract.ts`)의 내장 썸네일 추출 경로 두 곳은 JavaScript 구현에 남아 있었다.

1. **HWP 5 썸네일(`extractHwp5Thumbnail`)** 이 npm `cfb`로 `/PrvImage`를 직접 읽었다.
2. **ZIP 기반 문서 썸네일(`extractZipThumbnail`)** 이 `.docx`·`.pptx`·`.xlsx`·`.xlsm`·`.odt`·`.xmind`·`.hwpx` 파일 전체를 Node 메모리에 `readFile`한 뒤 JSZip으로 통째로 열어 썸네일을 찾았다. 이 때문에 50 MiB 이상 미디어가 큰 문서는 빠른 미리보기 자체가 막혀 있었고, 50 MiB 미만이라도 미리보기 한 번마다 전체 파일 크기만큼 메모리·지연이 들었다.
3. **`ieum-parse-sidecar`의 bare stdin EOF 처리(`main.rs`)** 가 정상 `shutdown` 명령이 아닌 부모 비정상 종료(stdin EOF)에서는 `pool.shutdown(false)`를 호출해, 이미 진행 중이거나 대기 중인 대용량 압축 해제 작업이 끝날 때까지 프로세스가 살아 남을 여지가 있었다.

## 결정

- **HWP 5 Quick Look 썸네일은 `@genoffice/hwp5-wasm`으로 읽는다.**
  - `apps/hwp/src/main/hwp5-file.ts`의 `ensureHwp5Wasm`·`inspectHwp5WithWasm`을 재사용해 `GENOFFICE_HWP5_WASM`, `GENOFFICE_HWP5_WASM_PATH`, `resources/wasm/hwp5_bg.wasm` 경로 해석과 SheetJS `cfb` 패딩(`0xfffffffe`) 메모리 정규화를 일치시킨다.
  - 암호화된 HWP 5(`info.encrypted`)는 즉시 거절하고, `readStream(normalized, '/PrvImage', false)`로 원시 스트림을 꺼내 이미지 매직 바이트 검사(실패 시 5 MiB 상한 내 raw deflate 해제 후 재검사)를 수행한다.
  - 기존 JS `cfb` 폴백은 `GENOFFICE_HWP5_WASM=0|off` 또는 WASM 파일 부재·초기화 실패 같은 인프라 장애 때만 허용하며, 손상·암호·스트림 부재 같은 의미적 실패에서는 절대 폴백하지 않는다.
- **ZIP 기반 Quick Look 썸네일은 `ieum-parse-sidecar`의 `extract_thumbnail` 명령으로 스트리밍 추출한다.**
  - 새 Rust 크레이트를 추가하지 않고 `ieum-parse-sidecar`에 `extract_thumbnail` 명령(JSON-RPC v1)과 순수 Rust RFC 4648 base64 인코더를 추가한다.
  - 대상 9개 확장자(`.hwpx`, ZIP `.hwp`, `.docx`, ZIP `.doc`, `.pptx`, `.xlsx`, `.xlsm`, `.odt`, `.xmind`)에서 기존 `ZIP_THUMBNAIL_CANDIDATES` 12개 경로(`Preview/PrvImage.*`, `Thumbnails/thumbnail.*`, `docProps/thumbnail.*`)를 같은 우선순위·대소문자 무시 규칙으로 탐색한다.
  - `DEFAULT_ZIP_LIMITS`(ZIP 폭탄·ZIP64·암호화 엔트리), 경로 탈출(`..`, 선두 `/`, `\`), ODT `manifest:encryption-data`, 암호화 OOXML(`EncryptedPackage`), 5 MiB 상한(`read_entry_bytes_capped`), PNG/JPEG/GIF/BMP/WebP 매직 바이트 검사를 그대로 강제한다.
  - `extractQuickLook`은 `deps.readFile`이 주입되지 않은 일반 호출에서 ZIP 파일 전체를 Node 메모리로 읽지 않고 첫 4바이트 매직만 확인한 뒤 파일 경로를 바로 사이드카에 넘긴다. 사이드카가 활성화된 경우 스트리밍 ZIP 문서의 50 MiB 크기 상한도 해제한다.
  - JSZip 폴백은 `GENOFFICE_PARSE_SIDECAR=0|off` 또는 `SidecarInfraError` 때만 허용하며, `zip_rejected`·`password_protected`·`content_mismatch`·`corrupt`·`not_found`에서는 절대 폴백하지 않는다.
- **`ieum-parse-sidecar`는 모든 종료 경로에서 `pool.shutdown(true)`를 호출한다.**
  - 정상 `shutdown` 응답을 flush한 뒤와 bare stdin EOF·stdin 오류·stdout 끊김 모두에서 대기 큐를 비우고 진행 중인 작업의 `cancelled` 플래그를 즉시 세팅한 뒤 워커 스레드를 조인하고 exit code 0으로 끝낸다. `shutdown(true)` 이후에는 워커의 뒤늦은 출력도 억제한다.

## 버린 대안

- **새 크레이트(`base64` 등)를 `ieum-parse-sidecar`에 추가하기.** 30줄 남짓의 표준 RFC 4648 인코더로 충분하며 `Cargo.lock`과 `THIRD-PARTY-NOTICES.txt` 변경을 피할 수 있다.
- **Quick Look이 여전히 `readFile`로 전체 버퍼를 읽고 사이드카에 넘기기.** 50~100 MiB 문서에서 Node 메모리 스파이크를 없앨 수 없고 IPC로 수십 MiB를 복사하게 된다. 파일 경로 기반 스트리밍 추출(`extractEmbeddedThumbnailFromFile`)이 근본 해법이다.
- **Quick Look 전용 별도 사이드카 프로세스를 띄우기.** Quick Look은 사용자 상호작용 경로이고 파일 색인처럼 120초 재시작이 필요 없으므로 기존 대화형 싱글턴(`getInteractiveParseSidecar()`, 2분 유휴 종료, 앱 종료 시 정리)을 공유하는 편이 메모리와 기동 지연 모두 유리하다.

## 결과

- 변경 위치:
  - `packages/file-parse/native/parse-sidecar/src/{protocol,zip_gate,main}.rs`, `extract/{mod,odt,thumbnail}.rs`, `src/tests.rs`, `tests/sidecar_cli.rs`
  - `packages/file-parse/src/{sidecar-client,index}.ts`, `packages/file-parse/tests/{sidecar-client,rust-risk-perf-lifecycle}.test.ts`
  - `apps/shell/src/main/quick-look/extract.ts`, `apps/shell/tests/quick-look-rust-thumbnails.test.ts`
  - `packages/file-parse/AGENTS.md`, `apps/shell/AGENTS.md`, `docs/tracking/decisions/{index,0157-rust-quicklook-thumbnails}.md`
- 실측 결과(Windows x64):
  - 64 MiB 미디어 포함 DOCX 썸네일 추출: Rust 스트리밍 사이드카(`extract_thumbnail`) **0.7 ms**(Node RSS·heap 증가 **0.0 MiB**) 대비 기존 JSZip 경로(`readFile` + `assertZipInflatesWithinLimits` + `JSZip.loadAsync`) **76.5 ms**(약 109배 빠름).
  - 60 MiB 미디어 포함 DOCX 전체 빠른 미리보기(`extractQuickLook`, 텍스트 + 썸네일 병렬 스트리밍): **421 ms**, `JSZip.loadAsync` 호출 0회.
  - 64 MiB deflate 압축 파일 40건 대기·진행 중 bare stdin EOF: 즉시 취소 후 0.72초 내 exit 0, 잔여 `ieum-parse-sidecar` 프로세스 0건.
- 원본 GenOffice 문서 엔진 8곳, `Cargo.toml`/`Cargo.lock`, 패키징·CI·고지 스크립트, UI·22개 언어 문구는 건드리지 않았다.
