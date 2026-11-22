# 0156 첨부·색인 텍스트 추출은 독립 Rust 사이드카로, HWP 5 컨테이너 보정은 Rust WASM으로 옮긴다

## 맥락

두 경로가 JavaScript 기반 처리의 한계에 걸려 있었다.

1. **첨부·파일 색인의 대용량 ZIP 문서 처리와 색인 비용.** `packages/file-parse`의 OOXML·ODT·EPUB·XMind 읽기는 JSZip으로 압축 파일을 통째로 메모리에 올린 뒤 XML을 파싱했다. 50MB를 넘는 문서에서는 글자 파트만 추려 작은 ZIP을 다시 만드는 우회(`readZipTextParts`)가 필요했고, 파일 색인(`apps/shell/src/main/file-index`)은 64MB가 넘는 문서를 본문 추출에서 제외(`name-only`)해야 했다. 또한 폴더 탐색과 본문 CJK 2-gram 토큰화까지 Node 메인/작업자 스레드에서 돌았다.
2. **HWP 5 OLE2 컨테이너의 JS `cfb` 우회 부담.** 한글 편집기와 명령줄(`hwp apply`)은 저장 보정(바탕쪽·메모 복구, 탭 너비, 필드 종류, 미리보기 갱신)과 변경 추적 스트림 제거에서 npm `cfb` 라이브러리를 썼다. 이 라이브러리는 파일에 자기 표식 스트림(`' Sh33tJ5'`)을 끼워 넣고 미사용 FAT 섹터에 `0xfffffffe`를 남겨, 매 저장마다 표식을 지우고 FAT 빈 칸을 `0xffffffff`로 손수 고쳐야 했다.

한편 이 저장소는 원본 GenOffice의 문서 엔진(`docx-engine`, `pptx-engine`, `pptx-ops`, `pptx-render`, `pdf2docx`, `xlsx-gateway`, `zip-gate`, `apps/sheets/native/xlsx-engine`)을 그대로 유지하고 개선 커밋을 골라 받아오는 구조다. 따라서 원본 엔진 패키지와 `xlsx-sidecar`에는 손을 대지 않으면서 위 두 병목만 깔끔하게 옮겨야 했다.

## 결정

- **독립 Rust 추출 사이드카(`ieum-parse-sidecar`)를 `packages/file-parse/native/parse-sidecar/`에 둔다.**
  - 원본 `xlsx-sidecar`와 완전히 분리된 별도 바이너리이며, 네트워크 크레이트를 전혀 싣지 않는 오프라인 전용 표준 입출력 JSON-RPC v1 프로세스다.
  - 스트리밍 ZIP 탐색으로 7개 ZIP 형식(`.docx`, `.xlsx`, `.xlsm`, `.pptx`, `.odt`, `.epub`, `.xmind` 및 ZIP 기반 `.doc`)과 가리기 표시가 없는 평문/표 형식(`.csv`, `.tsv`, `.xml`, `.log`, `.py`), 폴더 재귀 탐색(`scan_dir`), 색인용 본문 CJK 토큰화(`tokenize: true`, 100만 자 상한)를 담당한다.
  - PDF, HWP/HWPX, 옛 바이너리 `.doc`/`.ppt`, draw.io, 이미지, 가리기 표시가 있는 텍스트·마크업(`.md`, `.markdown`, `.txt`, `.json`, `.html`, `.htm`)과 검색 질의 동기 토큰화(`FileIndexStore.search`·`excerptsFor`)는 기존 TypeScript 경로에 남긴다.
  - **PPTX 가리기는 닫힌 쪽으로 위임한다.** 사이드카는 실행 시 호출 쪽이 넘긴 `REDACT_NS` 이름공간을 포함해 PPTX의 가리기 흔적을 감지하면 본문을 한 글자도 돌려주지 않고 `fallbackReason: "redaction_present"`만 반환한다. 그러면 `packages/file-parse`의 기존 검증된 `pptx-redaction.ts`가 원문을 가려 처리한다.
  - **프로세스 수명과 인스턴스를 둘로 나눈다.** 대화형 첨부·읽기용 싱글턴은 시간 제한 없이 동작하고 2분 유휴 시 종료되며, 파일 색인용 전용 인스턴스는 낮은 우선순위로 동시성 기본 2(최대 4)·120초 제한·제한 초과 시 해당 인스턴스만 재시작해 대화형 첨부 읽기와 간섭하지 않는다. 두 인스턴스 모두 `releaseAppResources()`와 `process.on('exit')`에서 반드시 정리한다.
  - **7개 ZIP 형식의 64MB 색인 상한을 해제한다.** 기존 DB의 `EXTRACT_VERSION`은 올리지 않고, 이전에 `name-only`로 남았던 대용량 ZIP 파일만 다음 스캔 때 점진적으로 재추출한다.
  - **폴백은 인프라 실패에 한정한다.** 바이너리 부재, 기동 실패, 프로세스 크래시, 프로토콜 깨짐, 또는 명시적 비활성화(`GENOFFICE_PARSE_SIDECAR=0|off`) 때만 기존 TypeScript 구현으로 내려간다. 암호 걸림, 매직 바이트 불일치, ZIP 폭탄·ZIP64·경로 탈출, DRM, 잘못된 인코딩 같은 의미적·보안 거절은 절대 폴백하지 않고 그대로 거절한다.
