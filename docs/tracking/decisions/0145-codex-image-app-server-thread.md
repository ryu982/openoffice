# 0145 — Codex 그림은 app-server의 일회용 스레드로 만들고 응답의 `result`로 받는다

## 맥락

사용자는 다른 프로그램에서 Codex로 그림을 만들어 슬라이드·워드 문서에 넣어 쓰고 있었다. 이음오피스에서는 같은 일이 되지 않았다. 결정 0076의 길(`codex exec` 한 번)은 이 PC에서 Plus 계정으로 돌려 보면 늘 실패했다(2026-11-14, codex-cli 0.166.0). 까닭은 둘이었다.

1. **`codex exec`는 사용자의 Codex 개인 설정을 그대로 따른다.** 이 PC의 설정은 꺼진 로컬 중계 주소(`openai_base_url`)를 가리켜, 3분 동안 다시 연결만 하다 끝났다. 같은 실행에서 개인 설정의 훅이 돌았다("hook: Stop Failed"). MCP 서버도 꺼지지 않았다. 절대 규칙 3("앱이 끌 수 있는 도구는 모두 끈다")에 어긋난다.
2. **설정을 무시하게 해도(`--ignore-user-config`) 그림을 받아 오지 못한다.** 그림은 만들어지고 한도도 쓰였다. 그러나 Codex가 `~/.codex/generated_images`의 파일을 앱의 임시 폴더로 복사하는 단계를 자기 격리 규칙으로 막았다("blocked by policy"). 앱은 파일을 찾지 못하고 매번 실패로 끝났다.

앱이 채팅에 쓰는 Codex 연결(`codex app-server`)로 그림을 요청하면 결과가 달랐다(2026-11-14). 조건은 채팅과 같았다. 앱의 설정 덮어쓰기, MCP 끔과 그 확인, 일회용 스레드, 읽기 격리다. Windows에서는 권한 프로필이 거절되어("elevated Windows sandbox requires effective :root read access") 채팅처럼 읽기 전용 격리로 내려갔다. 그림은 `imageGeneration` 항목의 `result`에 base64 PNG로 바로 왔다. 새 그림은 약 12초, 약 900KB였다. 첨부 그림(`localImage` 입력)의 배경 지우기는 약 31초가 걸렸고, 실제로 투명한 PNG가 왔다(모서리 알파 0, 가운데 254). 그림 항목에는 `transparentBackground: true`와 받은 입력 그림이 적혀 있었다.

조사 처음에 이 PC의 Codex는 무료 요금제였다. 그때 Codex는 그림 도구를 내주지 않았다("이미지 생성 도구를 사용할 수 없어…"). 결정 0006이 끝까지 확인하지 못한 것과 같은 상황이다. 사용자가 Plus 계정으로 다시 로그인한 뒤 위의 확인을 했다.

2026-11-15에 하나를 더 확인했다. 스레드를 열 때(`thread/start`) 준 `config.features` 표는 그 스레드에서 프로세스를 띄울 때 준 `features` 값을 **통째로 바꾼다**. 그림 도구 하나(`{ image_generation: true }`)만 주었더니 사용자의 훅과 플러그인 MCP 서버가 되살아났다(`codex_apps`, `cua_repl`이 뜨고 개인 설정의 훅이 돌았다). 끄는 값을 모두 담은 표(훅·플러그인·앱·메모리 끔, 그림 도구 켬)를 주었더니 아무것도 뜨지 않았고 그림은 그대로 왔다. 이때 프로세스는 `features.image_generation=false`로 띄웠고, 스레드의 표가 그 스레드에서만 켰다.

채팅을 바로 연결한 ChatGPT(결정 0081)로는 그림을 만들 수 없다. OpenAI가 "Sign in with ChatGPT"의 요금제 사용에서 그림 생성을 지원하지 않는다고 적어 두었다. 직접 호출과 그 토큰으로 쓰는 Codex 연결 모두다(https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations). 같은 ChatGPT 계정으로 Codex 프로그램에 로그인하면 그 요금제로 그림이 된다.

## 결정

**Codex 그림은 app-server의 일회용 스레드에서 만든다.** 0076의 `codex exec` 방식을 대체한다.

