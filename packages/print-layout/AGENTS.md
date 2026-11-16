# print-layout

## 맡은 범위

편집기들이 함께 쓰는 고급 인쇄 배치다. 선택지의 모양과 기본값, 면 배치 계획(화면에서도 쓰는 `./plan`), 인쇄 작업 PDF의 쪽을 다시 놓는 일(한 장에 여러 쪽, 소책자, 포스터, 라벨, 홀짝, 역순, 용지 맞춤)을 맡는다. 결정 0141.

- `./plan`(`src/plan.ts`): 선택지 형과 값 목록, `createDefaultOptions`, `isDefaultOptions`(새 길로 갈지), `changesSheetArrangement`(면 배치가 바뀌는지, 미리 보기를 배치도로 바꿀지), `validateOptions`, 라벨 규격 목록과 `validateLabelSpec`, 용지 크기, `planSheets`(면 계획).
- `.`(`src/index.ts`): `./plan`의 모든 것과 `arrangePrintJob`(인쇄 작업 PDF → 배치한 PDF), `readJobPageSizes`, 뒷단 전용 모듈(`src/backend.ts`): PDFium으로 쪽 그림 만들기(`rasterizePdf`, `rasterDpiFor`), 회색 그림 PDF(`grayscalePdf`), 인쇄용 가로 면 돌리기, 작업 스레드에서 도는 그림 작업(`runRasterJob`, `serveRasterJob`), PNG 쓰기(`encodePng`).

## 맡지 않는 것 (경계)

- 프린터로 보내기와 숨은 창은 `packages/electron-utils`의 인쇄 모듈이 한다.
- 배치 계산(`arrangePrintJob`)은 회색조와 dpi를 선택지로 실어 나르기만 하고 쓰지 않는다. 회색조와 쪽 그림은 뒷단 전용 모듈이 한다.
- 화면 부품과 문구는 `packages/ui`가 한다. 여기에는 화면 문구가 없다. 오류는 까닭 코드(`PrintLayoutErrorCode`)로 돌려주고, 화면이 코드를 자기 문구로 바꾼다.
- `apps/pdf/src/main`의 모아찍기·뽑기 함수는 원본에서 온 코드라 가져다 쓰거나 고치지 않는다. 계산이 겹쳐도 여기서 따로 쓴다.
- 다른 작업 공간 패키지를 가져오지 않는다. `electron-utils`와 `ui`가 이 패키지를 가져오는 방향만 있다.

## 항상 지켜야 하는 것

- `./plan`이 끌어오는 파일(`plan.ts`, `errors.ts`, `geometry.ts`, `paper.ts`, `labels.ts`, `options.ts`, `sheet-plan.ts`)은 이 패키지 안의 상대 경로만 가져온다. Node 내장 모듈, Electron, pdf-lib를 넣지 않는다. 화면 번들에 그대로 들어간다. `tests/plan-imports.test.ts`가 가져오기 나무를 따라가며 지킨다. pdf-lib·PDFium·Node 모듈은 뒷단 전용 모듈(`arrange.ts`, `grayscale.ts`, `raster*.ts`, `pdfium.ts`, `png.ts`)에서만 쓰고, `./plan`에서 그것들을 가져오지 않는다.
- `isDefaultOptions`가 보는 값은 spec 3절의 일곱 가지(배치 방식, 면 고르기, 역순, 용지, 용지에 맞춰 줄이기, 회색조, dpi)뿐이다. 고르지 않은 배치 방식의 하위 값(쪽 수, 포스터 장 수 등)은 보지 않는다. 이 목록을 바꾸면 모든 편집기의 "지금 경로로 찍는가"가 바뀐다.
- 선택지가 면 배치를 바꾸지 않으면(`changesSheetArrangement`가 거짓: 기본값이거나 회색조·dpi만 바꿈) `arrangePrintJob`은 받은 바이트를 그대로 돌려준다. 다시 쓰지 않는다.
- 쪽은 그림으로 바꾸지 않는다. 원래 쪽을 폼 XObject로 넣어(`embedPages`) 글자는 글자로 남는다. 칸마다 칸 상자로 잘라(clip) 그린다.
- 홀짝은 배치를 마친 **면** 번호(배치 결과의 첫 면이 1)로 거른다. 문서 쪽 번호가 아니다. 그다음 역순이다.
- 라벨 규격 목록과 규격 id에 회사 이름이나 제품 번호를 적지 않는다. id는 칸 배치와 크기만 적는다(`a4-3x7-63.5x38.1`). 첫 항목이 규격 고르기를 열 때 골라지는 기본이다.
- 값 검사는 고른 배치 방식의 하위 값만 엄격하게 본다. 고르지 않은 방식의 값은 쓸 수 있으면 그대로, 아니면 기본값으로 실어 둔다(화면이 방식을 바꿔도 값을 잃지 않게).
- `validateOptions`는 던지지 않고 `{ ok, options | error }`를 돌려준다. `planSheets`와 `arrangePrintJob`은 같은 코드를 가진 `PrintLayoutError`를 던진다. 화면에서 IPC로 온 값도 그대로 넣어 검사할 수 있다(빠진 값은 기본값).

## 이 모듈의 방식

