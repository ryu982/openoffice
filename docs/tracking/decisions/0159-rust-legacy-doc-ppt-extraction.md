# 0159 옛 바이너리 Office(`.doc`·`.ppt`) 첨부·색인 텍스트 추출을 `ieum-parse-sidecar`로 옮긴다

## 맥락

결정 0156에서 7개 ZIP 형식과 가리기 없는 평문/표 형식을 독립 Rust 추출 사이드카(`ieum-parse-sidecar`)로 옮긴 뒤에도, 옛 바이너리 Office 97-2003 형식(`.doc`·`.ppt`)은 JavaScript 라이브러리(`word-extractor`, `ppt-to-text` + npm `cfb`) 경로에 남아 있었다.

1. **메모리·경계 검사 취약성.** 두 JS 라이브러리는 OLE2 파일 전체를 Node 메모리에 올린 뒤(`Pictures`·`SummaryInformation` 등 대용량 비텍스트 스트림 포함) FIB/PieceTable·레코드 오프셋을 느슨하게 읽어, 비정상 오프셋이나 악성 중첩·순환 편집 체인에 대한 경계 방어가 부족했다.
2. **암호·구버전 판별 일관성 부재.** 암호화된 `.doc`(`FibBase.fEncrypted`)·`.ppt`(`CurrentUserAtom` `0xF3D1C4DF`, `EncryptedSummary`, `RT_CryptSession10Container`), Word/PowerPoint 97 미만 구버전(`nFib < 0x00C1`, `PP40` 등)을 사이드카의 구조화된 거절(`password_protected`, `corrupt`)로 일관되게 막을 필요가 있었다.
3. **색인 통합.** `.ppt`는 `SIDECAR_EXTS`에 빠져 있었고 OLE2 `.doc`은 사이드카가 `fallback: unsupported_format`을 돌려보내 매번 Node 워커와 JS 파서를 거쳐야 했다.

## 결정

- **`ieum-parse-sidecar`에 `cfb = "0.15"`(MIT, `packages/hwp5-wasm`과 동일 버전, 네트워크 크레이트 0개)를 추가하고 OLE2 `.doc`·`.ppt` 텍스트 추출을 네이티브 Rust로 구현한다.**
  - 공용 OLE2 계층(`src/extract/ole.rs`)은 `cfb::CompoundFile::open(File)`로 필요한 텍스트 스트림만 선택 읽기(스트림당 128 MiB 상한, `cancelled` 원자 플래그 협조 취소)하고, 표준 컨테이너에서는 파일 전체를 메모리에 올리지 않는다. SheetJS `cfb` 등이 미사용 FAT/MiniFAT 슬롯을 `0xFFFFFFFE`로 패딩한 컨테이너만 감지 시 미사용 슬롯을 `0xFFFFFFFF`로 정규화해 연다(진짜 손상 컨테이너는 그대로 `corrupt` 거절).
  - **`.doc` (`src/extract/doc.rs`)**: ZIP 매직(`PK`) `.doc`은 기존처럼 `docx::extract_docx`로 읽는다. OLE2 `.doc`은 `WordDocument` + `0Table`/`1Table`만 읽어 `FibBase`(`wIdent == 0xA5EC`, `nFib 0x00C1..=0x0112`), `FibRgW97`, `FibRgLw97`, `FibRgFcLcb97`, CLX(`Prc` 스킵 + `Pcdt`/`PlcPcd` 피스 경계·단조 증가·예약 비트 검증)를 파싱한다. 기존 `packages/file-parse/src/doc.ts`(`word-extractor`)와 동등하게 본문과 본문 텍스트상자(머리글·바닥글 및 머리글 텍스트상자 제외)를 추출하고, `PlcfbteChpx` 변경 추적 삭제(`sprmCFRMarkDel`), `PlcfbtePapx` 표 행 끝(`sprmPFTtp`), 중첩 필드(`\x13...\x14result\x15`), CP1252/UTF-16LE 디코딩(`filterUnicode: false`)을 처리한다.
  - **`.ppt` (`src/extract/ppt.rs`)**: `.ppt` 이름의 ZIP 등 비-OLE2 매직은 기존 계약대로 `content_mismatch`로 거절한다. OLE2 `.ppt`는 `Current User`(`RT_CurrentUserAtom`) → `RT_UserEditAtom` 편집 체인(최대 1,024회, 순환 탐지) → `RT_PersistDirectoryAtom`으로 최신 세대 `persistId -> offset` 맵을 구축하고, `DocumentContainer`의 `RT_SlideListWithText`(슬라이드 `instance 0`, 노트 `instance 2`, 마스터 `instance 1` 제외)와 각 `RT_Slide`/`RT_Notes`의 `OfficeArt` 도형 트리(재귀 깊이 상한 64)에서 UTF-16LE(`TextCharsAtom`)·CP1252(`TextBytesAtom`)·`OutlineTextRefAtom` 텍스트를 추출한다. 슬라이드마다 `## Slide N` 섹션을 만들고 발표자 노트가 있으면 `### Notes` 블록을 붙인다.
  - **보안·거절 경계(절대 TS 폴백 금지)**:
    - `password_protected`: `.doc` `FibBase.fEncrypted` / `EncryptedPackage`, `.ppt` `CurrentUserAtom` `0xF3D1C4DF` / `UserEditAtom.encryptSessionPersistIdRef != 0` / `RT_CryptSession10Container(0x2F14)` / `EncryptedSummary`·`EncryptedPackage`.
    - `corrupt`: 손상된 OLE2, 필수 스트림 부재, 128 MiB 상한 초과, Word/PPT 97 미만 구버전(`nFib < 0x00C1`, `PP40` 등), 비정상 오프셋·길이·순환·깊이 초과.
    - `content_mismatch`: 매직 바이트 불일치(ZIP `.ppt` 포함).
  - `maxChars`(UTF-16 코드 단위 예산, `0` 포함)와 색인용 `tokenize: true` CJK 토큰화를 기존 `extract_file` 규약과 동일하게 지원한다.