- `@genoffice/ai-provider`의 `generateCodexImage`가 그림 한 장을 만든다. 채팅과 같은 app-server 프로세스에서, 그림 한 장마다 새 일회용(`ephemeral`) 스레드를 연다. 그림 전용 프로세스는 따로 띄우지 않는다.
- 결과는 그 턴에서 처음 완료된 `imageGeneration` 항목의 `result`(base64)다. 여러 장이 와도 첫 장만 쓴다. `savedPath`는 읽지 않는다. `result`가 비고 `fileId`만 있으면 데이터를 받을 수 없는 판으로 보고 `needs-update`로 답한다. 받은 바이트는 25MB까지이고, `generateImageTool`이 생성 그림 저장소에 넣어 `file://` 주소로 돌려준다.
- 시작 조건: Codex가 이 앱에서 꺼져 있지 않다(결정 0114). 로그인 방식이 구독이다. 종량 로그인과 알 수 없는 방식은 `unavailable`이다. 설치된 Codex가 0.166.0 이상이다. 낮으면 `needs-update`이고 다른 경로로 넘어가지 않는다. 판을 읽지 못하면 그대로 진행한다.
- 그림 스레드의 모델은 사용자가 지정한 모델, 설정의 Codex 모델, Codex의 기본 모델 순이다. 생각 깊이는 그 모델이 받는 가장 낮은 단계다.
- 시간 제한은 5분이다. 취소나 시간 초과면 턴을 멈추고(`turn/interrupt`) 스레드와 그 호출의 임시 폴더를 지운다. 프로세스는 채팅처럼 쓰이지 않으면 끝난다.
- Codex가 보내는 한 줄의 JSON 상한을 4 MiB에서 40 MiB로 올렸다. 그림 한 장이 base64 한 줄로 오기 때문이다.

**스레드마다 `features` 표 전체를 준다.** 위의 확인대로 스레드의 표는 띄울 때의 값을 바꾼다. 그래서 모든 스레드가 `CODEX_CONFIG_OVERRIDES`의 `features` 값을 모두 다시 적은 표를 준다(`codexThreadFeatures`). 그림 도구는 그림 스레드에서만 켜고 나머지 스레드에서는 끈다. 권한 프로필로 시작할 때와 읽기 전용 격리로 내려갈 때 모두 같다.

**채팅 스레드에서는 Codex의 그림 도구를 끈다.** 채팅에 쓰는 app-server는 `-c features.image_generation=false`를 더해 띄운다. 그림 스레드가 아닌 스레드(채팅과 연결 확인)는 표에서도 그림 도구를 끈다. 이전에 배포한 채팅 길은 이 도구를 끄지 않았다. 실제로 채팅 중에 그림이 만들어진 일이 있었는지는 확인하지 않았다. 에이전트 모드의 실행 인자는 그대로다.

**이것은 절대 규칙 3의 예외다.** 그림 한 장을 위한 일회용 Codex 스레드에서 그림 도구 하나만 켠다. 나머지 잠금은 채팅과 하나도 다르지 않다. 설정 덮어쓰기(훅·플러그인·앱·메모리 끔, `notify` 비움, 기록 없음, `model_provider="openai"`, `openai_base_url=""`, 웹 검색 끔), MCP 서버를 이름으로 모두 끄고 붙은 서버가 0개일 때만 진행하는 확인, 같은 권한(권한 프로필, 안 되면 읽기 전용 격리), 승인 정책 `never`다. 그림 스레드가 읽을 수 있는 사용자 경로는 그 호출의 임시 폴더뿐이다. 저장소 주인이 승인했고, `CLAUDE.md`·`AGENTS.md`의 규칙 3에 적었다.

**그림 고치기(참조 그림)를 Codex 길에서도 받는다.** 모델이 도구에 준 참조만 `loadMediaReferences`로 읽는다(개수·크기 예산, 주소 검사, 로컬 경로 허용 목록). 읽은 바이트를 그 호출의 임시 폴더에 쓰고 `localImage` 입력으로 넘긴다. 앱이 문서에서 다른 그림을 더 꺼내 보내지 않는다. 투명을 요청했는데 그림 항목의 `transparentBackground`가 참이 아니면 그 그림을 넣지 않고 오류로 답한다.