- 계획의 좌표는 pt이고, 면의 왼쪽 위가 원점이며 y는 아래로 커진다(화면 배치도가 그대로 쓴다). PDF로 그릴 때만 아래 원점으로 바꾼다.
- 계획의 입력은 인쇄 작업의 쪽 크기 목록이다(쪽 회전 표시를 반영한 보이는 크기). `readJobPageSizes`가 PDF에서 같은 값을 읽는다. 보이는 상자는 CropBox와 MediaBox가 겹치는 부분이고, `embedPages`에 그 상자를 직접 넘긴다. pdf-lib의 기본값은 MediaBox의 왼쪽 아래를 (0, 0)으로 가정해서, 원점이 0이 아닌 쪽이 어긋난다.
- 칸마다 `box`(그 칸이 차지하는 곳, 잘라 그리는 상자)와 `content`(쪽 전체가 놓이는 곳)를 둔다. 포스터 조각과 용지에 맞추지 않은 큰 쪽은 `content`가 `box` 밖으로 나가고, 나간 부분은 잘린다. 포스터는 조각마다 같은 쪽을 통째로 옮겨 그린다.
- 면의 방향: 한 장에 여러 쪽은 첫 쪽이 한 칸에 가장 크게 들어가는 방향(긴 쪽에 칸이 많다), 소책자는 두 쪽을 나란히 놓았을 때 가장 큰 방향, 포스터는 첫 쪽이 포스터 전체에 가장 크게 들어가는 방향이다. 비기면 소책자는 가로, 나머지는 첫 쪽의 방향을 따른다. 한 장에 한 쪽에 용지를 고르면 쪽마다 쪽의 방향을 따른다. 라벨은 규격 종이를 세로로 쓴다.
- 쪽 크기가 섞이면 각 쪽을 자기 칸에 비율을 지켜 맞춘다(한 장에 여러 쪽·소책자·라벨은 키우기도 한다). 한 장에 한 쪽의 용지 맞춤만 키우지 않는다.
- B4·B5는 JIS 크기(257×364, 182×257mm)다. 워드 편집기의 쪽 설정과 같다.
- 포스터 겹침이 면보다 크면(아주 작은 쪽을 문서 크기 그대로 쓸 때) `poster-overlap-too-large`로 거절한다. 홀짝 거르기로 남는 면이 없으면 `arrangePrintJob`이 `no-faces`로 거절한다. `planSheets`는 빈 `output`을 돌려준다.
- 내용 스트림이 없는 쪽은 넣을 수 없어(pdf-lib가 저장할 때 던진다) 빈 칸으로 둔다.

## 쪽 그림과 회색조(뒷단 전용)

- 쪽 그림은 `@embedpdf/pdfium`(WebAssembly)으로 한 쪽씩 만들고, 문서 전체의 그림을 메모리에 모으지 않는다. `pdfium.wasm`은 개발·시험에서는 `node_modules`에서, 설치본에서는 `process.resourcesPath/wasm/pdfium.wasm`(`apps/shell/electron-builder.cjs`의 extraResources)에서 찾는다.
- dpi `auto`는 PDF 편집기의 지금 인쇄 규칙(200dpi, 전체 화소 예산을 넘으면 150dpi까지)을 따른다. 사용자가 고른 숫자는 낮추지 않고 막지도 않는다.
- 인쇄용 그림에서만 가로 면(너비가 높이보다 큰 면)을 시계 방향 90°로 돌린다. 미리 보기 그림과 저장 PDF는 돌리지 않는다.
- 회색 그림 PDF는 면마다 DeviceGray 그림 하나만 든 쪽이다(글자 객체가 남지 않는다). 회색조로 인쇄할 때는 이 그림을 다시 그리지 않고 그대로 쓴다.
- 그림 작업은 앱에서는 작업 스레드(`packages/electron-utils/src/print-layout-worker.ts`)에서 돌고, 시험에서는 같은 함수를 호출한 스레드에서 바로 부른다.

## 테스트

- 패키지 폴더에서 `npx vitest run`, 또는 `npm run test -w @genoffice/print-layout`. 픽스처 파일은 없다.
- `tests/arrange.test.ts`는 시험 안에서 pdf-lib로 인쇄 작업 PDF를 만든다. 쪽마다 가운데에 표식(`P1`…), 회전 전 왼쪽 아래 구석에 작은 표식(`Q1`…)을 글자 원점이 그 자리에 오게 쓴다. 결과는 PDF.js(`pdfjs-dist/legacy/build/pdf.mjs`)의 글자 위치로 면 수, 면 크기, 어느 칸에 어느 쪽이 있는지 판정한다. 구석 표식으로 배율과 회전을 본다.
- PDF.js는 쪽 밖에 놓인 글자를 글자 목록에서 뺀다. 포스터 조각처럼 표식이 면 밖에 오는 경우는 "없음"을 확인한다(`expectAtOrOff`).
- 재단선은 결과 쪽의 내용 스트림을 풀어 `m … l` 선을 읽어 확인한다(`readLines`).
- `tests/plan.test.ts`는 PDF 없이 계획과 값 검사를 본다. 소책자 순서, 칸 모양, 홀짝·역순, 까닭 코드, 라벨 규격이 종이 안에 드는지가 여기 있다.