- **TS 연동과 인프라 폴백 경계를 유지한다.**
  - `packages/file-parse/src/parse.ts`의 `SIDECAR_EXTS`에 `'ppt'`를 추가하고 `.doc`(OLE2)도 사이드카가 직접 처리하도록 연결한다(`apps/shell/src/main/file-index/indexer.ts`는 `SIDECAR_EXTS`를 그대로 import해 자동 연동).
  - 기존 `doc.ts`·`ppt.ts`·`vendor.ts`와 npm 의존성(`word-extractor`, `ppt-to-text`, `cfb`)은 `GENOFFICE_PARSE_SIDECAR=0|off` 또는 `SidecarInfraError`(바이너리 부재·크래시·프로토콜 오류) 전용 폴백으로 유지하고 `packages/file-parse/package.json`은 수정하지 않는다.

## 버린 대안

- **기존 `packages/doc2docx`·`packages/ppt2pptx`로 텍스트를 변환·추출하기.** 편집용 전체 변환 파이프라인은 서식·도형·그림까지 해석하므로 첨부·색인용 경량 추출 목적과 맞지 않고 Node 힙과 지연이 크다.
- **npm `word-extractor`·`ppt-to-text`를 즉시 제거하기.** 배포 초기 환경 장애나 `GENOFFICE_PARSE_SIDECAR=0` 우회 경로를 안전하게 유지하려면 기존 TS 구현을 인프라 폴백으로 남겨 두어야 한다.
- **SheetJS `cfb`의 `0xFFFFFFFE` FAT 패딩을 거부하기.** 일부 서드파티 도구가 생성한 OLE2 파일이 미사용 FAT 슬롯을 `0xFFFFFFFE`로 채우므로, 미사용 슬롯만 한정 정규화해 정상 문서는 읽되 실제 FAT 손상은 거절하는 편이 안전하다.

## 결과

- 변경 위치:
  - `packages/file-parse/native/parse-sidecar/{Cargo.toml,Cargo.lock}`, `src/extract/{ole,doc,ppt,mod}.rs`, `src/tests.rs`, `tests/sidecar_cli.rs`
  - `packages/file-parse/src/parse.ts`, `packages/file-parse/tests/{legacy-doc-ppt,sidecar-fallback}.test.ts`
  - `packages/file-parse/AGENTS.md`, `docs/tracking/status.md`, `docs/tracking/decisions/{index,0159-rust-legacy-doc-ppt-extraction}.md`
- 실기기 검증(Windows x64, 빌드된 `@genoffice/shell` Electron 앱):
  - 홈 파일 색인·검색에서 실픽스처 `.doc`/`.ppt`, 한글 본문·텍스트상자 `.doc`, 한글·CP1252·발표자 노트 `.ppt`가 색인·검색되고, 제외된 머리글·암호화 `.doc`/`.ppt`·ZIP 위장 `.ppt`는 0건 비노출 확인.
  - 빠른 미리보기(`aiOfficeQuickLookHome.preview`)에서 `.doc` 블록·`.ppt` 슬라이드/노트 미리보기와 암호화 `.doc`/`.ppt`의 `encrypted` 판정 확인.
  - 실행 중 `ieum-parse-sidecar.exe` 2개(대화형·색인 전용) 기동 및 앱 종료 후 잔여 프로세스 0건 확인.
- 원본 GenOffice 문서 엔진 8곳, `packages/doc2docx`·`packages/ppt2pptx`·`packages/compound-file`, `packages/file-parse/src/pdf.ts`, `package.json`/`package-lock.json`, 패키징·CI·고지 스크립트, UI·설정·22개 언어 문구는 건드리지 않았다.