**모델 이름은 지정할 수 있지만 경로는 바꾸지 않는다.** `generate_image`, 명령어 `image --model`, MCP 그림 도구의 `model`이 같은 뜻이다. 사용자가 모델을 말했을 때만 넣는다.

- 경로(Codex인지 어느 키 제공자인지)는 언제나 설정이 정한다. 키 제공자는 돈이 드는 길이라, AI가 대화를 해석해 그쪽으로 옮기면 절대 규칙 2에 닿는다.
- Codex 경로에서는 `gpt-image`로 시작하는 이름을 먼저 본다. 그대로 그리고 "Codex 길에서는 Codex가 그림 모델을 정한다"는 메모를 단다. 다음으로 Codex의 모델 목록(`model/list`)에 있으면 그 스레드에 그 모델을 쓴다. 키 제공자의 그림 모델이면 그리지 않고 "그림 제공자는 설정 → AI → 고급에서 바꾼다"고 답한다. 어디에도 없으면 그리지 않고 Codex의 모델 목록을 알린다.
- 키 경로에서는 그 제공자의 그림 모델 목록이나 저장한 그림 모델과 같으면 그 요청에만 그 모델을 쓴다. 설정은 바뀌지 않는다. 다른 제공자의 모델이거나 모르는 이름이면 그리지 않고 쓸 수 있는 모델을 알린다.
- 그리지 않는 판정은 Codex 턴이나 키 요청을 시작하기 전에 한다. 그래서 한도를 쓰지 않는다. 모델 목록 읽기는 모델 호출이 아니라서 자동 호출의 차례와 장부를 거치지 않는다. 이름은 앞뒤 공백을 빼고 대소문자를 가리지 않고 비교한다. "model 옵션은 무시됐다"는 예전 메모는 없앴다.

**ChatGPT 요금제의 말로 안내한다.** 대부분의 사용자는 Codex보다 ChatGPT를 안다.

- 설정 → AI → 고급 → AI 미디어 및 검색 → 이미지 생성의 Codex 선택지 이름은 "ChatGPT 요금제(Codex 프로그램)"이다. 설명에는 Codex 프로그램에 로그인한 ChatGPT 요금제(Plus 이상)로 그린다는 것과, 앱에서 바로 연결한 ChatGPT로는 OpenAI가 그림 생성을 허용하지 않는다는 것을 적는다.
- ChatGPT 직접 연결은 연결됐는데 Codex가 구독으로 연결되지 않았고, 도구 가용성 보고(`ai:tool-capabilities`)가 그림 생성을 "쓸 수 없음"으로 답하면 그 칸에 안내 한 줄과 "Codex 연결하기" 단추를 보인다. 단추는 설정 → AI의 Codex 카드로 옮겨 갈 뿐 아무것도 시작하지 않는다.
- 모델에게 주는 "그림 생성을 쓸 수 없음" 안내와 도구의 `unavailable` 문장(`imageGenerationUnavailableMessage`)에는 늘 한 문장을 넣는다. 사용자가 ChatGPT 요금제를 쓴다면 같은 계정으로 Codex 프로그램을 연결해야 그림을 만들 수 있고, 바로 연결한 ChatGPT로는 OpenAI가 허용하지 않는다는 뜻이다. 누구에게나 사실이라 조건 없이 넣는다.

**무료 요금제는 그 프로세스에서 Codex 그림 길을 숨긴다.** 그림 없이 턴이 끝났고 계정 요금제가 `free`면 `unavailable`로 답하고 `setCodexImageGenerationAvailable(false)`를 부른다. 앱은 다시 켤 때까지, 명령어는 그 명령 하나 동안이다. 요금제 이름으로 미리 막지는 않는다. 그 밖의 이유로 그림이 오지 않으면(내용 거절, 한도가 아닌 실패, 그림 없이 끝남) `errorCode` 없이 Codex의 까닭을 짧게 전하고 길은 숨기지 않는다.

**명령어와 MCP도 이 길을 쓴다.** `packages/cli`의 `runCli`가 명령마다 생성기를 등록하고 가용성을 켠다(`registerCodexImageRoute`). 등록은 아무것도 띄우지 않는다.