- **HWP 5 OLE2 컨테이너·레코드 처리를 미리 빌드한 Rust WASM(`packages/hwp5-wasm`)으로 옮긴다.**
  - `inspect_hwp5`, `read_stream`, `parse_records`, `rewrite_streams`, `strip_tracked_changes` 다섯 함수를 순수 메모리 연산으로 제공하고, Rust `cfb` 크레이트로 `' Sh33tJ5'` 표식과 `0xfffffffe` FAT 오염 없는 표준 OLE2 컨테이너를 생성한다.
  - 일반 빌드와 CI에서 `wasm-pack`을 요구하지 않도록 `node tools/build-hwp5-wasm.mjs`로 만든 `pkg/`와 `pkg/manifest.json`(소스·WASM SHA-256)을 저장소에 커밋하고 `tests/freshness.test.ts`로 신선도와 로컬 경로 누출을 강제한다.
  - JS `cfb` 구현은 `GENOFFICE_HWP5_WASM=0|off` 또는 WASM 파일 부재·초기화 실패 같은 인프라 장애 때만 쓰이는 폴백으로 남긴다. 컨테이너 손상·암호·배포용 등 의미적 오류에서는 폴백하지 않는다.
- **패키징·CI·고지 정책.**
  - Windows x64 설치본은 `packages/file-parse/native/parse-sidecar/target/release/ieum-parse-sidecar.exe`(MSVC 정적 CRT `+crt-static`)를 그대로 싣는다(`GENOFFICE_WIN_ARM64=1`일 때만 `aarch64-pc-windows-msvc` 경로). `xlsx-sidecar`처럼 `x86_64-pc-windows-gnu`로 수동 복사하는 절차를 두지 않는다.
  - macOS는 두 아키텍처를 합친 universal 바이너리(`native:build:universal`), Linux는 `cargo zigbuild` 기반 glibc 2.28 호환 바이너리로 패키징한다.
  - 단독 배포 CLI 묶음(`pack-tarball`)은 `wasm/hwp5_bg.wasm`을 싣고 `ieum-parse-sidecar`는 싣지 않는다.
  - `THIRD-PARTY-NOTICES.txt`는 기존 두 크레이트(`xlsx-sidecar`, `rhwp`)에 더해 `ieum-parse-sidecar`와 `hwp5-wasm` 크레이트 고지까지 총 4개 Rust 섹션을 생성한다.
  - 화면 UI, 설정 파일(`app-settings.json`), 22개 언어 문구는 건드리지 않고 환경 변수(`GENOFFICE_PARSE_SIDECAR*`, `GENOFFICE_HWP5_WASM*`)로만 제어한다.

## 버린 대안

- **`apps/sheets/native/xlsx-engine`에 문서 추출 기능을 합치기.** 원본 GenOffice의 엔진 패키지를 수정하게 되어 업스트림 동기화마다 충돌이 나고, 엑셀 계산과 첨부·색인의 수명·장애 격리도 깨진다.
- **마크다운·HTML·PPTX 가리기 로직을 Rust로 복제하기.** 가리기 규칙은 편집기와 한 치도 어긋나면 기밀이 새므로 단일 진실 원천을 유지해야 한다. 마크다운·HTML은 TypeScript 경로를 유지하고, PPTX만 닫힌 쪽 감지로 TypeScript 가리기 경로에 위임했다.
- **색인 상한 해제 시 `EXTRACT_VERSION`을 올려 전체 재색인하기.** 기존 사용자의 모든 색인 DB가 한꺼번에 비워져 CPU·디스크 부담이 크다. `name-only` ZIP 항목만 선별 재추출하면 기존 색인을 보존하면서 대용량 ZIP만 채울 수 있다.
- **JS `cfb` 코드를 즉시 삭제하기.** 배포 직후 예상치 못한 환경 문제나 WASM 메모리 제약(`ulimit -v`)이 생겼을 때 환경 변수(`GENOFFICE_HWP5_WASM=0`)로 안전하게 우회할 출구가 필요하다.
- **일반 빌드(`npm run build:all`)에서 매번 `wasm-pack` 실행하기.** `rhwp-core`와 달리 추가 도구를 모든 개발자·CI 빌드에 강제하게 된다. 커밋된 `pkg/` + `freshness.test.ts` 해시 검증이 빌드 속도와 무결성을 모두 만족한다.

## 결과

- 추가·변경한 주요 위치:
  - `packages/file-parse/native/parse-sidecar/`(`ieum-parse-sidecar` Rust 크레이트), `packages/file-parse/scripts/build-sidecar*.mjs`, `packages/file-parse/src/{sidecar-client,sidecar-path,parse,index}.ts`
  - `packages/hwp5-wasm/`(Rust 크레이트, 미리 빌드된 `pkg/`, `src/{index,node}.ts`, `tests/`), `tools/build-hwp5-wasm.mjs`
  - `apps/hwp/src/main/{hwp5-file,tracked-changes,section-tails,preview-parts}.ts`
  - `apps/shell/src/main/file-index/{extract,indexer,store}.ts`, `apps/shell/src/main/index.ts`
  - `packages/cli/src/resources.ts`, `packages/cli/pack-tarball.mjs`
  - `apps/shell/electron-builder.cjs`, `tools/gen-third-party-notices.mjs`, `tools/run-workspace-tests.mjs`, `.github/workflows/{ci,windows-build,mac-build,linux-build}.yml`
- 실측 결과(Windows x64): 20 MiB 미디어 DOCX 추출 Rust 1.2 ms 대비 TS 430.1 ms, 105 MiB 미디어 DOCX 추출 110.4 ms(전체 색인·검색 257.5 ms), 100만 자 CJK+라틴 토큰화 Rust 145.3 ms 대비 TS 219.9 ms(출력 100% 일치).
- 원본 문서 엔진 패키지(`docx-engine`, `pptx-engine`, `pptx-ops`, `pptx-render`, `pdf2docx`, `xlsx-gateway`, `zip-gate`, `apps/sheets/native/xlsx-engine`)는 단 한 줄도 수정하지 않았다.
- macOS·Linux 설치본 동작은 GitHub Actions 빌드와 사용자 보고로 확인한다.