- 자동 호출 규칙은 그대로다. 스위치와 지금 판의 동의(`headlessSubscriptionConsentVersion` ≥ 2)가 있어야 구독을 쓰고, 데이터 폴더의 잠금으로 하나씩 돌며, 장부에 시작 시각을 남긴다.
- **동의 판은 올리지 않는다.** 올리면 PDF 작업 때문에 스위치를 켠 사람들의 스위치가 모두 꺼진다. 그림도 "구독 한도를 자동 호출에 쓴다"는 같은 범위다. 스위치 옆 경고에는 "그림 생성"을 예로 덧붙였다.
- 결정 0143의 "AI 끄기"는 명령어·MCP에 걸지 않는다(그 결정 그대로). 결정 0114의 "Codex 끄기"는 건다.
- 업그레이드 뒤 그림 제공자가 기본값(Codex)이고 스위치를 켠 명령어 사용자는 키 제공자 대신 Codex로 그리게 된다. 바꾸지 않고 다음 버전 소식에 알린다.

**그림 요청의 사용량도 AI 창에 보인다.** 그림 요청은 채팅 스트림이 아니라서 사용량 조각을 받을 창이 없다. 앱 메인(`apps/docs`의 `registerCodexImageBackend`)이 생성기에 사용량 함수를 넘기고, 그 함수는 받은 값(`IpcSubscriptionUsage[]`)을 살아 있는 모든 창에 `ai:subscription-usage-update`로 보낸다. AI 창이 있는 열 편집기가 구독 다리의 `onUsage`와 공용 부품 `useSubscriptionUsageUpdates`(`packages/ui`)로 이 알림을 듣고 지금의 사용량에 합친다. 사용량은 계정 전체의 값이라 그림을 요청하지 않은 창도 갱신된다. 명령어 경로는 사용량 함수를 넘기지 않는다.

**Codex가 남기는 사본은 건드리지 않는다.** Codex는 그림마다 `~/.codex/generated_images`에 사본을 남긴다(한 장에 약 0.4~1MB). Codex 자신의 동작이다. `~/.codex`는 보호 폴더라 앱은 그 폴더를 읽지도 지우지도 않고, 개인정보 안내와 도움말에 그 사실을 적는다.

**도중에 Codex를 끄거나 로그아웃해도 이미 시작한 그림은 끝까지 간다.** 채팅과 같은 규칙이다(결정 0114, 2026-11-15 저장소 주인 결정). 그 뒤부터 Codex를 쓰지 않는다. 앱을 끄면 그 요청은 오류로 끝난다.

같은 작업에서 한글·PDF 편집기의 AI 창에 웹 검색(`web_search`)을 넣었다. 다른 편집기와 같은 도구이고 같은 인터넷 도구 스위치와 드라이브 차단을 지난다. 명령어 `hwp apply`는 이 도구를 앱에서만 되는 도구로 거절하고 `ieumoffice search`를 쓰라고 답한다.

## 택하지 않은 것

- **`codex exec`를 그대로 두고 `--ignore-user-config`를 붙인다.** 개인 설정 문제는 풀리지만, 그림을 앱 쪽으로 복사하는 단계가 Codex 격리에 막혀 여전히 그림을 받지 못한다. 실제로 시험해 실패했다.
- **`savedPath`의 파일을 읽는다.** `~/.codex`는 보호 폴더이고 앱은 그 안을 읽지 않는다(`docs/security.md`). 데이터가 응답에 오니 읽을 까닭도 없다.
- **Codex가 남긴 사본을 앱이 지운다.** 같은 까닭으로 `~/.codex`에 쓰지 않는다. 사본이 남는다는 것을 알린다.
- **바로 연결한 ChatGPT로 그림을 만든다.** OpenAI가 그 요금제 사용에서 그림 생성을 지원하지 않는다. 비공개 주소를 쓰는 길은 결정 0081·0117이 금지한다.
- **채팅 모델이 Codex를 직접 실행한다.** 채팅 모델에게 프로그램 실행을 주지 않는 것이 앱의 규칙이다(예외는 에이전트 모드). 모델은 앱의 `generate_image`를 부르고, 앱이 Codex를 부른다.
- **모델 이름으로 경로(제공자)를 바꾼다.** 키 제공자는 돈이 드는 길이다. 사용자가 고르지 않은 요금 경로로 갈 수 있다. 사용자가 "경로는 바꾸지 않는다"를 골랐다.
- **그림 전용 app-server 프로세스를 따로 띄운다.** 시험 사용자 PC는 8GB다. Codex 상주 프로세스가 둘이 될 수 있다. 스레드 단위로 그림 도구를 켜고 끄는 것이 실제로 되므로(위 확인) 같은 프로세스를 쓴다.

## 결과

- 채팅을 어느 AI로 하든(Claude, Codex, 키 제공자) 그림 요청은 사용자의 ChatGPT 요금제(Codex 프로그램)로 만들어진다. 이미 있는 그림도 고친다. 명령어·MCP로 부르는 다른 AI 프로그램도 같은 길을 쓴다.
- `packages/ai-search/src/codex-image-cli.ts`와 그 시험은 지웠다. 새 생성기는 `createCodexImageGenerator`(`src/codex-image-subscription.ts`), 모델 이름 규칙은 `src/image-model.ts`에 있다. 등록된 생성기는 그림 만들기(`generate`)와 Codex 모델 목록(`models`)을 가진다. Codex를 이 앱에서 끄면 목록도 묻지 않는다.
- 결정 0006과 0076이 적은 "유료 계정에서의 실제 생성은 확인하지 못했다"는 이번 확인으로 닫는다. 2026-11-14 Plus 계정으로 app-server의 일회용 스레드에서 새 그림과 배경 지우기를 받았고, 2026-11-15 스레드의 `features` 표가 띄울 때의 값을 바꾼다는 것과 전체 표로 막을 수 있다는 것을 확인했다.
- 결정 0114의 "Codex 이미지 생성은 요청 하나를 위해 뜨고 그 답과 함께 끝난다"는 이 결정의 수명 규칙으로 바뀌었다. 그림은 채팅이 쓰는 app-server의 스레드에서 만들고, 프로세스는 채팅과 같은 규칙으로 끝난다.
- 단위 시험은 실제 프로그램 없이 가짜 app-server 대화로 본다. `packages/ai-provider/tests/codex-image-run.test.ts`(성공, 첫 장, `fileId`만 온 경우, 한도, 무료와 그 밖의 그림 없는 끝, 투명, 종량·알 수 없는 로그인, 낮은 판, MCP, 취소, 시간 초과, 참조 그림, 채팅·그림 스레드의 `features` 표), `packages/ai-search/tests/image-routing.test.ts`(모델 이름 표), `codex-image-subscription.test.ts`, `apps/docs/tests/codex-image-backend.test.ts`(등록과 사용량 알림), `packages/cli/tests/headless-tools.test.ts`·`capabilities.test.ts`, `apps/hwp/tests/web-search-guards.test.ts`, `apps/pdf/tests/ai-web-search.test.ts`, `packages/ui/tests/editors-consistency.test.ts`(열 편집기의 사용량 알림 배선)다.
- 2026-11-15 실제 Plus 계정으로 합친 코드를 확인했다. 따로 둔 설정 폴더에서 자동 호출 스위치를 켜고 명령어를 돌렸다. `capabilities`는 그림 생성을 `via: codex, route: subscription`으로 보였다. `image` 한 장은 36초에 1.07MB PNG로 왔고, 그 그림을 `--ref`로 넣은 배경 지우기는 33초에 투명 PNG(모서리 알파 0, 가운데 253)로 왔다. 두 번 다 끝난 뒤 Codex 프로세스가 남지 않았다. 채팅과 같은 조건(프로세스는 그림 도구 끔, 스레드 표도 그림 도구 끔)의 스레드에 그림을 시키자 Codex가 "이 세션에는 그림 도구가 없다"고 답했고 그림 항목은 나오지 않았다.
- 빌드한 앱 화면에서의 확인(설정의 ChatGPT 요금제 이름과 안내 줄, AI 창에서 그림을 만들어 문서에 넣기, 그림 뒤 사용량 줄 갱신)은 사람이 한다.
