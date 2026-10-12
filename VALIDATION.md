# 검증

## 브라우저 SDK 정의 맵의 객체 검사 (2026-10-13)

이벤트 속성 정의가 `[]`, 숫자, 불리언 또는 빈 문자열이어도 `Object.entries`가
빈 목록을 반환해 속성 없는 이벤트로 받아들였다. 빈 배열·스칼라 workflow 맵도
정상적인 빈 workflow 목록으로 해석됐다. 두 맵이 객체인지 확인해 잘못된 설정은
SDK 생성 시 비활성화한다. 정상적인 빈 객체 정의는 계속 지원한다. 검증된 버전의
배치 JSON 접두부는 SDK 생성 때 한 번 만들어 배치별 재생성을 줄인다.

- 새 `configuration.test.ts`의 원본·minified 일반/퍼널 검사 4개가 수정 전
  `properties: []`에서 모두 실패했다. 수정 뒤 50개 잘못된 맵 조합에서 이벤트
  대기·전송·Beacon·타이머·visibility listener가 없고 정상 빈 객체는 전송된다.
- `npm run test:browser`: 53/53 통과. 원본과 실제 esbuild minified 모듈을 확인한다.
- `npm run build:browser`, `npx --no-install tsc --noEmit`, `git diff --check` 통과.
- `npm run check:browser-size`: 3,072 bytes gzip 예산 통과. Sembom 연동 포함
  3,067 bytes, 퍼널 연동 포함 3,046 bytes, 생성된 퍼널 연동 포함 3,068 bytes.
  초기 수정은 생성된 퍼널 예산을 넘었으며 최종 코드로 다시 확인했다.

API·DB·SDK 공개 타입·의존성·CI·위생 정책 변경은 없다. 소유 문서는 이 검증 기록만
갱신했다. 변경 없는 관리자·서버 SDK·수집기 전체 검사는 생략했고, 실제 Chromium과
운영 OIDC·원격 DB·배포 환경은 확인하지 않았다. 설정 오류는 기존 비활성 SDK 방식으로
처리되어 UI에 별도 오류 알림을 제공하지 않는다. 푸시·배포는 하지 않았다.

## 분류별 집계 날짜 계산 재사용 (2026-10-12)

흐름·퍼널 분류 조회가 각 버킷에서 같은 날짜의 시간대 경계를 반복 계산했다. 31일·32개
버킷 회귀 검사에서 수정 전 두 경로 모두 `Intl.DateTimeFormat` 생성 992회로 실패했다.
날짜별 확정 여부를 한 응답 안에서만 재사용해 31회로 줄였고, 빈 버킷 결과는 계산하지 않는다.
다른 요청과 캐시를 공유하지 않아 시간 경계 이후 새 조회의 provisional 값은 다시 계산된다.

- `node --test --test-timeout=30000 packages/storage-d1/test/breakdown-dates.test.ts
  apps/collector/test/admin.test.ts apps/collector/test/funnel-query.test.ts`: 34/34 통과.
  새 검사 6개는 최대 버킷·기간, 빈 결과, 뉴욕 봄/가을 DST의 날짜 끝 +48시간 직전·경계·
  직후와 누락 날짜의 0건·null 비율을 확인한다. 기존 로컬 Miniflare D1 API 검사도 통과했다.
- `npx --no-install tsc --noEmit`, `git diff --check` 통과.
- 로컬 Node 24.18.0에서 HEAD의 수정 전 코드와 수정 후 코드를 각각 한 번 예열하고
  교대로 5회 실행했다. 31일·32개 버킷에서 흐름 992행 중앙값은 277.71→11.13ms,
  퍼널 3,968행은 362.66→39.40ms였다. 모든 결과를 deepEqual로 비교해 일치를 확인했다.
  `.tmp/breakdown-bench.mjs`는 임시 측정이며 네트워크·DB·Worker CPU와 운영 지연은 측정하지 않았다.

API·DB·SDK 공개 계약·의존성·CI/러너·위생 정책 변경은 없다. 변경 없는 관리자 UI와 SDK,
전체 저장소 검사는 반복하지 않았고 일반 lint 명령은 없다. 운영 환경·실제 OIDC 제공자와
원격 DB는 미검증이며 푸시·배포는 하지 않았다. 소유 문서는 이 검증 기록만 갱신했다.

## 관리자 API 응답 본문 크기 제한 (2026-10-12)

기본 native fetch 경로가 관리자 API 응답을 파싱할 때 크기 상한 없이 본문 전체를 메모리에
올렸다. `apps/admin/src/api/response-body.ts`의 `readResponseJson`이 성공 4MiB·오류 16KiB
상한(31일·32버킷·10단계 퍼널 분류 응답에 여유)을 두고, `Content-Length`가 숫자가 아니거나
상한을 넘으면 읽기 전에 즉시 거부하며 스트림 누적 바이트가 상한을 넘으면 중단한다.
401·403은 본문을 읽기 전에 상태만으로 확정해 알림·권한 잠금을 유지하고, 성공 본문을 JSON
으로 읽지 못하면 `contract`, 오류 본문 파싱이 실패하면 기존 HTTP 상태 메시지를 그대로 쓴다.

재현은 수정 전 새 `response-body.test.mjs` 2개가 2/2 실패한 것이다. bounded read 수정 뒤
생명주기·접근·응답 본문 focused 실행이 31/31 통과했고, 이어서 `check:admin` 타입검사·
`test:admin` 274/274·`build:admin`·번들 분리 2/2·Sites Worker 9/9가 통과했다. 이
274·번들2·sites9 실행은 마지막 스트리밍 버퍼 최적화 전이다. 첫 실행은 273/274로
native-fetch receiver 검사가 json-only mock 탓에 실패했고, 그 검사를 `Response.json` mock
으로 고친 재실행 로그가 `.tmp/admin-response-check.log`다.

마지막 스트리밍 버퍼 최적화(4KiB에서 시작하는 단일 `Uint8Array`, 상한까지 지수 성장, 청크별
문자열 배열 제거) 뒤 같은 변경을 다시 좁혀 확인했다. focused 34/34
(`.tmp/admin-response-focused.log`), 관리자 타입검사와 `build:admin` 통과
(`.tmp/admin-response-final-build.log`)이며, `npm run verify:admin-analysis-access`도
Chromium 156.0.8078.4·격리 D1·로컬 RS256에서 verified true, oversizedReads 1, recovery true,
pageErrors 0, routeError false, apiReads 31, apiWrites 0, authorizations 1이었다
(`.tmp/admin-analysis-access-v5erlm/report.json`). 버퍼 최적화 뒤 이 러너에서 취소된 소켓의
`workerd` WSASend 10053 진단이 한 번 찍혔지만 검사는 통과했다. runner `node --check`와
`git diff --check`도 통과했다. 이 러너는 기존 opt-in 검증을 넓힌 것이며 UI·API·DB 계약은
그대로다.

API·DB·public SDK·의존성·CI 계약은 바꾸지 않았다. 원격 환경은 생략했고 변경 없는 backend·
SDK 검사는 건너뛰었다. 소스 lint 명령은 없다. 푸시·배포는 하지 않았다.

## 서버 SDK 응답 기한 검사 (2026-10-12)

전송 전 자격증명 기한 검사는 있었지만 응답 헤더·영수증 처리의 동기 지연은 타이머에만
의존했다. 이벤트 루프가 막히면 기한 이후 정상 영수증을 `delivered`로 받아들였다.
소스·minified·동일 배치 자동 재시도 회귀 3개가 수정 전 모두 실패했다. 헤더 수신 직후와
영수증 해석 뒤 단조 시계로 시도/전체 기한을 확인해 늦은 응답은 결과 불명으로 처리한다.
취소·재시도 횟수·총 예산·기존 이벤트 식별자는 유지한다.

- `npm run test:server`: 38/38 통과. 새 결정적 검사는 timeout/총 budget의 정확한 경계와
  초과를 헤더·본문 양쪽에서 확인한다. 후속 send가 동일 본문으로 중복 영수증을 받는다.
  실제 루프백 HTTP의 100ms 동기 헤더/스트림 처리와 50ms timeout에서도 늦은 성공을
  거부하며, 빠른 재시도가 같은 바이트를 보내는지 확인했다. 소표본 성능 측정은 아니다.
- `npx --no-install tsc --noEmit`, `npm run build:server` 통과. 서버 번들 9110 bytes,
  gzip 3718 bytes, runtimeDependencies 0. 브라우저 SDK 크기 예산과 별개다.
- `npm run verify:server-recovery`: verified=true, defaultSdkFetch=true, 실제 임시
  Miniflare 수집기 3개와 격리 D1. 커밋 전 503 뒤 accepted 2/attempts 2, 커밋 후 소켓 유실
  뒤 duplicates 2/attempts 2, 403 뒤 attempts 1 및 추가 저장 없음. receipts 8,
  completedRuns 2, byteIdenticalRetries=true. 기존/원격 DB 접근은 없다.
  결과: `.tmp/server-recovery/run-tJXMUl`. runner가 검증 서버를 종료했다.
- `git diff --check` 통과. SDK 동작 안내와 이 검증 기록을 갱신했다.

API·DB·SDK 공개 타입·의존성·CI/러너·위생 정책 변경은 없다. 변경 없는 관리자·수집기
전체 검사와 브라우저 UI 검사는 반복하지 않았으며 일반 lint 명령은 없다. 원격 제공자·
운영 DB·배포 환경은 미검증이다. 실제 서버 저장 후 기한이 지나면 결과가 불명일 수 있어
기존 이벤트로 재시도해야 한다. 푸시·배포·게시는 하지 않았다.

## 관리자 요청 제한의 동기 지연 강제 (2026-10-12)

`ApiClient`가 제한 시간을 `setTimeout` 콜백에만 맡겨, `getBearer`가 동기로 이벤트 루프를
막으면 콜백이 늦게 돌아 마감이 지난 뒤에도 PATCH를 전송할 수 있었다. 요청 시작 시
`performance.now()` 단조 시계로 요청 종료 시각을 잡고 자격증명 직후·전송 직전·헤더
수신·JSON 성공/오류 완료에서 마감을 검사하도록 고쳤다. 호출자 abort는 timeout으로
덮지 않고, 이미 관찰한 401·403은 권한 오류로 유지하며 분석 접근 취소 알림을 전달한다.
공유 로그인 갱신은 취소하지 않고 저장을 자동 재시도하지 않는다.

새 회귀 검사는 수정 전 credential·headers·success-body·error-body 4개와 native HTTP
mutation 1개가 실패했고(러너 그룹 실패 포함 fail 6), 수정 뒤 `apps/admin/src/api/`의
request-lifecycle·client·settings-editor·analytics-access Node 검사가 71/71 통과했다.
`typecheck:admin`·`build:admin`과 번들 분리 2/2·Sites Worker 9/9(합계 11/11)도 통과했다.
native Node HTTP 확인은 `requestTimeoutMs` 100ms에 async `getBearer` 내부 `Atomics.wait`
150ms 동기 block을 주면 fetch dispatch 0·PATCH 0(사전 GET 1)·초안 review 유지였고, block
해제 뒤 checkLatest→keepChanges→save로 GET·PATCH가 완료됐다.

커밋·CI에 연결하지 않은 일회성 `.tmp/admin-sync-deadline.mjs`로 실제 Vite 원본
`ApiClient`·`SettingsEditor`를 Chromium 156.0.8078.4에서 import하고 로컬 HTTP middleware로
새 동기 credential 경로를 확인했다. verified true, 만료 단계는 review·draft `Changed`·
dispatches 1(사전 GET만)·미저장 true였고 같은 save 재호출에도 dispatches 1이었다. block
해제 뒤 checkLatest→keepChanges→save로 ready·이름 Changed·미저장 false·dispatches 3,
서버 요청 [GET, GET, PATCH]·pageErrors 0이었다. 임시 스크립트 초기 두 실행은 fixture
문제(module playwright 위치 해석, middleware가 Vite 404 뒤 등록돼 초기 settings 응답 실패)로
실패했으며 제품 결함으로 분류하지 않는다.

`npm run verify:admin-settings-recovery` 최종 실행도 Chromium 156.0.8078.4에서 verified
true였다. preCommitFailurePreservesDraft·committedLostResponseRecovered·
readbackPreventsDuplicateWrite·nativeDeadlinePreservesCommittedDraft·
lateTimedOutResponseIgnored·readOnlyRecoveryRemainsLocked·explicitOwnerRecovery·
disconnectedUiCleared가 모두 true였고 attemptedWrites 5·preCommitFailures 1·droppedWrites
2·timedOutWrites 1·pageErrors 0·routeError false·authorizations 1·exchanges 1·refreshes 0·
apiReads 93·apiWrites 4·browserBatches 0이었다. 이 명령은 기존 비동기 timeout/recovery UI를
확인하는 검사이고, 새 동기 credential block은 위 일회성 `.tmp` 스크립트와 native Node HTTP
회귀 검사로 확인했다. 원격 운영 OIDC/DB와 타 브라우저는 미검증이며 일반 lint 명령은 없다.
변경 없는 backend/SDK 전체 검사는 반복하지 않았고 API·DB·의존성·CI·위생 정책 변경과
push·배포는 없다.

## 분석 새로고침의 숨긴 작업 공간 보존 (2026-10-12)

분석 화면의 새로고침이 프로젝트 목록을 loading으로 바꾸며 data를 비울 때
`activeProjectId=null`이 되어 숨긴 설정 작업 공간도 해제됐다. 새 선택 검사
`--check-analysis-refresh`는 수정 전 `analysis-refresh-loading` exit 1이었다
(`.tmp/admin-settings-navigation-1eJa96/failure.json`). 실제 목록 GET을 로컬 D1에서 읽은
뒤 응답을 보류한 상태에서 기존 설정/스키마 DOM이 사라지는 경로를 재현했다.

작업 공간을 현재 client와 선택 projectId에 묶고 loading/error에서는 hidden/inert로
유지한다. 이탈 guard도 선택 ID를 사용하며 이전 목록으로 분석/CSV/편집 권한을 복구하지
않는다. 성공 재시도 뒤 설정/스키마 권한·값을 다시 읽고 명시적 비교 선택을 따른다.
실제 프로젝트/연결 변경은 기존 폐기 경로다. 첫 수정 후 도구는 실패 중에도 숨긴 입력의
표시를 기다려 `analysis-refresh-failed`에서 실패했다
(`.tmp/admin-settings-navigation-oGQoA0/failure.json`). 도구의 해당 단계는 탐색 클릭 후
hidden 상태를 확인하도록 고쳤고 제품의 숨김을 제거하지 않았다.

최종 `verify:admin-settings-navigation -- --channel chromium --check-analysis-refresh --check-unload --check-created-exit`
는 Chromium 156.0.8078.4·합성 서명 HTTP·격리 Miniflare D1에서 exit 0·verified=true,
apiReads 177와 별도 interceptedProjectReads 1(합계 178)·writes 1·pageErrors 0·
routeError=false였다(`.tmp/admin-settings-navigation-DlfJLw/report.json`). 목록 보류/503/
재시도에서 설정·스키마·권한·발행자 입력을 보존하고, 로딩/실패 중 연결 해제 취소,
실패 중 편집기 숨김, 복구 뒤 같은 프로젝트·명시적 비교를 확인했다. 기존 owner 회수/
reader 잠금·폐기 승인·생성 POST/행 1회/1개·native unload 4회 취소도 통과했다.
실행 중 workerd WSASend 10054/10053·WSARecv 64 진단은 원인 미확인으로 남긴다.
일반 UI 성공과 pageErrors 0을 네이티브 런타임 전체 정상 증거로 확대하지 않는다.

생성/권한/발행자 입력 이탈·commit 응답 유실 회귀도 verified=true·reads 159·writes 6·
pageErrors 0·routeError=false로 통과했다(`.tmp/admin-mode-exit-8SGDU0/report.json`).
집중 컨트롤러/Guard 43/43·타입·빌드(5231
modules)·번들 2/2·Sites 9/9·help·diff 검사를 확인했다. Frontend 설계·검증·선택 도구
안내를 갱신했으며 문서 초안은 CommandCode DeepSeek 4.1 Flash high로 받아 실행 근거와
대조했다. 모델이 검증을 수행하지 않았다. 서비스는 도구가 종료했다.

HTTP API·DB·SDK·의존성·버전·CI/러너·위생 정책 변경과 푸시·게시·배포는 없다.
관련 없는 관리자/SDK/backend 전체는 반복하지 않았고 일반 lint 명령은 없다. 성공한
목록에서 선택 프로젝트 제거·pending 쓰기 중 목록 실패·원격 OIDC/D1·모바일/타 브라우저·
승인한 종료 뒤 복구와 전체 저장소/72개 질문 점검은 미검증/미완료다. 이 수정이 이전 권한
이탈 검사의 중간 실패 원인까지 설명한다고 주장하지 않는다.

## 권한·발행자 입력과 변경 확인의 이탈 보호 (2026-10-12)

`LiveGrants`/`LivePublishers`의 원시 입력과 검토/저장/결과 불명 요청은 기존 프로젝트
이탈 guard에 등록되지 않았다. 설정 화면 복귀의 자동 목록 갱신은 검토 요청도 취소했다.
raw 입력의 dirty boolean과 새 컨트롤러 getter를 기존 `DraftExitGuard`·`beforeunload`에
연결하고, 자동 갱신은 검토 요청을 유지하며 수동 새로고침은 요청 폐기를 확인하도록 고쳤다.
식별자·초안을 부모나 저장소에 복사하지 않는다. 저장 확인·권한 거부·취소·destroy는 요청
보호를 해제하며 남은 원시 입력은 기본값으로 돌아갈 때까지 보호한다.

추가 Node 검사 4개는 수정 전 모두 실패했다. 브라우저는 수정 전
`grant-project-switch-cancel`에서 exit 1이었다(`.tmp/admin-mode-exit-PL7sYm/failure.json`).
첫 수정 후 실행도 같은 단계에서 실패했다(`.tmp/admin-mode-exit-sC0leW/failure.json`).
이 실패 원인은 확정하지 않았다. 선택 시작값을 명시적으로 확인하도록 도구를 보강한 뒤
raw 입력 검사가 통과했고, 실제 commit 응답 유실과 갱신/폐기 확인까지 확장한 최종 통합
검사는 exit 0이었다. 과거 실패 기록은 성공 기록과 구분해 남긴다.

`verify:admin-mode-exit -- --channel chromium --check-authority-drafts --check-creation-draft`는
Chromium 156.0.8078.4·합성 서명 HTTP·격리 Miniflare D1에서 verified=true·reads 159·
writes 6·pageErrors 0·routeError=false,
`.tmp/admin-mode-exit-fF5KTn/report.json`이었다. 두 폼의 원시 입력·role만 변경·검토 요청·
빈 추가 폼의 행 변경을 보호하고, 프로젝트/연결/모드/reload 취소 뒤 입력과 같은 확인
요청을 유지했다. 자동 목록 갱신은 검토를 보존하고 수동 새로고침은 취소/승인을 구분했다.
생성 응답 1회·권한/발행자 응답 각 1회가 실제 commit 뒤 유실됐다. 명시적 재확인 후
프로젝트·해당 권한·해당 발행자 행은 각각 1개였고, 확인한 입력은 경고를 해제했다.
최종 모드 이탈 취소는 두 폼 입력을 유지했고 승인은 기존 DOM을 제거했다. API 재진입은
빈 토큰으로 새 연결을 요구하며 local/session storage와 cookies는 비어 있었다.

기존 `verify:admin-access -- --channel chromium`는 실제 거부 2회·보류 쓰기 2회·
reads 128·writes 5·pageErrors 0·routeError=false,
`.tmp/admin-access-HibHMo/report.json`으로 통과했다. 권한 회수/명시적 복구와 프로젝트
전환·연결 해제 뒤 늦은 commit 응답 격리는 유지했다. 집중 Node 17/17·관리자 전체
258/258·타입·최종 빌드(5231 modules)·번들 2/2·Sites 9/9·실행 없는 help·diff도 통과했다.
최종 두 브라우저 실행에서 workerd 연결 중단 진단은 관측하지 않았다. 기존 원인 미확인
진단이나 초기 후속 실행 실패의 원인이 해결됐다고 확대하지 않는다. 브라우저·Vite·D1
런타임은 도구가 종료했다. 문서 초안은 CommandCode DeepSeek 4.1 Flash high로 받아
실제 결과와 대조했으며 모델이 검증을 수행하지 않았다.

Frontend 설계·검증 기록·선택 도구 안내를 갱신했다. 이번 단위는 HTTP API·DB·SDK·의존성·
버전·CI/러너·위생 정책을 바꾸지 않았으며 푸시·게시·배포도 하지 않았다. backend/SDK 전체는
변경 범위 밖이라 반복하지 않았고 일반 lint 명령은 없다. 원격 OIDC/D1·다중 운영자·
모바일/타 브라우저·권한/발행자 pending 상태에서 승인한 이탈의 늦은 응답·종료 뒤 복구·
힙 zeroing은 미검증이며 전체 저장소/72개 질문 점검은 미완료다.

## 서버 SDK 자격증명 기한 검사 (2026-10-12)

`getToken`이 동기로 오래 걸리면 이벤트 루프가 막혀 `requestTimeoutMs`·`retryBudgetMs` 타이머가
늦게 돌아도 그 사이에 HTTP 전송이 시작됐다. 전송 직전에 `host.monotonicNow`와 시도
기한(`min(전체 재시도 기한, 시도 시작 + requestTimeoutMs)`)을 검사해 기한이 지났으면 HTTP
요청 없이 시도를 끝내도록 고쳤다.

새 회귀 3개(source·minified·native HTTP)는 수정 전 모두 실패했고 수정 뒤 통과했다.
`npm run test:server` 34/34(새 자격증명 기한 3개 포함), `npm run build:server`는 선언 `tsc`
포함 성공, 빌드는 9021 bytes/gzip 3703 bytes·런타임 의존성 0개였다. native `fetch`로 임시
포트 로컬 HTTP 서버에 동기 `getToken` 120ms·`requestTimeoutMs` 100ms를 주면 수정 전은
attempts 1·`transport_unavailable`, 수정 뒤는 attempts 0·`authentication_unavailable`·
`retryable: true`·HTTP 요청 0이었다. 같은 이벤트를 이어서 바로 다시 보내면 delivered·
attempts 1·HTTP 1로 `eventId`가 유지됐다. 동기 함수 자체를 중간에 끊지는 못하며 시도 신호는
정리할 때 취소한다.

범위는 SDK source 단위 테스트·빌드·로컬 HTTP 실험이고 원격 OIDC·운영 DB·Worker 검증은 하지
않았다. 전송 직전 SDK 분기만 바뀌어 변경 없는 관리자·수집기 전체 검사는 생략했고 일반 lint
스크립트는 없다. API·DB·public types·의존성·CI·위생 변경은 없고 push·배포도 하지 않았다.
관련 파일 `git diff --check` 통과.

## 프로젝트 생성 입력·결과 불명의 이탈 보호 (2026-10-12)

생성 폼의 닫기·연결 해제·데모 API 모드 이탈·reload는 기존 설정/스키마 guard에
참여하지 않아 입력이나 확인 요청을 버릴 수 있었다. 수정 전 생성 getter/연결 scope
집중 검사 3개와 브라우저 `dirty-creation-close-cancel` 단계가 실패했다. 생성 컨트롤러가
기본 입력을 한 번 기억하고, 입력 차이·생성 중·결과 불명 요청에만 이탈 보호를 제공한다.
확인한 생성 영수증·destroy는 보호를 해제한다. 연결 전체를 떠날 때는 생성 guard도
확인하지만 생성 폼이 남는 프로젝트 선택에서는 확인하지 않는다. pending 요청의 기존
불변·명시적 재확인·멱등성 계약은 바꾸지 않았다.

최종 `verify:admin-mode-exit -- --channel chromium --check-creation-draft`는 Chromium
156.0.8078.4에서 exit 0·verified=true·reads 61·writes 2·pageErrors 0·routeError=false,
`.tmp/admin-mode-exit-FtQERw/report.json`이었다. 기본 폼 무경고 닫기, dirty 닫기 취소/승인,
프로젝트 선택 시 입력 유지, 연결/모드/reload 취소를 확인했다. 실제 D1 commit 뒤 생성
응답 1회를 버린 뒤 연결 해제를 취소하면 같은 확인 요청이 남았고, 명시적 POST 재확인
뒤 DB 행은 1개였다. 확인 완료 후 자동 이동과 깨끗한 전환은 경고하지 않았다. 기존 숨긴
설정/스키마 이탈 검사·빈 재연결 토큰·storage/cookie 부재도 통과했다.

같은 수정으로 기존 `verify:admin-settings-navigation -- --channel chromium --check-created-exit`는
verified=true·reads 152·writes 1·pageErrors 0·routeError=false였다
(`.tmp/admin-settings-navigation-VE2D0i/report.json`). 실행 중 workerd WSASend 10054/10053
연결 중단 로그가 있어 원인 미확인으로 남긴다. 온보딩 `--lost-responses`는 생성/발행 응답
유실 각 1회, 첫 이벤트 DB/표 1건, `3 SDK 연결`, 스키마 교체 확인 3회를 통과했다.
reads 31·writes 5·browserBatches 1·pageErrors 0·routeError=false,
`.tmp/admin-onboarding-NWsq8Y/report.json`이다. 합성 서명 HTTP·격리 Miniflare D1 검사이며
실제 운영 인증 제공자나 원격 DB 검증은 아니다.

관리자 전체 254/254·타입 검사, 집중 컨트롤러/Guard 21/21·번들 2/2·Sites 9/9,
빌드·실행 없는 help·diff 검사가 통과했다. 브라우저·Vite·Miniflare는 도구가 종료한다.
Frontend 설계·선택 실행 안내·검증 기록을 갱신했다. HTTP API·DB·SDK·의존성·버전·
CI/러너·위생 정책 변경과 푸시·게시·배포는 없다. 변경 없는 backend/SDK 전체는 반복하지
않았고 일반 lint 명령은 없다. 승인한 이탈 후 복구·다른 폼·운영 세션·모바일·다른 브라우저·
힙 메모리 zeroing과 전체 저장소/72개 질문 점검은 계속 미검증/미완료다.

## 데모 API 모드 이탈의 미저장 초안 확인 (2026-10-12)

Tallyfin `/demo`에서 API 연결을 Sample로 바꾸면 숨긴 미저장 설정·스키마가 확인 없이
사라지던 경로를 실브라우저로 재현했다. 부모 모드 버튼이 기존 폐기 확인을 호출하도록
고쳤다. 취소하면 선택 프로젝트·초안·연결이 남고, 승인하면 API 작업 공간이 해제돼
재진입에 새 연결이 필요하다. 같은 모드 버튼과 깨끗한 이탈은 경고하지 않는다. 등록 수명은
고유 entry로 관리해 늦은 정리가 새 등록을 지우지 않는다. 실제 `/demo`·임시 서명 bearer·
로컬 HTTP·격리 Miniflare D1로 확인했다. 테스트 토큰은 메모리에서만 직접 연결에 사용하고
보고서·저장소·쿠키·로그에 남기지 않는다. 외부 실제 인증 제공자 검증은 아니다.

새 `verify:admin-mode-exit`는 구현 전 `hidden-mode-cancel` exit 1이었다
(`.tmp/admin-mode-exit-4dCkcM/failure.json`). 구현 후 Chromium 156.0.8078.4에서
exit 0·verified=true·reads 60·writes 0·pageErrors 0·routeError=false,
`.tmp/admin-mode-exit-8ZRaCL/report.json`이었다. 이탈 취소 후 같은 프로젝트·두 초안,
설정 복귀의 명시적 비교/편집 복구, 승인 후 기존 DOM 제거와 재진입의 빈 토큰·연결 화면,
동일 모드/깨끗한 이탈 무경고, D1 이름 불변·storage/cookie 부재를 확인했다.
실제 사용자 엔트리를 쓰고 App props나 인증/bridge를 대역으로 교체하지 않았다.
구현 전 실패 실행에서는 workerd WSARecv 64 연결 중단 로그도 관측했다. 원인 미확인
로그이며 최종 성공 실행에서 보이지 않았다는 이유로 해당 원인을 해결했다고 주장하지 않는다.

새 WorkspaceExit·기존 DraftExitGuard 집중 4/4·관리자 전체 251/251·타입·빌드·번들 2/2·
Sites 9/9·실행 없는 help·diff 검사가 통과했다. 부모에 credentials/draft state를 저장하지
않고 초기 API 화면 지연 로딩 경계는 번들 검사로 유지했다. 문서 초안은 지정 CommandCode
DeepSeek 4.1 Flash high에서 받아 실제 근거와 대조했으며 모델이 검증을 실행한 것은 아니다.
HTTP API·DB·SDK·의존성·버전·CI/러너·위생 정책 변경과 푸시·게시·배포는 없다. 변경 없는
backend/SDK 전체 검사는 반복하지 않았고 일반 lint 명령은 없다. 운영 OIDC 세션의 모드
이탈·pending 쓰기·나머지 폼·모바일·승인한 종료 뒤 복구·힙 메모리 zeroing은 미검증이다.
기존 서버 SDK의 다른 수정은 건드리지 않았다. 전체 저장소/72개 질문 점검은 계속 미완료다.

## 새 프로젝트 생성 후 화면 이동 취소 (2026-10-12)

Tallyfin에서 새 프로젝트 생성 뒤 자동 이동이 기존 설정·스키마 초안을 확인 없이 버리는
버그를 재현했다. native confirm을 취소하면 기존 초안과 선택 프로젝트는 그대로 남고,
새 프로젝트는 목록과 생성 영수증에 유지된다. 자동 열기 한 번과 명시적 다시 열기 한 번을
취소한 뒤 승인해도 생성 POST는 1회만 나가고 재열기는 GET만 쓴다. 취소는 생성 성공을
실패나 결과 불명으로 바꾸지 않는다. 확인은 실제 Chromium, 서명 HTTP, 격리 Miniflare D1에서
했다. 관리자 테스트 249개와 타입·빌드가 통과했고, 최초 프로젝트 온보딩과 생성/스키마
발행 응답 유실 복구도 통과했다. HTTP API·DB·의존성·CI 변경은 없고 푸시·배포도 하지 않았다.
실제 운영·모바일·기타 폼은 미검증이며 전체 저장소와 72질문 목표는 미완료다.

컨트롤러 회귀는 수정 전 취소를 무시하는 성공 메시지로 exit 1, 브라우저 회귀는
`created-project-cancel` exit 1이었다. 실패 기록은
`.tmp/admin-settings-navigation-GuEMTb/failure.json`이다. 구현 후 집중 Node 16/16,
최종 `verify:admin-settings-navigation -- --channel chromium --check-created-exit`는
Chromium 156.0.8078.4·exit 0·verified=true·reads 154·writes 1·pageErrors 0·routeError=false,
`.tmp/admin-settings-navigation-t5VZm8/report.json`이었다. 기존 이름 DB 불변·reader 잠금·
새 프로젝트 행 1개·승인 뒤 기존 초안 폐기·storage/cookie 부재도 확인했다.
두 옵션을 결합한 최종 실행도 exit 0·verified=true·native beforeunload 4회 취소·
reads 162·writes 1·pageErrors 0·routeError=false였다
(`.tmp/admin-settings-navigation-4Ap0yj/report.json`). workerd WSASend 10054 연결 중단
로그도 관측했다. 원인 미확인 로그이며 사용자 흐름 통과를 전체 런타임 정상으로 확대하지 않는다.

`verify:admin-onboarding -- --channel chromium --lost-responses`도 exit 0·verified=true,
생성/발행 실제 commit 응답 유실 각 1회 복구·첫 SDK 이벤트 DB/표 1건·3 SDK 연결 전환,
스키마 교체 confirm 3회·reads 31·writes 5·browserBatches 1·pageErrors 0·routeError=false,
`.tmp/admin-onboarding-5SpwPt/report.json`에 기록했다. 번들 2/2·Sites 9/9·diff도 통과했다.
문서 초안은 지정 CommandCode DeepSeek 4.1 Flash high로 받아 검토했고, 취소 두 번의
위치는 실제 자동 열기/명시적 열기로 바로잡았다. 외부 모델은 검증을 실행하지 않았다.
변경 없는 backend/SDK 전체는 반복하지 않았고 일반 lint 명령은 없다. 새 옵션은 기존
access fixture에만 생성 권한을 추가하며 기본 실행과 일반 CI에 쓰기를 늘리지 않는다.
모드 전환·다른 폼·pending 기존 설정 쓰기 중 생성·운영 인증/D1·모바일·승인한 종료 뒤
복구와 전체 목표는 여전히 미검증/미완료다. SDK·버전·위생 정책 변경도 없다.

## 프로젝트 선택·연결 해제 초안 확인 (2026-10-12)

현재 프로젝트의 설정·스키마 초안을 버리는 두 명시적 버튼에 native confirm을 추가했다.
실브라우저 회귀는 구현 전 `hidden-project-switch-cancel`에서 exit 1이었다
(`.tmp/admin-settings-navigation-GvYwr2/failure.json`). 확인창 없이 프로젝트가 바뀌었다.
구현 뒤 취소는 선택·세션·입력을 유지하고 승인한 전환은 기존 scope를 폐기한다.
이미 commit한 서버 값은 되돌리지 않는다. `DraftExitGuard`는 live getter만 보관하고
scope/client가 다른 getter는 조회하지 않으며, 각 정리 함수는 자신의 등록만 해제한다.

Chromium 156.0.8078.4의 최종 `verify:admin-settings-navigation -- --channel chromium
--check-unload`는 exit 0·verified=true·reads 148·writes 0·pageErrors 0·routeError=false였다.
설정만/스키마만 편집한 전환 취소, 숨긴 초안의 전환·연결 해제 취소, reader 잠금과 승인한
전환의 폐기, 깨끗한 전환/연결 해제와 reload, native beforeunload 경고 4회 취소를 확인했다.
storage/cookie는 없었다. 보고서는 `.tmp/admin-settings-navigation-jG0A96/report.json`이다.
이 성공 실행에서 workerd WSASend 10053/WSARecv 64 연결 중단 로그를 관측했다.
도구 종료 코드는 0이나 해당 로그의 원인은 미확인이며 운영 장애/복구 증거로 확대하지 않는다.
reload 없는 기본 명령도 exit 0·verified=true·reads 137·writes 0·pageErrors 0·routeError=false,
`.tmp/admin-settings-navigation-2uALpn/report.json`으로 통과했고 연결 중단 로그는 관측하지 않았다.
두 실행의 차이만으로 native reload를 해당 로그의 원인으로 단정하지 않는다.

공유 실제 서명 API/D1 `verify:admin-access`는 pending 쓰기 중 전환/연결 해제를 명시적으로
승인하고 이전 commit 응답 격리·권한 복구를 유지했다. exit 0·verified=true·거부 2·
보류 쓰기 2·reads 124·writes 5·pageErrors 0·routeError=false,
`.tmp/admin-access-xwu58z/report.json`이다. 새 Guard 검사 2/2·관리자 전체 248/248·
타입·빌드·번들 2/2·Sites 9/9·diff가 통과했다. 일반 lint 명령은 없고 변경 없는 backend/SDK
전체 검사는 반복하지 않았다. API·DB·SDK·의존성·버전·CI/러너·위생 정책은 불변이다.
새 프로젝트 생성 후 자동 전환·데모/API 모드 전환·나머지 폼·운영 인증/D1·모바일·
승인한 종료 후 초안 복구는 미검증이다. 푸시·게시·배포는 하지 않았고 전체 목표는 진행 중이다.

## 미저장 설정·스키마 이탈 경고 (2026-10-12)

설정·스키마 컨트롤러에 `hasUnsavedChanges`를 추가하고 해당 상태일 때만 브라우저의
`beforeunload` 경고를 설치한다. 원시 입력·잘못된 초안·발행 번호 변경·저장 중·발행 결과
불명을 보호한다. 기준선 복귀·확인된 저장/발행·서버 값 채택·destroy는 경고를 해제한다.
두 편집기의 리스너가 서로를 제거하지 않으며 저장·발행을 자동 재시도하지 않는다.
새 getter 회귀 두 개는 구현 전 undefined/false 비교로 실패했고 구현 후 통과했다.

실제 Chromium 156.0.8078.4의 `verify:admin-settings-navigation -- --channel chromium
--check-unload`는 verified=true·네이티브 경고 4회·탭 닫기 취소 true였다. 설정만 편집,
스키마만 편집, 분석 화면에 숨긴 두 초안의 reload 및 tab close를 취소해 입력/창 유지와
깨끗한 연결 해제 후 경고 없는 reload를 확인했다. 기존 권한 재확인·reader 잠금·프로젝트
격리도 통과했다. reads 140·writes 0·pageErrors 0·routeError=false·storage/cookie 없음,
보고서는 `.tmp/admin-settings-navigation-2uHfFm/report.json`이다. 앞선 두 실행은 경고를
취소한 reload Promise의 타임아웃을 실패로 처리했다. 최종 도구는 실제 dialog 관측/취소가
있을 때만 취소된 reload의 ERR_ABORTED/TimeoutError를 허용한다. 경고 없이 멈추면 실패다.

관리자 전체 Node 246/246·타입·빌드·번들 2/2·Sites 9/9가 통과했다. 컨트롤러·리스너
집중 검사 40/40도 통과했다. 공유 `verify:admin-access`는 Chromium에서 verified=true,
거부 2·보류 쓰기 2·reads 127·writes 5·pageErrors 0·routeError=false였다. 보고서는
`.tmp/admin-access-ugMj0u/report.json`이며 실제 commit의 늦은 응답 격리와 권한 복구가
유지됐다. 도구의 실행 없는 help와 diff 검사도 통과했다. backend/SDK 전체 검사는 해당
코드를 바꾸지 않아 반복하지 않았고 일반 lint 명령은 없다. API·DB·SDK·의존성·버전·
CI/러너·위생 정책은 불변이다. 입력 영속화·승인한 이탈 후 복구·프로젝트 전환 확인·원격 인증/D1·
다른 브라우저/모바일/강제 종료는 미검증이다. 푸시·게시·배포는 하지 않았다.

## 설정 화면 왕복의 초안 보존 (2026-10-12)

실제 Chromium의 새 `verify:admin-settings-navigation`은 수정 전 `draft-return`에서
exit 1이었다. 설정·스키마 입력을 바꾸고 이벤트 분석으로 이동한 뒤 돌아오면 편집기
해제로 입력이 서버 값으로 바뀌었다. 실패 사진
`.tmp/admin-settings-navigation-Myfkj6/failure.png`에서도 프로젝트 이름의 복귀를 확인했다.

`LiveDashboard`는 같은 client/project의 설정 작업 공간을 하나만 유지한다. 다른 분석
화면에서는 hidden/inert로 숨기고, 돌아올 때 기존 refresh로 권한·서버 상태를 확인한다.
변경된 설정·스키마 입력은 비교 상태에 유지하며 명시적 선택 없이 저장하지 않는다.
프로젝트 전환·연결 해제·활성 프로젝트 부재에서는 기존처럼 작업 공간을 폐기한다.
브라우저 reload/종료 복구·다중 프로젝트 저장·새 폴링은 추가하지 않았다.

수정 뒤 최종 Chromium 156.0.8078.4 실행은 exit 0·verified=true,
reads 137·writes 0·pageErrors 0·routeError=false·로그인 1이었다. 보고서는
`.tmp/admin-settings-navigation-iPVevm/report.json`이다. 실제 서명 HTTP/새 Miniflare
D1의 설정·스키마 초안 왕복, 화면 밖의 편집기 숨김, 이탈 중 owner→reader 변경 뒤
재조회/편집 잠금, 프로젝트 전환의 초안 폐기와 분석 화면의 연결 해제 후 숨은 DOM 제거,
storage/cookie 부재와 서버 이름 불변을 확인했다. 테스트 grant 변경은 로컬 fixture다.

관리자 타입·빌드·전체 Node 242/242·번들 분리 2/2·Sites 9/9가 통과했다. 공유 access
실브라우저 회귀도 exit 0·verified=true, 실제 거부 2·heldWrites 2·reads 128·writes 5,
pageErrors 0·routeError=false(`.tmp/admin-access-FaZdQ0/report.json`)로 통과했다.
프로젝트 전환·연결 해제 중 이미 commit한 쓰기의 늦은 응답 격리는 유지했다.
새 도구 구문·실행 없는 help·diff 검사도 통과했다.

설계·검증 기록과 선택 실행 도구를 추가했다. 관리자 렌더링/메모리 수명과 package script만
변경했고 API·DB·SDK·버전·의존성·위생 정책·CI는 불변이다. backend/SDK 전체 검사는
변경이 없어 반복하지 않았고 일반 lint 명령은 없다. 실제 운영 제공자·원격 D1·새로고침/
종료 입력 복구·모바일·전체 접근성·숨은 작업 공간의 메모리 측정은 미검증이며 푸시·게시·
배포는 없다. 전체 저장소와 72항목은 계속 진행 중이다.

## 설정 저장 전 실패·저장 후 응답 유실 실브라우저 검증 (2026-10-12)

옵트인 `verify:admin-settings-recovery`를 추가했다. 실제 관리자 컴포넌트·API client·
서명된 수집기 HTTP·새 Miniflare D1로 네 경로를 확인했다. 저장 전 합성 503은 DB에
전달하지 않고 초안을 보존한 뒤 재조회·명시적 변경 유지·한 번의 저장으로 복구했다.
실제 D1 commit 후 응답을 버린 경우는 저장 결과 불명·초안 잠금에서 현재 서버 값을
비교하고 채택해 추가 PATCH 없이 끝났다. 별도 실제 commit 응답을 client의 기존
15초 제한을 넘겨 보류하고, 재조회·변경 유지 뒤 늦게 해제해 화면과 쓰기 수가 유지됨을
확인했다. 가짜 시계나 client 제한 시간 변경은 없다.

마지막은 commit 응답 유실 뒤 로컬 owner grant를 reader로 바꾸고 readback해 편집
잠금을 확인했다. 서버 설정을 사용해도 저장은 잠겼으며, owner 복원·명시적 새로고침
이후에만 다시 편집됐다. 연결 해제 후 설정 UI와 storage/cookie 제거도 확인했다.
제품 코드의 새 결함은 관측하지 않았고 런타임을 바꾸지 않았다. 공유 fixture는 access
프로필의 두 테스트 프로젝트 PATCH만 응답 유실 대상으로 허용하며 onboarding의
기존 POST/PUT 제한과 access의 afterCommit 검증을 유지한다.

최종 Chromium 156.0.8078.4는 exit 0·verified=true, browser PATCH 시도 5,
전달 전 실패 1·버린 성공 응답 2·대기 초과 1·forwarded API 쓰기 4·읽기 93,
로그인 1·pageErrors 0·routeError=false였다. 보고서는
`.tmp/admin-settings-recovery-UCZVNv/report.json`이다. 앞선 중간 실행도 통과했으나
최종 보고서는 제한된 barrier 대기와 쓰기 수 assertion까지 포함한다.

공유 fixture 회귀 `verify:admin-access`도 exit 0·verified=true, deniedValidation 1·
deniedSettings 1·heldWrites 2·reads 126·writes 5·pageErrors 0·routeError=false였다.
보고서 `.tmp/admin-access-mx79JO/report.json`에 프로젝트 전환·연결 해제의 늦은 응답
폐기와 이미 commit된 DB 보존을 기록했다. 설정/요청 수명 Node 검사 19/19도 통과했다.

새 도구/공유 fixture 구문 검사·실행 없는 help·diff 검사와 선택 실행 안내를 추가했다.
제품 런타임·API·DB 스키마·SDK·버전·의존성·위생 정책·CI는 변경하지 않았다. 실행 도구와
package script만 변경했다. 타입/빌드·번들·전체 backend/admin은 제품 소스가 불변이라
반복하지 않았고 일반 소스 lint 명령은 없다. 실제 운영 제공자·원격 DB·다른 브라우저와
여러 운영자 동시 수정은 미검증이며 푸시·게시·배포는 없다. 전체 72항목 목표는 진행 중이다.

## 목표·퍼널 분석 권한 회수 실브라우저 검증 (2026-10-12)

옵트인 `verify:admin-goal-access`를 추가했다. 공유 로그인 fixture의 goals 프로필만
작업 흐름·퍼널과 보조 소유자를 등록하며 기존 login/access/onboarding 프로필은 유지한다.
Core 검증·D1 commit으로 현재와 직전 기간의 합성 이벤트 16개를 준비하고, 실제
RS256 로그인·서명 API·Miniflare D1 grant 회수로 목표/퍼널의 여섯 읽기 경로에서
403을 확인했다. 표·분류·비교·내보내기 제거 또는 비활성화와 명시적 새로고침 복구를
검사했다. 일곱 번째는 이전 프로젝트의 실제 403 응답을 보류했다가 전환 뒤 해제해
새 프로젝트 화면·CSV에 영향을 주지 않는지 확인했다. 제품 코드 수정은 필요하지 않았다.

최종 Chromium 156.0.8078.4 실행은 exit 0·verified=true, 시나리오 7·실제 403 관측 7,
API reads 67·writes 0·browserBatches 0·pageErrors 0·routeError=false다.
정상 퍼널 비교의 loan/current와 timer/previous 행을 화면 셀로 정확히 대조했고,
실제 다운로드 CSV의 양 기간 시작·완료 1건·완료율 100 및 속성별 1/0·0/1을 확인했다.
D1 workflow 시작 합계 4·funnel 시작 합계 4, 다른 프로젝트 CSV의 이전 ID 부재와
연결 해제 뒤 분석 제거도 통과했다. 근거는
`.tmp/admin-goal-access-mwpKGf/report.json`과 두 화면 스크린샷이다.

초기 실행은 첫 거부·화면 차단을 통과한 뒤, 이미 제거된 비교 checkbox를 복구 전에
읽으려는 검증 도구의 오류로 exit 1이었다. 서버 새로고침으로 화면을 복구한 뒤 checkbox를
읽도록 고쳤으며 실패를 제품 버그나 전체 통과로 세지 않았다. 정상 행/CSV 검증을
추가하기 전 중간 실행도 통과했지만 최종 근거는 위 실행이다.
공유 fixture 회귀로 `verify:admin-login -- --channel chromium`을 실행해 exit 0·
verified=true, PKCE·서명 API·공유 토큰 갱신·갱신 실패·재로그인·연결 해제·새로고침·
빈 storage를 확인했다. reads 27·writes 0·pageErrors 0이다.

새 도구·공유 fixture 구문 검사, 실행 없는 `--help`, `git diff --check`를 통과했다.
안내 `tools/browser-bench/ADMIN-GOAL-ACCESS.md`와 이 기록을 추가했다. 선택 실행 명령과
합성 fixture만 변경했고 제품 런타임·API·DB·SDK·의존성·위생 정책·CI는 바꾸지 않았다.
제품 소스가 불변이므로 타입/빌드·관리자 단위·백엔드 전체·루트 check는 반복하지 않았다.
일반 소스 lint 명령은 없다. 실제 제공자·원격 DB·Chrome/Edge·모바일은 미검증이고
푸시·게시·배포는 하지 않았다. 전체 저장소 목표는 계속 진행 중이다.

## SDK 차원 enum 순서 불일치 수정 (2026-10-12)

Core가 동일한 enum 집합으로 인정한 스키마도 단계별 허용 값 순서가 다르면 브라우저의
workflow·funnel 클라이언트가 비활성화되고 서버 SDK 생성이 실패하던 경로를 수정했다.
공식 예제 레지스트리의 종료 단계 값 순서만 뒤집어 투영한 소스·minified ESM 회귀
6개가 수정 전 모두 실패했다. 각 SDK의 내부 JSON 스냅샷에서 enum을 정렬해 비교하고,
호스트의 동결된 원본·예제·레지스트리 해시와 wire 형식은 바꾸지 않는다.

회귀는 실제 Core `prepareBatch`·`prepareServerBatch`로 전송 본문과 단계 정보를
검사하고, 다른 집합·누락·중복 값 거부와 원본 보존도 확인한다. 브라우저·서버 SDK와
Core 스키마 관련 검사 82/82, 루트 `tsc --noEmit`, 양쪽 SDK 빌드(타입 선언 포함)를
통과했다. 브라우저 퍼널의 UTC 검사에서 만든 Date를 재사용해 추가 변환을 줄였다.
초기 수정의 생성 코드 gzip 3,078바이트와 중간 후보 3,077바이트 실패는 통과로
세지 않았다. 최종 `check:browser-size`는 기본 SDK 2,780·Sembom 예제 3,053·퍼널 SDK
2,918·퍼널 참조 예제 3,047·관리자 생성 퍼널 코드 3,069바이트로 모두 종료 0이다.
서버 SDK는 minified 9,015바이트·gzip 3,701바이트, 런타임 의존성 0개다.

`verify:server-recovery`는 종료 단계 enum 순서를 뒤집은 합성 레지스트리로 기본 Node
fetch·실제 루프백 소켓·Miniflare 수집기 3개·새 D1을 사용했다. 종료 0·verified=true,
저장 전 503 뒤 accepted 2·duplicates 0·attempts 2, 저장 후 연결 유실 뒤 accepted 0·
duplicates 2·attempts 2였다. 영수증 8개·완료 run 2개와 동일 본문 재시도, 발행자 회수
후 403·단일 요청·DB 불변도 통과했다. 리포트는
`.tmp/server-recovery/run-6A8lEC/report.json`에 있다. 로컬 relay와 Miniflare는 정리했다.
브라우저 새 회귀는 합성 host와 minified ESM에서 확인했으며 실브라우저는 이번에 실행하지 않았다.

소유 문서 `docs/backend/browser-sdk.md`·`docs/backend/server-sdk.md`·
`tools/runtime/SERVER-RECOVERY.md`와 이 기록을 갱신했다. 복구 도구의 합성 fixture만
확장했고 API·DB·공개 타입·의존성·위생 정책·CI workflow 변경은 없다. 변경 없는 관리자와
백엔드 전체 검사·루트 전체 check는 생략했으며 일반 소스 lint 명령은 없다.
실제 운영 OIDC·원격 DB·서비스 설치는 미검증이고 푸시·게시·배포는 하지 않았다.
전체 목표는 계속 진행 중이다.

## 생성 브라우저 퍼널 SDK 크기 복구 (2026-10-12)

이전 관리자 전체 검사에서 확인한 `funnel-setup.test.mjs` 생성 코드 초과를
단독 재실행해 gzip 3,099바이트·종료 1로 재확인했다. 기존 예제 크기 명령은 퍼널
참조 예제 3,072바이트로 통과해 실제 관리자 생성 팩토리의 초과를 포착하지 못했다.

`common.ts`의 객체 검사를 workflow 종료·속성 snapshot·퍼널 입력 검증에서 공유하고,
Retry-After 하한을 한 번 계산하며, 타이머에서만 쓰는 중계 함수와 beacon 결과
임시값을 제거했다. 입력 검증·10분 만료·1초 하한·원래 바디 재시도·종료 정리는
그대로다. 퍼널 이벤트 조회를 Set으로 바꾸는 후보는 크기가 늘어 최종 변경에서
제외했다. 중간 후보 생성 코드 3,084/3,093바이트 실패도 통과로 세지 않았다.

`tools/browser/check.mjs`는 관리자 `sdkSetup`의 참조 생성 코드를 직접 번들링해
endpoint·스키마 포함 3KiB 예산과 외부 런타임·서버/관리자 런타임·다른 프로필
번들 유입 금지까지 기존 명령에서 검사한다. 예산·fixture·공개 SDK/HTTP 키를
바꾸지 않았다. 최종 gzip은 기본 SDK 2,775·Sembom 예제 3,047·퍼널 SDK 2,920·
퍼널 참조 예제 3,050·관리자 생성 퍼널 코드 3,072바이트이며 모두 종료 0이다.
이는 고정 참조 레지스트리·endpoint 기준이며 임의 크기의 사용자 스키마 보장은 아니다.
생성 코드의 예산 여유는 0바이트로 향후 변경 때 재측정이 필요하다.

브라우저 전체 45/45·관리자 전체 242/242, `build:browser`(선언 포함),
`npx --no-install tsc --noEmit`, `git diff --check`를 통과했다. minified 프로필의
재시도·공개 키·동일 바디, 잘못된 입력·핸들 보존, beacon false/예외 fallback,
숨김/종료 처리가 기존 회귀에서 유지됐다. `verify:admin-onboarding -- --channel
chromium --lost-responses`도 종료 0·verified=true, Chromium 156.0.8078.4에서
빈 프로젝트 생성·스키마 발행·생성 SDK 실제 실행·첫 이벤트 DB/표 1건·단계 3·
생성/발행 유실 각 1회 복구를 통과했다. API reads 31·writes 5·browserBatches 1·
pageErrors 0·routeError=false이고 `.tmp/admin-onboarding-1oB1FB/report.json`에 남겼다.
로컬 Vite·Miniflare·브라우저는 종료했다. 실브라우저는 기본 생성 SDK 전송을
확인했고 퍼널 생성 팩토리는 합성 host와 minified/크기 검사로 확인했다.

소유 문서 `docs/backend/browser-sdk.md`와 이 기록을 갱신했다. API·DB·공개 타입·
의존성·CI workflow·러너·위생 정책 변경은 없다. 불변 관리자 빌드/번들/Sites는
직전 `d2f20f7`의 결과를 재사용했고 전체 백엔드 검사는 변경 없어 생략했다.
일반 소스 lint 명령은 없다. 실제 서비스 설치·원격 OIDC/DB·배포·모바일 브라우저는
미검증이고 푸시·게시·배포는 하지 않았다. 전체 목표는 계속 진행 중이다.

## 이벤트 상세 시간대 불일치 차단 — 2026-10-12

`LiveDashboard`가 상세 응답의 프로젝트 시간대를 대조하지 않아, CSV에서는 거부하는
응답을 일별 차트에는 표시하던 경로를 수정했다. 기존 `assertMeta`를 값 분석 전에
호출해 현재 레지스트리·요청 기간·출처·coverage와 일치하는 상세만 표시한다.
API 클라이언트가 보장하는 프로젝트·버전·기간·출처 검사는 그대로 유지한다.

`verify:admin-analysis-access`에 로컬 서명 API의 정상 상세 응답을 다른 유효 시간대
(`America/New_York`)로 바꾸는 브라우저 회귀를 추가했다. 수정 전 실행은
`mismatched-event-time-zone`에서 종료 1이었고, 실패 화면에는 Asia/Seoul 프로젝트의
일별 차트와 활성 CSV 버튼이 남았다. 수정 후 Chromium 156.0.8078.4 실행은 종료 0·
verified=true로 계약 오류·차트 없음·CSV 잠금, 정상 응답 재시도 뒤 차트와 실제 다운로드
CSV의 Asia/Seoul·선택 이벤트 행을 확인했다. 권한 회수·다른 프로젝트 CSV·늦은 거부
응답·연결 해제 회귀도 통과했다. reads 29·writes 0·browserBatches 0·pageErrors 0·
routeError=false였고 리포트는 `.tmp/admin-analysis-access-Uj9soi/report.json`이다.
로컬 Vite·Miniflare·브라우저는 종료했다. 응답 변경은 합성 route 주입이며 실제 운영
서버에서 시간대 불일치가 발생했다는 증거는 아니다.

관리자 타입 검사·빌드, 번들 분리·Sites 11/11, `git diff --check`는 통과했다.
관리자 전체 검사는 242개 중 241개 통과·1개 실패였다. 실패한 기존
`funnel-setup.test.mjs` 크기 검사는 관리자 UI가 아닌 `packages/browser/src/funnels.ts`
생성 통합 코드를 직접 번들링하며, gzip 3,099바이트로 3,072바이트 예산을 넘었다.
이 결과를 전체 통과로 취급하지 않고 별도 SDK 크기 후속으로 남긴다.

설계 기준 문서 `docs/frontend/FRONTEND_DESIGN.md`와 이 검증 기록만 갱신했다.
API·DB·SDK·의존성·CI·러너·위생 정책은 변경하지 않았다. 변경 없는 전체 백엔드 검사와
일반 소스 lint(명령 없음)는 생략했다. 실제 운영 OIDC·원격 DB는 미검증이고
푸시·게시·배포는 하지 않았다. 전체 목표의 완료로 표시하지 않는다.

## 서버 SDK 배치 빈 항목 검증 — 2026-10-12

`send`가 `Array.map`으로 이벤트를 검사하면서 희소 배열의 빈 칸을 건너뛰고, 이를 JSON의
`null`로 전송하던 경로를 수정했다. 고정한 배치 길이의 모든 위치가 배열 자신의 항목인지
확인한 뒤 이벤트 스냅샷을 만든다. 잘못된 항목은 `invalid_event`·`attempts: 0`으로
거부하며 자격증명 조회·HTTP 요청·재시도를 시작하지 않는다.

새 `packages/server/test/batch-slots.test.ts`의 소스·minified ESM 검사 2개는 수정 전
모두 실패했고, 수정 후 `npm run test:server` 26/26이 통과했다. 빈 배열 슬롯·앞/중간/끝
빈 칸·삭제된 항목·상속 항목·undefined·null 거부와, 실패 후 동일 클라이언트의 정상
동결 배치 전송을 확인했다. 정상 본문은 Core `parseServerBatch`로 직접 검사한다.
이 검사는 Node 합성 transport이며 실제 HTTP·원격 수집기 검증은 아니다.

`npx --no-install tsc --noEmit`, `npm run build:server`(타입 선언 포함),
`git diff --check`를 통과했다. 서버 SDK는 런타임 의존성 0개, minified 9,008바이트·gzip
3,699바이트다. 소유 문서 `docs/backend/server-sdk.md`와 이 기록만 갱신했다.
API·DB·공개 타입·의존성·저장소 위생·CI 러너 변경은 없다. 변경 없는 관리자·브라우저·
전체 백엔드 검사는 생략했으며 일반 소스 lint 명령은 없다. 실제 운영 OIDC·원격 DB는
미검증이고 푸시·배포는 하지 않았다.

## 프로젝트 생성 알림 예외 격리 — 2026-10-12

`ProjectCreator`의 최초 구독 통지·상태 변경 통지와 `onOpened` 인계 콜백에서 동기 예외가
성공한 POST의 receipt·생성 완료 상태를 바꾸거나 나머지 구독자 통지와 열기 인계를 막는
경로를 수정했다. 생성·설정 조회 상태를 알린 뒤 generation과 파괴 여부를 다시 확인해, 종료된
화면에서는 새 요청이나 인계를 시작하지 않는다. 파괴된 뒤 등록한 구독자는 호출하지 않는다. 새
`project-notifications.test.mjs` 5개는 수정 전 5/5 실패했다. 수정 후 project-notifications·
project-creation·request-lifecycle 검사 합계 27/27이 통과했다.

`npm run typecheck:admin`, `npm run build:admin`, `node --test
apps/admin/tests/bundle-split.test.mjs apps/admin/tests/sites-worker.test.mjs` 11/11,
`git diff --check`를 통과했다. `npm run verify:admin-onboarding -- --channel chromium
--lost-responses`는 exit 0·verified=true였고 Chromium 156.0.8078.4에서 emptyProjectCreated·
schemaPublished·generatedSdkExecuted·correctOnboardingStep·eventVisible·lostResponseRecovery가
모두 true, firstEventCount 1, 유실된 생성 1·발행 1, 교체 대화상자 3, routeError=false·
pageErrors=0, auth 1·exchanges 1·refreshes 0, API 읽기 31·쓰기 5, 브라우저 배치 1이었다.
이 실행은 로컬 서명 OIDC·D1 smoke이며, UI 콜백 예외는 합성 포트로 주입한 단위 검사이고
브라우저에서 예외를 직접 주입한 검사는 아니다.

설계 기준 문서 `docs/frontend/FRONTEND_DESIGN.md`와 이 검증 기록을 갱신했다. API·DB·SDK·
의존성·위생 정책·CI 러너 변경과 소스 계약 변경은 없다. 변경 없는 전체 백엔드 검사는
생략했고 일반 소스 lint 명령은 없다. 실제 운영 OIDC 제공자·도메인·원격 DB는 미정·미검증이며
푸시·배포는 하지 않았다.

## 스키마 편집기 알림 예외 격리 — 2026-10-12

`SchemaEditor`의 초기 구독·상태 변경·권한 상실 통지에서 동기 예외가 조회와 검증·발행
결과를 바꾸거나 다음 구독자·부모 권한 갱신을 막는 경로를 수정했다. 새
`schema-notifications.test.mjs` 5개는 수정 전 모두 실패했다. 수정 후 스키마·설정·권한
알림·요청 수명 검사 합계 59/59가 통과했다. 초기 통지, 검증 결과 보존, 확인된 발행
상태와 단일 쓰기 유지, 초안 보존·권한 잠금·권한 신호 재활성화, 파괴 후 구독을 확인했다.
콜백 예외는 합성 client 포트로 주입했으며 실제 HTTP 인증이나 브라우저 예외 주입은 아니다.

`npm run typecheck:admin`, `npm run build:admin`, 번들·Sites 검사 11/11,
`npm run verify:admin-access -- --channel chromium`을 통과했다. 브라우저 검사는
verified=true, Chromium 156.0.8078.4, 검증/설정 거부 각 1회, 섹션 사이 권한 갱신·
초안 보존·명시적 복구·프로젝트 전환 뒤 늦은 응답 폐기·연결 해제 모두 true였다.
보류 쓰기 2회, routeError=false·pageErrors=0, API 읽기 130·쓰기 요청 5,
브라우저 배치 0이었다. 이 실행은 기존 권한/수명 회귀 검사이며 새 콜백 예외 경로를
브라우저에서 직접 재현한 검사는 아니다. 도구는 로컬 Vite·Miniflare·브라우저를 정리했다.

설계 기준 문서 `docs/frontend/FRONTEND_DESIGN.md`와 이 검증 기록을 갱신했다.
API·DB·SDK·의존성·위생 정책·CI 러너 변경은 없다. 변경 없는 전체 백엔드 검사는
생략했고 일반 소스 lint 명령은 없다. 실제 운영 OIDC 제공자·원격 DB는 미검증이며
푸시·배포는 하지 않았다.

## 브라우저 SDK 종료 속성 검증 — 2026-10-12

`succeed([])`나 `fail(0)`처럼 객체가 아닌 속성이 빈 객체로 바뀌어 정상 종료로
기록되고 핸들이 소진되던 문제를 수정했다. 배열·null·원시값·함수는 속성을 복사하기
전에 거부한다. 잘못된 입력 뒤 올바른 호출은 같은 핸들로 가능하며, 시작 dimensions를
한 번 합쳐 비교·전송하여 중복 복사를 줄였다. 생략한 속성과 빈 객체는 계속 허용한다.

새 `terminal-input.test.ts`는 수정 전 3개 중 2개가 실패했다. 수정 후
`npm run test:browser` 45/45, `npm run build:browser`(타입 선언 포함),
`npm run check:browser-size`, `git diff --check`를 통과했다. 빌드된 SDK를 실제 Node에서
불러온 완료·실패 복구 스모크도 2/2 통과했고 전송 본문은 Core `parseBatch`로 확인했다.
gzip 크기는 기본 SDK 2,787바이트·Sembom 예제 포함 3,067바이트·퍼널 예제 포함
3,072바이트로 기존 3KiB 예산을 유지했다.

소유 문서는 브라우저 SDK 안내와 이 검증 기록만 변경했다. API·DB 계약·공개 타입·
의존성·위생 정책·CI 러너 변경은 없다. 변경 없는 관리자·백엔드 전체 검사는 생략했고,
일반 소스 lint 명령은 없다. 실제 서비스 연동·원격 운영은 미검증이며 푸시·배포는 없다.

## 브라우저 SDK 날짜형 재시도 안내 — 2026-10-12

`packages/browser`의 재시도 대기가 정수 초와 표준 IMF-fixdate(예 `Thu, 08 Oct
2026 15:01:15 GMT`)를 함께 처리한다. `common.ts`는 정규 UTC 문자열 왕복 파싱으로
날짜를 받아들이고, 남은 시간은 브라우저 호스트 현재 시각 기준으로 계산한다. 하한은
1초라 이미 지난 시각도 1초를 기다리고, 형식이 어긋나면 1·2초 백오프를 쓴다. 대기가
배치 시작부터 10분 이상이 되면 재전송 없이 버리고, `flush`와 숨김 콜백은 대기를
우회하지 못하며 재시도는 원래 ID·시각·본문을 유지한다. 새
`packages/browser/test/retry-after.test.ts` 6개는 수정 전 HEAD에서 6/6 실패했고 수정
후 전체 `npm run test:browser` 42/42를 통과했다.

esbuild minified `build.test` 2개는 HTTP-date 헤더 대기 검증으로 넓혀 별도 2/2를
통과했다(기존 42개에 포함되므로 44로 합산하지 않는다). 첫 확장 실행은 fixture 시각이
50ms 밀린 탓에 HTTP-date 초 정밀도와 어긋나 59999ms 기대값으로 2/2 실패했고, 대기
시간을 HTTP-date 기준 차이로 계산하도록 fixture를 고친 뒤 2/2를 통과했다. 이 실패는
검사 fixture 문제이며 제품 결함이 아니다. 전체 42/42 뒤에는 검사 파일만 바뀌어 관련
2/2만 다시 확인했고 `npm run build:browser`, `npx --no-install tsc --noEmit`,
`git diff --check`, `npm run check:browser-size`(sdk 2786·Sembom 3065·funnelSdk 2947·
funnelExample 3072 gzip bytes, 예산 3072)는 같은 결과를 재사용했다.

검사는 합성 호스트 fake clock, esbuild minified 번들, Node 네이티브 어댑터 대역으로만
확인했고 실제 Chromium 실행과 원격 서비스는 검증하지 않았다. 변화가 없는 기존 백엔드·admin
전체 검사는 돌리지 않았고 lint 스크립트는 없다. API·DB·공개 타입·의존성·CI·runner·위생
변경은 없고 SDK 재시도 동작 확장과 소유 문서 `docs/backend/browser-sdk.md`·
`docs/backend/event-contract.md` 갱신만 있었으며 푸시·배포는 하지 않았다.

## 브라우저 SDK 이름·식별자 원시 문자열 검사 — 2026-10-12

`packages/browser`가 이벤트 이름·workflow ID·attempt ID·이벤트 ID를 강제 변환 전에
원시 문자열인지 검사하도록 좁혔다. 이벤트 이름은 `common.ts`의 스냅샷이, `start`의
workflow ID·attempt ID는 `index.ts`가, 이벤트 ID는 `common.ts`의 enqueue가
`typeof === 'string'`을 통과해야 한다. `toString`·`toJSON`을 가진 객체는 이 단계에서
거부되므로 등록 조회나 직렬화가 일어나지 않고, 등록되지 않은 내용이 이름·식별자 자리에
실려 나가지 않는다.

수정 전 HEAD를 `.tmp`에 격리한 대역 호스트에서는 `track({ toString: () => 'view',
toJSON: () => 'unregistered text 한글' }, { tool: 'loan' })`이 `true`를 돌려주고 flush
뒤 전송 본문의 이벤트 이름이 `unregistered text 한글`로 기록됐다. 이는 합성 SDK 본문
증거이며 실제 HTTP·수집기·브라우저 실행이 아니다. 새
`packages/browser/test/identities.test.ts` 4개는 수정 전 HEAD를 격리해 같은 파일을
돌리면 3개가 실패하고 1개만 통과했다.

배치 16384와 이벤트 16000 한도는 UTF-8 바이트가 아니라 JavaScript 문자열 길이로 재도록
바꿨다. 직렬화되는 이름·키·enum은 ASCII 패턴으로 제한되고 UUID·ISO 시각·불리언·정수도
ASCII라서 두 값이 같지만, 자유 문자열이나 비ASCII 값을 허용 범위에 넣는 확장을 하면
UTF-8 바이트 측정으로 되돌려야 한다. 스키마 32768 한도는 이전부터 문자열 길이
기준이고 이번에 바뀌지 않았다.

최종 `npm run test:browser` 36/36, `node --test
apps/admin/src/api/funnel-setup.test.mjs` 6/6, `npm run build:browser`,
`npx --no-install tsc --noEmit`, `npm run check:browser-size`(sdk 2754·Sembom
3034·funnelSdk 2919·funnelExample 3043 gzip bytes, 예산 3072), `git diff --check`를
통과했다. 네이티브 어댑터 검사는 Node 전역 `fetch`·`Response` 대역을 쓰며 실제
Chromium 실행이 아니고, 이번 변경의 실브라우저·배포 수집기 smoke는 없다. API·DB 공개
계약은 그대로이며 SDK 검증만 강화했고 의존성·CI·runner·위생 정책 변경과 푸시·배포는
없다. 변경 범위 밖인 전체 백엔드 검사와 관리자 전체 빌드는 생략했고 lint 스크립트는 없다.
기준 문서 `docs/backend/browser-sdk.md`와 이 기록을 갱신했다.

## 권한 편집기 알림 예외 격리 — 2026-10-12

`GrantEditor`와 `PublisherEditor`의 `subscribe` 최초 통지와 `#set` 구독자 호출에서
동기 예외가 상태 갱신 밖으로 전파되던 경로를 수정했다. 각 호출을 감싼 `#notify`는
파괴된 편집기에서 콜백을 부르지 않고 돌아온다. 새
`apps/admin/src/api/permission-notifications.test.mjs` 4개는 수정 전 모두 실패했고(유효
fixture로 재실행 확인), 수정 후 관련 grant-editor·publishers·settings-editor·요청 수명
검사와 합계 36/36이 통과했다. 기존 `onSaved`·`onAccessLost` 격리는 유지했다. 이 fault는
client 포트를 대역으로 바꾼 합성 notification 검사이며 실제 인증·브라우저에서 알림 예외를
주입한 검사는 아니다.

`npm run typecheck:admin`·`npm run build:admin`,
`node --test apps/admin/tests/bundle-split.test.mjs apps/admin/tests/sites-worker.test.mjs` 11/11,
`npm run verify:admin-access -- --channel chromium`을 통과했다. 브라우저 검사는 exit 0,
verified=true, Chromium 156.0.8078.4, 스키마·설정 권한 거부 각 1회,
crossSectionPermissionsRefreshed·preservedDraft·explicitPermissionRecovery·
staleWriteAcrossProjectSwitchIgnored·disconnectedUiCleared·serverCommitsNotRolledBack 모두 true,
heldWrites 2, routeError=false·pageErrors=0, authorizations 1·exchanges 1·refreshes 0,
API 읽기 128·쓰기 요청 5, 브라우저 배치 0이었다. 이 브라우저 실행은 기존 설정/스키마
회귀 smoke이고 이번 grant/publisher 알림 예외 경로를 겨냥하지 않았다.

API·DB·SDK·의존성·CI·runner·hygiene은 바꾸지 않았고 푸시·배포도 없다. lint 스크립트가 없어
린트를 생략했고, 변경 없는 전체 백엔드 검사와 native 운영 검사는 변경 범위가 admin 편집기
알림 격리뿐이라 생략했다. 실제 운영 OIDC 제공자와 원격 DB는 미검증이다. 설계 기준 문서
`docs/frontend/FRONTEND_DESIGN.md`와 이 검증 기록을 갱신했다.

## 설정 편집기 콜백 격리 — 2026-10-12

`SettingsEditor`의 UI 구독자 호출과 `onSaved`·`onAccessLost` 콜백이 던진 동기
예외가 상태 갱신 밖으로 전파되던 경로를 수정했다. 새
`apps/admin/src/api/settings-editor.test.mjs` 5개는 수정 전 모두 실패했고, 확인된 저장
결과가 `ready` 대신 review에 머물거나 성공한 조회가 error로 처리되고 던진 구독자·권한
콜백이 나머지 통지와 잠금 처리를 끊는 재현이었다. 수정 후 settings-editor·client·요청
수명 검사 합계 55/55가 통과했다. 이 콜백 fault는 합성 단위 검사로만 확인했고 브라우저에서
콜백 예외를 재현한 것은 아니다.

`npm run typecheck:admin`·`npm run build:admin`, `node --test
apps/admin/tests/bundle-split.test.mjs apps/admin/tests/sites-worker.test.mjs` 11/11,
`git diff --check`를 통과했다. `npm run verify:admin-access -- --channel chromium`은
verified=true, Chromium 156.0.8078.4, 스키마·설정 권한 거부 각 1회, 보류 저장 2회,
crossSectionPermissionsRefreshed·preservedDraft·explicitPermissionRecovery·
staleWriteAcrossProjectSwitchIgnored·disconnectedUiCleared·serverCommitsNotRolledBack
모두 true, routeError=false·pageErrors=0, API 읽기 127·쓰기 요청 5, 브라우저 배치 0이었다.

이 브라우저 실행은 기존 정상/권한/유실/프로젝트 전환 회귀 스모크이고 이번 콜백 격리
경로를 단독으로 겨냥하지는 않았다. API·DB 계약, UI 레이아웃, SDK, 의존성, CI와 runner는
바꾸지 않았고 푸시·배포도 없다. 변경 없는 전체 백엔드 검사는 생략했고 lint 스크립트가
없어 린트도 생략했다. 실제 운영 OIDC 제공자와 원격 DB는 미검증이다. 설계 기준 문서와
검증 기록도 갱신했다.

## 서버 프로젝트 권한 경계 — 2026-10-12

기존 HTTP/D1 권한 검사 31개, 퍼널·서버 이벤트·생성 권한 검사 10개와 설치 접근 검사
3개를 실행해 모두 통과했다. 다른 프로젝트·발급자, 권한 회수, 저장 직전 소유권 재확인과
마지막 owner 보호를 확인했다. 정확한 명령·범위·제한은
`docs/ops/admin-server-access-audit-2026-10-12.json`에 기록했다.

앞선 41개는 인증 검증 포트를 시험 대역으로 바꿔 grant 경계를 검증한다. 추가 3개는
일회용 RS256 키·로컬 JWKS와 실제 프록시/D1을 사용해 관리자 토큰 허용, 게시자용
audience 거부, 잘못된 upstream 신원 중단, 보고서 비밀정보 제거와 DB 상태 보존을 확인했다.
저장소 장애 검사는 로컬 D1을 의도적으로 종료해 workerd 소켓 오류와 예상 503을 확인했다.
운영 제공자·원격 DB와 모든 grant 사례의 서명 토큰 조합을 검증한 것은 아니다.

이 범위에서 추가 제품 수정은 필요하지 않았다. 제품/API/DB/의존성/CI 변경과 푸시·배포는
없고, 전체 저장소 준비가 완료됐다고 판단하지 않는다.

## 설정·스키마 사이 권한 갱신 — 2026-10-12

스키마 검증의 403 뒤에도 프로젝트 설정 입력이 활성인 문제를 실제 Chromium에서
재현했다. 두 편집기는 확인된 owner 권한이 reader 또는 401/403으로 바뀔 때 부모에
알리고 같은 프로젝트의 섹션을 재조회한다. 실패 시 보존한 과거 snapshot으로 알림을
다시 활성화하지 않아 반복 조회를 막는다. 초안과 명시적 복구 절차는 유지한다.
설정 복구 화면에는 최신 응답을 이미 받은 경우에도 `최신 설정 확인`을 제공한다.

관련 controller/요청 수명 회귀 검사 76/76, 관리자 타입 검사·빌드, 번들/Sites 검사
11/11, runner 구문과 whitespace 검사를 통과했다. 확장한 `verify:admin-access`도
verified=true였다: Chromium 156.0.8078.4, 스키마·설정 403 각 1회, 양방향 섹션 잠금·
두 초안 보존·명시적 재조회/복구, 프로젝트 전환·연결 해제 후 늦은 저장 응답 폐기를
확인했다. API 읽기 128·쓰기 요청 5, 보류한 저장 2, route/pageerror 0이었다.

수정 전 검사 실패는 설정 입력이 잠기지 않은 재현이다. 첫 수정 검사는 권한 복구 뒤
설정 재확인을 하지 않은 runner가 프로젝트 전환 단계에서 실패했고, 명시적 설정
복구를 포함한 최종 검사는 통과했다. 합성 로컬 로그인·D1이며 운영 제공자는 미검증이다.
Frontend 설계·옵트인 검증 안내를 갱신했다. API/DB 계약·SDK·의존성·hygiene·CI는
변경하지 않았다. 변경 없는 전체 백엔드 검사는 생략했고 lint 명령은 없다. 푸시·배포 없음.

## 스키마 권한 거부·프로젝트 전환 중 저장 — 2026-10-12

권한을 잃은 뒤 스키마 검증 POST가 401/403으로 거부돼도 기존 owner snapshot으로 편집이
가능한 것처럼 표시되던 경로를 수정했다. 신규 회귀 검사에서 수정 전 canEdit=true로 실패했다.
SchemaEditor는 검증·발행·목록/버전 조회의 권한 거부를 blocked/review로 반영한다.
초안은 보존하되 편집·검증·발행과 기존 검증/개인정보 확인을 잠근다. 조회 실패가 반복돼도
잠금은 유지한다. 성공한 최신 설정 조회 뒤 명시적 서버/초안 선택으로만 복구한다.
화면은 이 상태를 소유자 대신 `권한 확인 필요`로 표시한다.

새 옵트인 `npm run verify:admin-access -- --channel chromium`은 합성 서명 제공자와 새 D1을
사용했다. 로컬 운영 도구로 실제 owner→reader→owner 권한을 변경한 뒤 UI 검증이 실제
403으로 거부되고 초안/잠금/권한 표시와 명시적 복구가 이어짐을 확인했다. 이어 설정 PATCH를
서버에 저장한 뒤 응답을 보류하고 프로젝트 전환과 연결 해제를 각각 수행했다. 이전 저장
응답이 새 프로젝트/연결 해제 화면을 바꾸지 않았고, 서버에 이미 저장한 이름은 DB에 남았다.
이것은 UI 취소가 서버 커밋을 되돌린다는 증거가 아니다.

최종 실행은 verified=true, Chromium 156.0.8078.4, 실제 검증 거부 1회, 보류된 저장 2회,
API 읽기 49·쓰기 요청 4, routeError=false·pageErrors=0, 쿠키/local/session storage 비어
있음이었다. 결과는 `.tmp/admin-access-U4BO8H/report.json`이다. 첫 브라우저 시도는 복수
checkbox를 단일 항목으로 찾는 검사 오류로 권한 복구 단계에서 실패했다. 개인정보 검토
checkbox의 정확한 이름으로 수정한 다음 성공했고 초기 실패 자료는 보존했다.

스키마/생성/번들 검사 36/36, 관리자 타입·빌드, runner/fixture 구문과 whitespace 확인이
통과했다. 기존 `verify:admin-onboarding -- --channel chromium --lost-responses`도
verified=true·첫 이벤트 1·단계 3·pageerror 0으로 통과했다. 테스트용 access 프로필만
추가하고 기존 GET 전용 login·onboarding 프로필을 유지했다. 모든 브라우저/Vite/Miniflare를
종료했다. runner는 기본 검사나 CI에 자동 추가하지 않았다.

Frontend 설계·README·권한 검증 안내와 이 기록을 갱신했다. API/DB 계약·백엔드·SDK·
의존성·hygiene·CI 변경과 푸시·배포는 없다. 변경 없는 전체 백엔드 검사는 반복하지 않았고
일반 lint 명령은 없어 생략했다. 실제 운영 제공자/원격 DB, 전 역할·조직 경계와 기기별
동작은 아직 미검증이며 이번 사용자 경로로 전체 준비가 완료됐다고 판단하지 않는다.

## 생성·발행 응답 유실 뒤 실제 화면 복구 — 2026-10-12

`verify:admin-onboarding`에 옵트인 `--lost-responses`를 추가했다. 합성 서명 로그인과 새 로컬
D1을 사용하고, 프로젝트 생성·v1 발행을 실제 서버에서 완료한 다음 성공 응답만 브라우저에
전달하지 않는다. 생성 확인은 사용자가 누른 동일 요청으로 수행하고, 발행 확인은 GET으로
읽어 추가 PUT 없이 복구한다. 초안 잠금·보존, 검증/개인정보 검토 초기화, 다음 버전 번호,
온보딩 3단계와 생성된 SDK의 첫 이벤트까지 이어서 확인한다. 기본 검사·CI에는 추가하지 않았다.

최종 `npm run verify:admin-onboarding -- --channel chromium --lost-responses`는 exit 0,
`verified:true`, Chromium 156.0.8078.4였다. 응답 유실은 생성/발행 각 1회, 관리자 쓰기는
4회(생성·명시적 동일 생성 확인·정의 검증·발행), 읽기 29회였다. 프로젝트 행 1건,
생성한 SDK의 배치 1회·DB/관리자 표 이벤트 1건, routeError=false·pageErrors=0,
쿠키/local/session storage 비어 있음을 확인했다. 새 재발행은 없었다. 브라우저·Vite·로컬
런타임을 종료했고 결과는 `.tmp/admin-onboarding-OUHKLZ/report.json`에 있다.

처음 실행은 편집 불가 입력을 disabled로 잘못 검사해 실패했다. 실제 폼은 readOnly이므로
isEditable=false로 고친 다음 통과했다. 초기 실패 사진·보고서는 원래 임시 폴더에 보존했다.
`node --test --test-timeout=30000 apps/admin/src/api/project-creation.test.mjs
apps/admin/src/api/schema.test.mjs` 32/32, 두 runner/fixture 구문 검사, git diff --check도
통과했다. 제품 소스·SDK가 변경되지 않아 기존 빌드를 재사용하고 앱 타입/빌드·전체 백엔드
검사를 반복하지 않았다. 일반 lint 명령은 없어 생략했다.

README·온보딩 검증 안내와 이 기록을 갱신했다. API·DB·제품 UI·의존성·hygiene·CI 변경은
없고 옵트인 검증 모드만 추가했다. 실제 운영 제공자·원격 DB·운영 장애는 미검증이다.
푸시·배포·활성화 없음. 이번 경로 통과로 모든 역할/권한 경계가 검증됐다고 판단하지 않는다.

## 새 프로젝트에서 첫 이벤트 조회까지

실제 Chromium·로컬 서명 인증·새 D1로 빈 프로젝트 목록에서 시작해 UI로 프로젝트를 만들고,
이벤트 정의 검증·개인정보 검토·v1 발행을 거친 뒤 UI가 만든 브라우저 SDK 연결 코드를 그대로
컴파일해 실행했다. 첫 이벤트가 `event_daily_counts`에 정확히 1건 저장됐지만 상단 단계는
`2 이벤트 스키마`로 남는 문제를 재현했다. 최초 발행 때 버전 입력이 이미 1이라 부모 스키마
조회가 다시 실행되지 않았다. 발행 알림 `setupRefreshTick`도 조회 의존성에 넣어 수정했다.

옵트인 `npm run verify:admin-onboarding -- --channel chromium`은 이 사용자 흐름을 재검증한다.
먼저 `npm run build:browser`로 현재 SDK를 빌드한다. onboarding 프로필만 합성 계정의 생성
권한과 로컬 HTTP를 허용하고, 기본 로그인 fixture의 GET 전용 동작은 유지한다. Vite 캐시는
실행별 새 디렉터리에 두고 90초 제한·고정 실패 단계·브라우저/서버/D1 종료를 적용한다.
검증 중 첫 SQL 테이블명 오류는 실제 `event_daily_counts`로 바로잡았다. 두 Vite 검증을 함께
실행한 시도는 로그인 단계에서 실패해 성공으로 세지 않았고, 캐시 분리 후 순차 실행했다.

최종 새 프로젝트 검증은 종료 코드 0·`verified:true`, Chromium 156.0.8078.4였다.
상단 `3 SDK 연결`, 생성 SDK 실행, DB·관리자 이벤트 표 1건, API 쓰기 3(생성·정의 검증·발행),
브라우저 배치 1, 로그인 교환 1, `routeError:false`, `pageErrors:0`을 확인했다. local/session
storage와 쿠키는 비었다. 보고서는 `.tmp/admin-onboarding-*/report.json`에 있고 원문 토큰·
URL·계정 식별자는 넣지 않는다. 실패 사진도 이 합성 환경의 로컬 디렉터리에만 남는다.

기존 `npm run verify:admin-login -- --channel chromium`은 종료 코드 0·`verified:true`,
서명 API 읽기 27·쓰기 0·배치 0·pageerror 0과 기존 PKCE/갱신/재로그인/정리 검사를 통과했다.
`npm run typecheck:admin`, `npm run build:admin`, 번들 검사 2/2, 두 스크립트 구문 검사와
`git diff --check`도 통과했다. API·DB·SDK 계약·의존성·CI 변경은 없다. 새 명령은 기본 검사나
CI에 자동 추가하지 않았다. 변경 없는 전체 백엔드 검사는 반복하지 않았고 일반 소스 lint는
명령이 없어 생략했다. 실제 운영 제공자·원격 배포·전체 저장소 점검 완료와 구분한다.

## 첫 실행 샘플 체험 경로

로그인 제공자가 없는 관리자 화면에 `/demo` 샘플 체험 링크를 연결했다. 데모 상단은
샘플 데이터와 화면 내 변경임을 알리고 `/` 관리자 로그인으로 돌아가는 링크를 제공한다.
운영 인증·등록 데이터와 샘플을 섞거나 실제 API 접근을 열지 않는다.

`npm run typecheck:admin`, `npm run build:admin`, 번들·Sites 검사 11/11,
`git diff --check`를 통과했다. ignore된 `.tmp/admin-first-run-smoke.mjs`에서 실제 Vite와
Chromium 156.0.8078.4로 키보드 Enter를 사용해 `/` → `/demo` → `/`를 이동하고 샘플
이벤트 분석·목표 화면을 확인했다. 320px 페이지 가로 넘침 없음·API 요청 0·pageerror 0·
local/session storage 0을 확인했다. 결과는 `.tmp/admin-first-run-smoke.json`에 있다.

기존 인증 경로도 `npm run verify:admin-login -- --channel chromium`으로 확인했다.
새 로컬 D1·합성 서명 제공자로 PKCE·콜백 제거·서명된 API 접근·공유 갱신·실패 뒤 로그인·
연결 해제·새로고침 상태 제거를 통과했다(`verified:true`, `apiReads:27`, `pageErrors:0`).
실제 운영 제공자를 연결한 검사가 아니며 브라우저·서버·로컬 런타임은 종료했다.

변경 없는 전체 백엔드 검사는 반복하지 않았고 일반 소스 lint는 명령이 없어 생략했다.
API·DB·SDK 계약·의존성·위생 정책·CI 변경은 없다. 실제 운영 환경은 미검증이며
푸시·배포·활성화는 없다. 이 수정은 전체 저장소 점검 중 첫 사용 흐름의 한 개선이다.

## 프로젝트 페이지 병합·새로고침 복구 — 2026-10-11

`LiveDashboard`의 목록 새로고침과 첫 페이지 조회 시작은 진행 중인 다음 페이지 요청을
취소하고 커서를 비운다. 준비된 목록에서만 추가 조회하고 ref로 중복 요청을 막는다. 종료된
이전 요청은 새 요청의 로딩 상태를 바꾸지 않는다. 설정 화면의 최초 목록 조회가 실패하면
`다시 시도`가 목록을 재조회한다. `appendPage`는 ID별 최신 행을 병합하고 서버식 ID 순서로
정렬하므로 신규 프로젝트가 다음 페이지에서 다시 와도 한 번만 표시한다. 입력 배열은 보존한다.

신규 병합 회귀 검사는 수정 전 1/1 실패했다. 실제 Vite 미리보기와 Chromium에서 다음 페이지를
대기시킨 뒤 목록을 새로고침하고 이전 응답을 보내자 새 목록 `beta`에 이전 `zeta`가 섞였다.
최초 검증 스크립트의 응답 정리 중복 호출 오류는 별도로 수정했다. 제품 수정 후 같은 화면에서
새 목록은 `beta`만 남고 추가 조회는 새 커서 `beta`로 `gamma`를 받아 중복 없이 표시했다.
설정 화면에서 최초 목록을 503으로 실패시킨 뒤 `다시 시도`로 복구됐고 실패 상태의 이전
`더 불러오기` 버튼은 없었다. `pageerror=0`, Chromium 156.0.8078.4, 스크립트 종료 코드 0이다.
기록은 ignore된 `.tmp/admin-pagination-smoke.json`이며 브라우저·개발 서버는 종료했다.

`node --test --test-timeout=30000 apps/admin/src/api/client.test.mjs` 35/35,
`npm run typecheck:admin`, `git diff --check`를 통과했다. 최초 타입 검사에서 새 가드 뒤의
불필요한 abort 분기가 `never` 오류를 내 제거한 뒤 다시 통과했다. 관리자 설계 문서와 이
기록을 갱신했다. API·DB·SDK 계약·의존성·위생 정책·CI 러너 변경은 없다. 변경 없는 전체
백엔드/앱 빌드는 반복하지 않았고 일반 소스 lint는 명령이 없어 생략했다. 로컬 합성 응답으로
검증했으며 실제 운영 데이터·제공자·원격 배포는 미검증이다. 푸시·배포·활성화는 없다.

## 관리자 API 리다이렉트 거부 — 2026-10-11

관리자 `ApiClient`의 모든 native fetch 요청에 `redirect: 'error'`를 적용하고 `FetchOption`에
`redirect?: 'error'`를 추가했다. 먼저 회귀 검사를 추가해 수정 전 로컬 Node native fetch +
HTTP 서버에서 307 GET·PATCH가 모두 목적지로 자동 추적되는 것을 확인했고, 신규 회귀 검사와
상위 검사가 실패하며 목적지 요청이 2건(`targetRequests=2`)이었다.

수정 후 `node --test --test-timeout=30000 apps/admin/src/api/request-lifecycle.test.mjs
apps/admin/src/api/client.test.mjs` 48/48과 `npm run typecheck:admin`, `git diff --check`를
통과했다. 조회·저장 모두 리다이렉트 목적지 요청 0, 자동 재시도 없음, 같은 클라이언트로 이후
정상 조회 복구를 확인했다. 실패는 기존 고정 network 오류로 처리되고 설정 편집기의 최신 상태
재조회 흐름을 유지한다.

브라우저 smoke는 별도 범위다. ignore된 `.tmp/admin-redirect-smoke.mjs`로 실제 Vite 로컬
미리보기와 Chromium 156.0.8078.4에서 앱 프로젝트 개요를 열고 소스 `ApiClient`·`SettingsEditor`를
브라우저에서 import해 확인했다. GET/PATCH 307 실패는 고정 network·status 0, 목적지 요청 0회,
같은 클라이언트 정상 재조회 복구였다. 설정 저장 redirect 실패 뒤 phase=review와 초안
`Changed` 보존, 중복 save의 추가 PATCH 없음, `checkLatest`+`keepChanges` 뒤 phase=ready·초안
`Changed`, `pageerror=0`을 확인했고 결과는 `.tmp/admin-redirect-smoke.json`이다. 개발 서버·
브라우저를 종료하고 스크립트 exit 0을 확인했다. 첫 실행은 루트에 Playwright가 없어 import가
실패했고 `tools/browser-bench/node_modules/playwright/index.mjs` 참조로 고친 뒤 성공했으며
의존성 설치·변경은 없었다.

전체 백엔드 검사는 변경 범위 밖이라 생략했고 일반 소스 lint 명령이 없어 생략했다. 실제 운영
제공자·원격 배포는 미검증이며 푸시·배포·활성화는 없다. API·DB·SDK 계약, 의존성, 위생 정책,
CI 러너 변경은 없다.

## 설치 파일 쓰기 실패·취소 정리 — 2026-10-11

공유 설치 writer는 `wx`로 파일을 생성한 직후 정리 목록에 넣고, 열린 파일에 내용을 쓴다.
기존에는 쓰기가 완료된 파일만 추적했으므로 생성 후 일부 내용을 쓰다가 실패하면 해당 파일이
목록에 없었다. 쓰기 전·중·후 취소를 확인하고 파일 핸들을 닫은 뒤 이번 실행의 파일만 정리한다.
기존 디렉터리 거부와 다른 실행이 만든 파일의 덮어쓰기 방지는 유지한다.

`node --test --test-timeout=30000 tools/runtime/test/installation.test.ts
tools/runtime/test/installation-setup.test.ts` 11/11, `npx --no-install tsc --noEmit`,
`git diff --check`를 통과했다. 실제 임시 파일에 두 번째 파일의 일부 내용을 쓴 뒤 실패/취소를
주입해 두 파일과 출력 디렉터리가 정리되고 열린 핸들이 모두 닫히는 것을 확인했다. 두 번째
경로에 다른 실행의 파일이 먼저 생기면 `EEXIST`로 거부하고 그 파일만 남는 것도 확인했다.
정상 생성·기존 묶음 거부·입력 검증·대화형 설정은 기존 검사로 확인했다.

설치 안내와 이 기록을 갱신했다. API·DB·SDK·의존성·위생 정책·CI 러너 변경은 없다.
변경 없는 전체 앱 빌드/검사는 반복하지 않았고 일반 소스 lint는 명령이 없어 생략했다.
프로세스 강제 종료·전원 손실·파일 정리 자체의 OS 오류는 복구를 보장하지 않는다.
실제 제공자와 원격 설치는 환경 미정으로 미검증이며 푸시·배포·활성화는 없다.

## 대화형 설치 설정 — 2026-10-11

`install:setup`은 대화형 터미널에서 공개 설정값만 받아 기존 `install:prepare`와 같은 다섯
파일을 새 디렉터리에 쓴다. 관리자 origin으로 workers.dev/custom domain을 판정하고, 두
Worker에 같은 계정 ID와 서비스 바인딩을 쓰며 D1 이름·ID·issuer·JWKS·audience·알고리즘·
token typ은 제공자 설정에 맞춰 입력한다. scope·알고리즘·token typ의 기본값 후보도 표시한다.
선택 발행자 인증은 issuer·audience를 따로 받고 audience만 관리자 API와 달라야 한다.
질문·안내·미리보기는 `stderr`, 결과 JSON은 `stdout`이고 형식 오류는 세 번까지 다시 묻고
오류 메시지에 입력값을 넣지 않는다. 기존 출력 디렉터리와
비대화형 실행은 첫 질문 전에 거부하고, 확인 `y` 전에는 아무것도 쓰지 않는다. `--help`
단독 또는 `--out <new-directory>`만 받는다. 네트워크·로그인·토큰·권한 조회·외부 등록·
리소스 생성·배포는 하지 않는다.

실행·통과: `node --test --test-timeout=30000 tools/runtime/test/installation.test.ts
tools/runtime/test/installation-setup.test.ts` 9/9 종료 코드 0(설치 JSON 4·대화형 5),
`node node_modules/typescript/bin/tsc --noEmit` 종료 코드 0, `git diff --check` 종료 코드 0,
`install:setup --help` 종료 코드 0. 신규 5건은 생성한 묶음을 `preparedInstallation`으로
다시 검증한 뒤 관리자 라우트·계정·서비스 바인딩·발행자 분리와 공개 login 설정에
발행자·계정 값이 섞이지 않는지 확인하고, workers.dev/명시 resource/발행자 미사용, 확인
거절 시 파일 없음, 세 번 실패·기존 디렉터리 거부·잘못된 인자, 확인 직후 취소 시 쓰기
미시작을 확인한다.

취소 경로는 호스트 `AbortSignal`을 공유 writer까지 넘겨 각 파일 쓰기 전과 전체 쓰기 뒤에
확인하고, 중단되면 이번 실행이 쓴 파일만 지운다. 실제 PTY 호스트의 합성 공개 값 실행으로
`.tmp/installation-setup-smoke-01`에 다섯 파일이 생성됐고 결과 JSON은 `prepared:true`·
`remoteChanges:false`, 종료 코드 0이었다. Ctrl+C는 `{code:'installation_setup_cancelled'}`
를 내고 `.tmp/installation-setup-cancel-01` 디렉터리를 만들지 않았다. Windows PowerShell
PTY 호스트가 돌려준 최종 종료 코드는 1(nonzero)로 관측됐으며, 코드가 취소 시 설정하는
`process.exitCode 130`과 호스트 반환 값은 구분한다. 성공 PTY 확인은 signal 전달 전에
실행했고 취소되지 않는 경로의 파일 내용은 같다. 입력은 `.invalid` 문법용 합성 값이며
실제 계정·도메인·D1·제공자를 조회하지 않았다.

package script `install:setup`을 추가하고 JSON 준비 CLI와 writer
(`write-installation.ts`)를 공유하도록 추출했다. API·DB·SDK·의존성·CI·위생 정책과 기존
`install:prepare` 동작은 바뀌지 않았다. 전체 CI·운영 빌드는 설치 도구 범위가 아니라
반복하지 않았고, 실제 제공자·원격 계정/DB·로그인·배포는 값이 미정이라 미실행이다.
설치 안내·README·로드맵을 갱신했다.

## 서버 SDK 실제 소켓 복구 — 2026-10-11

`verify:server-recovery`는 `@tallyfin/server` SDK를 플랫폼 주입 없이 기본 `fetch`·타이머·
`crypto`로만 돌려 실제 루프백 소켓에서 실패 뒤 재시도를 확인한다. 매 실행이 `127.0.0.1`
relay·새 합성 D1·수집기 3개(`collectorHarness(dir, undefined, 3)`)를 만들고, 브라우저
시드는 relay를 거치지 않고 `collector-0`에 직접 넣는다. relay는 본문 SHA-256만 메모리에
남기고 요청 본문·토큰·자격 증명은 보고서에 넣지 않는다. 서버 4단계 퍼널은 브라우저 시드
`file_selected`·`upload_finished` 위에 `job_started`·`job_finished`가 얹혀 완성된다.

- `npm.cmd run verify:server-recovery`: 종료 코드 0, `verified: true`. before-commit은 첫
  요청이 `503`+`Retry-After: 1`로 끝나고 재전송이 accepted 2·duplicates 0·attempts 2로
  통과했다. after-commit은 한 수집기가 저장을 마치고 `200` ack까지 준 뒤 클라이언트 소켓만
  끊겼고, 같은 본문의 재시도가 다른 수집기로 가 accepted 0·duplicates 2·attempts 2로
  정리됐다.
- 두 단계에서 relay가 받은 SDK 본문의 SHA-256이 서로 같다(`byteIdenticalRetries` true).
  재시도가 같은 바이트를 다시 보냈고 중복 제거는 수집기에서 일어났다는 뜻이다.
- D1 최종 검사: `event_receipts` 8건, `event_daily_counts`를 `source`·`event_name`으로
  묶은 `SUM(count)`가 등록 이벤트 네 개(`file_selected`·`upload_finished`·`job_started`·
  `job_finished`) 모두 2다. `funnel_runs` 2건은 둘 다 `step_times_json`에 4단계 시각이
  null 없이 들어 있고, `funnel_daily_counts`는 `step_index` 0..3의 `reached_count`가
  모두 2다.
- 발행자 grant 회수 뒤 `send()`는 403·attempts 1·retryable false로 끝나고, relay가 받은
  본문 1건과 함께 집계·`event_receipts` 8건은 회수 전과 같다(`unchangedAfterDenial` true).
  회수 뒤에도 owner 읽기는 수집기 세 곳 모두 200이고 `startedRuns` 2·`completedRuns` 2·
  `completionRate` 100이다.
- `node node_modules/typescript/bin/tsc --noEmit`: 종료 코드 0.
- `npm.cmd run verify:server-recovery -- --help`: 종료 코드 0. `-- --target
  https://example.invalid`는 거부되어 종료 코드 1이고 원격 연결은 일어나지 않았다.

이 슬라이스는 옵트인 `verify:server-recovery` 명령·도구 코드·`tools/server/schema.d.mts`·
README·서버 SDK 문서·[복구 확인 안내](tools/runtime/SERVER-RECOVERY.md)를 더했다.
최종 보고서는 `.tmp/server-recovery/run-yHHyGG/report.json`에 있다. 제품 소스가 바뀌지
않아 기존 SDK 회귀·전체 테스트·관리자 빌드는 반복하지 않았다.
API·DB·SDK 계약·의존성·CI 변경은 없고 이 명령은 기본 `test`·`check`·CI에 넣지 않았다.
한 호스트의 Miniflare 루프백·새 합성 D1 검증이라 실제 OIDC 발행자·원격 D1·다중 프로세스/
지역·절전/강제 종료·프로세스 재시작을 넘는 중복 제거·지속 outbox·exactly-once 전달의 증거가
아니다. 다음은 운영 인증·원격 환경 준비와 남은 장애·운영 검증이다.

## 10분 지속 soak 부하 — 2026-10-11

`bench:cluster`에 `--soak` 프로필을 추가해 한 workerd 안의 수집 Worker 3개와 새 공유
로컬 D1에서 600초 실시간 부하를 돌렸다. 2초마다 HTTP 15건(쓰기 9건·조회 6건)을 같은
배치로 세 Worker에 보내고 5초마다 scheduled 정리를 Worker를 바꿔 호출했다. 토큰은 메모리
합성 JWKS로 만든 5분 수명 토큰을 만료 30초 전 다시 발급한다.

- `npm.cmd run bench:cluster -- --soak`: 종료 코드 0, verified=true. 부하 창
  600,017.199ms, HTTP 4,500건이 전부 200이고 accepted 18,000·duplicates 36,000,
  클라이언트 재시도는 없다. 정리 120회 중 60회가 HTTP와 겹쳤고 관측 HTTP 동시 최대는
  15건(상한 16)이다. soak 프로필에서 관리자·발행자 토큰을 각각 3회 발급했다.
- `node node_modules/typescript/bin/tsc --noEmit`: 종료 코드 0.
- `node --test --test-timeout=30000 tools/runtime/test/cluster-profile.test.ts
  tools/runtime/test/benchmark-tokens.test.ts`: 3/3, 종료 코드 0. soak 계획의 창·
  accepted·duplicates·run·정리 횟수·scheduler 상한과 토큰 갱신·실패 캐시 차단을 확인했다.
- 보고서 `.tmp/cluster-bench/run-qF0zBv/report.json`(로컬 무시 파일, 토큰·시크릿 없음)을
  직접 확인했다. verified=true는 전체 event/workflow 집계 행을 초기값+수락 변경분과
  대조하고, 3,000개 퍼널 run이 모두 4단계 시각을 채웠는지(빈 단계 없음) 확인한다. 세
  Worker의 `funnel_daily_counts` 단계별 도달 합계도 각각 3,000이다. 만료 일별 행은 남지
  않았고 `retention_cleanup_state` revision은 정리 횟수 120과 같다.
- 종류별 p95(ms): workflow 310.971, browser-funnel 311.104, server-funnel 312.008,
  summary 56.607, funnel 57.264, cleanup 303.135. 최대는 449.724·449.089·451.428·
  160.519·160.745·380.005ms다. 작업 발행 지연(4,620표본) p50 6.747·p95 14.434·최대
  31.297ms다.
- 최종 행: 초기 event_receipts 67,200·workflow_attempts 67,200·event_daily_counts
  11,880·workflow_daily_counts 1,980·funnel_runs 0에서 receipts 78,000·attempts
  63,000·event daily 9,728·workflow daily 1,620·funnel runs 3,000·funnel daily 8이 됐다.

Node v24.18.0·Miniflare 4.20260730.0·Windows x64·Ryzen 5 7430U(논리 CPU 12개)의 한 번
관측이다. 단일 호스트/workerd의 수집 Worker 3개가 같은 새 합성 D1을 쓰는 실험이라 운영
인증·원격·다중 지역·장기간·최대 용량의 증거가 아니다. 관리자/SDK 빌드와 전체 검사는
변경 범위 밖이라 생략했고 일반 소스 lint 스크립트는 없다. API·DB·SDK·의존성·CI
변경은 없고 소스 진실 문서(`api/openapi.yaml`·`db/schema.dbml`)는 바꾸지 않았다. 다음은
서버 SDK 연결 손실 복구 검증과 실제 운영 준비다.

## 로컬 부하 인증의 만료 전 갱신 — 2026-10-11

공용 실험 harness는 5분짜리 메모리 서명 토큰의 초기 문자열을 유지하며 선택 getter로
만료 30초 전 다시 발급한다. 관리자/발행자 audience와 캐시는 독립이며 같은 audience의
동시 갱신은 서명 한 번을 공유한다. 시계·서명·지연 오류는 고정 실패로 반환하고 캐시하지
않으며 발급 횟수만 관측한다. 실제 제공자 갱신이나 운영 자격증명 발급 기능은 아니다.

- `node --test --test-timeout=30000 tools/runtime/test/benchmark-tokens.test.ts
  tools/runtime/test/collector-cluster.test.ts`: 4/4, 종료 코드 0. 실제 RS256 서명/검증으로
  만료 전 갱신·16개 동시 요청의 단일 서명·옛 토큰 만료·새 토큰 유효·audience 분리,
  실패/지연/잘못된 시계와 기존 실제 Worker HTTP/D1 연결을 확인했다. 시계 경계는
  테스트의 주입 시각으로 검사했고 5분 실시간 실행을 이번 커밋에서 기다리지는 않았다.
- `node node_modules/typescript/bin/tsc --noEmit`: 종료 코드 0.

API·DB·제품 인증·SDK·의존성·CI·위생 정책 변경은 없고 운영 제공자/원격/배포·푸시는 없다.
실시간 10분 부하와 실제 HTTP 토큰 교체는 다음 슬라이스다. 관리자/SDK 빌드와 전체 부하는
변경 범위 밖이라 생략했으며 일반 소스 lint 스크립트는 없다.

## 누적 데이터·수집 Worker 3개의 동시 부하 — 2026-10-11

별도 opt-in `npm.cmd run bench:cluster`가 한 workerd 안의 수집 Worker 3개와 새 공유 D1을
사용한다. 6개 프로젝트의 보존·만료 영수증/작업 상태·90일 집계에 별도 혼합 출처 퍼널을
등록한다. 초기 6개 데이터 테이블은 합계 148,260행이며 직접 SQL 준비는 HTTP 측정에서
제외한다. 60회 파동마다 같은 workflow 배치와 browser/server 퍼널 배치를 각각 세 Worker에
동시에 보내고 인증된 조회를 섞는다. 실시간 120초·초당 7.5 HTTP 요청·동시 작업 상한 16,
15초 요청/180초 CLI 예산이며 실제 scheduled 정리를 5초마다 Worker를 바꿔 호출한다.

- `npm.cmd run bench:cluster`: 종료 코드 0, verified=true. 부하 창 120,013.031ms,
  HTTP 900건·정리 24회·accepted 3,600·duplicates 7,200, 관측 최대 HTTP 동시 15건,
  정리가 HTTP와 겹친 호출 12회다. 모든 HTTP는 200이고 클라이언트 재시도는 없다.
  전체 유효 event/workflow 집계 행을 초기값+수락 변경분과 대조하고 보존 행 수·만료 제거·
  정리 revision 24를 검사했다. 세 Worker의 최종 퍼널 API/DB 단계 값은 각각 600이다.
  초기 실패는 실험용 requestsPerMinute=1200이 등록 상한 600을 넘어서였고 600으로
  보완한 뒤 통과했다. 첫 실패 뒤 단계 이름을 세분화했다.
- 종류별 p95(ms): workflow 360.163, browser-funnel 366.852, server-funnel 366.711,
  summary 85.994, funnel 92.917, cleanup 347.736. 발행 지연 p95 15.006ms이다.
  최대 지연은 각 종류 순서대로 584.140·581.403·580.375·315.694·315.613·546.801ms다.
- 최종 행 수: receipts 63,600, workflow attempts 60,600, event daily 9,728, workflow
  daily 1,620, funnel runs 600, funnel daily 8. 관측/DB는
  `.tmp/cluster-bench/run-jZczec/report.json`과 같은 실행의 state에 남긴다.
- `node .tmp/cluster-extra-verification.mjs`: 종료 코드 0. 실험 완료 뒤 추가한 두 최종
  검사와 같은 SQL을 저장된 합성 DB에 readOnly로 실행해 600개 run의 네 시각이 모두 존재하고
  출처별 네 이벤트가 각각 600(브라우저/서버 각 1,200)인 것을 확인했다. workerd의 별도
  metadata.sqlite는 대상에서 제외했다. 새 최종 검사 추가 뒤 120초 부하는 반복하지 않았다.
- `node node_modules/typescript/bin/tsc --noEmit`: 최종 코드 종료 코드 0.
- `npm.cmd run bench:cluster -- --help`: 종료 코드 0. `--remote`는 고정 안내와 종료 코드 1로
  거부한다. 기존 기본 test/check/CI에 이 2분 실험을 추가하지 않았다.
- `git diff --check`: 종료 코드 0.

Node 24.18.0·Miniflare 4.20260730.0·Windows x64·Ryzen 5 7430U(논리 CPU 12개),
실시간 Worker 시계·메모리 임시 JWKS/서명키를 사용했다. 실제 운영 인증·원격/기존 DB는
접근하지 않았고 런타임은 finally에서 닫는다. 단일 호스트/workerd의 별도 수집 Worker
실험이므로 다중 프로세스/지역·장기간·최대 처리량·운영 지연/비용의 증거는 아니다.
운영 안내·수집기 경계·로드맵·검증 기록을 갱신했다. API·DB·SDK·의존성·CI 러너·위생 정책
변경은 없다. 관리자/SDK 빌드·일반 소스 lint·운영 제공자/배포 검사는 범위 밖이거나 설정이
없어 생략했다. 실제 서비스 연동·푸시·배포는 없다.

## 같은 D1의 로컬 수집 Worker 분리 — 2026-10-11

`collectorHarness`의 기본 Worker 하나는 유지하고 선택 2~4개 프로필에 루프백 라우터와
별도 이름의 수집 Worker를 연결했다. 모든 수집 Worker가 같은 새 D1 ID를 바인딩하며
응답의 검증 전용 헤더로 실제 실행 인스턴스를 구분한다. 키/JWKS/서명 토큰은 메모리에만
두고 기존 DB 경로나 원격 URL을 받지 않는다. 호환 날짜는 기존 실험 대상 그대로다.

- `node --test --test-timeout=30000 tools/runtime/test/collector-cluster.test.ts
  tools/runtime/test/collector-bench.test.ts tools/runtime/test/retained-bench.test.ts`: 6/6,
  종료 코드 0. 세 Worker의 같은 배치 동시 HTTP 전송에서 accepted 합계 1·duplicates 2,
  인스턴스별 서명 인증 조회·공유 D1 행 수·라우터 경로 거부와 기존 fixture/부하 도구를
  확인했다. 초기 테스트 이벤트 이름이 등록 정의와 달라 422였고 실제 tool_view로 고친 뒤
  통과했다. 각 테스트 런타임은 finally에서 닫는다.
- `node node_modules/typescript/bin/tsc --noEmit`: 종료 코드 0.

한 Miniflare/workerd 안의 별도 수집 Worker 3개 검증이며 다중 프로세스/지역·장기간·운영
D1 검증은 아니다. 다음은 이 환경의 누적 데이터·실제 예정 부하·정리 동시 실행이다.
API·DB·SDK·의존성·CI·위생 정책 변경은 없다. 관리자/SDK 빌드는 범위 밖이라 생략하고
일반 소스 lint 스크립트는 없다. 운영 인증·배포·푸시·서비스 연동은 미실행이다.

## 퍼널 속성별 직전 기간 비교·CSV — 2026-10-11

같은 차원·프로젝트·버전·퍼널 정의의 직전 같은 길이 코호트를 추가 조회한다. 값의 자료형을
유지한 합집합을 비교하고, 한쪽에서 관측되지 않은 값은 0건·null 비율로 둔다. CSV는 실제
관측된 양 기간 분류 행과 값별 비교 지표를 구분하며 없는 값의 일별 행을 만들지 않는다.
분류 비교의 실패는 현재 분류를 보존하고 CSV만 잠그며 별도 재시도를 제공한다.

- `npm.cmd run test:admin`: 193/193, 종료 코드 0. 신규 4건은 양쪽/한쪽 값·자료형·0/null·
  단계 변화·동일 정의/기간 검증·CSV 날짜/시각/자료형/비교 행과 없는 일별 행 미생성을 확인한다.
- `npm.cmd run typecheck:admin`, `npm.cmd run build:admin`: 각각 종료 코드 0.
- `npm.cmd run test:bundle --workspace @tallyfin/admin`: 2/2, 종료 코드 0.
- `node .tmp/funnel-breakdown-comparison-smoke.mjs`: Chrome·Vite·실제 React·합성 응답으로
  선택 전 요청 없음·현재/직전 요청 각각 한 번·이전 기간에만 나온 값 선택·단계 변화·CSV,
  분류 비교 실패/재시도·현재 결과 보존·CSV 잠금·비교 해제 시 AbortSignal/늦은 응답 폐기·
  보존 범위 안내·컨텍스트 전환을 확인했다. 320px 문서 넘침 없음·키보드 내부 표 스크롤·
  pageerror 0을 확인하고 데스크톱/모바일 스크린샷을 열어 확인했다. 초기 harness의 전체
  비교 제목 선택자가 새 속성별 제목과 겹쳐 exact 선택자로 보완한 뒤 통과했다.
  임시 서버·브라우저는 harness가 종료했다.
- `git diff --check`: 종료 코드 0.

제품 명세·로드맵·프론트엔드 설계를 갱신했다. API·DB·SDK·의존성·CI 러너·위생 정책은
바뀌지 않았다. 일반 소스 lint는 스크립트가 없고 backend/Sites 인계·전체 부하 검사는 범위
밖이라 반복하지 않았다. 실제 운영 인증/D1·원격 부하·푸시·배포·서비스 파일럿은 미실행이다.
별도 요청의 전체와 분류는 조회 시각이 달라 합계가 다를 수 있으며 화면에서 안내한다.

## 퍼널 속성별 관리자 화면·CSV — 2026-10-11

등록 차원 선택 뒤에만 분류 API를 조회하며 값별 요약과 선택 값의 단계·일별 내역을 표시한다.
응답을 닫힌 형태·자료형·등록 값·정의·날짜·단계/합계로 검증하고 취소·세대 가드를 적용한다.
분류 실패 때 전체 결과를 유지하며 CSV만 잠그고 재시도·해제로 복구한다. CSV 분류 행은
현재 기간으로 명시하고 group_by·property_type·property_value를 남긴다.

- `npm.cmd run test:admin`: 189/189, 종료 코드 0. 분류 검사 6건이 새 계약·자료형·취소·
  오류·빈 결과·CSV와 기존 전체 퍼널/기간 비교 회귀를 확인한다.
- `npm.cmd run typecheck:admin`, `npm.cmd run build:admin`: 각각 종료 코드 0.
- `npm.cmd run test:bundle --workspace @tallyfin/admin`: 2/2, 종료 코드 0.
- `node .tmp/funnel-breakdown-smoke.mjs`: Chrome·Vite·실제 React와 합성 transport로 선택 전
  추가 요청 없음·값별 단계·CSV·실패/재시도·분류 해제·늦은 응답 폐기·컨텍스트 전환·320px
  문서 넘침 없음·pageerror 0을 확인했다. 서버·브라우저는 harness가 종료한다.
- `git diff --check`: 종료 코드 0.

제품 명세·프론트엔드 설계·로드맵을 갱신했다. API·DB·SDK·의존성·CI·위생 정책 변경은 없다.
일반 소스 lint 명령은 없어 생략하고 백엔드·Sites 인계 검사는 변경 범위 밖이라 반복하지
않았다. 브라우저 검사는 인증/D1 통합을 다시 검증한 것이 아니며 운영 제공자·원격 DB·
푸시·배포·Sembom 연동은 미실행이다. 속성별 직전 기간 비교는 다음 슬라이스다.

## 다단계 퍼널의 속성별 읽기 API — 2026-10-11

OpenAPI에 별도 GET `/v1/projects/{projectId}/funnels/{funnelId}/breakdown`, 필수 groupBy와
`FunnelBreakdownResponse`·bucket을 추가하고 코어 타입·D1 투영·관리자 라우트를 연결했다.
기존 dimension_key별 카운트만 읽어 등록된 시작 차원 하나로 묶으며 모든 조합의 단계 순서를
집계 전에 검사한다. 기존 daily 응답·등록·쓰기·보존 규칙과 DB는 유지했다.

- `node --test --test-timeout=30000 apps/collector/test/funnel-query.test.ts
  apps/collector/test/server-query.test.ts`: 21/21, 종료 코드 0. 실제 로컬 D1/HTTP에서 분류/전체
  합계·누락 날짜·0/null·잠정 여부·출처 교차·인증/권한/다른 프로젝트/버전·잘못된 파라미터·
  저장 차원 손상과 기존 daily/server 조회 회귀를 확인했다. 투영 검사는 boolean false·integer
  0, 원래 조합 병합, 순서를 바꾼 중복, 손상 조합을 정상 조합이 가리는 경우, 행 상한과 안전
  정수 넘침을 확인한다. 초기 오류 주입은 DB JSON CHECK에 막혀 유효 JSON의 잘못된 tuple로
  수정했고, 새 테스트 정의의 누락 purpose도 보완한 뒤 통과했다.
- `node node_modules/typescript/bin/tsc --noEmit`: 종료 코드 0.
- `node node_modules/typescript/bin/tsc -p apps/collector/tsconfig.runtime.json`: 종료 코드 0.
- `tools/contracts`의 `npm.cmd run check`: 63/63, 종료 코드 0. 새 예제·닫힌 응답·값 자료형·
  bucket/일수 상한·필수 groupBy·source 미지원과 기존 API/DB 계약을 확인한다.
- 같은 폴더의 `npm.cmd run lint`: OpenAPI valid, 종료 코드 0.
- `git diff --check`: 종료 코드 0.

계약 원본 `api/openapi.yaml`과 API 예제·관리자 경계·제품 명세·로드맵을 갱신했다.
DB·마이그레이션·SDK·관리자 UI·의존성·CI 러너·위생 정책은 바뀌지 않았다. 화면 연결은
다음 슬라이스라 관리자 빌드/브라우저 검사는 하지 않았고, 전체 출시·부하 검사는 이번 읽기
범위에서 반복하지 않았다. 운영 인증·원격 DB/배포·Sembom 활성화·푸시는 미실행이다.

## 다단계 퍼널의 직전 기간 비교·CSV — 2026-10-11

선택한 퍼널의 현재 보고서가 준비된 뒤 같은 프로젝트·스키마 버전·정의의 직전 같은 길이
시작일 코호트를 기존 API로 조회한다. 비교 중/실패에서는 현재 결과를 보존하고 CSV만
잠근다. 비교 해제·선택/컨텍스트/연결 변경에서는 취소·응답 가드를 적용한다. CSV는 현재
기간 단독 형식을 유지하고 비교 때만 period·metric·현재/이전 수치·변화/단위 열을 추가한다.

- `npm.cmd run test:admin`: 183/183, 종료 코드 0. 새 비교 검사 4건은 건수/비율 변화,
  0/null, 프로젝트·버전·정의·시간대·직전 기간 불일치, CSV 양 기간·시각·비교 지표를 확인한다.
- `npm.cmd run typecheck:admin`: 종료 코드 0.
- `npm.cmd run build:admin`: 종료 코드 0.
- `npm.cmd run test:bundle --workspace @tallyfin/admin`: 2/2, 종료 코드 0.
- 별도 Chrome 스모크: 실제 React 컴포넌트·Vite 서버·합성 API 응답으로 선택 전/비교 전
  추가 조회 없음, 정상 비교, 실패/재시도, 현재 결과 보존, CSV 잠금과 다운로드 내용,
  보존 범위 안내·해제, 늦은 응답 폐기, 컨텍스트 전환, 320px 문서 넘침 없음,
  pageerror 0건을 확인했다. 데스크톱·모바일 스크린샷을 확인했고 서버·브라우저를 종료했다.
  테스트 페이지의 초기 경로·React 로드 문제는 임시 harness 수정 후 통과했다.
- `git diff --check`: 종료 코드 0.

제품 명세·프론트엔드 설계·로드맵을 갱신했다. API·DB·SDK·의존성·CI 러너·위생 정책은
바뀌지 않았다. 브라우저는 인증·D1 통합을 다시 수행한 검증이 아니고 운영 제공자·원격 데이터
조회는 미실행이다. backend 전체 검사와 Sites 인계 검사는 변경 범위 밖이라 반복하지 않았다.
푸시·배포·Sembom 연동은 없다.

## Wrangler tail JSON의 로컬 보고서 변환 — 2026-10-11

`logs:summary`에 `--stdin --wrangler-tail`을 추가하고 기본 NDJSON 경로는 유지했다.
`WranglerTailInput`은 공백으로 구분된 여러 줄/한 줄 JSON 객체를 문자열·이스케이프·중첩에
맞춰 구분한다. `logs[].message`의 단일 앱 JSON 문자열을 기존 집계기로 보내고, 감싼 객체의
요청 URL·헤더·예외·시각·스크립트 이름은 출력하지 않는다. 관련 없는 console 기록은 내용
대신 무시 카운터만 센다. 앱 기록을 객체나 여러 인자로 보내면 거부한다. 출력 v2는 그대로다.

- 설치된 Wrangler 4.148.0의 `tail --help`, `src/tail/printing.ts` 출력 코드와 Cloudflare
  실시간 로그 문서를 확인했다. `wrangler tail` 원격 실행은 하지 않았다.
- `node --test --test-timeout=30000 tools/runtime/test/wrangler-tail-input.test.ts
  tools/runtime/test/summarize-observations.test.ts tools/runtime/test/observation-summary.test.ts
  tools/runtime/test/observation-diagnostics.test.ts`: 30/30, 종료 코드 0.
  실제 Node CLI stdout/stderr, 관리자 보고서 파서 호환, NDJSON 회귀, CRLF·byte-split UTF-8·
  이스케이프, 원문 제외, 중복/충돌, 잘못된 형식·사적 필드·불완전 입력·배너, 빈 관측,
  전체 바이트/객체/줄/깊이/console 기록 수 제한과 시간 초과·스트림 실패·리스너 해제를 확인했다.
- `node node_modules/typescript/bin/tsc --noEmit`: 종료 코드 0.
- `git diff --check`: 종료 코드 0.

첫 검사에서 테스트가 보고서 파서에 문자열을 넘겨 2건 실패했다. 파서의 실제 객체 계약에
맞게 테스트를 수정한 뒤 위 검사가 모두 통과했다. 사용법·운영 관측·로컬 뷰어 안내·README·
로드맵을 갱신했다. API·DB·마이그레이션·SDK·관리자 UI·운영 설정·의존성·CI 러너·위생 정책은
바뀌지 않았다. UI 빌드/브라우저 재검증과 전체 backend 검사는 변경 범위 밖이라 반복하지
않았다. 실제 운영 입력·로그 세션·추가 플랫폼 샘플링·원격 인증·배포는 미검증이며, tail의
누락을 보정하거나 전체 요청 수/서비스 정상 상태를 주장하지 않는다. 푸시·배포는 없다.

## 관리자의 로컬 운영 로그 보고서 화면 — 2026-10-11

`ObservationReportPanel`·`ObservationReportView`와 전용 CSS를 추가하고 API 연결 설정에서만
지연 로드한다. 파일 선택으로 8MiB 이하 v2 JSON을 실제 Worker에 전달하고, 관측 수·가중
요청 어림·진단·HTTP 상태/코드·지연 구간·정리 실행/처리 횟수를 표로 표시한다. HTTP 응답은
25줄씩 넘기며 새 보고서에서 첫 페이지로 돌아간다. 정리 상세가 없으면 처리 횟수를 0 대신
`—`로 표시한다. 프로젝트·기간 필터와 별개인 수집기 전체 로그 요약임을 안내한다.

- `npm.cmd run typecheck:admin`: 종료 코드 0.
- `npm.cmd run test:admin`: 179/179, 종료 코드 0.
- `npm.cmd run build:admin`: 종료 코드 0. 보고서 패널은 JS gzip 4.05kB·CSS gzip 0.54kB,
  별도 Worker는 7.75kB(비압축)다. 최초 화면 그래프에는 포함하지 않는다.
- `npm.cmd run test:bundle --workspace @tallyfin/admin`: 2/2, 종료 코드 0. 새 패널의 최초/API
  정적 그래프 제외도 기존 검사에 추가했다.

별도 Chrome 스모크는 실제 CLI가 만든 합성 요약과 프로덕션 빌드 preview·임시 서명 OIDC·
Miniflare collector/D1을 사용했다. 실제 배포 형태의 Worker에서 파일을 읽고 정상·식별자
여분 필드·8MiB 초과·새 파일·지우기·닫기·연결 끊기·diagnostics 없는 이전 v2를 확인했다.
75개 HTTP 응답을 25개씩 끝까지 넘기고 새 보고서에서 첫 페이지로 복귀했다. 실패 표시만
있는 정리 보고서의 처리 값 세 개가 `—`인지 확인했다. 파일 읽기 동안 추가 `/v1` 요청 0건,
localStorage/sessionStorage 기록 0건, 320px 문서 가로 넘침 없음, pageerror 0건이다.
데스크톱·모바일 스크린샷도 확인했다. 소유한 서버·브라우저·임시 D1은 종료/삭제했다.

제품 명세·운영 관측·새 사용 안내·README·관리자 README·문서 색인·로드맵을 갱신했다.
API·DB·마이그레이션·SDK·의존성·CI·운영 설정은 바뀌지 않았다. backend 전체 검사·부하
실험·Sites 인계는 변경 범위 밖이라 반복하지 않았고 실제 운영 로그·원격 모니터링·알림·
푸시·배포는 미실행이다. 하위 에이전트가 남긴 `.tmp/observation-view-check`의 재귀 삭제는
자동 승인 검토가 정책상 차단했으므로 그 ignored 검증 파일은 남아 있다.

## 운영 로그 보고서의 브라우저 읽기 기반 — 2026-10-11

CLI 집계기의 크기·operation·code·지연 bucket 목록을 I/O 없는 `observation-values.ts`로
분리하고 기존 집계기에서 같은 값을 사용한다. 관리자에 v2 보고서 파서·파일 Worker·유계
`ReportReader`를 추가했다. 이 슬라이스는 화면 연결 전 단계다. 원문 NDJSON·여분/식별자 필드·가짜
coverage/health·중복 항목·안전 정수 범위 밖·응답/지연/전체 합계·표본 가중치·정리 합계·
진단 불일치를 거부한다. additive diagnostics가 없는 이전 v2는 진단을 null로 남긴다.

- 관리자의 `node --test src/api/observation-report.test.mjs`: 7/7, 종료 코드 0.
- 루트의 `node --test tools/runtime/test/observation-summary.test.ts tools/runtime/test/observation-diagnostics.test.ts tools/runtime/test/summarize-observations.test.ts`: 20/20, 종료 코드 0.
- `npm.cmd exec -- tsc --noEmit`, `npm.cmd run typecheck:admin`: 각각 종료 코드 0.

실제 CLI 집계 결과와 파서를 대조했고, 중첩 정리 실패 표시·상세 없는 실행·HTTP 없는
정리 보고서도 확인했다. Worker 포트 검사는 선택 전 무생성·8MiB 상한·새 파일/닫기/해제의
종료·늦은 응답 폐기·10초 읽기 제한과 고정 오류를 확인한다. 실제 브라우저 Worker·화면은
후속이다. 최초 집중 검사는 Node strip-only가 매개변수 프로퍼티를 지원하지 않아 실패했고,
명시적 필드로 바꿨다. 관리자 타입 검사는 Node 집계기를 참조하는 테스트에만 node type
reference를 추가한 뒤 통과했다. API·DB·SDK·의존성·CI·운영 설정·원격 변경은 없다.

## 실제 관리자 브라우저 로그인 검증 명령 — 2026-10-11

선택적 `verify:admin-login`과 `tools/browser-bench/admin-login.mjs`·대역 fixture를 추가했다.
실제 Vite 관리자 UI와 Miniflare collector·D1을 사용하고 `.invalid` 제공자 URL은 브라우저에서
가로채므로 외부 제공자에 요청하지 않는다. 서명 키와 code·토큰은 메모리에만 두고 공개 설정은
명시 주입하며 `.env`·호출자의 로그인/수집기 대상 값을 사용하지 않는다. 수집기 샘플 로그는
대역 안에서만 출력하지 않아 CLI 보고서에 requestId도 담지 않는다.

- `npm.cmd run verify:admin-login -- --channel chrome`: 종료 코드 0, Chrome 154.0.8037.98.
- `node tools/browser-bench/admin-login.mjs --help`: 종료 코드 0.
- `node tools/browser-bench/admin-login.mjs --channel invalid`: 고정 arguments 오류·종료 코드 1.

실제 UI의 로그인 버튼부터 S256 인가 리다이렉트·nonce가 있는 ID token 서명·일회 코드 교환·
콜백 주소 정리·현재 access token으로 조회 성공·저장소 읽기 확인까지 통과했다. 브라우저
벽시계만 271초 이동하고 getAccessToken 동시 호출 수만 계측해 여러 호출이 한 번의 회전
갱신을 기다리는지 확인했다. 다음 갱신을 실패시키면 인증 필요 화면을 표시하고 제공자 오류
원문은 숨겼다. 원래 시계로 돌려 잘못된 state를 code 교환 없이 거부하고, 재로그인과
새로고침 후 재인증 요구도 확인했다. 인가 3회·code 교환 2회·갱신 2회(성공 1·실패 1)·
관리자 GET 27회·pageerror 0건이며, 단계별 localStorage/sessionStorage·쿠키는 비어 있다.
관리자 이력 snapshot 불변과 임시 DB 삭제를 확인했다. 스크립트 정리 중 변수 이름 중복으로
한 번 syntax error가 발생했고 이름을 고친 후 브라우저 검증이 통과했다.

README·개발 가이드·관리자 README·OIDC 안내·로드맵과 신규 로그인 검증 안내를 갱신했다.
앱·수집기·SDK의 운영 코드, API·DB 계약·마이그레이션·의존성·CI는 바뀌지 않았다. 기존
Playwright 개발 패키지를 사용하며 기본 검사에 브라우저 실행을 추가하지 않았다. 운영 코드가
같아 전체 검사·앱 빌드·부하 실험은 반복하지 않았다. 실제 OIDC 제공자 등록·CORS·운영
access token/resource/audience·원격 배포 검증은 아직 없으며 푸시·배포도 하지 않았다.

## 관리자 설정의 저장소 읽기 확인 — 2026-10-11

`LiveHealth`와 `HealthReader`, 닫힌 health 응답 파서, `ApiClient.getHealth`를 추가하고 API 모드
설정 화면에 연결했다. 버튼으로만 조회하며 5초 시간 제한·중복 클릭 차단·실패 시 성공 결과
삭제·닫기/연결 교체/언마운트 시 취소와 늦은 응답 폐기를 적용했다. 성공 시각은 수동 확인
시각이고 지표 갱신 시각과 구분한다. 기존 `/v1/health` 계약을 소비하며 API·DB·마이그레이션·
Worker·SDK·의존성·환경 변수·CI·위생 정책·package script 변경은 없다.

- `npm.cmd run typecheck:admin`: 종료 코드 0.
- `npm.cmd run test:admin`: 172/172, 종료 코드 0. 신규 health 집중 검사 5개를 포함한다.
- `npm.cmd run build:admin`: 종료 코드 0.
- `npm.cmd run test:bundle --workspace @tallyfin/admin`: 2/2, 종료 코드 0.

별도 로컬 Chrome 스모크는 임시 서명 OIDC와 실제 Vite 프록시·Miniflare collector·빈 D1을
거쳤다. grant 없는 관리자 연결에서 펼침 시 요청 0건, 버튼 성공, 잘못된 scope 응답의 오류,
테이블 일시 이름 변경의 저장소 503(마지막에 복원), 요청 지연의 5초 시간 초과와 재시도,
닫기·연결 끊기·재연결의 결과 초기화를 확인했다. 명시적 health 요청은 총 5건,
프로젝트 테이블 불변, 320px 문서 가로 넘침 없음, pageerror 0건이며 데스크톱·모바일
스크린샷을 확인했다. 첫 스모크는 마지막 단계의 버튼 선택자가 실제 `연결 끊기`와 달라
실패했고 선택자를 고친 두 번째 실행이 종료 코드 0이었다. 저장소 장애 주입 시 고정
`storage_unavailable` 로그 한 건이 발생했으며 운영 장애 관측은 아니다.

README·관리자 README·로드맵·운영 관측 문서를 갱신했다. collector·저장 어댑터는 바뀌지
않아 해당 전체 검사·부하 실험은 반복하지 않았다. 실제 OIDC 제공자·원격 상태 확인·
Sites 인계·푸시·배포는 미실행이다.

## 설치 접근 검사에 저장소 읽기 프로브 연결 — 2026-10-11

`tools/runtime/install-access-check.ts`와 집중 검사를 변경했다. 관리자 identity의 issuer를
확인한 뒤 닫힌 `{status:'ok',scope:'administrator_storage_read'}`를 받아야 프로젝트 조회로
넘어간다. 보고서 v2는 `admin-identity`·`admin-storage-read`·`project-list`를 차례로 담고,
건너뛴 단계는 identity-check-required 또는 storage-check-required unknown으로 구분한다.
README·로드맵·설치 안내·접근 확인 안내를 갱신했다. API·DB·마이그레이션·Worker·SDK·
의존성·환경 변수·CI·위생 정책·package script 변경은 없다.

- `node --test --test-timeout=30000 tools/runtime/test/install-access-check.test.ts`: 7/7, 종료 코드 0.
- `npm.cmd exec -- tsc --noEmit`: 종료 코드 0.
- `node tools/runtime/install-access-check.ts --help`: 종료 코드 0, 세 단계 검사·종속 조회 중지 도움말 출력.

실제 관리자 Worker 프록시·임시 서명 OIDC·로컬 Miniflare D1을 거쳐 빈 프로젝트와 접근 가능한
프로젝트를 확인하고, DB snapshot과 준비 파일 불변·토큰/identity/원문 미출력·기존 입력과
본문 상한·취소 검사를 통과했다. 새 검사는 잘못된/여분 health 필드와 401/404/503에서 프로젝트
조회를 차단하는지, 실제 DB 테이블을 일시 이름 변경했을 때 identity는 통과하고 health는
unknown·프로젝트는 storage-check-required가 되는지를 확인했다. 테스트의 테이블은 finally에서
복원했다. 요청당 5초·CLI 전체 15초·표준 입력 30초·본문 16KiB 상한은 유지한다.

실행 중 로컬 workerd가 Win32 `WSARecv #64` 진단 두 건을 stderr에 냈다. 원인을 확정하지
않았다. 이후 실제 health 실패 검사와 CLI 성공 검사까지 수행했고 Node 검사 종료는 0이었다.
이 진단을 숨기거나 무경고 실행으로 기록하지 않는다.

실제 운영 제공자·원격 접근·푸시·배포는 하지 않았다. 기존 Worker·API·DB·UI·SDK 코드가
바뀌지 않아 해당 전체 검사·빌드·부하 실험은 생략했다.

변경한 Markdown 다섯 파일의 로컬 링크 124개가 모두 존재하며 `git diff --check`를 통과했다.
링크 검사는 파일 존재 검사이고 모든 앵커·외부 URL 검증은 아니다.

## 인증된 관리자 저장소 읽기 프로브 — 2026-10-11

`GET /v1/health`와 선택적 `AdministratorAccess.checkReadiness` 포트, native Worker의 읽기
포트 연결, `readiness.ts`의 단일 batch·두 `SELECT 1 ... LIMIT 1`을 추가했다. 성공 JSON은
status·scope 고정 두 필드다. 새 OpenAPI 응답·예제와 계약 검사, 운영·제품 문서를 갱신했다.
DB·마이그레이션·SDK·환경 변수·의존성·CI·위생 정책·package script 변경은 없다.

실행·결과:

- `node --test --test-timeout=30000 apps/collector/test/readiness.test.ts apps/collector/test/admin.test.ts apps/collector/test/runtime.test.ts apps/collector/test/request-observation.test.ts`: 28/28, 종료 코드 0.
- `npm.cmd exec -- tsc --noEmit`와 `npm.cmd exec -- tsc -p apps/collector/tsconfig.runtime.json`: 각각 종료 코드 0.
- `tools/contracts`의 `npm.cmd run check`: 61개 통과, 종료 코드 0.
- 같은 폴더의 `npm.cmd run lint`: OpenAPI valid, 종료 코드 0.

새 집중 검사 5개는 grant 없는 성공·원문 행과 identity 미출력·쓰기/수집 quota 불변, 인증과
method/query 검증 전 DB 접근 차단, 몸체 미소비, 포트 미연결/예외의 고정 503·Retry-After,
읽기 batch가 한 번이고 한 테이블당 상수 한 행만 읽는지, 빈 테이블 성공·테이블 누락 실패를
확인한다. 기존 runtime 검사에는 임시 RS256 서명 JWT와 workerd·D1로 인증된 200·잘못된
audience/무토큰 401·테이블 누락 503을 추가했다. 실제 운영 제공자·DB·반복 모니터링 검증은 아니다.

기존 fetch 처리와 관리자 프록시의 서비스 바인딩 구조는 Cloudflare
[fetch handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/)·
[HTTP service binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/)
문서와 로컬 소스로 확인했다. 새 bindings·config·호출 로그·traces는 추가하지 않았다.

관리자 UI·SDK 코드가 바뀌지 않아 해당 전체 검사·빌드·부하 실험은 생략했다. 원격 호출·
마이그레이션 적용·푸시·배포는 하지 않았다. 이 probe는 두 제어 테이블 읽기만 확인하므로
수집 쓰기·모든 16개 테이블·Cron 동작·전체 서비스 가용성 증거로 사용할 수 없다.

변경한 Markdown 8개 파일의 로컬 링크 171개가 모두 존재하며 `git diff --check`를 통과했다.
링크 검사는 파일 존재만 확인했고 모든 앵커·외부 URL을 검증하지는 않았다.

## 로그 기반 진단 — 2026-10-11

`tools/runtime/observation-diagnostics.ts`와 집중 검사 파일을 추가하고 기존 집계기·CLI 검사를
연결했다. 문서 안내는 README·로드맵·로그 요약 계약·운영 관측에 반영한다. API·DB·마이그레이션·
수집기·SDK·환경 변수·package script·의존성·CI·위생 정책은 바뀌지 않는다.

`node --test --test-timeout=30000 tools/runtime/test/observation-diagnostics.test.ts tools/runtime/test/observation-summary.test.ts tools/runtime/test/summarize-observations.test.ts`
종료 코드 0으로 20/20을 통과했다. `npm.cmd exec -- tsc --noEmit`도 종료 코드 0이었다.
성공 표본만 있을 때 정상 판정하지 않는지, 4xx 보호 거부가 review인지, operation별 중복 없는
분류와 관측수(가중치 아님), 역순 입력의 같은 결과, 정리 실패의 합집합·상세 누락·원문 ID
미출력을 검사했다. 기존 CLI subprocess 검사에서도 error 진단이 있어도 입력 집계는 exit 0이고
원문 runId를 출력하지 않는 것을 확인했다.

추가 코드가 로컬 로그 요약에만 실행되므로 수집기·관리자·SDK 전체 검사·빌드·부하 실험은
생략했다. 합성 로그 검증이며 실제 운영 로그·알림 발송·원격 변경·푸시·배포는 미실행이다.

PowerShell 합성 NDJSON(저장소 503 한 줄·상세 없는 정리 실패 한 줄)을
`npm.cmd run --silent logs:summary -- --stdin`에 파이프해 종료 코드 0으로 진단
`storage_errors`·`cleanup_failures`·`cleanup_report_missing`와 `serviceHealth=unknown`을 확인했다.
보고서에 원문 requestId·runId는 없었다. 다섯 Markdown 파일의 로컬 링크 119개 존재와
`git diff --check`를 확인했다. 링크 검사는 파일 존재 검사이며 앵커·외부 URL 전체 검사는 아니다.

## 정리 로그 요약 확장 — 2026-10-11

`tools/runtime/LOG-SUMMARY.md`·`docs/ops/observability.md`·`README.md`에 scheduled 정리 로그
지원을 적고 `docs/product/01-roadmap.md`에 이 슬라이스를 기록했다. 집계기
`tools/runtime/observation-summary.ts`와 집계·CLI 검사 두 파일을 변경했다.

실행·결과: `node --test --test-timeout=30000 tools/runtime/test/observation-summary.test.ts tools/runtime/test/summarize-observations.test.ts`
종료 코드 0으로 16/16을 통과했다. `npm.cmd exec -- tsc --noEmit`도 종료 코드 0이었다.

실제 `runCleanup` 함수의 합성 store 결과를 사용해 시도 3·성공 2·실패 1에서 커서가
진행할 수 있음을 확인했다. 상세 보고+실패 표시의 연계, UUID 대소문자·키 순서·중복·역순 입력,
상세 없는 실패를 미관측으로 남기는 `reportlessFailureRuns`, 카운터 상한·합계·필드 검증,
상충 보고의 `run_conflict`와 부분 보고 거부를 검사했다. 실제 Node CLI subprocess로 정리만·
HTTP 혼합 입력·민감한 여분 필드·충돌의 stdout/stderr·종료 코드와 runId 미출력을 확인했다.
보고서 스키마는 `tallyfin.observation-summary/v2`이고 `cleanup`의 9개 고정 필드는 안내에 적었다.

수집기·API·DB·마이그레이션·SDK·환경 변수·의존성·package script·CI·위생 정책은 바뀌지 않았다.
해당 부분의 전체 검사·빌드·부하 실험은 생략했다. 합성 로컬 로그 검사이며 실제 운영 로그·
원격 자동화·운영 알림·푸시·배포 검증은 아니다.

PowerShell 합성 정리 로그 두 줄을 `npm.cmd run --silent logs:summary -- --stdin`에 파이프해
종료 코드 0·`observedResponses=0`·`cleanup.observedRuns=1`·`failedProjects=1`·
`cursorAdvancedReports=1`을 확인했다. 출력에 원문 runId는 없었다. 변경한 다섯 Markdown 파일의
로컬 링크 118개가 모두 존재하고 `git diff --check`를 통과했다. 링크 검사는 파일 존재만
확인했고 모든 앵커·외부 URL 검사는 아니다.

## 앱 로그 요약 도구 — 2026-10-11

`tools/runtime/LOG-SUMMARY.md`를 새로 쓰고 `docs/ops/observability.md`·`README.md`에 연결·설명을,
`docs/product/01-roadmap.md`에 이 슬라이스를 기록했다. 이 슬라이스는 문서와 함께 CLI 도구·package
script를 더하며, 수집기·API·DB·SDK·환경 변수·CI 워크플로·의존성은 바꾸지 않았다.

실행·결과: 코어 요약 검사 `tools/runtime/test/observation-summary.test.ts`는 5/5이며 그
구현을 `064643f`로 커밋했다. CLI 검사 `tools/runtime/test/summarize-observations.test.ts`는
6/6, 루트 `npm exec -- tsc --noEmit`는 종료 코드 0이었다. 도움말에 직접 node 실행과
PowerShell npm.cmd를 안내하도록 바꾼 뒤 CLI 6/6과 루트 타입 검사를 다시 통과했다. 코어 코드는
그대로라 코어 5개의 앞선 결과를 재사용했으며 전체 검사를 한 명령으로 합쳐 돌리지는 않았다.

코어 검사는 실제 앱 emitter 함수의 합성 로그로 표본 가중·중복 제거·충돌 거부·민감한 여분
필드 거부·예산·출력 복사·빈 입력/래퍼 거부를 확인한다. CLI 검사는 UTF-8 청크·CRLF·마지막
개행 없는 줄·손상 UTF-8·입력 상한·타임아웃·스트림 오류·조기 종료·TTY/인자·리스너 정리와 실제
Node subprocess의 출력·실패 종료를 확인한다. 실제 배포된 Worker나 운영 로그 검증은 아니다.

로컬 스모크: 첫 직접 실행은 실제 파일이 아니라 PowerShell here-string으로 만든 합성 NDJSON을
`node tools/runtime/summarize-observations.ts --stdin`에 직접 파이프한 것이었고, 종료 코드 0으로
`observedResponses=2`·`weightedRequestsEstimate=65`(성공 1×64 + storage 오류 1)를 냈으며
`requestId`는 없었다. `| npm.cmd run --silent logs:summary -- --stdin`도 종료 코드 0으로
`observedResponses=1`·`weightedRequestsEstimate=64`를 냈다. PowerShell 파이프를 설치된
`npm.ps1` 래퍼로 넘긴 시도는 종료 코드 1로 CLI 보고서를 내지 않았다. 설치된 `npm.ps1` 래퍼
소스만 읽었고 셸·툴체인은 바꾸지 않았다. 스모크 실패 경로를 통과로 적지 않는다.

이어서 기존 최종 CLI 검사 파일에 실제 Node CLI 서브프로세스의 닫힌 stdout 파이프(`--help`) 케이스를
더해 `node --test --test-timeout=30000 --test-name-pattern="actual Node CLI" tools/runtime/test/summarize-observations.test.ts`를
1/1로 통과했다. 종료 코드 1, stderr 고정 `output_unavailable`, 원시 스택 없음이었다. 런타임 코드는
바뀌지 않았고 나머지 CLI 검사 5개는 앞선 결과를 재사용한다. 이 케이스와 6/6을 한 번에 합쳐
재실행하지 않았다.

`npm run --silent logs:summary -- --help`도 도움말을 출력했다. 변경한 다섯 Markdown 파일의
로컬 링크 117개가 모두 존재하고 `git diff --check`를 통과했다. 링크 검사는 파일 존재만
확인했고 모든 앵커·외부 URL 검사는 아니다.

수집기·SDK·관리자 빌드와 크기·부하 검사는 해당 코드가 바뀌지 않아 생략했다. 네트워크·DB·
Cloudflare 호출·새 의존성·CI 워크플로·환경 변수·저장소 위생 정책 변경·푸시·배포는 없고,
package script `logs:summary`만 더했다. 루트 테스트 명령의 기존 글롭은 새 검사 11개를 포함한다.
계약 안내는 `tools/runtime/LOG-SUMMARY.md`·운영 관측 문서이며 README·로드맵과 이 기록을 갱신했다.
운영 로그 확보·대시보드·알림·기간 비교·헬스 프로브는 이번 도구가 제공하지 않는다.

## 시크릿 계약 (문서 전용) — 2026-10-11

`docs/ops/secrets.md`의 빈 scaffold를 채우고 `README.md`에 링크를, `docs/product/01-roadmap.md`에
이 슬라이스를 기록했다. 문서 전용 변경이며 코드·설정·의존성·CI 변경이 없다.

실행·결과: 변경한 네 Markdown 파일의 로컬 링크 115개가 모두 존재하며 `git diff --check`를
통과했다. 파일 존재 검사이고 모든 앵커·외부 URL 응답을 확인한 것은 아니다.

관리자 `auth/client.ts`·`auth/bootstrap.ts`·`auth/OidcLogin.tsx`·`api/client.ts`,
서버 SDK `index.ts`, OIDC 검증기, `installation.ts`·`prepared-installation.ts`·
`prepare-installation.ts`·`target.ts`·`install-access-check.ts`, 관리자 설정 빌드 스크립트와
`.gitignore`·추적된 `.github` 파일 목록을 대조했다. 토큰 메모리 보관과 PKCE 일시 거래 저장,
access token 수명과 refresh token 회전 구분, 콜백 주소 정리의 범위, 허용 필드에 잘못 넣은
비밀값은 탐지하지 못하는 한계, 빌드 환경 분리·표준 입력 경계·권한 회수와 캐시 키의 한계를
문서에 반영했다. 현재 체크아웃에는 GitHub Actions 워크플로가 없다.

문서 전용 변경이라 코드 테스트·타입 검사·빌드·SDK 크기·부하 검사는 생략했다. 시크릿 스캔은
하지 않았고 토큰 평문 값이나 자격 증명·provider 명령은 열어 보거나 실행하지 않았다. 실제
vault·회전·운영 값·원격 배포·원격 CI secret store는 확인하지 않았다. 계약 원본은
`docs/ops/secrets.md`이며 README·로드맵과 이 기록을 갱신했다. API·DB 계약·마이그레이션·SDK·
설정·의존성·CI 러너·저장소 위생 정책 변경·푸시·배포는 없다.

## 장애 대응·운영 계약 (문서 전용) — 2026-10-11

`docs/ops/incident-response.md`·`docs/ops/00-operational-contract.md`의 빈 scaffold를 채우고
`README.md`에 링크를, `docs/product/01-roadmap.md`에 이 슬라이스를 기록했다. 문서 전용 변경이며
코드·API·DB·SDK·의존성·CI 변경이 없다.

실행·결과: 변경한 다섯 파일의 로컬 링크 122개가 모두 존재하며 `git diff --check`를 통과했다.
파일 존재를 확인한 검사이며 모든 앵커나 외부 URL 응답을 검증한 것은 아니다.

수집기 `handler.ts`·`cleanup.ts`·`index.ts`, 관리자 `worker/index.js`, 브라우저
`common.ts`, 서버 SDK `index.ts`, OIDC 검증기 `index.ts`, 코어 `batch.ts`·`ingest.ts`와
계약 문서를 대조했다. paused 상태에서도 관리자 쓰기·정리가 계속되는 점, 프록시
`admin_api_unavailable` 응답의 requestId 부재, 캐시 키의 즉시 폐기 한계, SDK 재시도·원본 보존과
수신 시각 창, 복구 뒤 회수 권한 재확인, 시작일 cohort·프로젝트 시간대·정리 카운터의 의미를
확인했다. 문서는 실제 장애 연습이나 자동 모니터링 구현을 증명하지 않는다.

문서 전용 변경이라 코드 테스트·타입 검사·빌드·SDK 크기·부하 검사는 생략했다. 실제 provider·
원격 DB·배포·백업/복원·운영 로그인·알림은 실행하지 않았고 새 모니터링 기능·헬스 엔드포인트도
추가하지 않았다. 실제 운영 대응 연습과 담당자·수신자·SLO·RTO·RPO 확정이 남았다. 계약 원본은
장애 대응·운영 계약 문서이며 README·로드맵과 이 기록을 갱신했다. API·DB 계약·마이그레이션·
SDK·의존성·CI 러너·저장소 위생 정책 변경·푸시·배포는 없다.

## 릴리스·롤백 런북 (문서 전용) — 2026-10-11

`docs/ops/release.md`·`docs/ops/rollback.md`의 빈 scaffold를 현재 소스, 설치·백업·마이그레이션
문서와 설치된 CLI 도움말에 맞춰 채우고, `README.md`에 런북 링크와 빠져 있던
`install:access-check` 안내를 더했다. `docs/product/01-roadmap.md`에 이 슬라이스를 기록했다.
문서 전용 변경이며 코드·API·DB·SDK·의존성·CI 변경이 없다.

실행·결과: 문서만 바꿔 코드 테스트를 돌리지 않았다. 명령·옵션 근거는 설치된 CLI 도움말이다.
`wrangler deploy`·`rollback`·`d1 migrations apply`·`d1 migrations list`·
`d1 export`·`deployments list` 도움말과 여섯 로컬 도구(`install:prepare`·
`install:check`·`install:database-check`·`install:access-check`·
`admin:build-configured`·`admin:dry-run`) 도움말을 확인했다. 모두 종료 코드 0이고 원격 접촉이
없다. 실제 provider·원격 DB·배포·백업/복원·운영 로그인은 실행하지 않았다.

추가 검증: 변경한 다섯 Markdown 파일의 로컬 링크 107개가 모두 존재하며 `git diff --check`가
통과했다. 링크 검사는 파일 존재를 확인한 것이며 전체 과거 기록의 앵커나 원격 URL 응답 검사는
아니다. 첫 링크 검사 시도는 문서 교체 중 파일을 읽어 ENOENT로 끝났고, 편집 완료 뒤 다시 실행해
통과했다. 설치·마이그레이션 소스와 문서의 명령·순서를 대조했고, Worker 롤백의 연결 리소스
비복원 경계는 [Cloudflare 공식 안내](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)로
확인했다. export는 원격 읽기라는 점, 기존 DB 쓰기 중지 뒤 백업한다는 순서, 버전 롤백과
라우팅·Cron의 별도 확인, 이벤트 스키마 버전과 마이그레이션 번호 구분을 최종 문서에 반영했다.

문서 전용 변경이라 타입 검사·코드 테스트·빌드·SDK 크기·부하 검사는 생략했다. 실제 설치
묶음·운영 인증 제공자·원격 리소스가 없어 운영 배포·롤백·복구 절차의 실환경 검증은 남았다.
계약 원본은 릴리스·롤백 문서이며 README·로드맵과 이 검증 기록을 갱신했다. API·DB 계약·
마이그레이션·SDK·의존성·CI 러너·저장소 위생 정책 변경과 푸시·배포는 없다.

## 수집기 완료 관측 로그 — 2026-10-11

`apps/collector/src/request-observation.ts`를 추가하고 `handler.ts`에 선택적 `observe`·
`monotonicNow` 포트를, `index.ts` 네이티브 Worker에는 오류 전용 로그 대신 완료 관측 포트를
연결했다. 응답이 준비된 지점에서만 고정 필드 일곱 개(`event`·`requestId`·`operation`·
`status`·`code`·`latencyBucket`·`samplingDenominator`)를 투영하고, 성공(코드 `ok`·
200/204)은 UUID 앞 두 글자 기준 4/256 표본에 `samplingDenominator=64`, 실패는 전량에 1을
적는다. 5xx는 `console.error`, 4xx는 `console.warn`, 그 밖은 `console.log`다. 지연 버킷은
핸들러 시작부터 응답 객체 준비까지이고 `waitUntil` 백그라운드 작업과 네트워크 전송은 뺀다.
시계가 유한하지 않거나 음수면 시각을 쓰지 않고 끝이 시작보다 작으면 `unknown`이며, 관측
콜백·시계 호출이 실패해도 응답은 바뀌지 않는다. 요청 본문·URL·경로·조회 파라미터·메서드·
헤더·프로젝트 ID·대상 식별자는 로그에 넣지 않고 별도 DB 쓰기·네트워크 호출·의존성도 늘리지
않았다.

실행·결과: 관측 검사 파일을 포함한 다섯 파일 범위를 한 명령으로 돌린 첫 실행은 36개 중
35개 통과·1개 실패였다. 실패는 네이티브 Worker 로그 검사 하나로, 합성 D1에서 `DROP TABLE
projects`가 외래 키 제약에 막혀 결함 가드에 닿기 전에 끝난 것이 원인이었다. 검사 fixture를
`DROP TABLE project_schemas`로 고친 뒤 집중 검사
`node --test --test-timeout=30000 apps/collector/test/request-observation.test.ts`가 6/6
통과했다. 나머지 30개는 첫 실행에서 이미 통과했고 이번 수정은 검사 파일만 바꿔 제품 코드가
그대로라 다시 돌리지 않았다. 36개 전체를 재실행한 결과는 아니다. 루트 `npm exec -- tsc
--noEmit`와 `tsc -p apps/collector/tsconfig.runtime.json`은 종료 코드 0, `git diff --check`도
통과했다. 네이티브 로그 검사는 `createWorker`를 직접 불러 실제 로컬 Miniflare D1에 console
가로채기를 씌워 확인했고, 수집기·런타임 검사는 실제 workerd에서 돈다.

집중 검사는 256칸 UUID 접두사 전부에 대해 성공 표본 4개·실패 8종 전량·승인된 필드 투영만
남는지, 시계 경계 버킷과 NaN·Infinity·음수·역행·예외 시계가 `unknown`이 되는지, 성공과
preflight가 응답 하나당 관측 한 번을 남기고 본문을 소비하거나 바꾸지 않는지, 거부 응답의
`requestId`·`code`가 본문과 같고 콜백·시계·백그라운드 작업이 응답을 바꾸지 않는지, 관리자·
서버·모르는 경로가 고정 `operation`만 쓰는지, 네이티브 Worker가 SQL 오류·요청 자료를 남기지
않고 응답당 한 줄만 남기는지 확인한다. 관측 콜백은 동기이고 프로미스를 돌려주는 비동기
관측은 지원하지 않는다. 성공 1/64·실패 전량으로 표본 비율이 달라 원시 로그 줄 수로 실패
비율을 계산할 수 없고, 로그 수치는 정확한 방문자·요청 수나 p95가 아니라 추정 규모라는 점을
문서에 적었다. 배포 시계가 I/O 뒤에만 진행하는 성질은
[Cloudflare 문서](https://developers.cloudflare.com/workers/runtime-apis/performance/)로
확인했고 로컬 타이머와 다르다.

계약 원본 [로그 경계](docs/backend/06-logging-and-observability.md)·[수집기
구현](docs/backend/collector.md)·[운영 관측](docs/ops/observability.md)·[로드맵](docs/product/01-roadmap.md)과
이 기록을 갱신했다. API·DB·마이그레이션·SDK·의존성·CI 러너·저장소 위생 정책 변경은 없고
루트 `wrangler.jsonc`의 관측 설정도 그대로다. 빌드와 SDK 크기 검사는 대상 패키지가 바뀌지
않아 돌리지 않았고 부하·비용·속도도 측정하지 않았다. 운영 로그 수집·대시보드·알림 수신자·
헬스 프로브 배포와 원격 배포·푸시는 없다.

## 복구 연습 발행자 권한 확장 — 2026-10-11

`verify:restore`가 전체 SQL export/restore를 대조한 뒤 합성 복원 DB에서만 발행 권한 회수·
재부여를 연습하도록 `restore-publishers.ts`를 추가하고 `restore-drill.ts`를 넓혔다. 보호
쓰기 목록에 `project_publishers`의 `grant_id`와 `admin_changes`의 `action` UPDATE를 더해 거부
대상이 5개가 됐고, 보고서에 `publisherRecovery`(고정 boolean과 `addedAuditRows`)를 넣는다.

실행·결과: 공식 `npm run verify:restore`가 종료 코드 0으로 통과했고 최종 결과는
`.tmp/restore-drill/run-Ptns25/report.json`이다. 마이그레이션 `0001`~`0009` 아홉 개, 16개
애플리케이션 테이블이 모두 비어 있지 않고 스키마·행 내용 fingerprint가 동일하며 `restored`
fingerprint는 발행자 변이 전 값이다. 재전송은 브라우저 0 accepted·2 duplicates, 서버 0
accepted·1 duplicate이고 `protectedWritesRejected`는 5다. `publisherRecovery` 일곱 boolean이
모두 true이고 `addedAuditRows`는 2다. quick_check는 ok, 외래 키 위반은 0이다. 백업은 28,398
bytes, export 3,774ms·restore 5,222ms·전체 14,873.6ms다(Node 24.18.0·Wrangler 4.148.0·
Miniflare 4.20260730.0). 소표본 로컬 합성 결과이며 운영 RTO가 아니다.

발행자 연습은 회수 뒤 새 non-funnel 서버 이벤트 거부와 DB 불변, 같은 밀리초 재부여의
`grant_id` 변경·`created_at` 유지, stale 회수 계획의 `apply_conflict` 거부와 데이터·감사
불변, no-op 부여의 감사 행 미생성, 재부여 뒤 이벤트 1건 저장(accepted=1·duplicates=0)을
확인한다. 보고서는 subject·issuer·grantId를 담지 않고 원본 백업 SQL과 원본 DB는 바뀌지
않았으며 기존·원격 DB를 열지 않았다.

집중 검사 `node --test --test-timeout=30000 tools/runtime/test/restore-publishers.test.ts
tools/runtime/test/restore-fingerprint.test.ts`는 4/4, 루트 `npm exec -- tsc --noEmit`는 종료
코드 0이다. 초기 탐색용 `node --input-type=module -e` 실행이 멈췄는데, 설치된 Miniflare의
동기 fetch가 `new Worker(eval:true)`에서 CommonJS `require`를 쓰면서 module 입력 인자를
물려받아 Atomics에서 대기한 것이 원인이었다. 소유한 진단 프로세스를 확인해 직접 종료한 뒤
공식 CLI로 통과했고 제품 복구 결함은 아니며 원격 호출과 무관하다.

백업·복구 운영 문서와 로드맵을 갱신했다. API·DB 계약·SDK·의존성·CI 변경은 없고 푸시·
배포도 없다.

## 관리자 접근 확인 도구 — 2026-10-11

`install:access-check`를 로컬 구현했다. 준비한 설치 묶음의 다섯 파일을 먼저 재검증하고, 이미
발급된 관리자 access token을 비대화형 표준 입력(30초·8192바이트 이하, TTY 거부)에서만 받은 뒤
검토한 관리자 HTTPS 출처로 GET 두 개만 보낸다. `GET /v1/identity`로 서버가 검증한 issuer를
확인하고 그 issuer가 설정한 발행자와 정확히 같을 때만 `GET /v1/projects?limit=1`을 읽는다.
리다이렉트 거부·자격 증명 생략·no-referrer·no-store·재시도 없음, 요청당 5초·토큰 입력 후 검사 15초·
본문 16KiB 상한이다. 보고서는 고정 `id`(`admin-identity`·`project-list`)·`status`·`code`와
`accessChecksPassed`·`visibleProjectObserved`(true·false·null)를 담고 `operationalReadinessVerified`·
`remoteChanges`·`tokensRequested`는 false로 둔다. 토큰·이름·subject·URL·응답 본문은 출력하지
않는다.

실행·결과: 집중 검사 5/5, 루트 `npm exec -- tsc --noEmit` 종료 코드 0, CLI `--help`,
`git diff --check`가 통과했다. 처음 실행은 3/5가 실패했는데, 테스트 전송이 Node `Request`를
그대로 Miniflare `dispatchFetch`에 넘겨 호환되지 않은 것이 원인이었다. 명시적 `request.url`과
method·headers·redirect를 넘기도록 테스트 전송을 고쳐 5/5가 됐고 운영 코드 결함은 아니었다.

검사는 임시 서명 OIDC와 실제 관리자 Worker 프록시, 로컬 Miniflare D1로 돌렸다. 빈 목록은
`visibleProjectObserved=false`, 한 건 목록은 true로 확인했고 issuer/audience 거부·401·다른
issuer identity·503·302 응답이 프로젝트 조회 전에 멈추는 것을 확인했다. 본문 16KiB·
Content-Length·비JSON·닫힌 단일 페이지 형태, 요청 취소와 표준 입력 상한·TTY 거부·취소, 묶음
재검증(변조 파일 거부)과 토큰·식별자·URL 비출력도 함께 확인했다. 검사 전후로 `projects`·
`project_grants`·`admin_changes`·`ingest_daily_usage` 스냅샷이 같고 설치 묶음 다섯 파일이
그대로였다.

계약 원본 [설치 안내](docs/backend/installation.md)·[로드맵](docs/product/01-roadmap.md)·
[접근 확인 안내](tools/runtime/INSTALL-ACCESS-CHECK.md)를 갱신했다. API·DB·SDK·의존성·CI
러너·저장소 위생 정책 변경은 없다. 실제 제공자·원격 리소스·원격 DB·배포는 실행하지 않았다.

## 발행 권한 세대 ID API·화면 — 2026-10-11

발행 권한 API와 관리자 화면을 생성 시각(`createdAt`) CAS에서 불변 부여 세대 `grantId`로
옮겼다. 목록·변경 응답이 `grantId`를 함께 돌려주고 `DELETE`는 `expectedGrantId`(32자 소문자
hex 또는 null)를 받는다. `PUT` 본문은 그대로다. 회수 화면은 관측한 `grantId`를 내부로만
보내고 사람에게는 등록 시각 표를 그대로 보여주며, 확인 패널은 "선택한 발행 권한을 회수해요.
다시 부여된 권한은 회수하지 않아요."로 범위를 말로 설명한다.

실행·결과: 최신 API 검사 16/16(후행 개행 `grantId` 거부 추가 뒤), 루트 `npm exec -- tsc
--noEmit`과 수집기 런타임 `tsc -p apps/collector/tsconfig.runtime.json` 종료 코드 0,
contracts lint 통과와 `check` 59/59. 처음 `check`는 DBML 필드 기대값이
아직 네 열이라 실패했고 `grant_id` 단언으로 고친 뒤 통과했다. 관리자 집중 `LiveGrants`·
`LivePublishers` 검사 19/19(명시적 32자 길이 가드 뒤). 관리자 api·모델 153/153과 타입 검사·
빌드·번들 2/2·sites 9/9는 길이 가드 전에 통과했고, 명시적 길이 32자와 후행 개행 거부 변경
뒤 타입 검사·빌드·번들 2/2·sites 9/9를 다시 통과했다. 153/153을 길이 가드 뒤에 다시 돌린
것은 아니다.

실제 Chrome·임시 서명 OIDC 로컬 Worker·D1·고정 `Date.now`·같은 출처 Vite 스모크는
종료 코드 0이었다. 확인 전 쓰기 없음, 보류 중인 PUT 동안 이웃 설정·grant 잠금 유지, 회수
확인 패널을 연 뒤 별도 HTTP 요청이 DELETE+PUT으로 같은 밀리초에 권한을 교체, 화면의
예전 DELETE가 `expectedCreatedAt` 없이 예전 `expectedGrantId`를 보내 409로 끝나 새 행이
보존되고 감사 행이 늘지 않음(발행 3행), 최신 목록 재조회 뒤 새 `grantId`로 다시 보낸 DELETE
성공과 이후 재부여까지 감사 5행, owner 회수 후 목록·폼 식별자 삭제, 320px 문서 가로 넘침
없음과 pageerror 0건을 확인했다. 스크린샷 `.tmp/publisher-generations-desktop.png`(확인)과
`.tmp/publisher-generations-mobile.png`를 남겼고 브라우저·Vite·Miniflare·임시 디렉터리는
finally에서 정리했다.

이 슬라이스는 0009 DB 커밋 `73efeaa` 뒤에 온다. 서버 목록·변경 응답이 `grantId`를 포함하고
예전 `expectedCreatedAt` DELETE는 400으로 거부된다. DB 마이그레이션 추가·SDK·의존성·CI 러너·
저장소 위생 변경은 없다. 원격 D1·실제 제공자·배포·푸시·Sembom 연동은 미실행이다.

## 발행 권한 부여 ID 세대 — 2026-10-11

`project_publishers`에 비밀 아닌 동시성 표식 `grant_id`를 더해 같은 밀리초에 회수·재부여된
권한을 구분한다. 0009가 표를 복사·재생성해 프로젝트·issuer·subject·created_at을 보존하고
행마다 32자 소문자 hex ID를 UNIQUE·CHECK로 두며 BEFORE UPDATE 트리거로 기존 행 수정을 막는다.
CLI `PublisherProvisioner`의 미리보기·적용 CAS는 프로젝트 생성 시각과 함께 현재 행의
`grant_id`를 비교하고, 회수는 `grant_id=?` 조건 삭제로 바뀌어 stale DELETE가 새 권한을 지우지
못한다.

실행·결과: 발행 세대·발행자 CLI·발행 이력·server 수집·발행 목록·설치 DB 기준을 함께 보는
집중 검사 `node --test` 22/22와 루트 `npm exec -- tsc --noEmit`이 통과했다. 이어 같은 순차
실행에서 돌린 기존 Worker 서버·퍼널·source 조회와 저장소 검사는 총 40개 중 관리자 이력 6개를
뺀 34개가 처음부터 통과했고, admin-changes 6개는 처음에 2개가 실패했다. `admin_changes`만
재생성한 fixture에서 마이그레이션 0009까지 기대한 잘못된 단언이 원인이었고, 0009가 이미 적용된
상태에 맞게 기대값을 `0005`+`0008`로 되돌린 뒤
`node --test packages/storage-d1/test/admin-changes.test.ts` 6/6으로 통과했다. 40개 전체
재실행이 아니라 34개 통과 + 수정한 6/6이다.

변경 전 실제 로컬 D1에서 시계를 고정하고 같은 밀리초에 회수·재부여한 뒤, 관측한 생성 시각으로
stale DELETE를 보내면 새로 부여한 권한이 status 200으로 삭제되는 것을 재현했다(문서화된
재현). 새 DB와 CLI 경로에서는 같은 밀리초 재부여를 구분하는 검사가 통과한다. HTTP
`DELETE /v1/projects/{projectId}/publishers`와 관리자 발행 화면은 이번 슬라이스에서 아직 생성
시각(`createdAt`) 기준이고, ID로 전환하는 API·UI는 다음 슬라이스다.

이번 DB 슬라이스에서 바뀐 계약 원본은 [db/schema.dbml](db/schema.dbml)의 `project_publishers`
`grant_id` 하나이고, HTTP 회수 계약(`api/openapi.yaml`)과 관리자 화면 UI는 다음 슬라이스로
넘긴다. 마이그레이션은 [마이그레이션 안내](db/migrations/README.md)와
[0009 SQL](db/migrations/0009_publisher_generations.sql), 발행자 CLI·설치 안내에 기록했다.
설치 메타데이터 기준 참조도 9개 마이그레이션·16개 테이블로 갱신했다. 의존성·CI 러너·저장소
위생 정책 변경은
없다. 실제 운영 OIDC·원격 D1 적용·권한 이관·푸시·배포는 미실행이며, 원격 D1에는 어느
마이그레이션도 적용하지 않았다.

## 관리자 서버 발행자 화면 — 2026-10-11

설정의 LiveGrants와 LiveAdminChanges 사이에 owner 전용 LivePublishers를 연결했다.
25건 목록·다음 페이지·첫 페이지 새로고침, issuer/subject 추가, 관측 생성 시각으로 회수,
확인 후 쓰기와 변경 이력 갱신을 제공한다. 결과 불명은 같은 요청만 재확인하고 저장 중·
결과 불명에는 설정 입력/저장/초기화와 관리자 grant 편집도 잠근다. 401/403·프로젝트 전환·
폐기에서 신원을 지우고 늦은 응답을 폐기한다. UTF-8 BINARY 순서와 프로젝트/종류별 커서,
닫힌 응답·createdAt/granted 쌍을 검증하며 640px 표는 포커스 가능한 영역 안에서 가로 스크롤한다.

실행·결과: 부모의 publisher·기존 grant 목록/편집 테스트 19/19, 보조 에이전트의
관리자 신규 publisher 테스트 6/6·typecheck·build,
test:sites 9/9를 통과했다. 부모는 기존 cryptographic ephemeral OIDC collector harness·
Miniflare D1·Vite same-origin proxy·실제 Chrome으로 부여/회수 확인 전 쓰기 없음, 목록·
이력 자동 갱신, 대기 PUT 동안 설정/grant 필드 잠금, owner 권한 회수 후 목록·입력 삭제,
320px 문서 가로 넘침 없음·pageerror 0을 확인했다. 단위 회수 기대 시각은 실제 API로
보냈고 최초 2개 이력과 재부여까지 총 3개 publisher 이력을 확인했다. 첫 브라우저 시도는
기존 Vite 프록시의 정규식 키를 잘못 덮어 5188에 연결 실패했고, 검증 fixture가 그 키를
정확히 덮도록 고친 뒤 통과했다. UI 코드의 오류로 판정하지 않았다. 보조 코드 리뷰에서
오름차순 비교 역방향과 opaque subject 앞 공백 거부 fixture를 수정하고 관련 회귀를 넣었다.

화면 캡처는 .tmp/publishers-desktop.png·publishers-mobile.png이고 브라우저·Vite·Miniflare와
이번 합성 D1 상태는 finally에서 정리했다. 브라우저 검증 후 모바일 표 최소 너비·안내
보완을 다시 같은 시나리오로 확인했다. 이번 API/DB 원본 계약·마이그레이션·SDK·의존성·
CI·위생 정책 변경은 없다. README·관리자/서버 발행 문서·로드맵을 갱신했다. 전체 스위트는
관련 검사와 앞선 이력 검사 결과가 유효해 재실행하지 않았다. 실제 운영 OIDC·원격 D1·
배포/Sembom 검증은 설정 미정으로 미실행이며 푸시·배포도 없다.

## 서버 발행자 등록·회수 API — 2026-10-11

현재 owner의 PUT/DELETE /v1/projects/{projectId}/publishers를 로컬 구현했다. PUT은
issuer/subject만 받고 기존 생성 시각을 보존하는 no-op를 허용한다. DELETE는 관측한
expectedCreatedAt을 비교하고, 이미 없는 권한에는 no-op, 다른 시각의 권한에는
publisher_conflict(409)를 반환한다. 동일 밀리초에 재부여된 권한을 구분하는 고유 세대 ID는
아니라는 한계를 계약에 명시했다. 권한 변경·publisher 감사 행·owner 재확인은 같은 D1
batch이며 CLI와 별개로 검증된 administrator actor를 기록한다.

실행·결과: 발행자 조회/변경·기존 관리자 grant 변경 테스트 16/16, 루트 npm exec --
tsc --noEmit, tools/contracts lint·check 59/59 통과했다. 이후 입력 snapshot 복사 보완 뒤
변경 API 4/4·타입 검사를 다시 통과했다. 실제 로컬 D1에서 회수 전 기대 시각과 현재 값
불일치, 재요청 no-op·중복 이력 없음, owner 회수 경쟁, reader/publisher-only/없는 프로젝트
거부, 이력 실패 시 권한 롤백, 닫힌 입력과 16KiB body·Content-Type 제한을 확인했다.
새 ErrorCode를 추가한 첫 타입 검사에서는 고정 메시지 누락을 찾아 보완했다.

계약 원본 api/openapi.yaml과 서버 발행·관리자 문서, 로드맵·README를 갱신했다.
이번 슬라이스의 DB·마이그레이션·SDK·의존성·CI·위생 변경은 없고 기존 0008 이력을 쓴다.
발행자 관리 화면은 별도 다음 슬라이스다. 운영 리소스·실제 로그인/원격 검증은 설정
미정으로 미실행이며 푸시·배포도 없다.

## 서버 발행자 변경 이력 — 2026-10-11

publisher.granted/revoked 이력을 target issuer/subject만 담는 별도 action으로 확장했다.
0008은 admin_changes 13개 열과 기존 행을 그대로 복사하고 action/target 제약을 넓힌 뒤
원래 인덱스·필드 검증·수정 금지 트리거를 재생성한다. 로컬 init이 두 action과 필요한
가드를 확인하고 불완전한 업그레이드를 거부한다. CLI 부여/회수와 이력은 같은 batch이며
중복·no-op에는 기록하지 않는다. 이력 조회/관리자 파서·표시에 두 action을 연결했다.

실행·결과: 저장소/CLI/collector 이력 집중 테스트 20/20, 기존 서버 수집·퍼널·설치 DB
검사 16/16, 관리자 이력 테스트 6/6, 루트 npm exec -- tsc --noEmit과
npm run typecheck:admin·build:admin, tools/contracts lint·check 58/58 통과. 보조 에이전트의
관리자 전체 테스트도 161/161 통과했다. 기존 history/project 행 보존·FK 무결성·반복 init,
권한과 이력의 동시 롤백·중복 이력 없음·90일 정리·가드 손상 거부를 로컬 D1에서 확인했다.
첫 타입 검사는 rows[0] 가능성으로 실패했고 비어 있는 batch 검사 뒤 non-null 표현을
추가해 통과했다. 운영 DB에 마이그레이션은 적용하지 않았다.

API/DB 계약 원본 api/openapi.yaml·db/schema.dbml과 문서/로드맵을 갱신했다.
SDK·의존성·CI·위생 변경은 없으며 등록/회수 HTTP API와 발행자 관리 화면은 후속이다.
DB 복사이므로 운영 적용 전 관리자·CLI 쓰기 중지와 백업·행 수·제약/FK 확인이 필요하다.
실제 운영 리소스는 미정으로 원격/배포·실로그인 검증은 미실행이고 푸시·배포도 없다.

## 서버 발행자 목록 API — 2026-10-11

현재 owner 전용 GET /v1/projects/{projectId}/publishers를 추가했다. 발행자 권한과 관리자
권한을 분리하고 매 페이지 같은 D1 batch에서 owner와 행을 읽는다. 기본 25·최대 100,
issuer/subject 순서, 프로젝트·목록 종류별 커서, 신원·생성 시각만 반환한다.

실행·결과: node --test apps/collector/test/publishers.test.ts apps/collector/test/grants.test.ts
10/10, npm exec -- tsc --noEmit, tools/contracts의 npm run lint와 npm run check 57/57 통과.
실제 로컬 Miniflare D1에서 권한 회수 직후 페이지 조회 거부, publisher-only/reader/다른
프로젝트 owner 거부, 최대 Unicode 식별자·삭제된 커서 위치·목록 종류/프로젝트 분리,
손상 데이터·저장 실패의 고정 오류를 확인했다. 처음의 손상 fixture는 DB CHECK가 빈 subject
저장을 거부해 잘못된 HTTP issuer로 고친 뒤 통과했다. 이번 endpoint는 쓰기가 없다.

계약 원본 api/openapi.yaml과 관리자·서버 발행 문서, 로드맵을 갱신했다. DB·마이그레이션·
SDK·의존성·CI·위생 정책은 바꾸지 않았다. 화면·등록/회수 API는 다음 슬라이스다.
운영 인증·원격 D1·배포 검증은 실제 설정 미정으로 미실행이며 푸시·배포는 없다.

## 설치 설정 오류 안내 — 2026-10-11

설치 설정 검증 실패가 어느 입력 항목인지 알려주도록 `installation()`이 고정 `field`를 가진
`InstallationConfigError`(기존 `TypeError` 호환)를 던지고, `install:prepare` CLI가
`installation_config_failed` 오류에 그 `field`를 붙여 출력한다. 값은 `input`, `admin`,
`collector`, `admin.accountId`, `admin.collectorWorkerName`, `adminOrigin`, `login`,
`login.issuer` 중 하나이고 입력값·URL·ID·내부 예외 원문은 담지 않으며 `cause`도 두지 않는다.
파일·인자·쓰기 오류처럼 검증 밖에서 난 실패는 기존 고정 오류 그대로이고 `field`를 붙이지 않는다.

실행·결과: `node --test tools/runtime/test/installation.test.ts
tools/runtime/test/configured-build.test.ts` 6/6, 루트 `npm exec -- tsc --noEmit`. 새 필드 형태
검사는 8개 field 각각에서 `InstallationConfigError`·`TypeError` 호환, 제출 값 미포함, `cause`
없음을 확인했고, CLI issuer 불일치는 `field=login.issuer`·stdout 빈 값·출력 폴더 미생성을, 일반
인자 오류는 `field` 없음을 확인했다. 실제 관리자 빌드와 기존 빌드 보존·ambient `VITE_` 분리
회귀도 함께 통과했다.

[설치 설정 준비](docs/backend/installation.md)에 `field` 안내를, [README](README.md)에 현재
구현·미확인 상태를 반영했다. API·DB 스키마·마이그레이션·SDK·의존성·CI 러너·저장소 위생 정책
변경은 없다. 실제 운영 인증·원격 리소스·배포 검증은 미실행이다(실제 설정 미정). 푸시·배포는 없다.

## 설치 메타데이터 검사 — 2026-10-11

`npm run install:database-check -- --remote --dir <설치 묶음>`을 로컬 구현·검증했다. 설치
디렉터리의 다섯 파일을 다시 검증하고 기준 마이그레이션을 이번 실행의 새 인메모리 D1에 적용한
뒤 원격 D1의 `sqlite_master`를 한 번 조회해 테이블·인덱스·트리거 메타데이터를 비교한다. 기존
원격 생성 권한 도구의 설치 Wrangler 전송을 그대로 쓴다. 기준은 16개 테이블·7개 마이그레이션이고
SQL 입력·환경 변수·추가 config 옵션은 받지 않는다.

실행·결과: `node --test tools/runtime/test/install-database-check.test.ts
tools/runtime/test/restore-fingerprint.test.ts` 4/4(신규 2·기존 복구 2), 루트 `npm exec --
tsc --noEmit`, 새 `--help`가 통과했다. 설치된 Wrangler를 테스트 포트에서만 `--remote`→`--local`로
바꾼 실제 로컬 D1에서 호출 두 번과 임시 scratch 삭제를 확인해 현재 스키마는 통과하고
`funnel_run_update`를 DROP한 DB는 누락 트리거로 불일치했으며 `retention_cleanup_state`
revision 37은 조회 전후로 유지됐다. 데이터 행 읽기는 검사가 아니라 검증 fixture의 sentinel
확인에서만 일어났고, 설정 파일 변조와 잘못된 인자는 원격 호출 수를 늘리지 않고 거부했다.
초기 두 번의 테스트 실패는 fixture의 옛 테이블 이름 `cleanup_cursor` 오류와 `dispose` 중복
호출이었고 수정 뒤 통과했으며 실행 동작은 그대로다.

보고서는 기준·관측 객체 수, 누락·변경(기준 객체 이름만), 추가 객체 개수, 스키마 SHA-256,
대상 해시, 기준 마이그레이션 목록을 담고 SQL·주소·계정·DB ID·issuer·subject는 출력하지
않는다. `databaseSchemaMatches`가 true여도 `operationalReadinessVerified`는 false이고 예상과
다르면 종료 코드 1이며, 원격 쓰기·상품 행 조회·토큰 발급·grant·원격 마이그레이션·배포는 하지
않는다. 실제 Tallyfin 운영 설치 묶음이 없어 원격 실행은 하지 않았고 Workbench 등록 Tallyfin
대상도 없다. Cloudflare vault `no-visible-accounts`(부분 커버리지)는 계정 부재의 증거가 아니며
관측 metadata timestamp는 오늘 00:51 UTC다.

API·DB 스키마·마이그레이션·SDK·의존성·CI 러너·저장소 위생 정책 변경은 없다. package 명령 1개를
추가했고 기존 `normalizeSql`을 내보내 재사용한다. 실제 운영 인증·원격 리소스·데이터 무결성·
Cron·백업·로그인 검증은 미실행이다(운영 환경 미설정). 푸시·배포는 없다.

## 브라우저 SDK 재시도·응답 유실 복구 실험 — 2026-10-11

실패 정책을 상태 0(네트워크·타임아웃)·408·429·모든 5xx 재시도와 401·403·409·422
미재시도로 넓히고 `bench:browser`에 `recovery` 화면을 추가했다. 최대 2회 재시도(총
3번)·1/2초 백오프·정수 Retry-After·10분 예산·같은 ID/본문 유지·40개 버퍼·비동기
전송·본문 무저장 규칙은 그대로다. [이벤트·집계 계약](docs/backend/event-contract.md)과
[브라우저 SDK](docs/backend/browser-sdk.md)의 실패 정책·전송 계약 문장을 갱신했다.

`recovery` 화면은 첫 배치를 수집기 앞에서 502로 막고, 다음 시도는 20개를 D1에 저장한
뒤 HTTP 응답 연결만 끊는다(브라우저에는 상태 0). 전송 trace는 [502, 0, 200, 200]이고
앞 세 본문의 SHA-256이 같다. 첫 번째 200은 accepted 0·duplicates 20, 마지막 200은
accepted 6이라 응답 유실 뒤 재전송이 이중 집계되지 않는다. 재시도 대기 중에 넣은
계산 1건도 버퍼에 남아 함께 전송된다. 실브라우저 계산은 recovery 12회·수집기 종료 후
outage 11회이고, Origin은 있고 쿠키·인증·Referer는 없으며 브라우저 스크립트 오류는
0건이다.

실행·결과: 브라우저 SDK 검사 30개와 관리자 SDK 코드 생성 검사 6개를 함께 실행해 36/36,
`npm exec -- tsc --noEmit`,
`npm run build:browser`, `npm run check:browser-size`,
`npm run bench:browser -- --channel chrome --samples 2`. 번들 gzip은 기본 2750 B·
Sembom 3026 B·퍼널 2920 B·퍼널+예제 3047 B로 예산 3072 B 안이다. 정상 화면 2회는 각각
24개, 복구 화면은 26개가 저장돼 영수증 74개·workflow 시작/성공 34/34다. 결과 파일은
`.tmp/browser-bench/1791679581062.json`이다.

관리자 생성 코드의 최초 gzip 3081 B는 한도 검사에서 실패했다. 진행 중 배치의 개수와
재시도 상태를 확인할 때 Set을 배열로 복사하던 부분을 직접 순회로 바꿔 3072 B로 줄였다.
소스와 빌드된 패키지로 생성한 코드 모두 같은 크기다. 위 36개 검사·타입 검사·빌드·
크기 검사·Chrome 복구 실험은 이 변경 뒤 다시 통과했다.

fixture의 본문 SHA-256과 accepted·duplicates는 합성 측정값이며 실제 운영 로깅이 아니다.
성능 수치 비교나 SLO 주장은 하지 않는다. API 형태·DB 스키마·마이그레이션·의존성·CI
워크플로/러너 변경은 없고, 실제 운영 인증·원격 리소스·모바일·운영 환경 검증은
미실행이다(운영 환경 미설정). 후속은 실제 운영 인증·원격 리소스 확인과 장기간·다중
Worker 검증이다. 푸시·배포는 없다.

## 누적 데이터·정리 부하 실험 — 2026-10-11

`bench:retained`(opt-in, 기본 test/check/CI 미포함)를 추가했다. 새 로컬 D1의 6개 프로젝트에
네 테이블의 합성 이력 67,860행을 직접 SQL로 넣고, 실제 Worker 시계로 HTTP 8건/초를
120초 제공했다. 데이터 생성과 인증 warmup은 측정에서 제외한다. 쓰기 480건·인증된 30일
요약 조회 480건이 모두 200이었다. 실제 scheduled 정리 24회가 모두 ok였고 HTTP와 겹쳤다.
운영 1분 대신 5초마다 정리를 호출했으며 커서 revision은 24다. 클라이언트 재시도 없이 새
이벤트 8,800건·중복 800건·신규 workflow 시도 4,400건이 기대값과 일치했다.

만료 영수증 7,200·만료 시도 7,200·오래된 이벤트 집계 2,160·workflow 집계 360행이
삭제됐다. 최종 영수증 44,800·시도 8,000·이벤트 일별 9,720·workflow 일별 1,620행을
확인했고, 보존 중인 집계의 모든 행은 초기값+새 수락분과 일치했다. API 요약도 별도
검사했다. p95는 쓰기 48.95ms·조회 10.96ms·정리 123.60ms·작업 시작 지연 13.96ms였다.
실제 부하 창은 120,011.575ms이고 설정 동시 작업 상한 16은 관측 최대치가 아니다.

실행·통과: `npm run bench:retained`, 루트 `tsc --noEmit`,
`node --test tools/runtime/test/retained-bench.test.ts tools/runtime/test/collector-bench.test.ts`
4/4, 새 명령 help, `git diff --check`. 공용 harness 추출 뒤 `npm run bench:collector`도
통과했다(`.tmp/collector-bench/run-hBJyX8/report.json`). 이 회귀 실행은 다른 검사와
겹쳤으므로 측정 수치 비교에는 쓰지 않는다. 집중 검사는 과부하 때 발행 속도를 숨겨
낮추지 않고 실패하는 것, 이미 시작한 작업 drain·취소·결과 순서, 작은 fixture의 6개
프로젝트 정리/보존을 확인했다.

최종 결과는 `.tmp/retained-bench/run-r2xPxi/report.json`이다. Node 24.18.0·Windows
x64·Ryzen 5 7430U·Miniflare 4.20260730.0 환경이며 JWKS는 메모리 합성이다. 기존/원격 DB
접근은 없었다. 실제 인증 제공자·운영 리소스·장기간·다중 Worker·장애 상황과 네 테이블 밖
대량 데이터는 미검증이며 로컬 2분 결과를 운영 처리량/SLO로 일반화하지 않는다.

부하 도구·공용 harness·설명과 성능 예산/수집기/로드맵을 갱신했다. API·DB 스키마·
마이그레이션·SDK·의존성·CI 워크플로/러너·위생 정책 변경은 없고 푸시·배포도 없다.

## 설치 공개 제공자 검사 — 2026-10-11

`install:check -- --dir <prepared-installation>`은 다섯 설치 파일을 재검증하고 공개 OIDC
discovery·JWKS GET과 진단용 token endpoint OPTIONS만 보낸다. 코드 교환·로그인·토큰
발급/갱신·클라이언트 등록·Cloudflare 조회·DB·배포·파일 쓰기는 하지 않는다. 같은 출처는
CORS 헤더와 OPTIONS를 요구하지 않고 발행자 인증을 켰으면 발행자 JWKS도 검사한다.
필수 공개 검사만 `publicChecksPassed`에 반영하고 운영 준비는 항상 미확인으로 반환한다.

실행·통과: `node --test tools/runtime/test/install-check.test.ts
tools/runtime/test/installation.test.ts` 7/7(신규 4·기존 3), 루트 `tsc --noEmit`, 신규 명령
`--help`, 누락된 설치 디렉터리의 종료 코드 1·고정 오류 출력, `git diff --check`.
집중 검사는 issuer·PKCE·알고리즘·HTTPS/CORS 오류, 같은 출처, 별도 발행자 키,
비공개 필드·약한/잘못된 용도 공개키, 선언/실측 본문 상한, 요청 전 취소·멈춘 스트림 취소,
설치 파일 변조 때 무네트워크·추가 인자 거부·파일 무변경을 확인했다. 제공자 응답과
공개키는 격리된 메모리 fixture다. 초기 취소 검사 실패는 요청 전 취소 확인을 추가해 수정했다.

읽기 전용 Workbench snapshot의 등록 대상에는 Tallyfin이 없었다. vault 기반 Cloudflare
목록은 `unknown/no-visible-accounts`, coverage partial이므로 계정 부재로 단정하지 않는다.
저장소 `.tmp` 안에는 실제 설치 묶음이 없었고 실제 제공자·운영 리소스 검사는 미실행이다.
실제 로그인·갱신·토큰 audience/type·클라이언트 등록·원격 DB/Worker/Cron은 확인하지 않았다.

설치 안내·로드맵·검증 기록을 갱신했고 API·DB 스키마·마이그레이션·SDK·의존성·CI
워크플로/러너·위생 정책 변경은 없다. npm 명령만 추가했으며 푸시·배포도 없다.

## 수집기 로컬 부하 실험 — 2026-10-11

`npm run bench:collector`(opt-in, 기본 test/check/CI에 연결하지 않음)를 추가했다. 새 합성
D1·loopback HTTP에서 실제 bearer·JWT 검증과 D1 집계를 거치는 216요청을 측정했고 204건
200, 12건은 설계한 할당량 429다(Retry-After 확인). 동시성 1·4·8·16 단계는 각각 12배치
240개 신규 이벤트와 같은 DB 조회 6건을 처리했고 workflow 쓰기 p95는
47.13/111.39/190.01/322.82ms, 인증 조회 p95는 9.35/109.87/189.35/321.15ms였다. 같은 20개
이벤트를 16동시로 재전송한 단계는 accepted 20·duplicates 300이고, browser/server가 공유하는
분당 한도 12는 성공 12·429 12였으며 이후 다른 프로젝트 2건은 정상 수락됐다.

실행·통과: 루트 `tsc --noEmit`, `node --test tools/runtime/test/collector-bench.test.ts` 2/2,
신규 명령 `--help`와 옵션 인자 거부, `npm run bench:collector`. 환경은 Node 24.18.0·Miniflare 4.20260730.0·
win32 x64이며 결과는 `.tmp/collector-bench/run-QOCW8g/report.json`이다. 최종 DB는 영수증
1090·workflow 시작/성공 480/480·4단계 퍼널 완료 24·할당량 수락 12/거부 12이고 API 조회
합계와 독립 DB 집계가 일치했다.

Worker 시계는 고정했고 HTTP 시간은 호스트 단조 시계 실측이며 JWKS는 메모리 합성이라 실제
제공자 로그인·토큰 갱신·JWKS 장애는 미실행이다. 작은 순차 스윕으로 단계마다 DB가 커지고
쓰기 12개·조회 6개 표본의 p95는 최댓값이므로 운영 처리량·SLO·원인 귀속으로 일반화하지
않는다. 원격 DB·실제 운영 인증·지속 대용량 부하·정리 중 부하·다중 Worker는 미실행이다.
측정 조건은 `tools/runtime/COLLECTOR-BENCH.md`에 있다.

API·DB 스키마·마이그레이션·의존성·CI 워크플로/러너·위생 정책 변경은 없고 opt-in
`bench:collector` 명령만 추가했으며 푸시·배포는 없다.

## 전체 스키마 SQL 백업·복구 연습 — 2026-10-11

`verify:restore` 명령과 로컬 합성 fixture·스키마/행 내용 fingerprint를 추가했다.
새 source DB에 마이그레이션 0001~0007과 workflow·혼합 출처 퍼널·권한·관리자 변경 이력·
생성 이력·사용량/거부·정리 커서를 저장하고 닫은 뒤 실제 Wrangler 로컬 export를 실행한다.
별도 새 DB에 전체 SQL을 import하고 16개 테이블·38행의 내용/개수와 인덱스/트리거를
포함한 스키마를 비교한다. 복원 후 브라우저 2건·서버 1건 재전송은 모두 duplicate이고
집계가 바뀌지 않는다. 스키마 정의·생성 이력·퍼널 순서 위반 쓰기 3개가 거부되며
그 뒤 내용이 그대로다. 최대 안전 정수 카운터도 SQL export/import 뒤 보존됐다.

최종 실행·통과: `npm run verify:restore`, 루트 `tsc --noEmit`, 집중 검사 2/2,
신규 명령 help와 `git diff --check`. 환경은 Node 24.18.0·Wrangler 4.148.0·
Miniflare 4.20260730.0이며 최종 결과는 `.tmp/restore-drill/run-VFtFl3/report.json`이다.
백업은 27,364 bytes, export 2,659ms·import 2,669ms·전체 8,814ms였다.
소표본 로컬 합성 결과이며 운영 RTO가 아니다. 원시 SQL·두 DB·환경과 마이그레이션/백업
해시는 무시된 새 실행 디렉터리에 보존했다.

초기 검사는 D1에서 허용되지 않는 `integrity_check`로 실패했고 이를 공식 지원
`quick_check`로 수정했다. 최종 quick_check는 ok, 외래 키 위반은 0이었다.
집중 검사는 행의 물리적 순서 무관, 같은 행 수의 내용 변경·인덱스/트리거 손실·
따옴표 안 공백 변화 감지, 누락된 검사 응답/외래 키 위반 거부를 확인했다.
실행은 원격/기존 DB 옵션 없이 합성 DB만 사용했고 원본 행이나 credential을 stdout에
출력하지 않았다. 전체 연습은 기본 CI에 추가하지 않았으며 작은 집중 검사만
기존 runtime test 경로에서 발견한다.

백업·복구 운영 문서·설치 안내·로드맵을 갱신했다. API·DB 스키마·마이그레이션·SDK·
의존성·CI 워크플로/러너·위생 정책 변경은 없다. 실제 인증 제공자·원격 DB가 미설정이므로
운영 백업·원격 복구·장애 전환·운영 RTO/RPO·부하 검증은 미실행이다. 푸시·배포도 없다.

## 원격 최초 생성 권한 도구 — 2026-10-11

`provision:remote-creators`를 추가했다. 완전한 설치 묶음 재검증·발급자 일치·닫힌 JSON
입력·대상과 상태를 포함한 계획 해시를 요구한다. 미리보기는 읽기만 하고 적용은 한 SQL
CAS로 `project_creators`만 변경한다. 기존 grant·생성 이력·부여 시각을 보존하고
재부여 시각·한도·생성 개수 경쟁을 거부한다. 오류·응답 유실은 고정 문구로 처리하고 자동
재시도하지 않는다. Wrangler SQL import 대신 query 경로를 사용하고 임시 config/env·
로그/metrics 차단·직접 CLI 프로세스 제한과 대상 범위를 확인한 캐시 정리를 추가했다.

실행·통과: 전체 권한 도구 검사 19/19(신규 7개), 루트 `tsc --noEmit`, 신규 npm 명령 help,
`git diff --check`. 실제 로컬 D1에서 Unicode/따옴표/세미콜론 subject의 정확한 보존·부여·
변경·회수·no-op·stale/재부여/생성 개수 경쟁을 검증했다. 합성 transport로 대상 고정·
설치 파일 편집 거부·해시 필수·해시 불일치 쓰기 거부·응답/예외 정보 비노출을 확인했다.
설치된 Wrangler의 동일 config/env/command를 테스트 포트에서 `--local`로만 바꾸어
실제 D1 JSON·RETURNING 프로토콜을 확인했고 마지막 검사에서 네 실행의 임시 캐시 제거를
확인했다. 이전 검사에서 남은 임시 캐시 디렉터리 4개의 수동 삭제는 자동 승인 검토에서
차단되어 해당 캐시는 남겼다. 저장소·실행 대상 DB에 영향이 없다.

제품 로드맵·권한 정책·설치/등록 안내와 원격 등록 문서를 갱신했다. API·DB·마이그레이션·
SDK·의존성·CI·위생 정책 변경은 없다. npm 실행 명령만 추가했다. 실제 제공자·운영 자격
증명·원격 DB 대상이 미설정이므로 원격 조회/쓰기·운영 로그인·푸시·배포는 미실행이다.

## 관리자 자기 계정 화면 — 2026-10-11

관리자 API 연결 후 `로그인 계정 확인`을 펼칠 때만 `/v1/identity`를 읽고 검증한
issuer/subject를 읽기 전용 필드·JSON으로 보여준다. 토큰·추론한 역할은 복사하지 않는다.
닫기·연결 교체·언마운트는 요청 취소와 세대 번호로 이전 응답을 폐기하고, 조회 실패는
이전 식별자를 지우고 재시도를 제공한다. 권한 없는 최초 계정도 프로젝트 선택 없이 사용한다.

실행·통과: 관리자 검사 160/160(자기 계정 신규 4개), 관리자 타입 검사·production 빌드,
초기 JS/지연 로딩 검사 2/2, Sites 패키징/Worker 검사 9/9. 초기 JS gzip은 100 KiB 예산 안이다.
로컬 브라우저에서 실제 컴포넌트와 합성 transport로 최초 0회·열기 1회 조회, 복사 성공 안내,
401 후 식별자 제거, 재조회·닫은 뒤 지연 응답·연결 교체 뒤 지연 응답 폐기를 확인했다.
실제 LiveDashboard에도 합성 transport를 연결하여 빈 프로젝트 목록에서 계정 조회 가능과
연결 해제 때 계정 정보 제거를 확인했다. 좁은 화면(실제 innerWidth 356px)에서 문서 가로
넘침이 없고 모든 계정 필드가 읽기 전용이다. 브라우저 viewport의 요청값 320px과 실제값은
달랐으므로 320px 검증으로 기록하지 않는다.
실제 제공자·원격 로그인·DB·운영 배포는 미설정으로 미실행이다. 이번 변경은 기존 API를
소비하며 API·DB·마이그레이션·SDK·의존성·CI·위생 정책 변경이나 푸시는 없다.

## 첫 운영 관리자 식별 조회 — 2026-10-11

`GET /v1/identity`는 기존 관리자 bearer 검증을 거친 호출자의 issuer/subject만
반환한다. 프로젝트 grant·생성 권한·DB 접근 없이 자기 계정만 확인할 수 있고 권한은
부여하지 않는다. GET만 받고 쿼리를 거부하며 no-store·Vary Authorization을 적용한다.
API 계약·닫힌 응답 예제·계약 검사와 제품/관리자 경계·로드맵을 갱신했다.

실행·통과: 관리자/실제 런타임 집중 검사 17/17(신규 자기 계정 검사 2개 포함),
계약 검사 55/55, 수집기·OIDC 전체 검사 132/132, 루트 타입 검사와 OpenAPI lint.
테스트는 관리자 store 접근을 차단한 상태에서도 grant 없는 호출자만
반환하고 프로필·역할 등 검증기 추가 값은 제외함을 확인했다. 메서드·쿼리·헤더·인증
미설정·검증기 예외·잘못된 식별자·크기 초과를 거부했다. 실제 Worker/JWKS/단기 서명
JWT/D1 검사에서 grant를 모두 제거한 뒤에도 자기 계정은 200이고 변조 서명·다른
audience 토큰은 401이었다.
실제 제공자·운영 계정·DB·배포는 미설정으로 미실행이다.
DB·마이그레이션·SDK·의존성·CI·위생 정책 변경과 푸시는 없다. API는 자기 계정 GET을
추가했으며 기존 프로젝트 조회/변경 권한은 유지했다. UI 연결과 운영 최초 권한 등록은 후속이다.

## 설정 묶음 기반 관리자 빌드 — 2026-10-11

`admin:build-configured`는 설치 스냅샷을 다시 검증하고 네 설정 파일과 비교한 뒤
공개 로그인 값만 Vite define으로 주입한다. `.env`·부모 `VITE_` 값·개발 proxy는
제외하고 production 모드로 새 `admin-assets`에 빌드한다. 기존 산출물·기본 앱 dist는
덮어쓰지 않는다. 성공 기록은 `admin-build.json`이며 실패한 부분 파일은 보존한다.
admin dry-run은 선택 config 하나만 전달하고 dry-run을 고정하며 원격·중복 옵션을 거부한다.

실행·통과: `node --test --test-timeout=30000 tools/runtime/test/configured-build.test.ts
apps/admin/tests/local-proxy.test.mjs` 3/3. 실제 관리자 앱을 임시 설치 디렉터리에
production 빌드했다. 부모 NODE_ENV=development·상이한 VITE client ID·불필요한
VITE 값·원격 개발 proxy 환경을 넣어도 승인 client/issuer만 번들에 있고 DB/account ID·
JWKS 설정·환경 sentinel은 없었다. 실제 manifest의 초기 gzip JS는 100KiB 이내이고
로그인 청크는 지연 로딩이다. 두 설정이 다른 경우·32KiB 초과·누락 설정을 거부하고
검증 실패 전 자산을 만들지 않았다. 재빌드는 이전 자산/성공 기록을 보존한다.

추가 실행·통과: 루트 `npx --no-install tsc --noEmit`, 로그인·설치 검사 12/12,
기본 관리자 빌드와 번들 검사 2/2, 계약 검사 53/53, 기본 admin dry-run.
백엔드 전체 검사는 소스가 바뀌지 않아 반복하지 않았다.

같은 검사는 생성한 관리자 config를 지정해 실제 설치 Wrangler dry-run을 수행했다.
새 자산과 지정 test collector 바인딩을 패키징했고 업로드는 없었다. 원격 플래그와
중복 config 옵션은 Wrangler 호출 전에 거부했다. 런타임 키·운영 자격 증명은 쓰지 않았다.
실제 로그인 제공자·remote D1·grant·DNS·서비스 연결·배포는 설정 미정이라 미실행이다.
API·DB·SDK·의존성·CI·위생 정책 변경과 푸시는 없다. 설치/앱/개발 안내·로드맵과 검증
기록을 갱신했다. Vite proxy 변경은 개발 서버에만 적용되며 위 실제 proxy 검사도 통과했다.

## 운영 설치·로그인 설정 묶음 — 2026-10-11

`install:prepare`는 관리자·수집기·공개 OIDC login 설정을 함께 검증하고 새 디렉터리에
두 Wrangler config·공개 login JSON·제공자 등록 요구 값·입력 스냅샷을 쓴다. 계정·
서비스 바인딩·관리자 HTTPS 출처·issuer 일치를 검사한다. 비밀 키·추가 키·잘못된
scope/알고리즘·32KiB 초과·기존 출력·원격 플래그는 거부하며 서버·DB 값은 공개 login
설정에 복사하지 않는다. 원격 작업과 discovery는 실행하지 않는다.

실행·통과: 설치·관리자 타깃·수집기 타깃의 집중 검사 9/9(설치 신규 3개),
루트 `npx --no-install tsc --noEmit`, 계약 검사 53/53. 검사는 격리된 문법용 식별자로 두 설정의 일치·
callback/CORS·resource와 audience 구분·프론트엔드 값 분리·잘못된 조합·검증 전 쓰기
없음·덮어쓰기 거부·원문 없는 CLI 오류를 확인했다. 실제 제공자·원격 계정/도메인/DB·
로그인·grant·배포는 값이 미정이라 미실행이다. 프론트엔드·수집기 동작을 바꾸지 않아
해당 전체 검사는 반복하지 않았다. API·DB·SDK·의존성·CI·위생 정책 변경과 푸시는 없다.
OIDC·런타임 안내·로드맵·설치 안내와 검증 기록을 갱신했다.

## 관리자 Worker 같은 출처 API 경로 — 2026-10-11

관리자 Worker는 `/v1`·`/v1/*`를 정적 자산보다 우선해 고정 `COLLECTOR` 서비스
바인딩으로 전송한다. 경로·쿼리·Origin·Authorization·쓰기 본문과 응답을 유지하고,
스트리밍으로 한 번만 호출하며 리다이렉트·자동 재시도·API 캐시는 사용하지 않는다.
바인딩 누락·호출 예외는 고정 503 JSON이고 HTML fallback을 거치지 않는다.
HEAD 오류 본문은 없고 `Retry-After: 5`를 보낸다. 화면에서도 저장소 오류와 구분한다.
실제 계정·Worker·공개 진입점을 받는 로컬 전용 `admin:config`, 기본 Wrangler config,
타입 생성/checkJs와 dry-run 명령을 추가했다.

실행·통과: `npm run check:admin`(타입 검사, 테스트 156/156, 빌드, 번들 2/2,
Sites/게이트웨이 검사 9/9), 루트 `npm run typecheck`(수집기·관리자 타입 생성 포함),
`node --test --test-timeout=30000 tools/runtime/test/admin-target.test.ts apps/admin/test/edge.test.ts`
4/4, 계약 `npm run check` 53/53, `npm run admin:dry-run`(업로드 없음).
단위 검사는 메서드·Accept와 무관한 API 예약, 본문·쿼리·헤더 유지, upstream
401/403/404/409/429/503/307 유지, 예외 고정 메시지, callback/demo/v10 분리와 누락 JS
404를 확인했다. 설정 검사는 자기 바인딩·불완전 진입점·추가/비밀 키·잘못된 도메인·
출력 덮어쓰기·8KiB 초과·원격 플래그를 거부했다.

실제 로컬 Miniflare Worker 두 개와 임시 D1에 모든 마이그레이션·프로젝트·grant를
적용했다. 메모리에서 만든 단기 테스트 JWT/JWKS로 무인증 401·owner 200·grant 회수 후
403을 확인했고, 충돌하는 API 정적 파일이 있어도 API가 우선했다. 없는 API는 HTML
Accept에도 404 JSON이며 callback/demo/v10은 HTML이고 없는 JS는 404였다.
검증 런타임과 임시 디렉터리는 finally에서 정리한다. 원격 리소스·운영 자격 증명을 쓰지 않았다.

초기 신규 날짜 `2026-10-11`은 현재 Miniflare가 미래 호환성 날짜 오류로 거부했다.
기존 검증 베이스라인 `2026-08-06`으로 config·타깃·검사를 맞춘 뒤 위 검사를 통과했다.
호환성 날짜 승격은 도구 갱신과 함께 별도 검증한다. traces/자동 invocation 로그를 끄고
query redaction을 유지하는 것은 기존 개인정보 정책을 따른다.

ADR 0007·런타임 안내·로드맵·앱 안내와 이 검증 기록을 갱신했다. API·DB·마이그레이션·
SDK·의존성·CI 러너·위생 정책 변경은 없고 루트 실행/타입 명령만 추가했다.
백엔드 전체 검사는 변경 범위 밖이라 반복하지 않았다. 실제 OIDC 제공자·원격 서비스
바인딩·DNS·D1·배포·Sembom 활성화는 값이 미정이라 미실행이다. 푸시는 하지 않았다.
다음은 운영 로그인 구성과 설치 절차 정리다.

## 운영 API 기본 진입·데모 분리 — 2026-10-11

`apps/admin`의 기본 주소와 `/auth/callback`은 API 관리자 모드로 시작한다.
`/demo`·`/demo/` 경로에서만 Sample/API 전환을 제공하고 제목에 샘플 데모를 표시한다.
일반 주소의 쿼리를 모드 선택에 사용하지 않는다. 실제 관리자 진입에는 가상 프로젝트·
샘플 KPI·Sample 버튼이 없으며 인증 미설정 상태는 기존 비활성화 안내를 사용한다.

실행·통과: 루트 `npm run check:admin`(타입 검사, 테스트 155/155, 빌드, 번들 검사 2/2,
Sites 검사 4/4), 변경한 실제 stack 검사 2/2, 계약 `npm run check` 53/53. stack은 관리자 제목·demo HTML·callback
경로·프록시된 401 JSON과 종료를 확인한다. 프로덕션 preview/Chromium에서 기본 주소의
로그인 진입·Sample 버튼 0개·샘플 지표 0개, `/demo`의 샘플 지표와 제목·모드 전환,
`/?mode=sample`의 API 유지, callback error 쿼리 제거, 콘솔 오류 0건과 CSS 320px의
문서 폭 320px를 확인했다. 증거는 ignore된 `.tmp/admin-workspace-ui/operational-entry.jpg`·
`demo.jpg`에 둔다. 검증 탭·서버는 종료했다.

ADR·설계·로드맵·앱 안내를 갱신했다. API·DB·마이그레이션·SDK·의존성·CI 러너·위생
정책 변경은 없다. 백엔드 전체 검사는 반복하지 않았고 운영 OIDC·원격 DB·배포·Sembom
활성화는 미실행이다. 푸시는 하지 않았다. 다음은 운영 같은 출처 경로와 인증 설정이다.

## 관리자 앱 워크스페이스 이전 — 2026-10-11

기존 관리자 소스·자산·설정·검사를 `apps/admin`으로 이전하고 private workspace
`@tallyfin/admin`으로 등록했다. React/Vite 채택과 범위는 ADR 0007에 기록했다.
`prototypes/admin`에는 초기 디자인 QA와 이전 안내만 남긴다. 관리자 의존성은 루트
lockfile에 통합하고 별도 prototype lockfile을 제거했다. 캐시를 사용한
`npm install --ignore-scripts --offline --no-audit --no-fund`로 설치했다. 관리자 직접
의존성 13개의 버전이 모두 이전 lockfile과 일치함을 확인했다.

루트 `dev:admin`·`build:admin`·`typecheck:admin`·`test:admin`·`check:admin`을 추가했다.
통합 dev 감독기는 새 앱의 dev-local을 실행한다. 루트 NodeNext 타입 검사에서 admin은
제외하고 별도 bundler/React 타입 검사를 루트 typecheck에 연결한다. 이전 단계의
Sample/API 전환 동작은 유지하며 API 기본·데모 분리는 다음 슬라이스다.

실행·통과: 루트 `npm run check:admin`(타입 검사, 관리자 테스트 155/155, 빌드,
번들 검사 2/2, Sites 검사 4/4), `npm run typecheck`,
`node --test --test-timeout=30000 tools/runtime/test/stack.test.ts` 2/2.
통합 검사에서 실제 로컬 D1 초기화·등록 후 SPA·auth/callback·프록시된 관리자 401 JSON,
두 서버 정상 종료·형제 프로세스 실패 시 종료와 계약 `npm run check` 53/53을 확인했다. Sites hosting 설정·worker·
패키징 스크립트·Sites 테스트 4개 파일의 내용이 이전 경로와 byte 단위로 같았다.
첫 JS는 262,512 B로 코드 분리 결과를 유지했다.

실제 루트 `npm run dev:admin -- --host 127.0.0.1 --port 5186 --strictPort`와 Chromium으로
샘플 설정·API 로그인 진입, 설정 없는 로그인 비활성화, callback error 쿼리 제거를
확인했다. 콘솔 오류 0건, CSS 320px에서 문서 폭 320px였다. 증거는 ignore된
`.tmp/admin-workspace-ui/login.jpg`·`mobile.jpg`에 있다. 검증 탭·서버는 종료했다.

앱 경로·워크스페이스/타입 검사·개발 실행·의존성 소유권과 ADR·명세·로드맵·설계·실행
안내를 변경했다. API·DB·마이그레이션·SDK·의존성 버전·CI 러너·위생 정책은 바꾸지 않았다.
전체 백엔드 회귀 검사는 반복하지 않았고 영향받은 실제 stack만 검사했다. 운영 인증·
원격 D1·배포·Sembom 활성화는 환경 연결 전으로 미실행이며 푸시도 하지 않았다.

## 관리자 화면 코드 분리 — 2026-10-11

`App`에서 API 관리자 모드를 지연 로드하고 `LiveDashboard`에서 설정 작업 공간·목표·
프로젝트 생성 화면을 지연 로드한다. 진단·설정·권한·이력·스키마·SDK 안내를
`LiveSettingsWorkspace`로 추출했다. 부모 client·선택 프로젝트·조회 상태는 유지하고
projectId key로 설정 컨트롤러를 교체한다. `DeferredPanel`은 로딩·청크 실패 안내와
새로고침을 제공하며 새로고침 때 초안·직접 연결 토큰의 초기화를 안내한다.
OIDC callback URL 정리는 첫 엔트리에 유지한다.

같은 Node gzip 설정으로 첫 JS를 비교했다. 524,427 B / gzip 142,248 B에서
262,512 B / gzip 78,634 B로 감소했다(원본 49.94%, gzip 44.72%). 모든 JS 파일의
합계는 약 911 kB이며 로딩 시점 분리다. 500 kB 경고는 없어졌고 LiveDashboard는
38,139 B다. Vite manifest를 생성하고 빌드 후 별도 `npm run test:bundle`로 첫 정적
그래프 gzip 100KiB·개별 JS 500kB 예산과 설정/목표/생성/로그인/차트의 지연 경계·
CSS 자산 존재를 검사한다. 일반 테스트는 빌드를 요구하지 않고 CI 러너는 바꾸지 않았다.

실행·통과: 관리자 `npm run typecheck`, `npm test` 155/155, `npm run build`,
`npm run test:bundle` 2/2, `npm run test:sites` 4/4, 계약 `npm run check` 53/53.
Vite preview의 프로덕션 자산을 Chromium으로 확인했다. 캐시를 끈 첫 Script 요청은
index·TrendChart뿐이고 API 모드 진입 때 LiveDashboard·client·OidcLogin이 추가됐으며
설정/목표/생성 코드는 요청되지 않았다. 로그인 전 endpoint 초안은 설정 메뉴 전환에도
유지됐다. 실제 제공자 로그인은 실행하지 않았다. CDP로 LiveDashboard 파일만 임시
차단해 오류 경계·새로고침 버튼을 확인했고 차단 해제 후 새로고침으로 정상 복구했다.
차단·cache override는 복원했다. 새 탭 정상 진입의 콘솔 오류 0건, CSS 320px에서
document scrollWidth 320px였다. 스크린샷은 ignore된
`prototypes/admin/.tmp/admin-split-ui/`, 크기 기록은 `.tmp/admin-split-result.json`에 둔다.
Web Vitals trace 도구가 없어 LCP·INP·CLS 개선이나 운영 지연 수치는 측정하지 않았다.

설계·로드맵·프로토타입 안내를 갱신했다. API·DB·마이그레이션·SDK·의존성·위생 정책은
변경하지 않았고 백엔드 실행 테스트는 반복하지 않았다. 검증 탭·preview 서버는 종료했다.
운영 인증·원격 D1·배포·Sembom
활성화는 미실행이고 푸시도 하지 않았다. 다음은 운영 관리자 앱 구조 정리다.

## 관리자 퍼널 단계 편집 폼 — 2026-10-11

`LiveSchemas`에 `SchemaFunnelForm`과 공유 JSON 초안 변환기를 연결했다. 퍼널 ID·표시
이름·출처별 이벤트 선택, 단계 추가/삭제·순서 변경, 필수 속성 비교 기준을 편집한다.
기존 서버 검증·개인정보 검토·새 버전 발행을 사용하며 편집 때 승인을 초기화한다.
표현 불가 JSON과 추가 키·미완성 참조·이벤트/속성/작업 흐름은 보존한다. 단계마다 이름과
출처를 함께 설정하고 오류 경로·추가/삭제/이동 후 포커스를 해당 필드로 연결한다.

실행·통과: 관리자 `npm run typecheck`, `npm test` 155/155(신규 7개), `npm run build`,
`npm run test:sites` 4/4, 루트 `npm run typecheck`, 계약 `npm run check` 53/53. 집중 폼·스키마 검사 30/30은 실제
코어 validator로 중복·출처·단계/퍼널 수·필수 도메인·32KiB 경계와 발행 승인 재설정·reader
잠금을 검증했다. 메인 관리자 번들은 524.42 kB(gzip 143.48 kB)이고 기존 500 kB 경고는
후속 앱 분리·성능 개선으로 남긴다.

127.0.0.1:5186의 임시 검증 페이지에서 실제 `LiveSchemas`·`SchemaEditor`·폼과 실제 코어
validator에 합성 API 응답만 제공했다. 실제 자격 증명·운영 API는 쓰지 않았다. 브라우저에서
단계 이동 후 포커스, 추가·중복 이벤트 오류 필드 포커스, 삭제 후 정상 검증·개인정보
확인·v2 발행, 새 퍼널 추가/삭제와 승인 초기화, 중복 ID 오류, reader 제어 잠금,
깨진 JSON 보존과 복구를 확인했다. 기존 90% 확대의 CSS innerWidth 320px에서 문서
scrollWidth 303px로 가로 넘침이 없었고 단계 select는 225px·16px 글꼴이었다.
최종 코드를 새로고침한 뒤 콘솔 오류 0건이다. 검증 탭·서버를 종료하고 임시 페이지 코드는
삭제했다. 스크린샷은 ignore된
`prototypes/admin/.tmp/funnel-form-ui/desktop.jpg`·`mobile.jpg`에 보관한다.

명세·로드맵·ADR·프론트엔드 설계·프로토타입 안내를 갱신했다. API·DB·마이그레이션·SDK·
의존성·CI 러너·위생 정책 변경은 없다. 백엔드가 변경되지 않아 백엔드 실행 테스트는
반복하지 않았다. 운영 인증·원격 D1 연결은 환경 미설정으로 실행하지 않았고 푸시·배포·
Sembom 활성화는 하지 않았다. 다음은 운영 관리자 앱 정리와 코드 분리·성능 개선이다.

## 관리자 퍼널 분석 화면·CSV 연결 — 2026-10-11

API 연결 목표 화면에 `LiveGoals`·`LiveFunnels`를 연결했다. 퍼널 선택 전에는 요청하지
않고, 선택한 등록 정의의 모든 출처·차원 조합을 함께 표시한다. 단계별 이벤트/출처·도달
수·첫 단계 대비 도달률·직전 대비 전환율·다음 미도달 수와 일별 요약·날짜별 단계 표를
연결했다. 잠정값 안내를 결과 근처에 두고 미도달을 실패로 분류하지 않는다. 퍼널 CSV는
기존 작업 흐름 CSV와 별도이며 작업 흐름 없는 목표에는 기존 CSV/기간 비교를 숨긴다.

조회 effect는 선택 해제 때 cancel하고 context·client 소유 가드로 이전 표/CSV를 숨긴다.
같은 퍼널 재선택도 스냅샷을 즉시 비운다. cancel/dispose·늦은 응답을 테스트했고 목표
렌더링을 추출해 `LiveDashboard.tsx`는 40,575 B에서 39,027 B로 줄였다.

실행·통과: `prototypes/admin`의 `npm run typecheck`, `npm test` 148/148(퍼널 신규 8개),
`npm run build`, `npm run test:sites` 4/4. 마지막 표 선택 스타일·잠정값 안내·기존 비교
범위 표시 보완 후 typecheck·build·Sites 패키징 검사를 다시 통과했다. 관리자 메인 번들
510.27 kB(gzip 141.23 kB)의 500 kB 경고는 남았으며 후속 성능 정리 대상이다.

로컬 Vite 127.0.0.1:5186과 Codex 인앱 Chromium에서 실제 App→LiveDashboard→LiveGoals→
LiveFunnels에 합성 transport만 주입했다. 실제 자격 증명 없이 API 연결·목표 이동·등록
퍼널 선택, 91회 시작/42회 완료·단계별 browser/server 표시, 일별 날짜 선택 내역, 403과
응답 합계 오류 후 표 제거/CSV 잠금, 정상 재시도, 0건의 null 비율 표시, 지연 중 CSV
잠금·선택 해제, 프로젝트/기간 전환 선택 초기화, 연결 해제 후 표 제거를 확인했다.
실제 CSV를 내려받아 요약 4행·일별 28행과 source·미지 비율 빈 셀을 확인했다.

기존 90% 확대를 유지한 CSS innerWidth 320px(뷰포트 288px)에서 문서 scrollWidth 320px,
표 영역 288px/내용 797px, 표 셀 18px였다. 키보드 ArrowRight 내부 스크롤을 확인했다.
뷰포트는 복원하고 검증 탭·서버는 종료했다. HMR 중 hook 의존성 배열 크기 변경 경고가
1건 발생했으며 최종 코드를 새 탭에서 로드한 뒤 콘솔 오류는 없었다. 증거는 ignore된
`prototypes/admin/.tmp/funnel-report-ui/desktop.jpg`·`mobile.jpg`·`download.csv`에 있다.

명세·로드맵·ADR·프론트엔드 설계·프로토타입 안내를 갱신했다. API·DBML·마이그레이션·
SDK·의존성·CI 러너·위생 정책 변경은 없다. 루트 `npm run typecheck`도 통과했으며,
백엔드는 변경하지 않아 백엔드 테스트는 반복하지 않았다. 운영 OIDC·원격 D1은 환경
연결 전이라 실행하지 않았다. 푸시·배포·Sembom
활성화는 없다. 다음은 기존 JSON 초안/검증/발행을 사용하는 퍼널 단계 편집 폼이다.

## 관리자 퍼널 조회·CSV 계층 — 2026-10-11

관리자 `ApiClient.getFunnelDaily`에 같은 출처·메모리 bearer·취소·no-store 전송을 연결했다.
닫힌 응답의 날짜·정의·단계 건수·분모·합계·잠정값을 검증하고 선택한 레지스트리와
다르면 표시하지 않는다. `FunnelReport`는 새 요청·오류에서 이전 데이터를 지우고 취소와
세대 번호로 늦은 결과를 폐기한다. CSV는 검증한 요약/일별 전체 단계, 각 단계 출처,
미지의 비율 빈 셀과 잠정값 여부를 담으며 기존 UTF-8 BOM·수식 방어 직렬화를 재사용한다.

`prototypes/admin`의 `node --test src/api/funnel-analysis.test.mjs` 7/7와 `npm run
typecheck`를 실행해 통과했다. 날짜/합계/비율 불일치·0 분모·DST 잠정값 경계·선택 정의
불일치·403·재시도·취소·늦은 응답·dispose·CSV 수식 방어를 확인했다. 화면 연결 전 조회
계층 검증이며 실제 브라우저 화면·다운로드는 다음 UI 작업에서 확인한다.

OpenAPI·DBML·마이그레이션·SDK·의존성·CI 러너·위생 정책은 바꾸지 않았다. API·DB를
변경하지 않아 백엔드 검증은 반복하지 않았고 운영 인증·원격 DB·배포·Sembom 연동은
환경 연결 전이므로 실행하지 않았다. 푸시는 하지 않았다.

## 작업 퍼널 일별 조회 API — 2026-10-11

`GET /v1/projects/{projectId}/funnels/{funnelId}/daily`와 코어 응답 타입, D1 조회·응답
투영을 추가했다. 프로젝트·스키마·단계 건수를 같은 D1 batch에서 reader/owner grant로
검사하며 모든 차원 조합과 등록 단계 출처를 함께 센다. 응답의 meta에는 단일 source를
넣지 않고 등록 definition에 단계별 출처를 둔다. 시작일 기준 최대 31일을 채워 반환하고,
기간 전환율은 합산한 건수로 계산한다. 0 분모는 null, 첫 단계 conversionRate와 마지막
단계 notReachedNext도 null이다. 잠정값은 프로젝트-local 날짜 끝 + 48시간까지다.

실행·통과:
- `node --test --test-timeout=30000 apps/collector/test/funnel-query.test.ts`: 8/8.
  실제 로컬 D1에 browser/server 역순 수집·새 eventId 단계 재시도, 시작일 귀속, 차원 합산,
  빈 날짜, 서버 전용 정의, reader/owner와 publisher 권한 분리, 준비 후 권한 회수,
  retired/paused·프로젝트/버전 격리, 정의 없는 버전, 31일·90일 경계, 잠정값 경계,
  405와 불허 source/groupBy, 안전 정수 경계·합산 초과·저장 실패를 확인했다.
  응답 투영은 중복/범위 밖 행과 날짜별 단계 순서 위반을 별도로 거부한다.
- `node --test --test-timeout=30000 apps/collector/test/admin.test.ts apps/collector/test/server-query.test.ts apps/collector/test/funnels.test.ts packages/storage-d1/test/funnels.test.ts packages/core/test/funnel*.test.ts`: 39/39.
  기존 관리자·서버 출처 조회와 실제 Worker/D1 수집·원자 저장·정리를 회귀 검증했다.
- 루트 `npm run typecheck` 통과. 마지막 테스트 보완 후 `npx --no-install tsc --noEmit`와
  `npx --no-install tsc -p apps/collector/tsconfig.runtime.json`도 통과했다.
- `tools/contracts`의 `npm run lint`(OpenAPI) 오류·경고 없음, `npm run check` 53/53.
  새 응답 예제·닫힌 형태·분모·날짜 개수·개인 식별자 제외 계약을 확인했다.
- `git diff --check` 통과. 문서 링크 검사도 마지막 문서 변경 후 통과했다.

API source of truth `api/openapi.yaml`과 예제·계약 검사를 변경했다. DBML·마이그레이션·
SDK·의존성·CI 러너·저장소 위생 정책은 변경하지 않았다. 관련 범위만 검사했고 전체
릴리스 검사·운영 OIDC/원격 D1·부하·관리자 브라우저 검증은 이번 로컬 API 변경 범위에서
실행하지 않았다. 푸시·배포·Sembom 활성화도 없다. 관리자 퍼널 화면·CSV는 다음 작업이다.

## 관리자 퍼널 SDK 코드 생성 — 2026-10-11

`sdkSetup`은 기존 세 인자 호출을 유지하고 선택 profile·funnelId를 받는다. 브라우저는
일반 이벤트/workflow가 기본이며 별도 퍼널 프로필을 고르면 `/funnels` 엔트리의 팩토리와
source별 압축 정의를 만든다. 서버 안내도 등록된 서버 참여 퍼널을 투영한다. 다른 출처의
단계 이름·규칙은 null 위치로만 남긴다. 선택 퍼널의 source별 사용 예제는 주석으로만
생성하며 등록된 필수 속성의 예시 값·작업 링크 전달·원래 발생 시각·서버 eventId 보존과
실제 단계 발생 뒤 발행할 조건을 안내한다. 생성만으로 이벤트나 인증 요청을 보내지 않는다.

`LiveSdkSetup`에 브라우저 SDK 종류와 source별 퍼널 예제 선택을 연결했다. 일반 프로필과
기존 workflow를 자동 전환하지 않는다. 유효하지 않은 이전 선택은 현재 등록에 맞춰
대체하고, 복사 상태는 client·조회 key·현재 코드에 묶어 늦은 결과를 새 코드에 표시하지
않는다. 실제 연결 수집 미지원이라는 오래된 문구를 제거했다.

관련 generator·프로젝트 생성·서버 안내 테스트 18/18, 관리자 typecheck·build와 생성된
브라우저/서버 TypeScript의 실제 패키지 선언 소비자 컴파일을 통과했다. 생성 코드와
고정 endpoint를 합친 최초 gzip 3091 bytes가 예산을 넘겨 SDK 내부 Batch의 여섯 필드만
`__tfBatch` 예약 이름으로 표시하고 빌드 때 짧게 만든다. HTTP 본문·공개 SDK 키는 그대로다.
이 최적화는 별도 로컬 커밋으로 나눴다. 브라우저 SDK·빌드·HTTP·native Worker/D1
48/48, 루트 typecheck·브라우저 build·크기 검사를 통과했다. 새 빌드 테스트 2개는
여섯 내부 키만 압축하는지, source와 압축 번들의 workflow/funnel 바디·ID·재시도·
destroy가 같은지 확인한다. generator의 새 1개 테스트는 dist가 없는 checkout에서도
source를 빌드해 고정 endpoint와 설정을 포함한 3072-byte 예산을 검사한다.
일반 SDK gzip 2743·Sembom 3022·퍼널 SDK 2912·참조 예제 3038 bytes다. 설치용 패키지에서
관리자 생성 코드를 번들한 실측도 gzip 3063 bytes로 한도 안이다. 생성/조회 외 관리자
흐름과 HTTP/DB 계약을 바꾸지 않아 전체 저장·관리자 테스트는 반복하지 않았다.
인앱 Chromium·직접 띄운 로컬 Vite(127.0.0.1:5185)에서 공개 예제 정의와 토큰 없는 합성
클라이언트를 실제 LiveSdkSetup에 연결했다. 기본/퍼널 프로필·server source·출처별
이름 분리·퍼널 예제·복사·프로젝트 전환 후 새 endpoint와 이전 코드/상태 제거를 확인했다.
뷰포트 360을 요청했지만 브라우저 실제 innerWidth는 400이었다. 관찰한 400px 화면에서
문서 scrollWidth 383으로 페이지 가로 넘침이 없고 코드 영역은 읽기 전용이었다.
새 콘솔 오류는 0이며 desktop/mobile 화면은 ignore된
`prototypes/admin/.tmp/funnel-setup-ui/`에 저장했다. 코드 갱신 후 폼 상태가 초기화되어
복사 버튼 조회가 한 번 실패했고, 현재 상태를 확인한 뒤 입력해 복사를 확인했다.
검증 서버·탭을 종료하고 임시 HTML·TSX·예제 JSON을 지웠다. 계약 검사 51/51·문서 링크·
`git diff --check`도 통과했고 문서 링크 검사 대상에 프론트엔드 설계를 추가했다.

제품 명세·로드맵·ADR·브라우저 SDK 안내·프론트엔드 설계를 갱신했다. HTTP API·DB 계약·
마이그레이션·의존성·CI·호스팅 파일 변경은 없다. 운영 인증·원격 DB·서비스 적용·푸시·
배포는 실행하지 않았다. 다음은 reader/owner 퍼널 조회 API와 관리자 단계 집계 화면이다.

## 선택 브라우저 퍼널 SDK — 2026-10-11

`@tallyfin/browser/funnels`에서 별도 `createTallyfinFunnels` 진입점을 제공한다.
빌드 시점의 브라우저 투영은 서버 단계 이름·규칙을 넣지 않고 null 위치만 유지한다.
`createFunnelRun`은 작업마다 무작위 UUID·시작 시각을 복사·동결하며 이벤트를 만들지
않는다. `trackFunnel`은 등록된 브라우저 단계·유한 속성·UTC 링크·24시간 창을 검사하고
공통 메모리 전송 큐를 사용한다. 첫 단계는 시작 시각과 일치하고, 수동 재전송은 원래
발생 시각을 명시해야 한다. 일반 track은 퍼널 단계 이름을 거부한다. 기존 workflow SDK의
공개 API는 유지하며 두 프로필은 각자의 번들에 다른 프로필을 넣지 않는다.
공통 스키마 직렬화도 한 번만 실행해 크기를 검사한 바로 그 스냅샷을 검증한다.

브라우저 SDK·서버 퍼널 SDK·HTTP·native Worker/D1 관련 52/52 테스트를 통과했다.
마지막 테스트 보완 후 해당 8/8을 다시 통과했다. 스키마 단일 스냅샷 검증을 추가하고
브라우저 퍼널 8/8을 통과했으며 변경 없는 나머지 결과를 재사용해 총 53개를 확인했다.
브라우저 퍼널 테스트 8개는 투영·신규 작업·시작 시각·불변 입력·바이트 동일 재시도·
수동 복원·경계·잘못된 링크와 설정·비활성/파괴를 확인한다. 실제 로컬 D1 통합은
브라우저 SDK와 Node/Worker 서버 SDK를 같은 run에 연결하고 역순 수신·응답 유실·
분류 충돌·발행자 권한 회수를 확인한다. 브라우저 단계의 새 ID 재전송도 중복으로
처리해 영수증은 늘지만 이벤트 합계 4·각 단계 도달 수 1을 유지한다.

`npm run typecheck`·`npm run build:browser`·`npm run check:browser-size`와 두 공개
패키지 경로의 선언 소비자 컴파일을 통과했다. 기본 SDK gzip 2772 bytes·Sembom 포함
3053 bytes, 퍼널 SDK 2942 bytes·예제 설정 포함 3068 bytes로 각각 3072 bytes 예산 안이다.
계약 검사 51/51·문서 링크·`git diff --check`도 통과했다. 문서 링크 검사 대상에
브라우저 SDK 안내를 추가했다. 선언 소비자 검사는 TypeScript 7의 `--ignoreConfig` 없이 첫 실행이 실패했고 옵션을
명시한 재실행으로 통과했다. HTTP/DB 계약·마이그레이션·의존성·CI 변경은 없다.
운영 인증·원격 DB·실서비스 설치·푸시·배포는 실행하지 않았다. 관리자 SDK 코드 생성과
퍼널 조회 API·집계 화면은 후속이다.

## 브라우저 SDK 내부 전송 분리 — 2026-10-11

기존 공개 타입을 types.ts, 공통 검증·전송·수명 주기 처리를 common.ts로 분리하고
index.ts에는 workflow 검증과 track/start 진입점을 남겼다. 내부 enqueue의 연결 필드를
공통화했으며 기존 workflow의 {attempt} 형식과 공개 BrowserClient API는 유지한다.
빌드 tsconfig에 allowImportingTsExtensions를 추가하고 타입 전용 .js import로 선언 생성을
유지했다. 브라우저 퍼널 모듈은 아직 후속이다.

`npm run build:browser`·`npm run check:browser-size`·`npm run typecheck`와
`node --test packages/browser/test/*.test.ts apps/collector/test/collector.test.ts` 37/37
(SDK 19개·HTTP 18개)이 통과했다. 기본 SDK gzip 2774 bytes·SDK+Sembom 3053 bytes로
이전 2667·2949 bytes보다 증가했지만 둘 다 3072 bytes 예산 안이다.
공개 API·HTTP/DB 계약·CI 변경은 없다. 운영 인증·원격 DB·배포는 검증하지 않았고
푸시·배포도 실행하지 않았다.

## 서버 SDK 퍼널 연결 전송 — 2026-10-11

서버 SDK에 선택 funnel 링크·createFunnelRun과 서버 참여 퍼널의 스키마 투영을 연결했다.
브라우저 단계는 null로 위치만 남기고 브라우저 이름·규칙·label·purpose는 투영하지 않는다.
입력을 복사·동결하고 재전송 본문·재시작 복원 metadata를 유지한다.

`node --test apps/collector/test/funnels.test.ts packages/server/test/*.test.ts` 21/21,
`node --test apps/collector/test/server-sdk.test.ts` 2/2, 합계 23개 테스트와
`npm run typecheck`를 통과했다. `npm run build:server`도 통과했고 번들 8864 bytes·gzip
3631 bytes·런타임 의존성 0이다. native Worker producer의 퍼널 SDK 전송은 서명 JWT와
실제 로컬 D1에서 중복·발행 권한 회수를 확인했고 Node는 응답 유실 뒤 중복을 확인했다.
이 결과는 서버 SDK 슬라이스만의 검증이며 브라우저 기본 SDK 바이트는 바꾸지 않았다.

`tools/contracts`의 `npm run check` 51/51과 문서 링크·`git diff --check`도 통과했다.
공개 HTTP·DB 계약·CI·의존성 변경은 없다. 운영 인증·원격 DB·푸시·배포는 실행하지 않았다.
브라우저 SDK 전송·관리자 SDK 코드 생성·퍼널 조회 API와 화면은 후속이다.

## 퍼널 연결 수집·저장과 0007 마이그레이션 — 2026-10-11

BrowserBatch·ServerBatch가 이벤트별 선택 funnel 링크를 받고, 한 이벤트에 attempt와 funnel을
함께 넣으면 거부한다. funnel 링크가 있으면 workflow로 해석하지 않는다. 연결 이벤트의
payload hash는 funnel-v1 접두사를 쓰며 funnel이 없는 기존 일반·workflow 해시는 그대로다.
코어 `prepareFunnelStage`가 등록 정의의 출처·단계 이름·24시간 창을 검사하고,
`funnel_runs`·`funnel_daily_counts`(0007)와 저장 어댑터의 `funnelStatements`가 영수증·
할당량·시도·이벤트·목표 집계·`projects.ingest_revision` CAS와 같은 D1 batch에서 연결
상태·연속 도달 단계를 반영한다. 정리는 연결 상태 72시간·단계 집계 90일을 같은 순회
한도로 지운다.

루트 `npm run check`가 타입 검사·268/268 테스트·SDK 크기 검사를 통과했다. SDK gzip
2667 bytes·SDK+Sembom gzip 2949 bytes는 예산 3072 bytes 안이다. `tools/contracts`의
`npm run lint`(OpenAPI)는 오류 없이 FunnelCounts 후속 조회 미사용 경고 1건만 남았고
`npm run check`는 51/51을 통과했다. 신규 저장 테스트 7개는 역순 browser/server 도착과
영수증·단계 재전송 중복, 실행·영수증·버전·시간 충돌의 batch 롤백, 동시 쓰기와 발행 권한
회수의 공유 revision 가드, 카운터 상한·SQL 시각/순서 가드의 부분 반영 방지, 20 runs·
10 steps·20 dimensions 지연 시작의 100 bind·50 statement 예산, 선택 프로젝트만 지우는
bounded cleanup, 0007 추가 전용과 트리거 누락 감지를 확인한다. native Worker 실제 D1
ephemeral·서명 JWT HTTP 통합 1개는 공개 browser 단계와 인증 server 단계를 같은 run에
연결해 저장하는 것을 확인한다.

OpenAPI·DBML 계약, 코어·저장 어댑터와 수집기 통합 테스트, 0007 마이그레이션과 계약 검사 스크립트를
바꿨다. 제품 스펙·로드맵·이벤트 계약·저장 모델·정리·마이그레이션·서버 이벤트 문서도
함께 갱신했다. 의존성·CI 워커플로·위생 정책 변경은 없다. 원격 D1 적용·운영 OIDC·푸시·
배포·Sembom 연동은 실행하지 않았다. 다음은 브라우저·서버 SDK 전송과 reader/owner 조회
API·관리자 퍼널 집계 화면이다.

## 퍼널의 공용 수집 계획 연결 — 2026-10-11

PreparedEvent와 IngestSnapshot/Plan에 최소 퍼널 관찰·연결 상태·단계 delta를 연결했다.
planIngest가 먼저 source별 영수증 중복을 검사하고 새 영수증·프로젝트 일일 한도와 함께
작업의 연속 도달 단계를 계획한다. browser/server는 같은 runId 상태를 공유하며 일반
이벤트와 기존 workflow 계획은 유지한다. 같은 단계의 새 ID 재전송은 영수증 한도를
소모하되 이벤트/단계 집계를 더하지 않는다. 입력 snapshot은 변경하지 않는다.

타입 검사·코어 44/44 테스트·SDK 크기 검사를 통과했다. 새 2개 테스트는 역순 server
완료→browser 시작/중간→server 중간 연결, 자정 전 시작일 집계, 원래 ID/새 ID 중복,
할당량·영수증·분류 충돌과 snapshot 보존을 확인했다. SDK gzip 2667·Sembom 포함
2949 bytes를 유지한다. 현재 HTTP parser는 아직 funnel 필드를 거부하며 D1 어댑터도
내부 PreparedEvent에 funnel이 있으면 저장 연결 전에는 503으로 닫는다.

다음 커밋에서 DBML·0007·원자 저장·정리와 wire 준비 경로를 연결한다. 아직 신규 퍼널의
D1 통합은 실행하지 않았고 API·DB·SDK·화면·의존성·CI·위생 정책은 변경하지 않았다.
전체 DB/HTTP 테스트는 실제 저장 연결 커밋에서 실행한다. 푸시·배포는 없다.

## 퍼널 정의의 버전별 등록·검증·발행·읽기 — 2026-10-11

Registry·SchemaDraft·SchemaPublication에 선택 funnels를 연결했다. 공용 검증기는
기존 events/workflows 규칙 뒤에 2~10개 출처 고정 단계·최대 10개 퍼널·동일 필수
분류 도메인을 검사한다. 정의 전체의 32KiB 예산을 공유한다. 퍼널 검증을 schema로
옮겨 코어 수집 계산과 스키마 검증이 순환 import를 만들지 않게 했다.

D1의 기존 definitions_json·owner 발행·reader/owner 정의 읽기·오프라인 등록 CLI는
선택 funnels를 저장/보존한다. schemaDefinitions가 생략 필드를 추가하지 않아 기존
정의 해시·재요청 비교를 유지한다. 명시한 퍼널은 버전 불변성과 재요청 해시에 포함한다.
정의 JSON 구조만 확장했고 DBML 주석을 맞췄으며 SQL·테이블·마이그레이션은 바꾸지 않았다.

관리자 클라이언트는 출처·단계·분류 참조를 검사해 퍼널을 읽고, JSON 초안·발행 해시·
응답 유실 재확인에도 보존한다. 이벤트/속성/흐름 폼은 기존 퍼널을 버리지 않고 연결
이름·출처·필수 분류 도메인을 잠근다. 퍼널 오류는 JSON 편집에 남긴다. SDK 안내와
JSON 도움말은 정의 등록과 아직 미지원인 연결 수집을 구분한다.

관련 29/29 테스트에서 실제 로컬 D1 owner의 검증·발행·읽기·동일 재요청·충돌·잘못된
출처와 reader 제한, CLI preview/적용/재요청/다음 버전·구버전 보존을 확인했다.
이후 루트 npm run check의 타입 검사·258/258 테스트·SDK gzip 예산 검사를 통과했다.
SDK 2667 bytes·SDK+Sembom 2949 bytes를 유지한다. 관리자 관련 23/23 및 전체 테스트,
typecheck·build·test:sites 4/4 통과. 마지막 JSON 도움말 문구 수정 뒤 typecheck·build를
다시 통과했고 로직이 같은 전체 테스트는 앞의 결과를 재사용했다.
계약 lint는 유효하며 아직 경로에 연결하지 않은 FunnelEvent/FunnelCounts의 미사용
경고 2개가 남는다. 계약 check 51/51·git diff --check도 통과했다.

인앱 Chromium·로컬 Vite(127.0.0.1:5185)에서 실제 LiveSdkSetup에 토큰 없는 합성
transport와 공개 예제 정의를 주입했다. 퍼널 미지원 안내·browser/server 선택·서버 코드의
source별 이벤트 투영을 확인하고 ignore된 prototypes/admin/.tmp/funnel-registration-ui/
desktop.png에 화면을 저장했다. 임시 harness가 처음 default export를 named import로
읽어 오류가 났고 수정·새로고침 뒤 화면을 확인했으며 이후 새 콘솔 오류는 없었다.
검증 서버·탭을 종료하고 임시 html/tsx를 삭제했다.

OpenAPI·DBML 주석·ADR·제품 명세/로드맵·관리자/서버/프론트엔드 문서를 갱신했다.
계약 검사 도구는 새 예제를 검증하도록 확장했고 CI 러너·의존성·위생 정책 변경은 없다.
퍼널 연결 상태·단계 집계 저장/수집·SDK·집계 조회/화면은 후속이다. 신규 연결 이벤트의
D1 수집 통합·운영 인증·원격 DB·서비스 파일럿·푸시·배포는 실행하지 않았다.

## 순서 작업 퍼널 계약·코어 — 2026-10-11

OpenAPI의 독립 FunnelDefinition·FunnelLink·FunnelEvent·FunnelCounts와
packages/core/src/funnel.ts를 추가했다. 2~10개 단계·고정 발행 출처·동일 필수 분류
도메인·작업별 UUID·24시간 진행 창·시작 시각 + 72시간 연결 상태를 정의한다.
prepareFunnelObservation은 기존 이벤트 검증을 재사용하고 연결 내용을 포함한 별도
정규 해시를 만든다. planFunnelProgress는 원본 snapshot을 바꾸지 않고 연속 관찰한
단계의 delta만 돌려준다. 영수증 중복 제거와 인증·원자 저장은 저장/수집 연결에서 맡는다.

새 테스트 8/8은 4단계 browser/server의 전체 24개 수신 순열, 시작·중간 단계 누락,
자정 전후 시작일 집계, 동일 시각 단계, 재전송·상반된 단계 시각, 프로젝트/버전/분류
충돌, 정확한 24시간/만료 경계, 유한 등록 속성·출처·정의 검증과 null 분모를 확인한다.
현재 Registry·BrowserBatch·ServerBatch가 신규 funnel 필드를 계속 거부함도 확인했다.

루트 npm run check의 타입 검사·255/255 테스트·브라우저 gzip 예산 검사를 통과했다.
SDK는 2667 bytes·SDK+Sembom은 2949 bytes로 그대로다. 최초 타입 검사의 unknown
좁히기와 attempt 타입 문제를 수정한 뒤 전체 check를 재실행했다. 계약 npm run lint는
유효하지만 아직 endpoint에 연결하지 않은 신규 타입의 no-unused-components 경고
3개가 있다. npm run check의 계약 검사 50/50과 git diff --check도 통과했다.

ADR 0006·제품 명세·로드맵·서버 이벤트 문서를 갱신했다. API에는 독립 타입만 추가했고
실제 HTTP 요청/응답·DBML·SQL·SDK·의존성·CI·위생 정책 변경은 없다. 저장·수집·SDK·
조회·화면 연결은 후속이라 신규 퍼널의 D1 통합·브라우저 화면 검증은 실행하지 않았다.
기존 전체 테스트의 D1/Worker 통합은 통과했지만 신규 퍼널 저장 증거로 사용하지 않는다.
운영 인증·원격 DB·서비스 파일럿·푸시·배포는 실행하지 않았다.

## 관리자 서버 SDK 안내·출처별 진단 — 2026-10-11

프로젝트 생성·설정 입력과 응답 파서가 빈 allowedOrigins를 처리한다. SDK 안내는
browser/server 선택 출처만 투영하고 server-only면 서버를 기본 선택한다. 서버 코드는
실제 서비스가 토큰을 제공하는 ServerOptions.getToken 함수를 받는 TypeScript 팩토리다.
자격 증명이나 운영 제공자를 지어내지 않으며 코드 생성으로 이벤트를 전송하지 않는다.
브라우저 정의가 없는 투영 도구는 오류를 내고 browser 허용 출처가 비면 UI 코드를 만들지 않는다.
스키마 조회는 client·프로젝트·갱신 키를 검사해 전환·실패 뒤 이전 코드를 가린다.

수집 진단은 server-only면 오늘의 서버 건수를 기본 조회한다. 선택 출처의 meta·정의·
합계를 검사하고 출처를 바꾸면 요청을 취소하며 조회 키가 다른 데이터를 가린다. 마지막
수신과 거부 기록은 기존 프로젝트 전체 범위를 유지한다. server 진단은 Origin 비교 대신
전용 발행자 인증·권한·send 응답 확인을 안내하고, browser의 빈 출처에는 차단 안내를 표시한다.

관리자 타입 검사·132/132 테스트·빌드·test:sites 4/4·git diff --check 통과.
신규 4개 테스트는 빈 출처 생성/저장과 코어 계약 일치, 실제 projection 도구와 생성 코드의
일치, TypeScript 변환 후 실제 서버 SDK 팩토리 실행·토큰 조회/전송 없는 이벤트 생성,
server 자동 진단·명시적인 빈 browser 조회·잘못된 출처 응답 거부를 확인한다.
SDK 크기 검사도 다시 통과해 gzip 2667 bytes·SDK+Sembom 2949 bytes를 유지했다.
마지막 화면 수정은 select 레이블·로딩 중 포커스 유지라 타입 검사·빌드와 브라우저 확인을
마쳤고 숫자/전송 테스트는 앞의 유효한 132개 결과를 재사용했다.

인앱 Chromium·로컬 Vite(127.0.0.1:5185)에서 실제 LiveSdkSetup·CollectionDiagnostics에
자격 증명 없는 합성 ApiClient transport를 주입했다. server-only의 서버 자동 선택·
browser SDK 선택 불가·서버 코드 생성·오늘 서버 4건, 명시 browser 조회의 0건/차단 안내,
혼합 스키마의 browser 코드와 서버 선택을 확인했다. SDK 스키마 503이면 이전 코드가 사라지고
명시 재조회로 복구했다. 진단 선택의 정확한 accessible name을 붙이고 로딩 중 컨트롤을 유지했다.
임시 검증 페이지 HMR에서 createRoot 중복 경고가 한 번 있었고 새로고침 뒤 새 오류는 없었다.
320px 실제 innerWidth(기존 90% 확대, override 288px)에서 문서 303px·주소 입력 253px·
코드 영역 236px로 문서 넘침이 없었다. 뷰포트 복원·검증 탭/서버 종료·임시 페이지 삭제를
마쳤으며 ignore된 .tmp/server-setup-ui-qa/desktop.jpg·mobile.jpg에 화면을 보관했다.

제품 명세·로드맵·프론트엔드 설계·서버 이벤트 문서·프로토타입 안내를 갱신했다.
API·DB·SDK 런타임·의존성·CI·위생 정책은 바꾸지 않았다. 일반 소스 lint 명령은 없고
백엔드 247개는 앞의 코어 커밋 검증을 재사용했다. 운영 인증·원격 DB·Sembom·푸시·배포는
실행하지 않았다. 다음은 다단계 퍼널·브라우저/서버 작업 연결 계약이다.

## 서버 전용 스키마·빈 브라우저 허용 출처 — 2026-10-11

공용 스키마 검증에서 최소 browser 이벤트 조건을 제거했다. 전체 이벤트 1~50개·
browser 전용 workflow 참조·속성 한도·개인정보 검토는 유지한다. 프로젝트의
allowedOrigins는 0~16개이며 빈 배열은 browser 수집을 origin_denied로 거부한다.
발행자는 기존 전용 인증·프로젝트 권한으로만 server-batches를 사용한다.
browser_event_required는 구버전 호환 코드로 남지만 현재 검증기는 내보내지 않는다.
job-registry 예제에서 임시 browser 이벤트와 허용 출처를 없애 서버 전용 예제로 바꿨다.

관련 schema·settings·server query·server SDK 테스트 23/23을 통과한 뒤, 루트
`npm run check`의 타입 검사·247/247 테스트·SDK 크기 검사도 통과했다. SDK gzip
2667 bytes·SDK+Sembom 2949 bytes는 이전과 같다. owner의 실제 HTTP 설정 변경·
초안 검사·v2 발행·server 수집·같은 ID 재전송·server 조회·빈 browser summary·
없는 workflow 404·browser Origin 거부를 로컬 D1에서 확인했다. native Worker의
server-only 스키마 조회와 기존 Node·Worker SDK 발행/충돌/권한 회수 통합도 통과했다.

OpenAPI lint·계약 검사 46/46·git diff --check 통과. 처음 추가한 YAML description이
기존 키와 중복되어 검사가 실패했고 기존 설명에 합친 뒤 lint·계약 검사를 재실행했다.
OpenAPI·등록 예제·DBML의 출처 설명·제품 스펙·로드맵·서버/관리자 계약·예제 안내를
갱신했다. DBML은 주석만 바꿨고 SQL·마이그레이션·SDK 런타임·의존성·CI·위생 정책은
변경하지 않았다. 관리자 서버 연결 안내·빈 출처 편집·진단은 다음 슬라이스다.
운영 인증·원격 D1·Sembom·푸시·배포는 연결 환경이 없어 실행하지 않았다.

## 관리자 발행 출처 선택 화면 — 2026-10-11

`LiveDashboard`의 개요·이벤트 분석에서 browser/server 출처를 고르도록 연결했다.
출처를 조회·기간 비교·CSV·로딩 키에 포함하고 전환 시 선택 이벤트와 분류를 초기화한다.
`SourceEventTable`과 `SourceMetrics`를 분리해 기존 표시 규칙을 공유하며 server 개요에는
브라우저 시작·성공·완료율을 넣지 않는다. 목표는 browser 작업 흐름만 조회한다.
다른 출처 행은 건수 0 대신 `다른 출처`로 표시하고 빈 server 집계 안내에서 완료율 문구를 뺀다.

관리자 `npm run typecheck`, `npm test` 128/128, `npm run test:sites` 4/4,
`npm run build`, `git diff --check` 통과. build는 Sites용 client/server/hosting 파일을 만들었다.
API·DB·SDK를 바꾸지 않아 백엔드 검사는 반복하지 않았고 일반 소스 lint 스크립트는 없다.

Codex 인앱 Chromium과 로컬 Vite(127.0.0.1:5184)에서 실제 화면과 ApiClient에 합성
fetch transport를 연결했다. 토큰을 비운 채 연결해 자격 증명을 만들거나 전송하지 않았다.
browser 총 35건·20회 시작·15회 성공·75% 완료율, server 총 12건과 이전 6건·100% 증감,
server 일별 그래프·retried 속성의 false/null 구분·값별 비교, 목표의 browser 고정을 확인했다.
server 조회에는 workflow 요청이 없었고 내려받은 CSV 파일명에 `-server`가 들어가며
선택하지 않은 browser 행은 `not_selected`·빈 건수였다. 503 오류 때 결과와 CSV를 잠그고
재시도로 복구하며, 지연된 server 응답을 browser 전환 뒤 전달해도 35건·75%가 유지됐다.
임시 검증 페이지 HMR에서 createRoot 중복 경고가 한 번 기록됐고 연결이 끊겨 새로고침했다.
새로고침 후 최종 코드의 정상 조회를 확인했으며 이후 새 콘솔 오류는 발생하지 않았다.

기존 브라우저 90% 확대에서 실제 innerWidth 320px(override 288px), 문서 폭 303px,
표 540px·스크롤 영역 255px·셀 18px를 확인했다. 표 영역에 키보드 포커스를 두고
ArrowRight로 가로 스크롤했으며 뷰포트는 복원했다. 검증 화면은 ignore된
`prototypes/admin/.tmp/source-ui-qa/desktop.jpg`·`mobile.jpg`에 보관한다.
운영 OIDC·원격 D1·Sembom 연결·푸시·배포는 실행하지 않았다. 로컬 검증 서버와 탭은 종료한다.
제품 스펙·로드맵·프론트엔드 설계·서버 이벤트 문서·프로토타입 안내를 갱신했다.
API·DB·SDK·의존성·CI 러너·위생 정책은 변경하지 않았다.

## 관리자 서버 출처 클라이언트·비교·CSV — 2026-10-11

관리자 `ApiClient`의 summary·event daily에 선택 source를 연결했다. 파서는 두 이벤트
출처를 받고 요청한 출처와 응답 meta.source가 다르면 거부한다. workflow 응답은 browser
전용으로 계속 검사한다. 기간 조회·스냅샷 검증·속성 분석·직전 기간 비교·CSV가 서버 출처를
지원하며 server 기간에는 workflow 요청/완료율을 넣지 않는다. 출처가 다른 기간·선택
이벤트를 섞으면 거부한다. CSV에서 미선택 출처 건수는 빈 값·not_selected로 구분하고
서버 파일명에는 server를 넣는다. 기본 browser 호출과 파일명은 유지한다.

관리자 `npm run typecheck`, `npm test` 128/128 통과. 새 5개 테스트는 명시 source 전송,
서로 다른 출처 응답과 잘못된 입력의 거부, browser 전용 workflow 파서, 서버 기간의
workflow 요청 없음, 빈 정의, 타입별 속성/기간 비교, 교차 출처 CSV 거부를 확인한다.
화면은 아직 이 source 옵션을 선택하지 않으므로 서버 조회 화면 완료로 주장하지 않는다.
관련 상태 표시·출처 선택·그래프·CSV 버튼 배선은 다음 UI 슬라이스다.

API·DB·SDK·의존성·CI 러너·위생 정책은 변경하지 않았다. UI 마크업 변경이 없어 시각
검증은 생략하고 백엔드 검사 245/245는 이전 API 커밋 결과를 재사용한다. 일반 소스 lint
스크립트는 없다. 원격 인증·DB·Sembom 연결·푸시·배포는 실행하지 않았다.

## 서버 출처 집계 조회 API — 2026-10-11

`GET .../summary`와 `GET .../events/{eventName}/daily`에 선택 `source=browser|server`를
추가했다. 생략하면 기존 browser 조회다. D1의 출처 조건은 bind하며 한 번에 한 출처의
등록 정의·집계만 읽는다. 새 API나 테이블을 만들지 않고 기존 쿼리 한도·권한 조건·일관
batch를 유지했다. 잘못된 출처와 중복 파라미터는 400, 선택 출처에 없는 이벤트는 404다.
workflow 조회는 browser 전용이고 source 파라미터를 받지 않는다. 선택 출처에 정의가
없으면 summary는 events=[]·totalEvents=0으로 응답한다. meta.latestReceivedAt는 여전히
프로젝트 전체의 마지막 신규 수신이며 출처·버전·조회 기간별 수신 시각이 아니다.

루트 `npm run check`의 타입 검사·전체 테스트 245/245·브라우저 크기 검사 통과.
신규 7개 테스트는 실제 D1에 서버/브라우저 이벤트를 같은 ID로 저장하고 중복 재전송,
출처 분리·기본값·날짜 경계·false/0/누락 속성·빈 정의·버전 분리·retired/paused 조회,
발행자 조회 거부·다른 issuer/프로젝트·권한 회수·잘못된 source·저장 손상 거부를 확인한다.
실제 Miniflare Worker에서도 서버 합계·일별 속성 조회와 grant 회수 후 403을 확인했다.
관리자 인증 포트는 테스트용 검증기를 주입했고 실제 제공자 토큰 검증을 새로 실행하지
않았다. 운영 인증은 기존 검증 어댑터 범위다. 관리자 `npm run typecheck`도 통과했다.
OpenAPI lint와 계약/문서 링크 검사 46/46, `git diff --check` 통과.

OpenAPI의 출처 파라미터·QueryMeta와 browser 전용 workflow meta를 확장했다. 응답 예제와
계약 검사에 서버 응답·빈 합계·서버 workflow 거부를 추가했다. DB·마이그레이션·SDK·
의존성·CI 러너·위생 정책은 변경하지 않았다. UI 코드를 바꾸지 않아 화면 빌드/시각 검증은
반복하지 않았고 일반 소스 lint 명령은 없다. 서버 이벤트 화면 연결과 서버 전용 등록은
후속이다. 원격 DB·운영 연결·Sembom 활성화·푸시·배포는 실행하지 않았다.

## 서버 SDK Node·Worker·D1 통합 — 2026-10-11

`apps/collector/test/server-sdk.test.ts`에서 서버 작업 예제와 등록 정의 투영을 확인했다.
Node 기본 fetch의 루프백 HTTP 전송과 Worker 기본 fetch의 outbound service 전송이
전용 audience로 서명한 메모리 임시 토큰·발행 권한 검사를 거쳐 실제 로컬 D1에 저장된다.
테스트 전용 키/JWT는 메모리에서 생성하고 실제 제공자·자격증명은 사용하지 않는다.
응답 유실 뒤 본문·ID를 유지한 재전송은 신규 집계/할당량을 늘리지 않고, 저장된 이벤트의
수동 복원도 duplicate다. 같은 ID·다른 내용은 409이며 권한 회수 뒤 두 런타임 모두
403이고 신규 영수증을 만들지 않는다. 서버 발행은 브라우저 작업 흐름 상태를 만들지 않는다.

기존 `redirect: 'error'`는 현재 Worker 런타임에서 요청 전에 실패하는 것으로 재현됐다.
SDK를 `redirect: 'manual'`로 수정해 리다이렉트를 따라가지 않으며, Node와 Worker 모두
302에서 한 번만 시도하고 다른 주소로 토큰을 보내지 않는지 확인했다. 응답 유실 테스트의
Miniflare 영수증 스트림은 소진 후 버려 로컬 연결 오류 로그 없이 실패를 재현한다.

관련 테스트 15/15, 루트 `npm run check`의 타입 검사·전체 테스트 238/238·브라우저 크기
검사, OpenAPI lint와 계약/문서 링크 검사 43/43 통과. `npm run build:server`의 ESM/타입
선언 빌드 통과: 7179 bytes/gzip 3154 bytes, 런타임 의존성 0개다. 브라우저 SDK는 gzip
2667 bytes, Sembom 포함 2949 bytes로 3KiB 예산을 유지했다.

예제 Registry를 추가했고 API/DB 계약·마이그레이션·의존성·CI 러너·위생 정책은 변경하지
않았다. 아키텍처·개발 안내·SDK/패키지 경계·로드맵을 갱신했다. UI 변경이 없어 화면 검사는
반복하지 않았고 일반 소스 lint 스크립트는 없다. 실제 제공자·원격 DB·서비스 활성화·푸시·
배포는 실행하지 않았다. 서버 출처 조회 화면과 서버 전용 등록은 다음 구현이다.

## 의존성 없는 서버 SDK — 2026-10-11

`packages/server`에 별도 ESM SDK `createTallyfinServer`를 구현했다. 검토한 서버 이벤트
규칙으로 이름·속성·UUID·UTC 시각을 검사하고, 반환 이벤트·속성을 얼린다. 호출자가
`send` 결과를 기다리며 하나의 1~20개/16KiB 배치를 보낸다. 자동 큐·DOM·백그라운드
전송을 두지 않고, 재시도는 처음 만든 본문과 이벤트 ID·발생 시각을 그대로 쓴다.
토큰만 시도마다 호스트 callback에서 다시 얻는다. 자격증명 실패와 영구 4xx는 자동
재시도하지 않고 408·429·5xx·네트워크/응답 실패는 횟수·총 시간·취소로 제한한다.
`Retry-After`가 예산 밖이면 오래 대기하지 않고 재시도를 호스트에 넘긴다.
단일 요청의 시간 제한에는 토큰 획득·요청·응답 읽기가 모두 포함된다.

루트 `npm run check` 타입 검사·전체 테스트 236/236·브라우저 크기 검사 통과.
SDK 단위 13/13에서 동일 ID/본문 재전송·입력/스키마 변경 격리, false·0·필수/범위·
잘못된 UTC/캘린더·배치/출처 입력 거부, 자격증명 오류 비공개, 초/HTTP-date backoff·
단조 시계 예산·인증/요청/본문/대기 취소, 지연된 토큰의 요청 차단, 1KiB 응답 한도와
정확한 accepted+duplicates만 성공으로 인정하는 처리를 확인했다.
`npm run build:server`의 ESM·타입 선언 빌드 통과. esbuild graph에서 런타임 import·
외부/코어/저장/브라우저 코드 유입이 없고, 빌드한 ESM을 Node에서 실행했다.
서버 SDK는 7178 bytes/gzip 3150 bytes다. 서버 크기/운영 지연 목표는 아직 정하지
않았고, 브라우저의 3072-byte 예산과는 별개다. 기존 브라우저 SDK gzip 2667 bytes·
Sembom 포함 2949 bytes를 유지했다.

새 private workspace와 build:server·test:server 명령, workspace link만 lockfile에
추가했다. 외부 의존성·버전·API·DB·마이그레이션·CI 워크플로·위생 정책은 바꾸지
않았다. 제품 명세·로드맵·서버 SDK/서버 이벤트·수집 안내를 갱신했다. 일반 소스
lint 명령은 없다. UI 변경이 없어 UI 빌드/브라우저 화면 확인은 생략했다.
실제 Worker/D1 SDK 통합은 다음 슬라이스다. 영속 큐·업무와 전송의 원자적 보장·
토큰 발급·원격 제공자/D1·부하·푸시·배포·서비스 활성화는 검증하지 않았다.

## 로컬 서버 발행 권한 관리 CLI — 2026-10-11

`publisher-grant`·`publisher-revoke`를 기존 로컬 등록 CLI에 추가했다.
닫힌 JSON의 projectId·issuer·subject만 받으며 role·토큰·자격증명 발급은 받지 않는다.
미리보기 출력에는 원본 발행자 식별자 대신 principalHash를 넣고, 현재 권한·변경
계획·planHash를 표시한다. 기본은 미리보기, 쓰기는 `--apply`만 수행하며
`--expect-plan`이 있으면 현재 계획과 대조한다. 한 번만 적용할 수 있는 계획을 도구
인스턴스에 보관하고 프로젝트 생성 시각·발행자 행의 생성 시각/부재를 조건부 SQL로
비교한다. 같은 상태 재요청은 생성 시각을 바꾸지 않고, 회수는 관리자 grant를
건드리지 않는다.

`npm run typecheck` 통과. 기존 등록·관리자 grant와 신규 publisher CLI 관련 테스트
11/11 통과. CLI 시험의 영속 DB 재개방 횟수를 줄인 뒤 신규 5/5를 다시 실행해 통과했다.
실제 Miniflare D1에서 미리보기 무쓰기, 부여·회수·동일 상태 재시도, 원래 생성 시각
보존, 다른 프로젝트 격리, 경쟁 부여·회수/재부여·프로젝트 생성 시각 변경의 오래된
계획 거부, 도구/계획 사본/재사용·변조 입력 분리, DB 오류 비공개 처리를 확인했다.
영속 CLI에서 planHash를 검토한 적용·오래된 hash의 쓰기 전 거부·원격 옵션과
관리자 role 필드 거부까지 확인했다. 계약/문서 링크 검사 42/42 통과.

API·DB 구조·마이그레이션·SDK·의존성·CI 러너·위생 정책은 변경하지 않았다.
제품 명세·로드맵·서버 이벤트·프로비저닝 안내를 현재 구현에 맞췄다. 이 변경은
CLI 범위여서 전체 테스트는 서버 수집 API 커밋의 218/218 결과를 재사용하고 관련
11개만 실행했다. API lint·SDK 크기도 해당 커밋의 결과를 재사용한다. UI 변경이
없어 화면 빌드/브라우저 검증은 생략했다. 일반 소스 lint 스크립트는 없다.
publisher CLI 변경은 현재 admin_changes에 기록하지 않는다. 해당 이력의 닫힌
action 계약 확장은 후속이다. 실제 제공자·원격 DB·토큰 발급·서비스 활성화·푸시·
배포는 실행하지 않았다.

## 인증된 서버 이벤트 수집 API — 2026-10-11

`POST /v1/projects/{projectId}/server-batches`를 별도 발행자 검증기와 연결했다.
관리자 grant와 독립인 발행 권한을 admission 전에 확인하고, 기존 commitServer가 쓰기
직전에 다시 검사한다. 브라우저와 같은 분당·UTC 일일 한도를 쓰며 JSON 전용·16KiB·
20개 한도, POST 전용, 쿼리 거부, CORS 없음·Origin 무시, 동일 ID 재시도와 전체 배치
충돌 거부를 적용한다. 기본은 401로 닫힌다. `PUBLISHER_AUTH_MODE`와 별도
`PUBLISHER_OIDC_*` 설정을 runtime에 연결했고, 서버 토큰은 단일 audience만 받는다.
관리자·발행자 audience를 같게 설정하면 구성 단계에서 거부한다. 발행자 변수가 없는
이전 구성도 disabled로 동작한다.

루트 `npm run check`의 타입 검사·전체 테스트 218/218·브라우저 SDK 크기 검사 통과.
신규 HTTP 테스트 6/6에서는 실제 Miniflare Worker와 D1, 메모리에서 생성한 임시 RSA
서명과 격리된 공개 JWKS transport로 인증과 저장까지 확인했다. 관리자 토큰·다중
audience·잘못된 issuer·만료·서명 변조 거부, owner 권한만 있을 때 발행 거부,
미등록 프로젝트 비공개 403, 발행 권한 회수 전후·저장 전 회수, 중복·충돌·공유
할당량, 잘못된 메서드·미디어 타입·UTF-8·크기·스키마·출처·attempt 입력 거부를
확인했다. 인증·발행 권한 초기 거부는 admission을 쓰지 않으며 그 뒤 잘못된 요청은
한도를 쓴다. OpenAPI lint 경고 없이 통과·계약 검사 42/42 통과.
SDK gzip 2667 bytes·Sembom 예제 포함 2949 bytes로 3072-byte 예산을 유지한다.

OpenAPI 요청 경로·발행자 security scheme, 제품 명세·로드맵·수집/서버 이벤트·OIDC·
실행 문서를 변경했다. DB 구조·마이그레이션·브라우저 SDK·의존성·CI 러너·위생
정책은 변경하지 않았다. UI 변경이 없어 UI 빌드/브라우저 화면 검증은 생략했고 일반
소스 lint 스크립트도 없다. 실제 제공자 자격증명 발급·원격 DB·부하·배포·Sembom
활성화는 실행하지 않았다. 발행자 권한 관리 도구·서버 SDK·서버 출처 조회와
server-only 레지스트리 허용은 후속이다.

## 소유자 전용 변경 이력 조회 API — 2026-10-11

`GET /v1/projects/{projectId}/changes`·코어 AdminChangePage·AdminStore.changes와 D1
reader를 연결했다. 현재 owner와 기록을 같은 batch에서 검사하고 최신 시각·UUID
내림차순으로 기본 25·최대 100건을 읽는다. 프로젝트에 묶인 최대 512자 커서는 기록
시각·UUID만 담고 계정 정보나 권한을 담지 않는다. 물리 정리가 지연돼도 요청 시각 기준
90일 rolling 밖과 미래 기록은 제외한다. API actor와 식별자 없는 CLI actor를 구분하며
각 동작의 최소 필드만 투영하고 recorded-changes-only·생성 시각·보존 기간을 반환한다.

루트 `npm run check`의 타입 검사·전체 테스트 199/199·SDK 크기 검사 통과.
관련 HTTP/기존 관리자 테스트 19/19를 먼저 실행했고, 최대 페이지 검사 추가는 위 전체
실행에 포함했다. 실제 Miniflare D1에서 동시각 페이지·기준 행 삭제·새 기록 재조회,
기본/최대 한도, 보존 경계·만료 행 숨김·타 프로젝트 격리, reader/권한 회수·쓰기 직전
회수, 잘못된 커서/쿼리/메서드, 손상 데이터의 503과 비공개 오류를 확인했다. 기존
native Worker smoke에 변경 이력 조회·다음 페이지·grant 회수 후 403을 추가해 통과했다.
OpenAPI lint·계약 39/39·`git diff --check` 통과. SDK gzip 2667 bytes·예제 포함 2949 bytes.

OpenAPI·예제·코어 저장 포트·DBML의 조회 보존 설명·관리자/제품 문서를 변경했다.
DB 구조·SQL 마이그레이션·SDK·의존성·CI 러너·위생 정책은 변경하지 않았다.
화면 연결은 다음 단계라 UI 빌드/브라우저 UI 검사는 실행하지 않았다. 원격 D1·운영
OIDC·부하·푸시·배포·Sembom 활성화는 이번 범위에 포함하지 않았다.

## 관리자 변경 이력 저장 — 2026-10-11

`0005_admin_changes.sql`과 DBML에 프로젝트별 제어 영역 이력을 추가했다. API의
프로젝트 생성·설정 변경·스키마 발행·grant 변경과 로컬 Provisioner의 등록·설정·
스키마 상태·grant 변경은 실제 쓰기와 같은 DB batch에 이력을 넣는다. 실제 변경 없는
설정 요청·동일 상태 재요청·권한 거부·충돌은 이력을 추가하지 않는다. 검증된 관리자
issuer/subject와 CLI의 식별자 없는 local_operator를 구분하며 CLI 변경 대상을 실행자로
추정하지 않는다. 설정 필드명·스키마 번호·grant 이전/이후 역할만 보관하고 설정값·
정의·원시 본문·토큰·방문자 자료는 넣지 않는다.

90일 rolling 보존과 프로젝트별 기본 500행·최대 1000행 정리를 기존 scheduled 경로에
추가했다. 과거 변경은 backfill하지 않고 정상 브라우저 수집에는 기록 쓰기를 추가하지
않았다. UPDATE 불변 트리거·동작별 NULL 관계·설정 필드명 허용 목록과 중복 거부를
DB에서도 검사한다. 신규 owner 전용 조회 API·화면은 다음 단계다.

루트 `npm run check`의 타입 검사·전체 테스트 192/192·SDK 크기 검사 통과.
마지막 필드 제약·CLI rollback 검사 추가 후 관련 D1 테스트 6/6을 다시 실행해 통과했다.
실제 로컬 Miniflare D1에서 API/CLI 이력 실패 시 전체 rollback, 재시도/충돌/동일 값
무기록, 보존 경계·테넌트 격리·삭제 한도, 기존 DB upgrade/재적용·무 backfill·원본 보존,
신규 DB CLI 초기화를 확인했다. 계약 검사 37/37과 `git diff --check` 통과.
SDK gzip 2667 bytes·Sembom 예제 포함 2949 bytes를 유지한다.

DB 구조·마이그레이션·코어 저장 포트의 선택적 설정 저장 시각을 변경했다. HTTP 요청/
응답 형태·SDK·의존성·CI 러너·위생 정책은 변경하지 않았다. 화면 변경이 없어 UI 빌드/
브라우저 검사는 생략했다. 원격 마이그레이션·운영 OIDC·부하·직접 SQL 변경의 기록은
검증 범위에 포함하지 않는다. 푸시·배포·Sembom 활성화는 하지 않았다.

## 관리자 권한 변경 화면 — 2026-10-11

`LiveGrants`에 접힌 계정 추가 폼·행별 역할 변경/회수 버튼을 연결하고,
`GrantChangePanel`에서 대상 식별자와 기존/변경 역할을 검토한 뒤 저장한다.
자기 강등/회수 가능성을 안내하며, 응답 유실 때는 같은 고정 요청만 재확인한다.
권한 상실은 목록·폼을 즉시 제거하고 `LiveSettings` 편집을 잠근다. 설정 초안은
보존하고 관련 스키마/진단/SDK 설정도 재조회한다. 설정 새로고침 중에는 진행 중인
권한 저장/응답 유실 상태를 유지하며, 프로젝트/연결 전환의 늦은 응답은 버린다.

관리자 `npm run typecheck`·`npm run build`·`npm run test:sites` 4/4 통과.
동일 변경 클라이언트의 전체 테스트 118/118은 앞 단계 결과를 재사용했고 UI 연결에는
실브라우저 smoke를 실행했다. 일반 lint 스크립트는 없어 생략했다.

로컬 Vite(127.0.0.1:5182)와 Codex 인앱 Chromium에서 실제 컴포넌트에 합성 transport를
주입해 추가·승격·회수, 확인 전 요청 0건, 응답 유실의 동일 재확인, 마지막 owner 거부,
동시 변경 충돌 뒤 최신 목록, 자기 강등/회수·403 후 입력 잠금과 행 제거, 초안 보존,
저장 지연 중 설정 새로고침·프로젝트 전환 후 늦은 응답 폐기를 확인했다.
reader 전환 때 권한 요청 수가 늘지 않고 목록·추가 폼이 사라진다.
최종 코드를 새 탭에서 로드한 뒤 콘솔 오류가 없었다. 편집 도중 임시 파일 교체로 발생한
과거 HMR 오류는 최종 문서의 런타임 오류로 집계하지 않았다.

실제 CSS innerWidth 320px에서 문서 scrollWidth 303px·패널 253px로 페이지 넘침이 없고,
표 540px은 255px 영역 안에서만 스크롤된다. 508자 식별자를 자르지 않고 표/확인 값은
18px이며 키보드 ArrowRight로 표 스크롤을 확인했다. 뷰포트를 복원하고 검증 탭·서버를
종료했다. 화면은 `.tmp/grants-edit-qa/desktop.png`·`mobile.png`에 저장했다.

제품 명세·로드맵·프론트엔드 설계·관리자 문서·검증 기록을 갱신했다.
API·DB·SDK·의존성·CI 러너·위생 정책 변경, 푸시·배포·Sembom 활성화는 없다.

## 서버 배치 코어 검증·집계 계획 — 2026-10-11

`ServerBatch`·`ServerEvent`·`PreparedServerBatch`와 `parseServerBatch`·
`prepareServerBatch`를 추가했다. 기존 parser/preparer와 구조·등록 속성·시간 검증을
공유하고 server 출처 정의만 허용하며 attempt는 거부한다. canonicalEvent에 출처를
선택적으로 받아 기본 browser 해시 입력 바이트를 유지한다. `planIngest`는 서버 배치의
영수증·이벤트 delta만 만들고 시도·작업 흐름을 만들지 않는다. HTTP handler와 저장
어댑터에는 연결하지 않았으며 현재 공개 browser 경로는 여전히 server 배치를 거부한다.

신규 테스트의 첫 실행에서 기존 dimensionKey의 typed 값 직렬화를 잘못 적은 예상값
한 건이 실패했다. 소스의 기존 직렬화 형식에 맞춰 기대값을 수정하고 루트
`npm run check`를 실행해 타입 검사·203/203 테스트(서버 배치 신규 4개 포함)·브라우저
크기 검사를 통과했다. 기존 Worker/Miniflare·D1 원자 저장·관리자 권한·CLI 회귀도 함께
실행됐다. SDK gzip 2667 bytes, Sembom 연동 포함 2949 bytes로 3072 bytes 예산 이내다.

`tools/contracts`의 `npm run check` 41/41과 `npm run lint`가 통과했다. OpenAPI의
ServerBatch는 아직 HTTP 경로에 연결하지 않은 계약이라 no-unused-components 경고
한 건이 있다. 이 경고를 없애려고 browser 경로에 서버 스키마를 허용하거나 검사 규칙을
완화하지 않았다. ServerBatch·ServerEvent 스키마와 예제를 더하고, 별도 출처·attempt
금지·닫힌 객체·20개 한도·공개 browser 경로의 기존 요청 스키마를 검사한다.

제품 명세·로드맵·서버 이벤트 계약·백엔드 안내·README와 검증 기록을 갱신했다. API의
컴포넌트 스키마만 추가했고 HTTP 경로·인증·DB·마이그레이션·SDK·의존성·CI 러너·위생
정책을 바꾸지 않았다. 새 HTTP 서버 인증/저장 smoke와 서버-only 스키마 등록은 아직
구현하지 않아 실행하지 않았다. 운영 인증·원격 DB 적용·푸시·배포·Sembom 활성화는 없다.

## 서버 발행 권한·출처별 저장 — 2026-10-11

`ServerPrincipal`·`ServerCollectionStore`와 `D1Store.publisherAccess`·`commitServer`를
추가했다. 새 `project_publishers`는 관리자 reader/owner와 독립인 프로젝트·issuer·subject
권한이며 자동 부여하지 않는다. 호스트의 인증 검증이 끝난 주체만 이 포트로 전달해야
한다. 저장 어댑터 자체가 토큰 서명·audience·expiry를 검증하거나 토큰을 발급하지 않는다.
서버 commit은 일관 읽기에서 권한과 출처별 영수증을 읽고 쓰기 batch의 CAS 조건에서
현재 권한을 다시 검사한다. 회수 경쟁이면 쓰기 전부가 롤백되고 재조회에서 403이다.
같은 ID도 browser/server 영수증은 분리되며 UTC 일일 할당량은 프로젝트 전체가 공유한다.

0006은 event_receipts·event_daily_counts의 source CHECK를 browser|server로 넓히기
위해 두 테이블을 복사·재생성하고 기존 인덱스를 복구한다. project_publishers는 빈
테이블로 추가한다. 로컬 initialize는 새 marker와 두 확장 CHECK를 함께 확인해 반복
적용을 막고 임시 테이블·부분 적용 상태를 거부한다. DBML·마이그레이션 안내를 갱신했다.

`node --test packages/storage-d1/test/server-collection.test.ts` 신규 7/7이 통과했고,
루트 `npm run check`의 타입 검사·210/210 테스트·브라우저 크기 검사도 통과했다.
테스트는 관리자 권한과의 분리·project/issuer/subject 격리·동일 ID의 출처 분리·재시도·
충돌·공유 할당량·권한 회수 경쟁·20개 동시 중복 전달·집계 overflow 전체 롤백·보존
정리를 확인한다. 기존 browser·관리자·등록 CLI·로컬 supervisor 회귀도 실행했다.
SDK gzip 2667 bytes, Sembom 포함 2949 bytes로 3072 bytes 예산 이내다.

Miniflare의 빈 DB에 0001~0006을 적용하는 경로와 0001~0005의 기존 browser 영수증·
집계·시도·설정·grant를 가진 DB에 0006만 적용하는 경로를 확인했다. 업그레이드 직전과
직후 행을 대조했고 인덱스 두 개·foreign_key_check·새 권한 0건·재초기화 no-op를 확인했다.
마이그레이션 마지막에 count=-1 제약 실패를 주입했을 때 원래 행·테이블 제약을 유지하고
새 marker와 임시 테이블도 남지 않았다. 확장된 표만 있고 marker를 지운 불완전 상태는
partial_database로 거부한다. 실제 운영 규모의 table copy 시간·원격 D1은 미검증이다.

`tools/contracts`의 `npm run check` 41/41과 `npm run lint`가 통과했다. ServerBatch의
미연결 HTTP 컴포넌트 경고 1건은 유지한다. 일반 소스 lint 명령은 없으며 HTTP 서버
인증 smoke·실제 자격증명·원격 마이그레이션·운영 부하 검증은 아직 연결하지 않아 생략했다.
API 경로와 기존 인증·SDK·의존성·CI 러너·위생 정책 변경, 푸시·배포·Sembom 활성화는 없다.
API 설명·제품 명세·로드맵·서버 이벤트 계약·README도 현재 범위에 맞춰 갱신했다.
실제 OIDC 계정과 원격 D1은 환경이 연결되지 않아 이번 UI 검증에 사용하지 않았다.

## 관리자 권한 변경 클라이언트 — 2026-10-11

관리자 `ApiClient.changeGrant`와 `GrantEditor`를 추가했다. 닫힌 PUT/DELETE 본문과
응답의 프로젝트·계정·역할을 검사하며 모든 변경은 검토 뒤 명시적으로 확인한다.
응답 유실·503·응답 계약 오류는 입력을 고정한 상태에서 같은 요청만 재확인한다.
충돌·마지막 owner 거부는 별도 오류로 표시하고, 권한 상실·언마운트 때 추가 변경과
늦은 응답을 차단한다. 자동 재전송·식별자 저장·로그는 없다.

관련 요청/컨트롤러/기존 목록 테스트 13/13, 관리자 `npm run typecheck`와 전체
`npm test` 118/118 통과. UI 콜백 실패가 확인된 저장을 응답 유실로 바꾸지 않는 것도
검사했다. 아직 화면 연결 전이므로 이번 단계에서는 브라우저 UI smoke·build를
실행하지 않았다. API·DB·SDK·의존성·CI 러너 변경은 없고 푸시·배포도 없다.

## 프로젝트 권한 변경 API — 2026-10-11

owner 전용 `PUT/DELETE /v1/projects/{projectId}/grants`를 로컬 구현했다.
조회한 `expectedRole`로 동시 변경을 검사하고 마지막 owner의 강등·회수를 거부한다.
권한 검사·변경·결과 조회는 같은 D1 batch에 두며, 같은 목표 상태의 재요청은
추가 변경 없이 성공한다. 기존 생성 시각은 보존하고 자기 권한을 바꾸면 결과의
`canManage`에 남은 owner 권한을 반영한다.

루트 `npm run check`의 타입 검사·전체 테스트 186/186·브라우저 크기 검사 통과.
신규 요청 검증 1개와 변경 API 8개, 기존 목록 6개를 함께 실행한 관련 테스트도
15/15 통과했다. 동시 변경·마지막 owner 보호·권한 회수 경합·다른 프로젝트 접근 거부·
재요청·DB 실패 롤백을 확인했고 기존 Worker smoke에서 실제 PUT/DELETE도 실행했다.
`tools/contracts` OpenAPI lint와 계약 검사 37/37, `git diff --check` 통과.
SDK gzip 2667 bytes, Sembom 예제 포함 2949 bytes로 유지된다.

OpenAPI·코어 저장 포트·수집기 오류 계약을 변경했다. DB 구조·마이그레이션·SDK·
의존성·CI 러너·위생 정책 변경은 없다. 화면은 조회만 지원하므로 변경 폼 연결이
남았다. 실제 OIDC 계정·원격 D1·운영 배포는 환경이 연결되지 않아 검증하지 않았고,
푸시·배포·Sembom 활성화도 하지 않았다.

상태: 코어·D1 저장·수집기·브라우저 SDK·관리자 조회/설정 변경 API·OIDC 검증 어댑터와 v0.1 계약·샘플 UI를 로컬에서 검증했다. 브라우저 SDK는 커밋 `cb3f2ff`와 뒤이은 예제·크기 검사·수집기 통합 테스트 및 합성 화면의 실브라우저 측정으로 확인했다. Sembom 예제는 저장소 안에만 두었고 실제 서비스에는 설치·활성화하지 않았다. 실제 인증 제공자·운영 로그인·원격 DB 마이그레이션과 운영 배포는 아직 없다.

2026-10-08 관리자 조회 슬라이스 검증: `apps/collector/src/admin.ts`에 관리자 GET 조회를, `index.ts`에 `createWorker(verifyBearer)` 검증기 포트를 구현했고, 모킹한 trusted 검증기와 실제 D1 grant 경계를 Miniflare에서 확인하는 native Worker 팩토리 smoke 테스트 1개를 추가했다. `node --test`로 `apps/collector/test/admin.test.ts` 9/9 통과. 부모 검증은 루트 `npm run check`(typecheck + 테스트 86개 + SDK+Sembom gzip 2949 bytes 예산)와 `tools/contracts` lint/check 27개 통과다. 이후 추가한 관리자 테스트 1개로 현재 전체 테스트는 87개지만 루트 full check 87은 다시 돌리지 않았다(루트 check 86 → 이후 관리자 9/9). DB 스키마·SQL 마이그레이션 변경은 없고 OpenAPI는 관리자 GET 405 응답 추가와 설명 문구 갱신만 있었다(경로·본문 형태는 그대로). 검증기는 테스트에서만 모킹했고 실제 서명 검증·인증 제공자·토큰 발급은 미구현·미검증이다. 자격증명·토큰은 만들지 않았다. backend 커밋 `404875c`, smoke 추가는 별도 커밋.

## OIDC 검증 어댑터

2026-10-08 OIDC 슬라이스 검증: `packages/auth-oidc`와 `createOidcWorker(options)`를
구현했다(코드 커밋 `7e85001`). 서명/issuer/API audience/만료/발행 시각/필수 클레임,
알고리즘·토큰 타입, JWKS 키 갱신·실패 재시도 제한·크기·본문 시간 제한을 검증한다.
실행 중 생성한 키로 실제 서명을 검증하며 운영용 자격증명은 생성하지 않는다.

관련 테스트 10/10, 루트 `npm run check`(타입 검사 + 전체 테스트 97/97 + 크기 검사)
통과. Miniflare Worker에서도 정상 토큰 200, 잘못된 audience/변조 401, grant 회수 후
403을 확인했다. SDK gzip 2667 bytes, SDK+Sembom gzip 2949 bytes로 유지된다.
`jose ^6`을 서버용 어댑터에 추가했고 새 workspace는 기존 루트 명령으로 검사한다.
OpenAPI·DB·마이그레이션·브라우저 UI·루트 러너 변경은 없다.

실제 인증 제공자·원격 JWKS·브라우저 로그인/PKCE·토큰 발급/갱신·운영 배포는
설정값과 연동 환경이 없어 실행하지 않았다. 공개키 캐시 수명은 10분이고 키 갱신
재조회 간격은 30초다. 토큰별 폐기/로그아웃 반영은 아직 구현하지 않았다.
운영 외부 키 조회·동시 부하는 미검증이며 로컬 transport와 Worker 암호 런타임을
확인한 결과다. 상세 정책은 [OIDC 어댑터](./docs/backend/oidc.md)를 따른다.

## 만료 데이터 예약 정리 — 2026-10-08

Worker `scheduled` 핸들러·D1 순회 커서·0002 추가 마이그레이션을 로컬 구현했다.
회당 최대 5개 프로젝트·6개 테이블별 500행을 처리하고, 중지된 프로젝트를 포함하며
개별 실패 뒤에도 진행한다. CAS로 겹친 실행의 오래된 커서 갱신을 거부한다.

루트 `npm run check`(타입 검사 + 테스트 102/102 + 브라우저 크기 검사) 통과.
추가한 테스트 5개는 프로젝트 순회/재생성/끝 순환/삭제된 대상/중지 프로젝트,
실패 격리/DB 실패/커서 충돌, 실제 workerd 예약 핸들러와 D1 삭제를 확인한다.
501개 만료 영수증 중 500개만 첫 실행에 삭제하고 아직 만료되지 않은 1개는 유지한다.
프로젝트-local 오늘을 포함한 90일 집계 경계와 ingest revision 유지도 확인했다.
기존 0001 데이터가 있는 DB에 0002를 적용해 프로젝트·영수증이 유지됨을 검사했다.

처음 예약 실패 검사는 Miniflare 호출의 reject를 기대해 실패했다. 실제 호스트는
예약 결과의 `outcome: exception`으로 전달하므로 그 결과를 검사하도록 수정했고
단독 예약 검사 3/3 및 위 루트 102/102에서 통과했다.

`tools/contracts` 검사 27/27, `git diff --check` 통과. SDK gzip 2667 bytes,
SDK+Sembom gzip 2949 bytes로 유지된다. DBML에 운영용 커서 테이블을 추가하고
0002와 테스트의 마이그레이션 로더·DB 계약 검사 기대값을 갱신했다. OpenAPI·
브라우저 SDK·루트 package scripts·의존성·CI는 변경하지 않았다.

원격 Cron Trigger 등록·배포·D1 적용은 승인한 배포 범위와 리소스 설정이 없어 실행하지
않았다. 장기 적체·처리량·비용은 운영 측정 전이다. 관리자 UI 검사는 이번 서버 정리
변경 범위 밖이므로 반복하지 않았다. 조건과 롤백은
[자동 정리](./docs/backend/retention-cleanup.md)에 기록한다.

## 로컬 프로젝트 등록·권한 관리 CLI — 2026-10-08

`tools/provision`에 init/register/grant/revoke를 구현했다(코드 커밋 `d8019cf`).
Node 24·Miniflare 영속 로컬 D1을 사용하며 기본은 미리보기다. `--apply`로만
반영하고 `--expect-plan`으로 검토한 입력·DB 상태와 일치하는지 확인한다.
시간대·발행 스키마 불변성, 새 버전 증가, 마지막 owner 보호, CAS 충돌 시
원자적 롤백을 검사한다. CLI는 신뢰된 파일시스템 운영자용이며 로그인을 검사하지 않는다.

타입 검사, CLI 관련 테스트 6/6과 루트 `npm run check`의 전체 108/108 통과.
권한 회수 후 조회 목록에서 제외, 두 owner 제거 계획 사이 충돌, 변경 없는 계획의
오래된 스냅샷 거부, 재등록 no-op, 실제 CLI 프로세스의 help/실패 종료 코드와
영속 DB 재실행을 확인했다. `tools/contracts` 검사 27/27 통과.
SDK gzip 2667 bytes, SDK+Sembom gzip 2949 bytes로 3072 bytes 예산 안이다.
`git diff --check` 통과. 설치된 `@types/node` 24.19.1을 개발 의존성 `^24`로
추가하고 CLI를 루트 타입 검사·테스트 러너에 포함했다. 실행 코드·설치 버전은 검사 후
변경하지 않았고 의존성 선언 범위만 같은 메이저로 넓혔다.

OpenAPI·DBML·SQL 마이그레이션·브라우저 SDK·CI 변경은 없다.
권한 문서 `docs/backend/02-authorization.md`에 로컬 운영자와 조회 grant 경계를
명시하고 사용법·복구를 `docs/backend/provisioning.md`에 기록했다.
실제 인증 제공자 사용자·운영 권한·원격 DB·배포·부하는 환경 설정과 승인 범위가 없어
실행하지 않았다. UI 검사는 이번 CLI 범위 밖이므로 반복하지 않았다.
원격 푸시·배포·마이그레이션은 실행하지 않았다.

## 수집기 실행·배포 구성 — 2026-10-08

런타임 코드 커밋 `3eda6ef`: `apps/collector/src/runtime.ts`가 D1·OIDC 환경 설정을
검사하고 같은 설정의 검증기 캐시를 재사용한다. 공통 팩토리·닫힌 기본 export는
유지한다. `collector:dev`는 등록 CLI와 같은 영속 로컬 D1을 열고 초기화 상태를
확인한다. 127.0.0.1에서 구동하고 60초마다 정리를 예약하며 겹친 실행을 막고 종료 시
진행 중 정리·타이머·런타임을 정리한다. 코드·설정 변경 후 재시작이 필요하다.

`npm run check` 통과: Wrangler 생성 타입·공통/호스트 타입 검사, 전체 테스트 111/111,
브라우저 크기 검사. 추가한 config/runtime 검사 3/3은 설정 오류·네트워크 없는 검증,
환경 바인딩을 통한 실제 테스트 서명·401/200·grant 회수 후 403·scheduled 호출,
등록 CLI에서 만든 DB 재사용·초기화 없는 DB 거부·종료 후 리스너 해제를 확인했다.
60초 타이머 자체의 장시간 관측은 반복하지 않았고 정리 호출은 직접 검증했다.

`collector:config`는 입력한 계정·DB ID와 OIDC 설정의 형식을 검사하고 새 파일만 만든다.
원격 요청·리소스 생성·덮어쓰기는 없다. 이후 대상 준비 도구의 타입 검사와 관련 테스트
3/3 통과. 현재 테스트는 114개이며 전체 114개를 다시 돌리지 않았다(전체 111 + 추가 3).
`npm run collector:dev -- --help` 통과. `npm run collector:dry-run`으로 업로드 없이
기본 Worker 번들을 검사했다: 97.63KiB, gzip 24.61KiB. 실제 운영 대상 값이 없어
운영 설정으로 묶음을 만들거나 원격 ID 존재·소유권을 확인하지 않았다.

개발 의존성 `wrangler ^4`(설치 4.148.0)를 추가했다. 검증된 compatibility date
2026-08-06은 유지한다. 루트 타입 검사는 `.tmp`에 플랫폼 타입을 생성하고 별도 호스트
tsconfig로 검사한다. SDK gzip 2667 bytes, SDK+Sembom gzip 2949 bytes로 유지된다.
OpenAPI·DBML·SQL 마이그레이션·브라우저 SDK·CI 변경은 없다. `.wrangler`·`.dev.vars`
무시 규칙을 추가했다. 실행 설정·로그 정책은 `wrangler.jsonc`와
`docs/backend/runtime.md`, 운영 설정 문서는 `docs/ops/config-and-env.md`에 반영했다.
구조화 앱 로그만 켜고 요청 URL을 담는 호출 로그·자동 traces는 프라이버시 계약에 따라
끈다. 플랫폼 자체 로그의 저장·반출은 원격 환경에서 추가로 검토해야 한다.

원격 인증 제공자 연결·D1 마이그레이션·grant 등록·Cron Trigger·배포·부하는 실제
리소스/설정과 승인 범위가 없어 실행하지 않았다. UI 검사는 변경 범위 밖이다.
푸시·배포·원격 리소스 변경은 실행하지 않았다. 계약 검사 27/27,
`git diff --check`, `ssealed update . --yes`·`ssealed doctor . --strict` 통과.

## 검증 이름
스캐폴드 `ssealed update . --yes`, `ssealed doctor . --strict` 통과.
매니페스트의 기존 키 정렬을 유지해 체크섬 갱신만 남겼다.

기존 체크리스트와 연결되는 이름을 유지한다: `format`, `lint`, `typecheck`, `test`, `contract`, `migration-check`, `smoke`, `docs`, `check`.

## 루트 패키지
저장소 루트는 npm workspaces와 Node 24 실행 러너를 쓴다.

```sh
npm ci --ignore-scripts
npm ci --prefix prototypes/admin --ignore-scripts
npm run typecheck
npm test
npm run check
```

- `typecheck`: `tsc --noEmit`로 코어·저장 어댑터·수집기·브라우저 SDK 소스와 `examples/sembom` 예제 소스를 검사한다.
- `test`: `node --test`로 `packages/core`·`packages/storage-d1`·`packages/browser`·`apps/collector` 테스트를 실행한다.
- `test:core`: 코어 테스트만 실행한다. 등록·배치·시간·해시 검증은 통과 상태다.
- `test:browser`: 브라우저 SDK 테스트만 실행한다.
- `build:browser`: esbuild로 `packages/browser/dist/index.js`를 만들고 `tsc -p tsconfig.build.json`으로 타입 선언을 낸다.
- `check:browser-size`: 예제 스키마 투영 일치와 브라우저 번들 크기 예산을 검사한다.
- `check`: `typecheck`·`test`·`check:browser-size`를 순서대로 실행한다.

저장 어댑터 테스트는 Miniflare D1에 `db/migrations/0001_initial.sql`을 적용해 원자적
커밋·CAS 가드·중복·할당량·만료 정리를 확인한다. 수집기 테스트는 esbuild로 번들한
Worker를 Miniflare에서 호출해 HTTP 경계(오리진·본문 한도·CORS·오류 응답·관리자 401)를
확인한다. 테스트는 Node 24와 Miniflare 4의 workerd 바이너리를 쓰며 `compatibilityDate`는
`2026-08-06`이다. 더 새로운 날짜(예: 2026-10-08)는 아직 검증하지 않았다.

2026-10-08 검증: 루트 `npm run check`(실행 당시 typecheck + 테스트 78개)와 별도 `check:browser-size` 통과. 이후 기본 `check`에 크기 검사도 연결했다. 테스트는 기존 58개에 브라우저 SDK 19개와 SDK→Worker→D1 통합 1개를 더한 78개다. `npm run build:browser`와 `npm run check:browser-size` 통과, 크기는 SDK 5747 bytes/gzip 2667 bytes, SDK+Sembom 어댑터·스키마 6628 bytes/gzip 2949 bytes로 3072 bytes 예산 안이다. 개발 전용 계약 검사 `tools/contracts` lint/check 27개 통과, OpenAPI Redocly lint와 타입 검사 통과. `npm ci`는 기존 설치 상태라 이번에 다시 돌리지 않았고 `git diff --check` 통과.

루트 테스트에는 `tools/provision`·`tools/runtime`도 포함한다. 통합 실행 테스트가
관리자 서버를 사용하므로 `prototypes/admin` 의존성은 별도로 설치한다.

## 계약 검사
개발 전용 계약 검사 패키지는 `tools/contracts/`이며 운영 코드와 분리한다.

```sh
npm ci --prefix tools/contracts --ignore-scripts
npm run lint --prefix tools/contracts
npm run check --prefix tools/contracts
```

`lint`는 Redocly의 OpenAPI 3.1 구문·참조 검사다. `check`는 JSON 예시, 잘못된 wire
입력, 예시의 등록/카디널리티/날짜/집계 일치, DBML 파싱과 문서 링크를 검사한다.
수집 상태 머신·DB 트랜잭션·운영 인증·원격 마이그레이션을 실행하지 않는다.

## 브라우저 SDK
`packages/browser`(SDK 본체), `examples/sembom` 예제, 배포 크기 검사는 루트 npm 명령으로 확인한다.

```sh
npm run test:browser
npm run build:browser
npm run check:browser-size
```

- `test:browser`는 결정적 `FakeBrowser` 호스트로 배치 상한·재시도·Retry-After·숨김 전송·`destroy`를 검사하고, 네이티브 어댑터가 `credentials: omit`·`referrerPolicy: no-referrer`·keepalive로 전송하는지 확인한다.
- `apps/collector` 테스트는 Sembom 예제가 여섯 이벤트와 작업 흐름을 Worker→D1로 전달하고 재전송이 duplicate로만 계산되는지 통합 확인한다.
- `check:browser-size`는 `examples/sembom/browser-schema.json`이 `api/examples/registry.json`의 browser 투영과 같은지 검사하고, esbuild 번들에 런타임 임포트나 `packages/core`·`packages/storage-d1`·`apps/collector` 코드가 들어가지 않았는지 확인한 뒤 gzip 예산 3072 bytes를 검사한다. 실측 크기는 위 2026-10-08 기록에 있다.

브라우저 SDK 변경은 API·DB 계약을 바꾸지 않는다. SDK는 네이티브 `sendBeacon`을 쓰지 않고 keepalive fetch로 credentials/referrer를 생략하며, 서버 코어·D1 런타임을 번들에 포함하지 않는다.

## 프로토타입
`prototypes/admin/`에는 `typecheck`·`test`·`build` 명령이 있다. UI smoke와 디자인
비교는 [design-qa.md](./prototypes/admin/design-qa.md)에 기록한다.

2026-10-08 API 연결 모드 검증: `npm run typecheck`, `npm test` 19/19,
`npm run build`, `npm run test:sites` 4/4 통과. 클라이언트는 같은 출처 `/v1`만
조회하고 응답의 프로젝트·버전·기간·이벤트·작업 흐름을 요청과 대조한다. 연결 해제 시
토큰과 데이터를 지우고 헤더 및 본문을 읽는 중인 요청도 취소한다. 최초 테스트 실패
1개는 유효한 빈 프로젝트 목록을 형식 오류로 기대한 테스트를 수정해 해결했다.

로컬 Miniflare D1(5188)과 Vite 프록시(5187), 모킹한 검증기 포트로 브라우저에서
수집 이벤트 3건·시작 1건·성공 1건·완료율 100%, 일별 시계열과 `tool=loan` 버킷,
목표·읽기 전용 설정, 빈/잘못된 버전 입력, 존재하지 않는 버전의 404,
토큰 없는 401, 연결 해제 후 초기화와 재연결을 확인했다. 증명은 로컬 무시 파일
`.tmp/admin-api-d1-local-20261008.jpg`다. 실제 인증 제공자·서명 검증·운영 로그인은
시험하지 않았다. 403·503·응답 계약 오류는 관리자/클라이언트 테스트에서 확인했고
브라우저에서 별도 재현하지 않았다. 편집 중 이전 HMR 실패 로그가 남아 있었지만
최종 타입 검사·빌드와 정상 API 화면을 확인했다.

관리자 JS 번들은 약 653kB(압축 전)로 chunk-size 경고가 남는다. SDK gzip 3KiB
예산과 별개이며 운영 UI의 코드 분할·폰트 최적화는 후속이다. API/DB 계약과 루트
러너·의존성은 이 화면 슬라이스에서 바꾸지 않았고 프로토타입 테스트 명령에 API
클라이언트 검사를 추가했다. 원격 푸시·배포·마이그레이션은 실행하지 않았다.

## 포맷·문서·스캐폴드

2026-10-08 OIDC 로그인 연결 검증: `prototypes/admin`의 `npm run typecheck`,
`npm test` 31/31, `npm run build`, `npm run test:sites` 4/4 통과. 기존 28개에
요청별 현재 bearer 조회·갱신 실패의 고정 401·공유 갱신 대기 중 취소/연결 해제
검증 3개를 추가했다. PKCE 클라이언트 9개는 생성한 키로 ID 서명·state/nonce·
중복 코드 교환·회전 갱신·만료·늦은 응답 취소를 검사한다.

로컬 Vite 5180 브라우저에서 설정 없음, 직접 연결 접기/펼치기, 다른 출처 거부,
실패 콜백 쿼리 제거·대기 종료, 샘플 모드 복귀/재진입을 확인했고 콘솔 오류는
수집되지 않았다. 증거는 `.tmp/admin-oidc-login-20261008.png`다. 실제 제공자
로그인/CORS·운영 access token·운영 배포는 설정이 없어 실행하지 않았다.
전체 접근성 감사와 부하 테스트는 이번 로그인 연결 범위에서 실행하지 않았다.
프로토타입에는 lint 스크립트가 없으며 `git diff --check`를 통과했다.

로그인 코드는 지연 로드 청크 30.65kB/gzip 10.85kB로 분리됐다. 메인 청크는
657.25kB/gzip 191.91kB로 기존 크기 경고가 남는다. API/OpenAPI·DB·루트 러너와
의존성 계약은 이번 화면 연결에서 변경하지 않았다. 설정/보관/갱신 조건은
`docs/backend/oidc.md`, 화면 책임은 `docs/frontend/FRONTEND_DESIGN.md`에 반영했다.
스캐폴드 `ssealed update . --yes`와 `ssealed doctor . --strict`도 통과했다.
원격 푸시·배포·마이그레이션은 실행하지 않았다.

- `format`: `git diff --check`로 공백 오류를 확인한다.
- `docs`: 변경 문서의 상대 Markdown 링크와 계획/구현 상태의 일관성을 확인한다.
- `check`(스캐폴드): 외부 CLI의 `ssealed doctor . --strict`로 상태를 확인한다. 의도적인
  문서 수정은 `ssealed update . --yes`로 인정한 후 확인한다. 파일 내용을 덮어쓰는
  `--force`는 사용하지 않는다.

## 2026-10-08 통합 개발 실행

루트 `npm run check`(타입 검사·116/116 테스트·브라우저 크기 예산), 관리자
`npm run typecheck`·`npm test` 32/32·`npm run build` 통과. supervisor 테스트는
정상 종료·예기치 않은 종료·시작 실패 시 자식 정리를 확인한다. 실제 스택 통합
테스트는 초기화된 로컬 D1, 관리자 페이지·로그인 콜백 SPA, `/v1/projects`의
수집기 401 JSON 응답, 종료 후 양쪽 리스너 해제를 확인했다. 프록시 테스트는
경로·쿼리·헤더 전달, `/auth/callback`·`/v10` 제외와 비루프백 주소 거부를 확인했다.

브라우저에서 5190/5198 스택의 샘플 화면·API 연결 전환·실패 콜백의 SPA 처리와
OIDC 미설정 상태의 직접 연결 화면을 확인했다. 확인용 스택은 종료했다.
관리자 빌드의 기존 청크 크기 경고는 남는다. 실제 OIDC 제공자 로그인·원격
리소스·운영 배포·부하 시험은 설정이 없거나 이번 범위 밖이어서 실행하지 않았다.

API/OpenAPI·DB·의존성 계약은 변경하지 않았다. 루트 `dev` 러너, 관리자 테스트
명령, 로컬 프록시·IPC 종료 처리를 추가했다. 실행 문서는 `docs/backend/runtime.md`,
`DEVELOPMENT.md`, `prototypes/admin/README.md`에 반영했다. 원격 푸시·배포는 하지 않았다.
계약·문서 링크 검사 27/27과 `git diff --check` 통과. 종료 후 5190·5198에
리스너가 남지 않은 것을 확인했다.

## 2026-10-08 브라우저 SDK 측정과 배치 경계 수정

첫 실제 Chrome 실행에서 20개 배치 뒤의 완료 이벤트 저장이 503으로 실패했다.
시작과 완료가 다른 배치에 있는 회귀 테스트 2개가 동일하게 실패하는 것을 확인했다.
SQLite INSERT의 CHECK가 충돌 처리 전에 적용되므로 완료만 있는 증가분을 신규 행으로
넣을 수 없었다. 같은 CAS 가드·원자적 write batch 안에서 유효한 0 집계 행을 준비하고
기존 값에 증가분을 더하도록 수정했다. 스키마·마이그레이션·API 계약은 변경하지 않았다.
수정 후 저장/수집기 테스트 35/35, 루트 타입 검사·브라우저 크기 예산과 JS 구문 검사 통과.

`npm run bench:browser -- --channel chrome --samples 2`로 복구를 확인하고 최종
`--samples 5`를 실행했다. 비활성/활성 5회씩과 실제 수집기 종료 화면 1회를 확인했다.
DB의 이벤트 120건과 시작/성공 각각 55건, 각 화면의 계산 11회·필수 입력 오류·복구,
비활성 수집 0건, 활성 200 응답, 장애 503 재시도와 destroy 이후 중단을 검사했다.
Origin 존재, Cookie·Authorization·Referer 부재와 배치 16KiB 상한도 통과했다.
도구가 소유한 서버·브라우저·임시 DB는 실행 후 정리됐고, 원시 결과는
`.tmp/browser-bench/1791469967935.json`에 남겼다. 수치와 조건은
`docs/engineering/03-performance-budget.md`에 기록했다.

루트에 선택 명령 `bench:browser`, 타입 검사에 측정 도구를 추가했다. Playwright ^1은
`tools/browser-bench` 개발 패키지/lockfile로 분리했고 운영 SDK 번들은 바꾸지 않았다.
새 CI나 기본 테스트 반복을 추가하지 않았다. 기존 서비스·운영 데이터·자격 증명·
원격 리소스를 사용하지 않았다. 실제 서비스/모바일/원격 부하·운영 OIDC는 범위 밖이므로
실행하지 않았다. 전체 CWV/성능 trace 감사도 이 동기 호출 측정 범위에 포함하지 않았다.
문서는 `DEVELOPMENT.md`, `docs/backend/browser-sdk.md`, 성능 예산과 로드맵을 갱신했다.
계약·문서 링크 검사 27/27, 측정 명령 `--help`, `git diff --check` 통과.
푸시·배포는 하지 않았다.

## 2026-10-09 프로젝트 설정 조회·변경 API

`GET /v1/projects/{projectId}`와 owner 전용 `PATCH`를 로컬 구현했다. 이름·상태·
허용 출처·수집 한도를 부분 변경한다. 읽은 설정의 `expectedSettingsHash`를 필수로
받고, 저장 SQL에서 기존 설정과 owner grant를 다시 확인한다. 설정이 바뀌면
`settings_conflict` 409, 권한이 없거나 저장 전에 취소되면 403이다. 이벤트 수집의
revision 증가만으로 설정 저장을 거부하지 않는다. 설정 저장은 수집 guard revision을
늘리며, 기존 데이터·정의 버전·소비한 한도를 유지한다.

`npm run typecheck`, `npm test` 127/127, `npm run check --prefix tools/contracts`
30/30, `npm run lint --prefix tools/contracts`, `npm run check:browser-size`,
`git diff --check` 통과. 새 설정 테스트 9개는 owner 성공·reader 거부·잘못된 인증·
닫힌 입력·본문 상한·동시 수정·저장 직전 권한 취소·수집과 설정 간 충돌·로컬 HTTP
제약을 확인했다. 기존 실제 Worker 런타임 테스트에도 설정 조회·PATCH 저장을 추가했다.
첫 관련 테스트 실행은 일시정지 시 거부 코드의 기대값을 잘못 지정해 17/18이었다.
실제 `project_unavailable` 거부에 맞춰 수정한 뒤 위 전체 테스트를 통과했다.
브라우저 SDK+연동 예제는 gzip 2,949 bytes로 3KiB 예산을 통과했다.

API source of truth `api/openapi.yaml`, 제품 source of truth
`docs/product/02-spec.md`, 관리자·이벤트 계약과 로드맵을 갱신했다. DB 구조·
마이그레이션·의존성·러너·CI 설정은 변경하지 않았다. 운영 인증 제공자·원격 D1·
배포 smoke는 운영 설정이 없어 실행하지 않았다. 관리자 화면의 쓰기 연결과 브라우저
측정·부하 시험은 이번 API 범위 밖이어서 실행하지 않았다. 화면에서는 아직 기존
조회 기능만 사용한다. 저장 응답이 유실되면 현재 설정을 다시 읽어 결과를 확인해야 한다.
원격 푸시·배포·Sembom 연동은 실행하지 않았다.

## 2026-10-09 관리자 설정 화면 저장 연결

설정 응답에 서버가 확인한 owner 권한 표시 `canEdit`를 추가했다. reader는 false이고,
권한 표시는 설정 해시에서 제외하며 PATCH의 저장 시점 권한 검사는 유지한다.
백엔드 타입 검사·관련 설정 테스트 9/9·OpenAPI lint·계약 검사 30/30 통과.

`LiveSettings`와 프로젝트별 `SettingsEditor`를 연결했다. 변경 항목만 저장하고,
reader·저장 중·충돌 검토 중에는 편집을 잠근다. 409·저장 응답 유실·권한 취소에서는
입력을 보존하고 자동 재전송하지 않는다. 최신 값을 읽어 비교한 뒤 서버 값 사용 또는
내 변경 유지 후 재검토를 명시적으로 고른다. 내가 편집하지 않은 항목은 최신 서버 값을
유지한다. 프로젝트 전환·연결 해제·언마운트는 요청을 취소하고 늦은 응답을 무시한다.
설정 편집은 집계 기간이나 선택한 스키마 조회 실패에 의존하지 않는다.

관리자 `npm test` 38/38, `npm run typecheck`, `npm run build`, `npm run test:sites`
4/4 통과. API/모델 테스트 6개를 추가해 PATCH 전송·응답 검사, 부분 저장·중복 submit,
409 후 명시적 재검토, 응답 유실 후 조회 복구, reader/권한 취소, 늦은 저장 응답 취소를
확인했다. 기본 테스트 명령·의존성·러너·CI 설정은 바꾸지 않았다. 기존 메인 청크 크기
경고는 남으며 빌드 시 673.91kB/gzip 196.36kB였다.

127.0.0.1의 Vite와 격리된 Miniflare/D1를 연결해 인앱 브라우저에서 실제 저장 200과
DB 반영을 확인했다. 다른 설정 변경 후 409·초안 보존·비교 표·명시적 재검토를 거쳐
이름만 저장하면서 서버의 분당 한도 55를 유지했다. DB 저장 후 HTTP 응답을 끊어도
초안과 저장 잠금을 유지하고 재조회로 커밋된 결과를 복구했다. owner를 reader로 바꾼
테스트에서도 403 이후 입력을 보존했고, 재조회 후 변경 유지 버튼·폼을 비활성화했다.
스키마 999 조회가 실패한 상태에서도 설정 저장·복구는 동작했다. 빈 이름 오류 시
`settings-name`으로 포커스가 돌아왔고 CSS viewport 320px에서 가로 넘침이 없었다.
화면 증거는 `.tmp/admin-settings-conflict.jpg`와 `.tmp/admin-settings-mobile.jpg`다.
확인은 합성 프로젝트와 검증기 포트로 수행했으며 운영 자격 증명·서비스 데이터는
사용하지 않았다. 임시 API·D1 테스트 서버를 종료한 뒤 5198에 리스너가 없음을 확인했다.
Vite 미리보기 5180만 남겼고, 테스트 프록시 없이 샘플 모드로 전환했다.

변경한 source of truth는 `api/openapi.yaml`, `docs/product/02-spec.md`,
`docs/frontend/FRONTEND_DESIGN.md`이며 관리자 문서·로드맵·검증 기록도 갱신했다.
DB 스키마·마이그레이션·위생 정책은 변경하지 않았다. 문서 6개의 상대 링크 31개와
`git diff --check`, `ssealed update . --yes`·`ssealed doctor . --strict`를 확인하고
스캐폴드 승인 체크섬만 갱신했다.
실제 OIDC 제공자·운영 저장·원격 배포 smoke는 운영 설정이 없어 실행하지 않았다.
전체 접근성 감사·부하 시험은 이번 설정 화면 범위 밖이어서 생략했다.
푸시·배포·Sembom 연동은 실행하지 않았다.

## 2026-10-09 스키마 초안 검증 API

기존 발행 스키마 GET을 유지하고 owner 전용
`POST /v1/projects/{projectId}/schemas/validate`를 추가했다. 이벤트·흐름 배열만 받아
등록과 공유하는 코어 검증기로 검사하고 첫 오류의 JSON pointer·코드를 반환한다.
검증 성공은 개인정보 승인·버전 예약·발행을 뜻하지 않으며 초안을 저장하지 않는다.
인증·owner grant 조회는 본문 읽기 전에 수행하고 reader·다른 프로젝트·권한 회수는
403이다. 본문은 UTF-8 32KiB, 기존 수집·설정 본문은 16KiB를 유지한다.
등록 검증기를 분리하며 문자열이 아닌 이벤트 source를 명시적으로 거부했다.

`npm run typecheck`, 전체 `npm test` 136/136, 계약 검사
`npm run check --prefix tools/contracts` 31/31, OpenAPI lint와
`npm run check:browser-size`(SDK+예제 gzip 2,949 bytes), `git diff --check` 통과.
신규 코어 테스트 3개·수집기 테스트 6개에서 정의/참조/차원/종류 수 제한·권한·본문
상한·닫힌 입력·저장 실패를 확인했다. 기존 Miniflare 실제 Worker 테스트에 검증 API
요청도 추가해 200 응답을 확인했다. DB의 프로젝트·발행 정의·사용량 무변경도 확인했다.
초기 관련 테스트는 DB 응답의 실행 시간 meta까지 비교해 32/33이었고, 실제 행만
비교하도록 수정했다. 초기 계약 검사는 oneOf 배열 type 누락으로 실패했고 수정 후
31/31과 lint를 통과했다.

변경한 source of truth는 `api/openapi.yaml`, `docs/product/02-spec.md`다.
관리자 문서·로드맵·검증 기록을 갱신했다. DB·마이그레이션·의존성·CI·러너·저장소
위생 정책은 변경하지 않았다. 관리자 편집 화면·발행 API는 후속 범위로 남겼다.
UI 변경이 없어 브라우저 UI 검증을 생략했고, 운영 설정이 없어 실제 OIDC 제공자·원격
D1·배포 smoke는 실행하지 않았다. 푸시·배포·Sembom 연동은 실행하지 않았다.

## 2026-10-09 스키마 목록·새 버전 발행 API

`GET /v1/projects/{projectId}/schemas`로 최고 버전과 최신순 메타데이터를 reader/owner에
반환한다. limit 25/최대 100과 배타적 beforeVersion 커서를 사용하고 매 페이지 grant를
확인한다. owner 전용 `PUT /v1/projects/{projectId}/schemas/{schemaVersion}`은
expectedLatestVersion·privacyReviewed=true·events·workflows를 받아 새 active 버전을
발행한다. 프로젝트·기존 정의·집계·수집 사용량은 유지하고 ingest_revision만 1 증가한다.
새 버전 정의로 실제 이벤트 저장이 가능한 것도 확인했다.

owner·최고 번호 조건부 INSERT와 revision 갱신을 같은 원자 D1 batch에서 실행한다.
동시 다른 버전 발행은 한 번만 성공하고 다른 요청은 schema_conflict 409다.
같은 버전·같은 canonical 내용의 재요청은 200과 기존 메타데이터를 반환하고 추가
저장·revision 증가가 없다. 이후 버전이 생기거나 해당 버전이 retired여도 재요청은
기존 상태를 반환하고 재활성화하지 않는다. 저장 직전 권한 회수는 403, revision
오버플로는 삽입까지 rollback하고 503이다. 본문은 33KiB, 정의 자체는 32KiB 상한이다.

`npm run typecheck`, 전체 `npm test` 144/144, 계약 검사 32/32,
OpenAPI lint, `git diff --check` 통과. 신규 발행 테스트 8개와 기존 실제 Miniflare
Worker 테스트를 확장해 발행·재시도·동시 요청·권한 회수·페이지·전송 상한·rollback을
확인했다. 초기 관련 테스트 7/8은 예전 시도 ID를 재사용한 합성 데이터 오류였고 새
시도 ID로 수정했다. 초기 전체 143/144는 기존 테스트의 Allow: GET 기대값이 새
GET, PUT 계약과 달라서 수정했고 최종 144/144를 통과했다.

변경한 source of truth는 `api/openapi.yaml`, `docs/product/02-spec.md`다.
이벤트·관리자 문서와 로드맵을 갱신했다. DB 스키마·마이그레이션·의존성·CI·러너·
저장소 위생 정책은 바꾸지 않았다. UI 변경이 없어 브라우저 UI 검증을 생략했고,
SDK 소스/빌드 경계를 바꾸지 않아 이전 브라우저 크기 검증을 재사용했다.
실제 OIDC 제공자·원격 DB·운영 배포 smoke는 운영 설정이 없어 실행하지 않았다.
스키마 편집 화면은 다음 작업이며 푸시·배포·Sembom 연동은 하지 않았다.

## 2026-10-09 관리자 스키마 API·초안 상태 관리

프로토타입 ApiClient에 버전 목록 GET·초안 검증 POST·버전 발행 PUT과 응답 검증을
추가했다. 발행 응답의 프로젝트·버전·canonical 정의 hash를 요청과 비교한다.
SchemaEditor는 변경 시 검증·개인정보 검토 확인을 취소하고 reader 쓰기를 막는다.
409·403·응답 유실 시 초안을 보존하고 자동 재전송 없이 서버를 재조회한다.
이미 저장된 대상 정의가 제출 내용과 일치할 때만 발행 완료로 확인한다.
프로젝트 생명주기가 끝나면 요청을 중단하고 늦은 응답을 무시한다.

관리자 `npm run typecheck`, `npm test` 45/45, `git diff --check` 통과.
추가한 테스트 7개가 보호된 POST/PUT 전송·변경 후 재검증·충돌 검토·응답 유실 복구·
reader/권한 회수·늦은 응답 취소·잘못된 응답 거부를 확인했다. 관리자 test 명령에
새 테스트 파일을 추가했으며 의존성·CI·API·DB·위생 정책은 변경하지 않았다.
프론트엔드 source of truth `docs/frontend/FRONTEND_DESIGN.md`를 갱신했다.
UI는 다음 슬라이스라 브라우저·빌드 검증을 아직 실행하지 않았다. 운영 인증·
배포·Sembom 연동·푸시는 실행하지 않았다.

## 2026-10-09 관리자 스키마 편집·검증·발행 화면

API 연결 모드의 설정 아래 LiveSchemas를 연결했다. 버전 목록과 이전 버전 조회,
명시적 버전 불러오기, 새 번호·JSON 초안 편집, 서버 검증 오류 pointer·포커스,
개인정보 검토 확인, 검증된 초안 발행을 제공한다. reader textarea는 조회·복사가
가능한 readOnly이며 수정·검증·발행은 잠긴다. 충돌·응답 유실 후 서버 상태를 읽고
최신 정의와 초안을 비교한 뒤 명시적으로 선택한다. 비교는 모바일에서 세로 배치한다.

UI·메시지 변경 후 관리자 전체 테스트를 다시 실행해 45/45 통과했다. 관련 스키마 테스트 7/7,
`npm run typecheck`, `npm run build`, `npm run test:sites` 4/4,
`git diff --check`를 통과했다. 빌드의 기존 메인 청크 크기 경고는 남으며
695.19kB/gzip 201.63kB였다. 일반 lint 명령은 프로젝트에 없어서 실행하지 않았다.

기존 127.0.0.1:5180 Vite에 도구가 소유한 격리된 메모리 Miniflare/D1 수집기를
5188로 연결해 인앱 브라우저에서 오류·실제 v2 발행·409·비교/초안 유지 후 재검증을
확인했다. 저장 후 HTTP 응답을 끊은 v4 발행은 자동 재전송 없이 대상 버전 재조회로
복구했고 초안은 유지됐다. owner를 reader로 바꾼 뒤 readOnly/disabled를 확인했다.
잘못된 초안의 검증 오류에서는 schema-draft로 포커스가 이동했다. 실제 CSS viewport
320px에서 문서 clientWidth와 scrollWidth가 모두 303px로 페이지 가로 넘침이 없었다.
뷰포트 조정은 확인 후 해제했다. 화면 증거는 `.tmp/schema-editor-conflict.png`와
`.tmp/schema-editor-mobile.png`다. 합성 프로젝트와 not-a-credential 검증기 포트만
사용했으며 실제 서비스 데이터·자격 증명은 사용하지 않았다.
테스트 수집기를 종료하고 5188 포트에 리스너가 없음을 확인했다. 브라우저의 테스트
연결도 해제해 메모리 토큰을 지우고 Sample 모드로 복귀했다.

변경한 source of truth는 `docs/frontend/FRONTEND_DESIGN.md`,
`docs/product/02-spec.md`다. 프로토타입 README·로드맵·검증 기록을 갱신했다.
API·DB·마이그레이션·의존성·CI·위생 정책은 변경하지 않았다. 서버/SDK 변경이 없어
백엔드·SDK 크기 검사 결과는 재사용했다. 실제 OIDC 제공자·운영 저장·원격 배포·
전체 접근성 감사는 이번 범위 밖이라 실행하지 않았다. 푸시·배포·Sembom 연동은 없다.

## 2026-10-09 프로젝트 생성 저장·명시적 생성 권한

코어 생성 입력 검증·D1 원자 생성과 0003 마이그레이션을 추가했다. 프로젝트 설정·
최초 owner·불변 생성 요청 해시를 함께 저장한다. 기존 owner에게 생성 권한을 자동으로
주지 않으며 creator-grant/revoke CLI가 issuer/subject별 한도를 관리한다. 생성 이력은
권한 회수 뒤에도 유지한다. 아직 HTTP 생성 경로는 연결하지 않았다.

관련 저장·CLI 테스트 13/13, 루트 타입 검사와 계약 검사 32/32를 통과했다.
동시 생성·개수 한도·설정 변경 후 재요청·서로 다른 생성자·권한 회수·중간 실패 rollback을
실제 로컬 Miniflare D1에서 확인했다. CLI 실행 경로에 생성 권한 미리보기·적용·회수를
추가한 뒤 CLI 테스트 6/6도 통과했다. DBML·제품 명세·마이그레이션/등록 안내를 갱신했다. 의존성·CI·
위생 정책·운영 인증·원격 마이그레이션·푸시·배포·Sembom 연동은 변경/실행하지 않았다.

## 2026-10-09 프로젝트 생성 HTTP API

`POST /v1/projects`를 별도 creator 권한에 연결했다. 본문을 읽기 전에 인증·생성 권한을
확인하고 INSERT에서 권한·개수 한도를 다시 검사한다. ID·이름·IANA 시간대·허용 origin·
명시적 한도만 받으며 owner·status·스키마를 지정할 수 없다. 생성과 최초 owner 부여는
원자적이며 새 프로젝트에는 스키마가 없다. 첫 스키마를 기존 PUT으로 발행할 수 있다.
최초·동일 재요청은 200의 불변 생성 결과이고 설정을 덮어쓰거나 grant를 복원하지 않는다.
ID/원본 내용 충돌과 생성 개수 한도를 서로 다른 409 코드로 반환한다.

루트 `npm run typecheck`, 전체 `npm test` 156/156, 계약 검사 34/34와 OpenAPI lint가
통과했다. 관리자/생성 API 관련 14/14에서 본문·미디어·쿼리·인증·권한·한도·재요청·
첫 스키마 발행을 확인했고 실제 Worker/Miniflare smoke에서 생성·재요청·버전 목록을
확인했다. 전체 테스트 뒤 기존 DB 업그레이드 테스트를 추가했고 관련 저장 테스트 8/8도
통과했다. 추가 테스트를 포함한 전체 157개는 재실행하지 않았다. 업그레이드는 기존
프로젝트·스키마를 보존하고 생성 권한/이력을 backfill하지 않음을 확인했다.

변경한 source of truth는 `api/openapi.yaml`, `docs/product/02-spec.md`다. 앞 슬라이스에서
`db/schema.dbml`·0003 마이그레이션을 추가했고 이번에는 권한·API 정책·이벤트 계약·
로드맵·검증 기록을 맞췄다. `git diff --check`를 통과했다. UI·브라우저 SDK·의존성·CI·
러너·위생 정책은 변경하지 않았다. UI/SDK 변경이 없어 UI 빌드·브라우저 화면·SDK 크기
검사는 재실행하지 않았다. 운영 설정이 없어 실제 OIDC 제공자·원격 0003 적용·배포 smoke는
실행하지 않았다. 푸시·배포·Sembom 연동은 하지 않았고 프로젝트 추가 화면이 다음 단계다.

## 아직 실행하지 않음

## 2026-10-09 프로젝트 생성 클라이언트·상태 관리

관리자 ApiClient에 프로젝트 생성 POST·응답 검증과 project_conflict/project_limit_reached
오류 분류를 추가했다. ProjectCreator는 메모리 입력·동시 제출 차단·명시적 생성 확인·
설정 조회 재시도·취소를 제공한다. 생성 해시는 실제 코어 함수와 비교했다.
관리자 npm test 52/52·typecheck·git diff --check 통과. 새 테스트 7개가 응답 유실·
권한/한도/ID 충돌·잘못된 응답·입력·지연 응답·설정 GET 실패를 확인했다.
frontend 설계를 갱신했으며 프로토타입 test 명령에 해당 테스트만 추가했다.
API·DB·의존성·CI·위생 정책은 변경하지 않았다. UI는 다음 슬라이스라 UI build와
브라우저 검증은 아직 실행하지 않았고 운영 인증·배포·Sembom 연동·푸시는 하지 않았다.

## 아직 실행하지 않음
- 실제 서비스의 SDK 초기 실행 비용·지연·처리량, 모바일·원격 배포
- 서버 발행 수집과 실제 인증 제공자 연결, 운영 관리자 조회 배포(로컬 grant 강제는 관리자 테스트로 확인)
- 원격 D1 마이그레이션과 운영 smoke
- 원격 만료 정리 예약 등록과 운영 Worker·도메인·인증 제공자
- 쓰기 처리량·지연 성능 측정

서술(prose) 테스트는 작성하지 않는다.

## 2026-10-09 프로젝트 추가·스키마·SDK 온보딩 화면

API 연결 도구모음에서 프로젝트 추가 화면을 열고 이름·공개 ID·IANA 시간대·허용 출처와
접힌 수집 한도를 입력한다. 생성 후 목록에 추가·선택하고 설정 화면의 프로젝트 →
스키마 → SDK 안내로 이동한다. 403·ID 충돌은 입력을 보존하고, 응답 유실은 원본 입력을
잠근 뒤 명시적인 같은 요청 확인만 허용한다. SDK 안내는 최신 발행 스키마의 브라우저
정의만 투영하며 수집 서버 출처를 직접 입력받고 관리자 토큰·서버 이벤트를 제외한다.

관리자 `npm test` 53/53, `npm run typecheck`, `npm run build`,
`npm run test:sites` 4/4를 통과했다. URL 오류 문구 보완과 불필요한 방어 분기 제거 뒤
관련 생성·SDK 테스트 8/8을 다시 통과했다. 기존 메인 청크 크기 경고는 남으며
713.10kB/gzip 206.09kB였다. 일반 lint 명령은 없어 실행하지 않았다.

127.0.0.1:5180 관리자와 5188 격리 메모리 Miniflare/D1 수집기를 연결해 인앱 브라우저에서
정상 생성·403 입력 보존·409 ID 포커스·저장 후 응답 유실과 동일 요청 복구를 확인했다.
생성 기록은 ui-created/ui-normal 두 건이며 재확인으로 중복 생성되지 않았다.
첫 스키마를 v2로 검증·발행해 도구모음 버전과 SDK 안내가 v2로 갱신되는 것을 확인했다.
서버 이벤트가 섞인 정의에서는 브라우저 코드에 서버 이벤트가 없었고 코드 복사도 성공했다.
서버 이벤트만 있는 초안은 기존 서버 검증이 /events 오류로 거부했다.
실제 CSS viewport 320px에서 문서 clientWidth/scrollWidth는 모두 303px로 생성 폼의
페이지 가로 넘침이 없었다. 임시 뷰포트 설정은 해제했다. 화면 증거는
`.tmp/project-create-sdk.png`, `.tmp/project-create-mobile.png`, `.tmp/project-created.png`다.

테스트 연결을 해제하고 Sample 모드로 복귀했다. 테스트 수집기를 종료하고 5188 포트에
리스너가 없음을 확인했다. 합성 데이터와 not-a-credential 검증기 포트만 사용했다.
API·DB·마이그레이션·의존성·CI·러너·위생 정책은 변경하지 않았다.
변경한 source of truth는 `docs/frontend/FRONTEND_DESIGN.md`, `docs/product/02-spec.md`이며
프로토타입 README와 로드맵도 갱신했다. `git diff --check`를 통과했다.
백엔드·브라우저 SDK 소스는 바뀌지 않아 해당
검증과 SDK 크기 측정은 반복하지 않았다. 실제 OIDC 제공자·운영 DB·원격 배포·전체 접근성
감사는 이번 범위 밖이며 실행하지 않았다. Sembom 연동·푸시·배포는 하지 않았다.

## 2026-10-09 관리자 이벤트 기본 정보 편집 폼

설정의 스키마 섹션에 이벤트 추가·삭제·이름·표시 이름·발행 출처 폼을 연결했다.
폼과 접힌 JSON 직접 편집은 SchemaEditor 초안 하나를 공유하고, 변경 시 검증과
개인정보 검토 확인을 취소한다. 이벤트 속성·작업 흐름·추가 키를 그대로 보존한다.
연결된 작업 흐름의 이름 참조를 끊지 않도록 해당 이벤트의 이름·출처·삭제는 잠그고
표시 이름만 수정한다. 표현 불가·잘못된 JSON은 대체하지 않고 직접 편집으로 안내한다.
속성·작업 흐름 폼은 다음 슬라이스다.

관리자 `npm test` 57/57, `npm run typecheck`, `npm run build`,
`npm run test:sites` 4/4를 통과했다. 폼 보존·참조 보호·한도·오류 초점·검증 무효화와
reader/충돌 잠금 테스트를 추가했다. 충돌 상태의 폼 편집 차단 검증을 보강한 뒤
관련 스키마 테스트 11/11을 재실행했다. 다른 입력이 바뀌지 않은 테스트는 재사용했다.
기존 메인 청크 크기 경고는 남으며 720.22kB/gzip 207.86kB다.

5180 관리자와 5188 격리 메모리 수집기를 연결해 인앱 브라우저에서 기존 스키마를
폼으로 읽고, 작업 흐름 참조 보호·추가/삭제 후 포커스·속성/흐름 보존·JSON 동기화를
확인했다. 폼으로 새 이벤트를 추가해 v2를 발행하고 다시 불러왔다. 폼 변경 후 이전
개인정보 확인만으로 발행할 수 없음을 확인했다. 중복 이름 오류는 해당 폼 입력으로,
속성 오류는 JSON을 펼쳐 textarea로 포커스가 이동했다. 잘못된 JSON `{`도 그대로
보존됐다. 빈 프로젝트에서 첫 이벤트를 추가하고 마지막 이벤트 삭제 후 추가 버튼으로
포커스가 이동함을 확인한 뒤 폼으로 첫 v1을 발행했다. reader 검증기에서는 폼의 이름·
표시 이름이 readOnly이며 출처·추가·삭제·검증 버튼이 disabled였다.
실제 CSS viewport 320px에서 문서 clientWidth/scrollWidth가 모두 303px로 가로 넘침이
없었다. 임시 뷰포트는 해제했다. 화면 증거는 `.tmp/event-form.png`,
`.tmp/event-form-mobile.png`다. 테스트 연결을 해제하고 Sample로 복귀했으며 격리
수집기를 종료해 5188에 리스너가 없음을 확인했다.

`docs/frontend/FRONTEND_DESIGN.md`·`docs/product/02-spec.md`와 로드맵·README를 갱신했다.
API·DB·마이그레이션·의존성·CI·러너·위생 정책은 변경하지 않았다. 테스트 명령도 기존
파일에 테스트를 추가해 유지했다. lint 명령은 없고, 운영 인증·운영 DB·원격 배포·전체
접근성 감사는 범위 밖이라 실행하지 않았다. 백엔드·SDK 소스가 바뀌지 않아 해당 검증과
SDK 크기 검사는 재사용했다. 푸시·배포·Sembom 연동은 하지 않았다.

## 2026-10-09 이벤트 속성 편집 폼

각 이벤트의 접힌 속성 폼에서 추가·삭제·이름·자료형·필수 여부·수집 목적과 선택값·정수
범위를 편집한다. 이벤트마다 최대 4개 속성, 속성별 32종·이벤트 조합 256개 규칙을 안내한다.
자료형 전환은 이전 자료형의 전용 필드만 대체하며 목적·필수 여부·추가 키를 보존한다.
중복 이름은 다른 속성을 덮어쓰지 않고 거부한다. 빈 정수 칸·불완전 숫자·중복 선택값을
자동으로 수정하지 않고 초안에 남긴다. 작업 흐름의 dimensions 속성은 목적만 수정한다.
폼 변경은 기존 초안·승인 무효화·권한·충돌 잠금을 공유하며 미지원 정의는 JSON으로 안내한다.

관리자 `npm test` 62/62, `npm run typecheck`, `npm run build`,
`npm run test:sites` 4/4를 통과했다. 5개 속성 테스트는 보존·중복 이름·자료형 전환·
숫자/선택값 원문·dimension 잠금·한도·실제 코어 검증·발행 승인 무효화를 확인한다.
브라우저에서 확인한 실제 조합 오류 pointer(`/events/0/properties`)의 초점을 보완한 뒤
관련 스키마 테스트 16/16을 다시 통과했다. 변경 없는 나머지 테스트 결과는 재사용했다.
기존 메인 청크 크기 경고는 남으며 730.97kB/gzip 210.81kB다.

5180 관리자와 5188 격리 메모리 수집기를 연결해 브라우저에서 속성 추가·삭제 포커스,
dimension 이름/자료형/허용값 잠금과 목적 편집, 중복 속성 이름 거부를 확인했다.
빈 최솟값은 문자열 그대로 초안에 남고 해당 입력으로 오류 초점이 이동했다. 선택값 중복도
초안에 그대로 남고 허용값 textarea로 초점이 이동했다. 조합 수 초과는 속성 폼의 안내로
초점이 이동했다. 수정 후 재검증·개인정보 확인을 거쳐 속성을 포함한 v2를 실제 발행했다.
수집 목적을 바꾸면 이전 승인만으로 발행할 수 없음을 확인했다. reader는 이름·목적·허용값이
readOnly이고 자료형·추가·삭제는 disabled였다. 실제 CSS viewport 320px에서 문서
clientWidth/scrollWidth가 모두 303px로 가로 넘침이 없었고 뷰포트 설정은 해제했다.
화면 증거는 `.tmp/property-form.png`, `.tmp/property-form-mobile.png`다.
연결을 해제하고 Sample로 복귀했으며 격리 수집기 종료 후 5188 리스너 0개를 확인했다.

`docs/frontend/FRONTEND_DESIGN.md`·`docs/product/02-spec.md`와 로드맵·README를 갱신했다.
API·DB·마이그레이션·의존성·CI·러너·위생·테스트 명령은 변경하지 않았다.
lint 명령은 없고, 운영 인증·DB·배포와 전체 접근성 감사는 범위 밖이라 실행하지 않았다.
백엔드·SDK 소스가 바뀌지 않아 해당 검사와 SDK 크기 결과는 재사용했다.
푸시·배포·Sembom 연동은 하지 않았다. 작업 흐름 폼은 다음 단계다.

## 2026-10-09 작업 흐름 편집 폼

설정의 이벤트 폼 아래에 작업 흐름 추가·삭제·ID·표시 이름·시작·성공·실패 이벤트와
비교 기준 속성 폼을 연결했다. browser 이벤트만 선택하며 null 실패와 빈 문자열을
구분한다. 흐름 최대 10개, 비교 기준 최대 4개 규칙을 안내하고 단계 중복·필수 속성
자료형/허용 값 불일치는 실시간 경고로 표시한다. 최종 검증은 기존 서버가 수행한다.
폼과 JSON은 같은 초안을 공유하며 변경 시 검증·개인정보 확인을 초기화한다. 미지원
구조·추가 키·미완성 선택은 자동 수정하지 않는다. 중복 ID는 덮어쓰지 않고 거부한다.

관리자 npm test 67/67(스키마 관련 21/21), npm run typecheck, npm run build,
npm run test:sites 4/4를 통과했다. 새 테스트 5개는 보존·중복 ID·단계 참조/중복·
비교 기준 일치·이벤트/속성 잠금 갱신·한도·초점 대상·실제 코어 검증·승인 초기화와
reader/review/more 잠금을 확인한다. 실패 select 예약 값과 원문 문자열의 충돌을
보완한 뒤 타입 검사와 빌드를 다시 통과했다. 변경 없는 테스트 결과는 재사용했다.
기존 메인 청크 경고는 남으며 최종 743.14kB/gzip 213.39kB다.

5180 관리자와 5188 격리 메모리 Miniflare/D1 수집기를 연결해 브라우저에서 흐름 추가·
삭제 후 초점 이동, 중복 ID 거부, 중복 단계 서버 오류의 select 초점, 비교 기준 불일치
경고와 서버 오류의 비교 기준 그룹 초점을 확인했다. 비교 기준 해제 후 해당 속성 잠금이
풀렸고, 편집 후 개인정보 확인과 발행 가능 상태가 초기화됐다. 두 흐름과 선택한 실패
이벤트를 포함한 v2를 검증·발행·다시 불러와 확인했다. reader에서는 ID·표시 이름이
readOnly, 단계 선택·비교 기준·추가·삭제가 disabled였다. 실제 CSS viewport 320px에서
문서 clientWidth/scrollWidth는 모두 303px였다. 뷰포트 설정을 해제했다. 화면 증거는
.tmp/workflow-form.png와 .tmp/workflow-form-mobile.png다. 테스트 연결을 끊고 Sample로
복귀했으며 수집기를 종료해 5188 리스너 0개를 확인했다. 합성 정의와 기존 테스트 검증기만
사용했다. 브라우저 제어 일부 입력 지연은 기본 브라우저 API로 확인을 마쳤다.

source of truth인 docs/frontend/FRONTEND_DESIGN.md·docs/product/02-spec.md와
로드맵·프로토타입 README·이 검증 기록을 갱신했다. API·DB·마이그레이션·의존성·
CI·러너·위생 정책·테스트 명령 변경은 없다. git diff --check를 통과했다.
lint 명령은 없어 생략했다. 백엔드·SDK 소스가 바뀌지 않아 해당 검사와 SDK 크기 검사는
반복하지 않았다. 실제 운영 인증·DB·배포·전체 접근성 감사는 범위 밖이라 실행하지 않았다.
푸시·배포·Sembom 연동은 하지 않았다.

## 2026-10-09 이벤트 속성별 분석

API 연결 모드에서 groupBy 직접 입력을 선택한 이벤트의 등록 속성 목록으로 바꿨다.
속성 값별 기간 합계·비중과 선택한 값 하나의 일별 추이·수치 표를 연결했다. 비중은
선택한 이벤트의 전체 건수가 분모이며, 표시값은 소수점 한 자리로 반올림한다.
null·false·숫자 0을 구분하고 분모가 없으면 비중을 알 수 없음으로 표시한다.
프로젝트·스키마 버전·이벤트가 바뀌면 분류 기준을 해제한다. 등록되지 않은 속성은
요청하지 않고, 응답 키와 요청 취소로 이전 조건의 데이터가 현재 화면에 섞이지 않게 한다.
응답의 전체 날짜·버킷 중복·정의에 맞는 값·안전 정수·일별/전체 합계를 확인한 뒤 표시한다.

관리자 npm test 70/70, npm run typecheck, npm run build, npm run test:sites 4/4와
git diff --check를 통과했다. 새 테스트 3개는 선택 범위 격리, 합계·비중·일별 값과
null/false/0 구분, 누락·중복·잘못된 값/합계 거부를 확인한다. 관련 client 테스트는
26/26이다. 선택 컴포넌트의 표시를 보완한 뒤 타입 검사와 빌드를 다시 통과했다.
변경 없는 테스트 결과는 재사용했다. 메인 청크 748.38kB/gzip 215.08kB로 기존
500kB 청크 경고는 남는다.

5180 관리자와 5188 격리 메모리 Miniflare/D1 수집기를 reader 검증기로 연결했다.
합성 tool_view 27건의 loan 12·grade 10·timer 5와 44.4%·37.0%·18.5%, 합계100.0%를
확인했다. 값 선택과 Enter 키 조작으로 일별 그래프·수치가 바뀌었으며 grade는 전날10건,
다른 날짜0건이었다. 이벤트 전환 시 분류 기준이 해제되고 error 속성의 값 없음3/6=50.0%를
확인했다. v2에서는 tool_view의 flag만 선택 가능하고 데이터가 없어 알 수 없음으로 표시했다.
잘못된 테스트 dimension_key로 수집기가503을 반환했을 때 기존 결과/0으로 위장하지 않고
오류를 표시했다. 테스트 키를 코어 dimensionKey 형식으로 수정한 뒤 재조회가 성공했다.
실제 CSS viewport320px에서 문서 clientWidth/scrollWidth는 모두303px, 선택 목록 너비는
221.33px였다. 뷰포트 설정을 해제하고 연결을 끊어 Sample로 복귀했다. 테스트 수집기 종료
후5188 리스너0개를 확인했다. 화면 증거는 .tmp/event-property-analysis.png와
.tmp/event-property-analysis-mobile.png다. 실제 Sembom 서비스 데이터나 설정은 사용하지 않았다.

source of truth인 docs/frontend/FRONTEND_DESIGN.md·docs/product/02-spec.md와 로드맵·
프로토타입 README·이 검증 기록을 갱신했다. API·DB·마이그레이션·의존성·CI·러너·
위생 정책·테스트 명령 변경은 없다. lint는 명령이 없어 생략했고, 백엔드·SDK 검증과
SDK 크기 검사는 해당 소스가 바뀌지 않아 반복하지 않았다. 운영 인증·DB·배포·전체
접근성 감사는 이번 범위 밖이다. 푸시·배포·Sembom 연동은 하지 않았다.

## 2026-10-10 직전 기간 비교

관리자 API 연결 모드의 개요·이벤트 분석·목표에 선택적인 직전 기간 비교를 추가했다.
프로젝트 시간대의 최근 7·14·30일(오늘 포함)과 바로 앞 같은 일수를 같은 스키마로
조회한다. 기존 summary·workflow daily를 각 기간별로 호출해 31일 한도를 지킨다.
기본은 꺼짐이며 켰을 때만 이전 기간 요청을 추가한다. 현재·이전 응답의 메타·등록
이벤트·중복·안전 정수·일별 날짜·합계·완료율 일관성을 검사하고, 조회 키와 취소로
조건이 다른 데이터 혼입을 막는다. 비교 실패는 현재 결과와 분리해 재시도한다.

관리자 npm test 73/73, npm run typecheck, npm run build, npm run test:sites 4/4를
통과했다. 새 테스트 3개는 월·연도·윤년 경계의 동일 길이, 0건·null 완료율 처리,
누락·중복·잘못된 합계·날짜·시간대·흐름 응답 거부, 기존 API·버전·취소 신호 전달과
실패·취소 전파를 확인한다. 메인 청크 754.73kB/gzip 216.87kB로 기존 500kB 경고는
남는다. UI·문서 초안은 지정 DeepSeek 4.1 Flash high의 문구를 검토해 반영했다.

기존 5180 관리자와 5188 격리 메모리 Miniflare/D1 테스트 수집기를 reader로 연결했다.
7일 비교에서 이벤트 69/16=+331.3%, 시작20/10=+100.0%, 성공16/6=+166.7%,
완료율80%/60%=+20.0%p를 확인했다. 이전 기간 요청만503으로 실패시켜 현재
69·20·16·80%가 유지되는 것을 확인하고 비교 재시도로 복구했다. 30일 이전0건은
증감률 계산 불가, null 완료율은 비교 불가였다. 14일/v2로 바꾼 뒤0건·null 결과가
표시돼 v1의 수치가 남지 않았다. 이벤트별 비교 표와 목표별 비교, 비교 해제 시 표 제거도 확인했다. 오늘 집계 중과 확정 전
코호트 안내, 키보드 접근 가능한 표의 내부 가로 스크롤을 확인했다.
모바일 너비320px 설정을 요청했지만 이 브라우저는 실제 innerWidth356px,
문서 clientWidth/scrollWidth339px로 렌더링했다. 실제339px에서 본문 가로 넘침은
없었으며 정확한320px 확인으로 기록하지 않는다. 화면 증거는 .tmp/period-comparison-mobile.png다.

테스트 연결을 끊고 Sample로 복귀했으며 뷰포트 설정을 해제했다. 테스트 수집기를 종료해5188 리스너0개를 확인했다. 제품 명세·프론트엔드 설계(source of truth)와 로드맵·프로토타입 README를 갱신했다.
API·DB·마이그레이션·SDK·의존성·위생 정책·CI·러너·테스트 명령 변경은 없다.
lint 명령은 없어 생략했다. 백엔드·SDK 검증은 소스가 바뀌지 않아 반복하지 않았고,
운영 인증·DB·배포·전체 접근성 감사는 범위 밖이다. 푸시·배포·Sembom 연동은 없다.

## 2026-10-10 CSV 내보내기

관리자 API 연결 모드의 개요·이벤트 분석·목표에 CSV 내려받기를 추가했다.
현재 조회 키에 묶인 검증 데이터만 클릭 시 내보내고 추가 조회는 하지 않는다.
기간·스키마·시간대·검색·선택 이벤트·분류 조건을 각 행에 기록한다. 현재/직전/비교와
합계/일별/속성/흐름/비교 지표를 구분하고 화면과 CSV가 같은 비교 행 생성기를 쓴다.
숫자 원값과 null/false/0/문자열 타입을 구분하며 지원하지 않는 서버 집계와 계산
불가 값을0으로 채우지 않는다. 활성 비교나 선택 상세가 미완료/오류면 잠근다.
UTF-8 BOM·CRLF·따옴표 이스케이프를 적용하고 위험한 시작 문자의 텍스트에
작은따옴표를 추가한다. 숫자 음수는 원값으로 둔다. 링크와 Blob URL은 정리한다.

관리자 npm test 77/77, npm run typecheck, npm run build, npm run test:sites 4/4,
git diff --check를 통과했다. CSV 테스트4개는 한글/쉼표/따옴표/줄바꿈/수식 시작
문자·전각 문자, 0/null/false와 음수, 고정 열/파일명/조회 메타, 검색 조건/모든 관찰
속성 값/일별 행, 활성 비교/흐름 수치와 미지원/빈 값, 오래된 프로젝트·버전·시간대·
범위·출처·coverage·그룹 응답의 거부를 확인한다. 메타 검사 보완 뒤 테스트·타입·빌드를
재검증했고 변경 없는 Sites 검사 결과는 재사용했다. 메인 청크760.45kB/gzip218.99kB로
기존500kB 경고는 남는다. 지정 DeepSeek 4.1 Flash high 문구 초안을 검토해 반영했다.

기존5180 관리자와5188 격리 메모리 Miniflare/D1 수집기를 reader로 연결했다.
목표 CSV22행과 검색tool/선택tool_view/분류tool의 이벤트 CSV43행을 실제 다운로드했다.
파일의 EF-BB-BF BOM, 같은 프로젝트·버전·날짜·검색·분류, 비교69/16과331.25%,
80/60과20 percentage_point, 속성loan12·grade10·timer5와 비중을 Import-Csv로 확인했다.
CDP에서 다운로드 전후 새 Network.requestWillBeSent 이벤트가0개였다. 비교 조회만503으로
실패시켰을 때 버튼이 잠겼고 비교를 끄면 풀렸다. 잘못된 스키마에서도 잠겼다.
화면 증거는 .tmp/csv-export.png다. 테스트 연결을 끊고 Sample로 복귀했으며 수집기를
종료했다. 실제 서비스 데이터·인증·Sembom 설치·연동은 사용하지 않았다.

제품 명세 docs/product/02-spec.md와 프론트엔드 설계 docs/frontend/FRONTEND_DESIGN.md
(source of truth), 로드맵·프로토타입 README를 갱신했다. API·DB·마이그레이션·SDK·
의존성·위생 정책·CI·러너·테스트 명령 변경은 없다. lint는 명령이 없어 생략했다.
백엔드/SDK 검증은 해당 소스가 바뀌지 않아 반복하지 않았고 운영 배포·전체 접근성 감사·
스프레드시트 앱에서 재저장/재열기는 범위 밖이라 미검증이다. CSV 수식 방어가 모든 앱과
재저장까지 보편적으로 보장되지는 않으며 참고 근거는 프론트엔드 설계에 기록했다.
푸시·배포·Sembom 연동은 하지 않았다.

## 2026-10-10 작업 흐름 속성별 조회 API

GET /v1/projects/{projectId}/workflows/{workflowId}/breakdown?groupBy={dimension}을 추가했다.
등록된 필수 workflow.dimensions 한 속성의 시작 시점 차원 키를 사용하고 같은 값의
다른 차원 조합을 합산한다. 응답 summary와 최대32개 typed bucket별 summary·31일
days를 제공한다. 성공/시작으로 완료율을 계산하며0시도는 null, 빈 결과는 buckets=[]다.
기존 daily 응답과 DB는 그대로다. 기존 reader/owner grant를 정의·집계와 같은 D1 batch
에서 다시 검사한다. 원본7936행 상한을 넘거나 차원/집계가 손상되면503으로 실패한다.

관리자 API 테스트12/12(실제 Worker/D1 runtime 포함)를 통과했다. 이후 다른 차원 합산/
실패 수 유지 테스트를 추가하고 관련5/5를 통과했다. 변경 없는 나머지 관리자 테스트는
재사용했다. 코어·D1 저장·수집기 회귀72/72와 루트 npm run typecheck를 통과했다.
OpenAPI는 처음 시도한 Node yaml/Python yaml 모듈이 없어 해당 명령은 실패했으나
설치된 Bun.YAML.parse로 새 경로/스키마를 확인했다. git diff --check를 통과했다.
새 OpenAPI 응답 예제와 관리자 API 문서·제품 명세를 갱신했다. 프론트 연결은 다음 커밋이다.

API 계약(OpenAPI)과 core QueryKind를 확장했다. DB·마이그레이션·SDK·의존성·위생·
CI·러너는 변경하지 않았다. lint 명령은 없어 생략했다. 운영 인증/원격 DB/배포는
범위 밖이라 실행하지 않았다. 푸시·배포·Sembom 연동은 없다.

## 2026-10-10 작업 흐름 속성별 완료율 화면·CSV

관리자 API 연결 모드의 목표에 등록된 시작 시점 비교 속성 선택과 값별 시작·성공·
실패·대기·완료율·선택 값의 일별 내역을 연결했다. 기본은 분류 안 함이며 선택 때만
조회한다. 메타·등록 값·자료형·중복·일별 날짜/합계·버킷 합계·성공/시작 완료율을
검사한다. 전체 목표와 속성 응답은 조회 시각이 다를 수 있어 값을 억지로 맞추지 않는다.
부모의 조회 키와 취소로 조건이 다른 응답을 버리고 오류는 전체 목표와 분리한다.
CSV는 workflow_property_summary/total/day 행으로 선택 분류·모든 값·일별 수치를
보존하고 빈 결과의 분류도 summary 행에 남긴다. 오류/미완료 분류에서는 CSV를 잠근다.
속성별 직전 기간 비교는 아직 없다.

관리자 npm test81/81, npm run typecheck, npm run build, npm run test:sites4/4,
git diff --check를 통과했다. 새로운4개 테스트는 weighted 완료율·false/0·빈 결과,
메타/정의/값/날짜/중복/합계/정밀도/완료율 오류 거부, CSV의 모든 값/일별/빈 분류와
오래된 응답 거부, 새로운 API 전송과 echo/자료형 검증을 확인한다. 초기 신호 identity/
완료 후 취소 가정이 실제 클라이언트의 조합 신호·리스너 정리와 달라 테스트가 실패했다.
기존 취소 테스트는 유지하고 새 전송 테스트의 잘못된 가정을 수정해81/81을 통과했다.
변경 없는 타입·빌드·Sites 결과는 재사용했다. 메인 청크769.38kB/gzip221.00kB로
기존500kB 경고는 남는다. 지정 DeepSeek4.1 Flash high 문구 초안을 검토해 반영했다.

기존5180 관리자와5188 격리 메모리 Miniflare/D1 수집기를 reader로 연결했다.
loan20/16=80%, grade3/1=33.3%, timer2/0=0%와 전체17/25=68%를 확인했다.
grade 값 버튼으로7일 내역을 열어0시도 날짜의 완료율—와 집계 중 표시를 확인했다.
실제 CSV 다운로드 후 Import-Csv로 세 값의 수치·tool 분류와21개 일별 행을 확인했다.
속성 조회만503으로 실패시켜 전체68%는 유지되고 CSV는 잠기는 것을 확인했다.
별도 재시도로 복구해 CSV가 풀렸고 스키마v2 전환 시 분류가 해제되고 이전 값 표가
사라졌다. v2의 빈 분류 결과는 관찰 값 없음으로 표시되고 CSV는 활성화됐다.
화면 증거는 .tmp/workflow-property-analysis.png다. 연결을 끊고 Sample로 복귀했으며
테스트 수집기를 종료했다. 실제 Sembom 데이터/인증/설치는 사용하지 않았다.

제품 명세 docs/product/02-spec.md와 프론트엔드 설계 docs/frontend/FRONTEND_DESIGN.md
(source of truth), 로드맵·프로토타입 README를 갱신했다. 이전 커밋의 API 확장을
소비하고 이 커밋은 API·DB·마이그레이션·SDK·의존성·위생·CI·러너를 바꾸지 않는다.
관리자 test 명령은 src/api/*.test.mjs를 검색하도록 바꿔 새 테스트를 포함한다.
lint는 명령이 없어 생략했다. 백엔드는 이전 커밋에서 검증한 결과를 재사용했고,
운영 인증·원격 DB·배포·전체 접근성 감사는 범위 밖이다. 푸시·배포·Sembom 연동은 없다.

## 2026-10-10 수집 상태 진단

API 연결 설정 상단에 읽기 전용 진단을 추가했다. 기존 설정/스키마를 병렬 조회하고
선택 스키마를 읽은 뒤 프로젝트-local 오늘 요약을 조회한다. 프로젝트 전체 마지막
신규 수신과 오늘의 선택 스키마 browser 건수, 일시정지/중지 스키마와 설정 한도를
구분한다. 한도 사용량/잔여량·거부 이력은 만들지 않고 확인 순서를 별도로 제공한다.
서비스 주소는 탭 안에서 정확한 출처 목록과 비교하며 보내거나 저장하지 않는다.
각 조회의 부분 실패는 확인 불가, null 수신만 기록 없음으로 표시한다. 설정 저장과
프로젝트/버전 변경·명시적 갱신에 반응하며 자동 폴링/시험 이벤트는 없다. 키와 취소로
오래된 응답을 버리고 독립 조회를 원자 스냅샷으로 취급하지 않는다.

관리자 npm test 86/86, npm run typecheck, npm run build, npm run test:sites 4/4,
git diff --check를 통과했다. 새 테스트5개는 프로젝트-local 날짜·null/0·paused/retired,
부분 실패와 스키마 실패의 종속 조회 차단, 다른 프로젝트/버전/날짜/시간대·잘못된
시각/정의/합계/안전 정수 거부, 취소, 프로토콜/호스트/포트·경로·로그인 정보의 출처
판정을 검증한다. 최종 reader 안내 문구 변경 뒤 타입/빌드를 재검증했고 변경 없는
모델 테스트·Sites 결과는 재사용했다. 메인 청크778.29kB/gzip223.25kB이며 기존500kB
경고는 남는다. 지정 DeepSeek4.1 Flash high의 문서 초안을 검토해 반영했다. 앞선
두 초안은 출력 한도로 실용적 내용이 없어 사용하지 않았고 짧은 요청으로 다시 받았다.

기존5180 관리자에5188 격리 메모리 Miniflare/D1 reader로 연결했다. 시드된 오늘13건·
120회/100000건 한도와 신규 수신 기록 없음을 확인했다. 로컬 테스트 DB에서만 수신
시각·paused·retired 상태를 바꾸고 진단을 새로고침해 시각과 두 상태 안내를 확인했다.
이는 실제 수집 전송 테스트가 아닌 표시 검증이다. 출처 허용/불허, 없는v999의 조회
실패와 확인 불가 표시, v1 복귀의 복구를 확인했다. reader에게 소유자 요청 안내가
나오는 것도 확인했으며 콘솔 오류는 없었다. 증거는 .tmp/collection-diagnostics.png다.
연결을 끊어 Sample로 복귀했고 테스트 수집기를 종료해5188 리스너0개를 확인했다.

제품 명세 docs/product/02-spec.md와 프론트엔드 설계 docs/frontend/FRONTEND_DESIGN.md
(source of truth), 로드맵·프로토타입 README·이 검증 기록을 갱신했다. API·DB·마이그레이션·
SDK·의존성·위생 정책·CI·러너·검증 명령 변경은 없다. lint는 명령이 없어 생략했다.
백엔드/SDK 소스가 바뀌지 않아 해당 검증은 반복하지 않았다. 실제 운영 인증/원격 DB/
배포·전체 접근성 감사·모바일 실측·실제 거부 이력은 미검증이다. 푸시·배포·Sembom
연동은 하지 않았다.

## 2026-10-10 거부 원인 집계 저장 단계

기존 admission 카운터에 2KiB 이내 고정 원인별 count/lastRejectedAt JSON을 추가하는
0004 마이그레이션과 저장/조회 어댑터를 구현했다. 분당 초과는 admission SQL 한 개에
같이 반영하고 다른 원인은 기존 분의 단일 업데이트로 기록한다. 기록된 분만 최근
7개 UTC 날짜에 보존하며 기록 없는 분의 기존 2분 정리·호출당 삭제 한도를 유지한다.
조회는 UTC 수신일 기준이며 프로젝트 reader/owner grant를 같은 D1 batch에서 검사한다.
최대 10080분을 읽고 JSON/원인/시각/안전 정수/합계를 검사한다. 저장은 개인정보를
포함하지 않고 과거 거부를 채우지 않는다. HTTP 수집/조회 연결은 다음 커밋이다.

저장/기존 수집/등록 관련 테스트 첫 실행 28개 중 기존 23개와 신규 4개를 통과했고,
신규 집계 응답 테스트가 실패했다. closed 검증기의 필수/선택 키 사용을 수정한 뒤
신규 5/5를 통과했다. 변경 없는 기존 23개 결과는 재사용했다. 루트 npm run typecheck,
git diff --check를 통과했다. 실제 Miniflare에서 기존 카운터 보존·마이그레이션 preview/
apply/재실행과 새 DB 초기화, 분당 초과 SQL 1개 유지, 권한/다른 프로젝트 격리·UTC
날짜·빈 값·데이터 오류 거부·7일 보존과 삭제 한도를 확인했다. 지정 DeepSeek4.1 Flash
high의 문서 초안을 검토해 반영했다.

DB source of truth schema.dbml·0004 SQL·마이그레이션 설명·수집/정리 문서·이 기록을
갱신했다. API HTTP 계약·SDK·의존성·위생 정책·CI·러너·검증 명령은 변경하지 않는다.
로컬 초기화의 additive-column 감지를 확장했다. lint 명령은 없어 생략했고 HTTP/Worker
연결 검증은 다음 단계다. 원격 DB·운영 부하·배포는 미검증이며 푸시·배포·Sembom 연동은 없다.

## 2026-10-10 거부 원인 수집·관리자 조회 연결

GET /v1/projects/{projectId}/collection/rejections?from={UTC-date}&to={UTC-date}를 연결했다.
reader/owner는 스키마가 없거나 중지된 프로젝트도 조회하며 from/to는 오늘을 포함한
최근 7개 UTC 날짜 안에서 필수다. meta는 UTC/receivedAt/retentionDays=7/coverage=
best-effort, 전체 summary와 모든 날짜의 days, 고정 10개 reason/count/lastRejectedAt
버킷을 반환한다. 기록 수가0이면 시각은 null이고 날짜/권한/저장 손상 실패를0으로
채우지 않는다. 분당/일일 quota_exceeded는 minute_limit/daily_limit로 구분한다.

실제 수집기에서 admission 통과 뒤 발생한 거부만 추가 기록하며 분당 초과는 이미
기존 admission SQL에서 기록된다. 알려지지 않은 프로젝트·관리자 실패·admission DB
실패는 제외한다. 진단 저장은 Worker ctx.waitUntil에 묶고 그 포트가 없는 호스트는
await한다. 저장 실패는 원래 응답을 바꾸지 않고 재시도/원문 로그를 만들지 않는다.
정상 요청의 진단 기록 쓰기/DB 왕복은 추가하지 않는다. 같은 분의 카운터를 한도+1로
낮추는 기존 동작을601 포화로 보완하여 설정을 낮췄다가 올려도 카운터가 줄지 않고
허용/추가 기록 요청이 최대600개에 머물게 했다. 원문·Origin·IP·토큰·requestId는 진단
DB/응답에 없다. 응답 뒤 기록·진단 저장소 오류·과거 backfill 없음으로 누락될 수 있어
완전한 거부율이나 전달 증거로 쓰지 않는다. 프로토타입 화면 연결은 다음 슬라이스다.

루트 npm test171/171, npm run typecheck(생성 Worker 타입 포함), OpenAPI의 Bun.YAML
파싱·새 경로와 응답 예제 버킷/합계 확인, git diff --check를 통과했다. 새 HTTP 테스트
4개는 실제 거부 요청과 분당/일일 구분·Retry-After·응답/DB 원문 비포함, reader/owner·
미인증/다른 프로젝트/없는 프로젝트/날짜/중복 파라미터/메서드·권한 회수, 늦은 sink의
응답 비차단과 실패 무시·재시도 없음, native Worker 실행 컨텍스트와 실제 D1 기록/조회
smoke를 확인한다. native smoke의 첫 esbuild 실행은 테스트 문자열의 JSON 반환 괄호가
없어 실패했고 이를 고친 뒤4/4·최종171/171을 통과했다. 저장 테스트에 설정 변경 시
카운터 비감소·동시12건 기록의 건수/최종 시각 보존을 추가했다. 전체 검증은 약59.5초였고
변경 없는 관리자 빌드/브라우저 UI를 반복하지 않았다.

OpenAPI·예제, DBML, 제품 명세(source of truth), 관리자·로그·수집·마이그레이션 문서,
로드맵과 화면 문서의 API 미지원 표현·이 기록을 갱신했다. 최초 DB 변경은0004 additive
열 확장이고 원격 적용은 하지 않았다. core의 저장/관리자 포트와 Worker 컨텍스트 전달을
확장했다. SDK·의존성·위생 정책·CI·러너·검증 명령 변경은 없다. lint는 명령이 없어 생략했다.
운영 부하/실제 인증 제공자/원격 DB/배포·화면 연결은 미검증/후속이다. 단위 테스트 임시
Miniflare와 개발 서버는 각 테스트가 정리했다. 푸시·배포·Sembom 연동은 없다.

## 2026-10-10 관리자 수집 거부 집계 화면

API 연결 모드 설정의 CollectionDiagnostics에 CollectionRejections를 연결했다.
최근 7개 UTC 날짜·프로젝트 전체의 기록된 거부 요청 건수와 마지막 거부 시각을
보여주며 고정 10종 원인별 표·최근 날짜부터의 일별 표는 details로 접었다. 원문·
Origin·IP·토큰을 진단에 추가하지 않고 UTC 수신일과 best-effort 누락·과거 backfill
없음을 안내한다. 거부율·잔여 할당량은 추론하지 않는다. 설정·스키마·거부 조회는
병렬로 읽고 스키마가 있을 때만 수신 요약을 읽는다. 각 실패는 독립적으로 표시하며
0건이나 기록 없음으로 바꾸지 않는다. 기존 취소/클라이언트/프로젝트 키와 수동 갱신
방식을 유지하고 추가 폴링·시험 이벤트를 보내지 않는다.

관리자 npm test 첫 실행은 기존/관련 82개를 통과했고 9개는 새 테스트의 공식 JSON
예제 상대경로를 한 단계 더 올라가도록 잘못 적어 실패했다. 경로를 고친 뒤 관련
10/10, 최종 전체 91/91과 npm run typecheck를 통과했다. 날짜/원인/합계/중복/안전정수/
UTC 시각·0/null·7개 날짜·프로젝트/기간 일치·부분 실패·중지/스키마 미확인·취소를
검사했다. npm run build와 npm run test:sites 4/4를 통과했다. 빌드에는 기존 주요 JS
청크 500kB 초과 경고가 남아 있으며 이번 작업에서 의존성이나 번들 구성을 바꾸지 않았다.

기존 로컬 Vite 5180과 별도 in-memory Miniflare D1 5188에서 실제 관리자 reader 조회를
확인했다. origin_denied 1건/invalid_event 2건·고정 10종·7일 표, UTC 날짜와 서울 오늘의
구분, 503에서 다른 진단 값 유지·0으로 미표시, 복구 후 재조회·진짜 0건/null 화면을
확인했다. 360px에서는 페이지 가로 넘침 없이 표 영역만 스크롤되고 글자는 16px이었다.
브라우저 콘솔 오류는 없었다. 테스트용 viewport 변경과 Miniflare를 정리했다.
지정 CommandCode DeepSeek 4.1 Flash high의 문서/레이아웃 제안을 검토해 반영했다.

FRONTEND_DESIGN.md(화면 source of truth)·프로토타입 README·제품 로드맵·이 기록을
갱신했다. API·DB 계약·SDK·의존성·위생 정책·CI/러너 변경은 없다. 백엔드는 변경이 없어
직전 커밋의 171/171 검증 결과를 재사용했다. lint는 명령이 없어 생략했다. 실제 운영
인증/원격 DB/운영 부하·배포는 미검증이고 푸시·배포·Sembom 연동은 하지 않았다.

## 2026-10-10 조회 기간 직접 선택

API 연결의 조회 기간에 직접 선택과 DateRangePicker를 추가했다. 프로젝트-local 오늘,
최근90일 보존/양끝 포함31일 한도를 기존 서버 규칙과 맞췄다. 입력 중엔 기존 결과와
CSV를 유지하고 미적용 안내를 내며 적용 때만 조회한다. 빈 값/잘못된 날짜/역순/미래/
보존·기간 초과를 거부한다. 실제 적용 값은 개요/이벤트/목표/속성별상세/비교/CSV의
조회 키에 함께 반영한다. 프로젝트/시간대/기본기간/재연결은 초기화하고 뷰/버전 변경은
적용 기간을 유지한다. 보존 범위 밖의 직전 비교는 요청 전에 막고 현재 결과를 유지하며
비교를 끄면 현재 CSV를 허용한다. 과거 기간에는 오늘 집계 중 안내를 표시하지 않는다.
Sample/설정 수집 진단 범위는 유지한다. 날짜 영속 저장·새 의존성·자동 폴링은 없다.

관리자 npm test94/94, npm run typecheck, npm run build, npm run test:sites4/4와
 git diff --check를 통과했다. 신규 날짜 테스트3개는 실제 core.queryDates와의 경계
일치, 정확히31일/90일 경계, 미래/역순/빈 값/유효하지 않은 날짜, 윤년/연말/DST와
프로젝트-local 오늘, 이전 비교 기간 보존 경계를 확인한다. 백엔드 코드는 변경하지 않아
이전171/171 결과를 재사용했다. 기존 JS500kB 초과 빌드 경고는 남았고 이번엔 번들
분리를 하지 않았다. lint는 등록 명령이 없어 생략했다.

로컬 Vite5180와 isolated in-memory Miniflare D15188에서 reader 조회를 확인했다.
단일10월9일을 적용해 전체75→62건과 해당 일별 차트, 직전10월8일 비교, 이벤트/목표/
속성별 완료율, 실제 CSV 파일의 current/previous from/to와62건을 확인했다. 입력 중에는
이전 결과를 유지했고31일 초과 오류와90일 경계의 비교 차단/현재 결과 보존을 확인했다.
브라우저 자동 입력에서는 date 값이 DOM에만 바뀌어 onChange가 반영되지 않았고,
날짜 칸을 onInput 처리로 바꾼 뒤 초안 안내/적용 동작을 확인했다. 기본7일 복귀와
다시 직접 선택 시 초기화,360px에서 페이지 가로 넘침 없음과 날짜 입력16px을 확인했다.
브라우저 콘솔 오류는 없었다. 검증 viewport와 실행한 개발/Miniflare 서버를 정리했다.
지정 CommandCode DeepSeek4.1 Flash high의 라벨/최소 폼 디자인/문서 초안을 검토해
반영했다. 첫 초안은 토큰 제한으로 잘려 같은 모델의 예산을 늘려 완전한 결과를 받았다.

제품 명세02-spec.md와 화면 source of truth FRONTEND_DESIGN.md·프로토타입README·
로드맵·이 기록을 갱신했다. API/DB·SDK·의존성·위생 정책·CI/러너 변경은 없다.
실제 운영 인증/원격 DB/운영 부하/배포는 미검증이다. 푸시·배포·Sembom 연동은 없다.

## 2026-10-10 작업 흐름 속성별 직전 기간 비교

목표의 등록 속성별 완료율에 직전 같은 길이 기간 비교를 연결했다. 기존 breakdown
API를 비교를 켰을 때만 추가 조회하고, 현재와 이전에 관찰된 값을 자료형대로 합쳐
시작·성공·완료율을 현재/이전 순서로 보여준다. 완료율 변화는 %p다. 관찰되지 않은
값의 건수는 0, 시작 0인 기간의 완료율과 그 차이는 null/—다. 현재·이전 조회와 재시도는
분리했고 취소한 요청의 응답은 버린다. 비교 조회 실패는 현재 표를 유지한다. CSV에는
이전 속성별 합계·일별 내역과 workflow_property_comparison 행을 더하고 metric 열로
시작·성공·완료율을 구별한다. 활성 비교가 미완료/실패하면 내보내기를 잠그며 비교를
끄면 현재 CSV를 허용한다. 이벤트 속성 비교와 값별 이전 일별 화면은 이번 범위 밖이다.

관리자 npm test 97/97, npm run typecheck, npm run build, npm run test:sites 4/4,
git diff --check를 통과했다. 신규 테스트 3개는 가중 완료율과 %p, false/숫자0 키,
두 기간 값 합집합·빈 결과·시작0·집계 중 상태, 다른 프로젝트/버전/시간대/분류/기간
거부, 이전 값별 일별 CSV와 현재에 없는 값·계산 불가 변화량·누락 비교 거부를 확인한다.
lint는 등록 명령이 없어 생략했다. 백엔드·API·DB는 변경하지 않아 백엔드 테스트는
반복하지 않았다. 기존 JS500kB 초과 빌드 경고는 남아 있다.

로컬 Vite5180와 격리된 in-memory Miniflare D15188의 reader 조회를 브라우저에서
확인했다. tool=loan의 시작20/10·성공16/6·완료율80%/60%·+20%p, grade/timer의
이전0건과 계산 불가 완료율을 확인했다. 이전 breakdown만 503으로 실패시켜 현재
속성 표 유지·CSV 잠금·비교 해제 시 내보내기 허용·비교 재시도 복구를 확인했다.
실제로 내려받은 CSV의 비교9행과 이전 데이터·metric·단위를 확인했다. 현재10월4~5일
0건/이전10월2~3일10건에서 이전에만 있는 loan 값이 0/10·0/6·—/60%로 남았다.
모바일 viewport360 설정 요청은 환경에서 실제400px로 적용됐고 페이지383px·표 내부
가로 스크롤을 확인했다. 360px 자체는 미검증이다. 콘솔 오류는 없었다. 비교 표 화면은
.tmp/prototype-qa/workflow-property-comparison.jpg에 저장했고 검증 서버와 탭을 정리했다.

CommandCode DeepSeek4.1 Flash high에 문서 갱신을 맡겨 결과를 코드와 대조했다.
제품 명세02-spec.md·화면 source of truth FRONTEND_DESIGN.md·프로토타입README·
로드맵·이 기록을 갱신했다. API/DB·SDK·의존성·위생 정책·CI/러너 변경은 없다.
실제 운영 인증·원격 DB·운영 부하·배포는 미검증이며 푸시·배포·Sembom 연동은 없다.

## 2026-10-10 이벤트 속성별 직전 기간 비교

이벤트 분석에서 등록 속성으로 분류하고 직전 기간 비교를 켜면 기존 event daily API로
같은 이벤트·속성·프로젝트·스키마·시간대의 직전 같은 길이 기간을 조회한다.
useEventPropertyComparison이 이전 조회의 상태·재시도·취소를 맡고, 별도
EventPropertyComparison 표는 현재/이전 건수·증감률(%)·비중·비중 변화(%p)를 보여준다.
비중의 분모는 각 기간의 선택한 이벤트 전체 건수다. 값의 자료형을 유지해 두 기간의
관찰 값 합집합을 비교한다. 없는 값의 건수는0, 전체 이벤트가 있으면 해당 비중은0,
전체가0이면 비중과 차이는null/—다. 이전 건수0의 증감률도null/—다.
분류 없는 상세에는 이전 속성 요청을 하지 않는다. 실패 시 현재 표와 차트는 유지하고
이전 속성만 다시 조회한다. 조건 변경·비교 해제·언마운트는 요청을 취소하고 늦은 응답을
버린다. 활성 분류 비교가 미완료/오류면 CSV를 잠근다. 비교 해제는 현재 기간 CSV를,
분류 해제는 전체 이벤트 기간 비교를 유지한 CSV를 허용한다. CSV는 이전 상세 합계·일별·
속성 값별 행과 property_comparison 행을 담는다.
metric=count/share, 변화 단위percent/percentage_point, 값 자료형과 계산 불가를 보존한다.

관리자 npm test101/101, npm run typecheck, npm run build, npm run test:sites4/4,
git diff --check를 통과했다. 신규 테스트4개는 건수 변화와 비중 차이의 구별, 새로 생긴/
사라진/null·false·숫자0 값, 빈 기간·0분모, 잘못된 메타/날짜/분류/합계 거부,
실제 ApiClient의 기존 조회 경로·그룹·기간·신호 전달과 취소/늦은 응답 거부,
이전 일별 CSV와 비중 변화·계산 불가·누락/잘못된 이전 데이터 거부를 확인한다.
lint는 등록 명령이 없어 생략했고 백엔드 코드는 변경하지 않아 재검증하지 않았다.
기존 JS500kB 초과 빌드 경고는 유지된다. LiveDashboard.tsx는41.7kB로 추후 분리 후보다.
이번 이전 조회 상태와 비교 표는 별도 파일로 두었다.

로컬 Vite5180와 격리된 in-memory Miniflare D15188의 reader 데이터로 확인했다.
tool_view의 loan12/10·+20%와 비중44.4%/66.7%·-22.2%p, grade10/5·+100%,
timer5/0·증감률계산불가·비중18.5%/0%를 확인했다. 실제 다운로드 CSV의 비교6행과
이전 값별 일별 행·숫자·단위가 화면과 일치했다. 이전 그룹 시계열만503으로 실패시켜
현재 표27건·차트 유지, CSV잠금, 비교·분류 해제 시 해제, 별도 재시도 복구를 확인했다.
직접 기간10월4~5일의 현재0건/이전10월2~3일에서 이전 loan·grade가 남고 -100%와
현재 비중/차이—를 표시했다. 브라우저 확대율을 반영한 실제 CSS320px에서 페이지303px,
표221px/내용575px로 표 내부만 스크롤하고 페이지 넘침은 없었다. 콘솔 오류는 없었다.
.tmp/prototype-qa/event-property-comparison.jpg에 화면을 저장했고 viewport·탭·검증
서버를 정리했다. 브라우저 확대율 자체는 변경하지 않았다.

CommandCode DeepSeek4.1 Flash high의 문서 갱신을 코드와 대조했다. 제품 명세02-spec.md·
화면source of truth FRONTEND_DESIGN.md·프로토타입README·로드맵·이 기록을 갱신했다.
API/DB·SDK·의존성·위생 정책·CI/러너 변경은 없다. 운영 인증·원격 DB·운영 부하·배포는
미검증이며 푸시·배포·Sembom 연동은 없다.

## 2026-10-11 관리자 차트 지연 로드

개요의 일별 추이 차트를 `Dashboard.tsx`의 `Trend`에서 `useEffect`의
`import('./TrendChart')`로 지연 로드하고 Recharts JSX를 `TrendChart.tsx`로
옮겼다. 불러오는 동안 자리 표시자는 `role="status"`로 알리고 실패해도 일별 수치 표와
나머지 화면을 유지하며 `화면 새로고침` 버튼으로 새 문서에서 복구한다. 언마운트 뒤
늦게 도착한 import 결과는 버린다. API/DB·SDK·의존성·CI·위생 정책 변경은 없다.

`prototypes/admin`에서 npm test 101/101, npm run typecheck, npm run build,
npm run test:sites 4/4를 통과했고 `git diff --check`도 통과했다. 빌드에서 기존
500kB 초과 JS 경고가 사라졌다. 루트 `npm run check`와 계약 검사는 이 슬라이스에서
돌리지 않았다.

번들: 기준선 커밋 `53aa645`의 첫 JS 800.26kB/gzip 228.43kB가 446.61kB/gzip
125.83kB로 약 44.9% 줄었고 차트 청크는 353.93kB/gzip 102.84kB다. 개요는 기본 화면에
차트가 있어 개요 총 JS gzip이 228.43kB에서 228.67kB로 거의 같고 요청 수가 1건에서
2건으로 는다. 모든 화면의 총량·로드 시간이 줄었다는 뜻이 아니다.

브라우저 확인은 로컬 `vite preview`(127.0.0.1:5180, 프로덕션 빌드)와 Codex 인앱
Chromium에서 캐시를 끄고 같은 탭에서 기준선 3회 뒤 지연 로드 3회를 연속 실행했다.
CPU·네트워크 제한은 없었다. FCP는 452/376/296ms에서 308/252/296ms로 중앙값이
376ms에서 296ms, DCL은 351.5/266.3/216.5ms에서 179.4/175.6/168.8ms로 중앙값이
266.3ms에서 175.6ms가 됐다. 개요 main fetch 종료는 기준선 302/213.4/139.1ms, 지연
로드 77.3/93.3/88.4ms였고 차트 청크 fetch 종료는 378/541.2/433ms였다. `load` 이벤트는
비동기 차트 완료 시각이 아니다. Resource Timing의 encodedBody는 기준선 226491 bytes,
지연 로드 entry 124796 bytes와 차트 101925 bytes를 합쳐 226721 bytes다. 로컬 preview
서버의 압축값은 Vite 빌드의 gzip과 달라 두 값을 서로 바꿔 쓰지 않는다. 표본 3회·
순차 측정이라 warmup이 섞이고 개선을 보장하지 않으며 운영 CWV·INP·LCP·full trace는 측정하지 않았다.
warmup이 섞이고 개선을 보장하지 않으며 운영 CWV·INP·LCP·full trace는 측정하지 않았다.
원시 수치는 로컬 무시 파일 `.tmp/prototype-qa/chart-load-metrics.json`이다.

차트 청크를 차단한 화면에서도 일별 수치 표와 요약 지표가 유지됐고, 브라우저가 실패한
import를 문서 단위로 기억해 다시 불러오는 시도로는 복구되지 않는다는 것을 직접 확인한
뒤 네트워크 차단을 풀고 `화면 새로고침` 버튼으로 차트가 복구되는 것을 확인했다.
실패 자리 표시자의 데스크톱 높이는 280px였다. 차트가 없는 `/auth/callback` 실제
화면에서는 entry 124796 bytes와 OidcLogin 10773 bytes만 요청됐고 차트 청크는 받지
않았다(인증 값은 입력하지 않았다).

7일에서 14일로 기간을 바꿔 차트 합계가 43440, 이벤트 상세 `conversion_started` 합계가
8825로 갱신되는 것을 확인했다. 실제 CSS 320px(innerWidth 320, viewport 288은 기존 90%
확대가 반영된 값이며 확대율 자체는 바꾸지 않았다)에서 정상·차트 다운로드 차단 실패
화면 모두 페이지 303px, 차트 자리 높이 285px에 가로 넘침이 없었고 실패 화면의
`role=status`와 새로고침 복구도 다시 확인했다. 최종 전체 화면은
`.tmp/prototype-qa/chart-lazy-load.png`다. 브라우저 캐시·차단 URL·viewport 설정을
되돌리고 검증 탭을 닫았으며 로컬 검증 서버 종료 후 5180 리스너가 없는 것을 확인했다.

운영 인증·실 DB·실 서버 부하·Sembom 연동·원격 푸시와 배포는 실행하지 않았다.

## 2026-10-11 관리자 폰트 로딩 정리

관리자 프로토타입의 폰트를 굵기별 정적 CSS 9개에서 가변 폰트 CSS 2개
(`@fontsource-variable/inter/wght.css`, `@fontsource-variable/noto-sans-kr/wght.css`)로
바꿨다. `App.tsx`의 import 9줄을 2줄로 줄이고 정적 의존성 `@fontsource/inter`·
`@fontsource/noto-sans-kr`를 빼고 `@fontsource-variable/inter`·
`@fontsource-variable/noto-sans-kr` `^5`(설치 5.3.0)를 넣었다. `vite.config.mjs`에
`scripts/font-assets.mjs` 플러그인을 연결해 실제 패키지 `@font-face`의 family와 굵기만
alias한다. Inter는 `400 800`(CSS 900은 800), Noto Sans KR은 `400 500`·`700`·`900`
(600과 800은 700과 900)이고 원본 `unicode-range`와 서브셋은 그대로 둔다. 플러그인이
두 OFL 원문을 `dist/client/fonts/inter-OFL.txt`·`noto-sans-kr-OFL.txt`로 동봉한다.

`tests/font-assets.test.mjs`를 테스트 러너에 넣어 실제 패키지의 모든 unicode 범위와
원본 src 유지, 서브셋별 중복 파일 다운로드가 늘지 않음, 기존 굵기 호환, 원본 변경 감지,
라이선스 동봉을 검사한다. `prototypes/admin`에서 npm test 105/105, npm run typecheck,
npm run build, npm run test:sites 4/4를 통과했다. 빌드 CSS는 380.42kB/gzip
119.38kB에서 264.85kB/gzip 35.91kB로 줄었고 초기 JS 446.61kB/gzip 125.83kB는 그대로다.
lint는 등록 명령이 없어 생략했고 백엔드는 바꾸지 않아 반복하지 않았다.

브라우저 확인은 로컬 `vite preview`(127.0.0.1:5180, 프로덕션 빌드)와 Codex 인앱
Chromium에서 캐시를 끄고 같은 탭으로 기준선과 가변 폰트를 한 번씩 비교했다.
`document.fonts.ready`를 기다린 뒤 Resource Timing을 봤다. 실제 preview가 내려준
encoded CSS는 113783에서 33732 bytes다. 첫 화면 폰트는 28건/324224 bytes에서
9건/178064 bytes로, CSS와 폰트 본문 합계는 438007에서 211796 bytes로 줄었다. 헤더는
뺐고 preview 서버의 압축값과 Vite 빌드 gzip은 서로 바꿔 쓰지 않는다. 개요 제목·지표·표의
전후 geometry 일치를 확인했고 글리프 전수 검증은 하지 않았다.

`document.fonts.load`로 Inter 600의 그리스·키릴·라틴 서브셋 face 4개, Noto Sans KR
700의 한글·한자 서브셋 face 6개가 실제로 로드되는 것을 확인했다. 지원 서브셋이
내려받는지 본 것이고 글리프 전수 검증은 하지 않았다. 로컬 dev(5181)의 폰트 CSS
요청에서 alias한 Inter와 굵기 범위 `400 800` 반영을 봤고 `dist/client/fonts`에 OFL
원문 2개가 실제로 동봉된 것을 확인했다. 이벤트 분석 `conversion_started` 상세 차트는
4800건으로 유지됐다.

실제 CSS 320px(innerWidth 320, viewport 288은 기존 90% 확대가 반영된 값이며 확대율은
바꾸지 않았다)에서 정상 화면과 WOFF2 전체 차단 실패 화면 모두 페이지 303px에 가로
넘침이 없었고, 차단 화면은 379개 face 오류에도 지표 24680/4800/4128/86.0%와
표·차트·메뉴가 읽혔다. 차단을 풀고 캐시와 viewport 설정을 되돌린 뒤 검증 탭을 닫았고
검증 서버도 종료하고 5180·5181 리스너가 없는 것을 확인했다. 원시 수치는 `.tmp/prototype-qa/font-load-metrics.json`이고 화면은
`font-before.png`·`font-after.png`다. 다른 화면 전체 확인과 운영 CWV·구형 브라우저
테스트는 실행하지 않았다.

API/DB·SDK·의존성 위생 정책·CI 러너·운영 인증은 바꾸지 않았고 프론트엔드 의존성과
Vite 플러그인·테스트 명령만 바뀌었다. 푸시·배포·Sembom 연동은 없다. Fontsource 가변 폰트
근거는 [Fontsource 가변 폰트 안내](https://fontsource.org/docs/getting-started/variable)다.

## 프로젝트 owner 전용 권한 목록 — 2026-10-11

`GET /v1/projects/{projectId}/grants`와 `AdminStore.grants`를 추가했다. 권한과 목록을
같은 D1 batch로 읽고 issuer/subject의 복합 기본키 순서로 페이지를 나눈다. limit은
기본 25·최대 100이고 커서는 프로젝트별 위치값이며 매 페이지에서 owner를 재검사한다.
응답은 최초 생성 시각과 등록 식별값·역할만 반환하고 no-store를 유지한다.

루트 `npm run check`가 타입 검사·177/177 테스트·SDK 크기 검사를 통과했다.
SDK gzip 2667 bytes, SDK+Sembom gzip 2949 bytes는 그대로다. 이후 커서 상한을
12288자(쿼리 12352자)로 확장하고 Worker smoke에 실제 커서 왕복을 추가했다.
변경 후 `npm run typecheck`와 관리자 기존 테스트 13/13(Worker smoke 포함), 최종
`node --test --test-timeout=30000 apps/collector/test/grants.test.ts` 6/6이 통과했다.
마지막 상한·smoke 수정 이후 전체 177개는 반복하지 않고 해당 범위를 재검사했다.

추가 테스트는 다른 프로젝트 식별값 제외, reader/외부 owner/발급자 변경 차단,
삭제된 커서 위치 이후 조회, 페이지 사이 역할 강등과 batch 직전 회수, 긴 Unicode·따옴표
식별값 커서, 잘못된/다른 프로젝트 커서, 파라미터·인증·저장 오류와 비공개 예외를 확인한다.
Miniflare workerd에서 owner 목록과 커서 왕복도 확인했다. 신뢰하는 검증기를 테스트에서
주입했으며 실제 제공자의 로그인·운영 토큰·원격 DB는 연동 환경이 없어 실행하지 않았다.

`tools/contracts`의 `npm run lint`(OpenAPI)와 `npm run check` 36/36, `git diff --check`
통과. API·제품 스펙·로드맵·관리자 경계 문서와 검증 기록을 갱신하고 계약 검사에 새 응답
예제와 닫힌 형태·페이지 상한 검사를 더했다. 일반 소스 lint 명령은 없어 생략했다.
DB·마이그레이션·SDK·의존성·CI 러너·위생 정책 변경, 운영 배포·푸시·Sembom 연동은 없다.
각 페이지는 현재 DB를 읽으므로 앞쪽에 새로 추가된 grant는 처음부터 재조회해야 한다.
권한 관리 UI·grant 부여/변경/회수 API는 후속이며 기존 CLI를 유지한다.

## 관리자 권한 목록 화면 연결 — 2026-10-11

API 모드 설정 화면에 owner 전용 `LiveGrants`를 연결했다. `ApiClient.listGrants`가
기존 bearer·같은 출처·no-store·no-referrer·credentials omit 정책을 재사용하고, 닫힌
응답 형태·역할·식별자 길이·등록 시각·프로젝트·페이지 한도·진행하지 않는 커서를 검사한다.
`GrantList`는 현재 25건 페이지 하나만 보관하며 실패·새 조회·dispose 때 행을 비운다.
프로젝트/연결 변경의 이전 설정 스냅샷도 렌더링에서 제외해 reader에게 기존 owner 상태를
적용하지 않는다. 각 응답은 abort와 세대 번호를 함께 확인한다.

`prototypes/admin`에서 `npm test` 111/111(권한 목록 신규 6개 포함), `npm run typecheck`,
`npm run build`, `npm run test:sites` 4/4와 `git diff --check`가 통과했다. 테스트는
권한 회수·네트워크 오류 후 행 제거, 실패한 페이지 재시도, 커서 진행/새로고침, 중복 클릭,
늦은 응답·언마운트 폐기와 응답 계약 오류를 확인한다. 일반 lint 명령은 없어 생략했고,
백엔드는 변경하지 않아 루트 백엔드 검사와 원격 마이그레이션을 반복하지 않았다.

Codex 인앱 Chromium과 로컬 Vite(127.0.0.1:5182)에서 실제 `LiveSettings`·`LiveGrants`
컴포넌트에 합성 transport를 주입한 무자격증명 검증 페이지를 사용했다. owner의 25건→2건
페이지 전환·끝 버튼 비활성화, reader 전환 후 요청 2건 유지/표 제거, 다음 페이지 403 후
표 제거, 빈 페이지 안내, 다른 프로젝트 데이터만 표시를 확인했다. 콘솔 오류는 없었다.
실제 CSS innerWidth 320px(기존 90% 확대에 viewport 288px)에서 페이지 scrollWidth
303px, 표 540px/스크롤 영역 255px로 전체 페이지 넘침이 없고, 508자 식별자를 자르지
않으며 셀은 18px였다. Tab으로 표 영역 포커스 후 ArrowRight 내부 스크롤을 확인했다.
뷰포트는 복원했고 검증 탭·서버는 종료했다. 화면은 `.tmp/grants-ui-qa/owner.png`·
`mobile.png`이며 임시 검증 페이지도 ignore된 `.tmp`에만 둔다.

제품 스펙·로드맵·프론트엔드 설계·검증 기록을 갱신했다. API·DB·SDK·의존성·CI 러너·
위생 정책 변경, 푸시·배포·Sembom 연동은 없다. 운영 OIDC/실제 계정 연동은 환경이
연결되지 않아 실행하지 않았고, 이번 화면은 조회만 하며 권한 변경은 기존 CLI가 맡는다.

## 관리자 변경 이력 화면 연결 — 2026-10-11

API 연결 설정의 권한 목록 아래 소유자 전용 `LiveAdminChanges`를 연결했다. 닫힌 응답
형태·프로젝트·90일 창·기록 정렬·페이지 한도·커서 진행을 검사하며 현재 25건 페이지
하나만 보관한다. 새 조회·실패·권한 상실 때 기록을 비우고 abort와 세대 번호로 늦은
응답을 막는다. 설정·권한 저장이 확인되면 첫 페이지를 다시 읽는다.

`prototypes/admin`의 `npm run typecheck`, `npm test` 123/123(변경 이력 신규 5개 포함),
`npm run build`, `npm run test:sites` 4/4를 실행해 통과했다. 신규 테스트는 응답 검증,
전송 정책, 실패 페이지 재시도, 중복 클릭, 끝 페이지, 401/403 기록 제거, 요청 취소와
늦은 응답·dispose를 확인한다. API·DB·SDK를 변경하지 않아 백엔드 검사는 반복하지
않았고 일반 소스 lint 명령은 없어 생략했다. 운영 OIDC·원격 D1 연동도 실행하지 않았다.

Codex 인앱 Chromium과 로컬 Vite(127.0.0.1:5183)에서 실제 `LiveSettings`·`LiveGrants`·
`LiveAdminChanges`에 합성 transport를 주입한 무자격증명 페이지를 사용했다. 25건→3건
페이지 이동과 마지막 버튼 잠금, 네트워크 오류 후 같은 페이지 재시도, reader 전환 때
추가 이력 요청 없음, 다음 페이지 403 후 표 제거·부모 잠금, 빈 이력, 프로젝트 전환 후
늦은 응답 폐기, 설정·권한 저장 후 새 기록 표시를 확인했다. 로딩 때 행을 비우고 버튼을
잠그며 자동 폴링하지 않는다. 임시 검증 페이지 제목 수정의 HMR에서 createRoot 중복
경고가 한 번 발생했고 페이지를 다시 연 뒤 새 오류는 없었다. 검증 페이지는 ignore된
`.tmp`에만 있으며 운영 앱 변경이 아니다.

기존 브라우저 90% 확대를 유지한 실제 innerWidth 320px에서 문서 scrollWidth 303px,
표 540px·스크롤 영역 255px로 문서 넘침이 없었다. 508자 식별자를 자르지 않고 셀 상세와
표 머리글은 18px였다. Tab으로 표 영역 포커스 후 ArrowRight 내부 스크롤을 확인했다.
화면은 `.tmp/admin-changes-ui-qa/desktop.png`·`mobile.png`에 보관하고 뷰포트는 복원했다.

제품 명세·로드맵·관리자 경계·프론트엔드 설계·프로토타입 안내와 검증 기록을 갱신했다.
API·DB·SDK·의존성·CI 러너·위생 정책 변경, 푸시·배포·Sembom 활성화는 없다.

## 관리자 요청 대기·취소 개선 — 2026-10-11

관리자 `ApiClient`에 기본 15초의 전체 요청 제한을 추가했다. 토큰 갱신 대기·HTTP 응답·
성공/오류 본문을 하나의 제한 안에서 처리하며 내부 생성 옵션 `requestTimeoutMs`는
10~120000밀리초 정수만 허용한다. `awaitRequest`는 취소를 무시하는 합성 transport도
대기에서 벗어나게 하고, 늦은 응답·실패를 소비하며 listener를 제거한다. 완료 시 타이머도
제거한다. 공유 로그인 갱신은 취소하지 않고, 이미 시간이 지난 요청은 늦게 토큰을 받아도
새 HTTP 요청을 시작하지 않는다. 기본 fetch에는 abort signal을 전달한다.

시간 초과는 고정 문구를 가진 `ApiError('timeout')`으로 표시한다. 이미 관측한 401·403은
오류 본문이 멈춰도 권한 오류로 유지하므로 권한 목록이 폐기되고 조회가 잠긴다. 저장
응답을 확인하지 못하면 기존 편집기의 review 상태로 이동하며 입력 보존·최신 상태 조회로
복구한다. 저장을 자동 재시도하지 않는다. 요청 취소가 서버에 반영된 쓰기를 되돌리지는 않는다.

`npm run test:admin` 204/204, `npm run typecheck:admin`, `npm run build:admin`,
`npm run test:bundle --workspace @tallyfin/admin` 2/2,
`npm run test:sites --workspace @tallyfin/admin` 9/9를 통과했다. 마지막으로 helper의
완료 직후 abort 검사 한 줄을 보완한 뒤 client·요청 생명주기 집중 검사 45/45와 관리자
타입 검사·빌드를 다시 통과했다. 변경되지 않은 나머지 검사 결과는 재사용했다.
`git diff --check`도 통과했다. 새 테스트는 단계별 멈춤·전체 예산 유지·타이머 정리·
caller 취소·연결 끊기·늦은 성공/실패·공유 갱신·재조회 복구·권한 거부·저장 결과 유실을
합성 transport와 실제 편집/권한 컨트롤러로 확인한다. 네트워크·운영 장애 재현 증거는 아니다.

프론트엔드 설계 문서·관리자 안내·로드맵을 갱신했다. OpenAPI·DB 계약·SDK·의존성·
CI 러너·위생 정책 변경은 없다. 백엔드를 바꾸지 않아 백엔드 전체 검사는 반복하지 않았고,
일반 소스 lint는 등록 명령이 없어 생략했다. 이번에는 브라우저 화면·실 OIDC·원격 D1
검증도 실행하지 않았다. 운영 제공자·도메인이 미정이며 원격 푸시·배포는 없다.

## 서버 SDK 늦은 응답·본문 정리 개선 — 2026-10-11

세 회귀 테스트를 먼저 추가해 기존 코드에서 3/3 실패를 확인했다. 오류 본문의 cancel이
거부되면 401을 `transport_unavailable`로 오인해 두 번 보내고, 1KiB 초과 영수증의 cancel이
멈추면 `invalid_response` 대신 전송 오류를 반환했다. 첫 시도가 시간 초과된 뒤 늦게 받은
200 응답은 진행 중인 두 번째 시도의 `httpStatus`를 null에서 200으로 바꿨다. 합성
transport·ReadableStream으로 재현했으며 실제 제공자/운영 네트워크 사고 재현은 아니다.

`discardBody`는 정리를 시작하고 실패를 소비하되 완료를 기다리지 않는다. `receipt`는
잘못된·초과·취소된 읽기를 정리하고 reader lock을 해제한다. fetch가 끝나면 시도별 signal을
먼저 확인하므로 끝난 시도의 응답은 상태·헤더·영수증을 바꾸지 못한다. 이어 호출 취소 뒤
늦은 응답의 정리가 거부되는 경우도 검사했다. 호스트가 취소를 무시하면 해당 전송 구현의
완전한 종료는 SDK가 보장하지 않는다. 영수증/재시도·토큰 전달·배치 형식은 유지한다.

`npm run test:server` 24/24, `npx --no-install tsc --noEmit`, `npm run build:server`,
`git diff --check`가 통과했다. 서버 SDK 빌드는 8952 bytes/gzip 3671 bytes이며 런타임
외부 의존성 0을 확인했다. 마지막 호출 취소 회귀 테스트 추가 뒤 서버 테스트만 재실행하고
변경하지 않은 소스의 타입·빌드 결과를 재사용했다.

`npm run verify:server-recovery`도 종료 코드 0과 `verified:true`로 통과했다. 새 합성 환경의
세 Miniflare 수집 Worker·공유 로컬 D1·실제 루프백 소켓과 기본 SDK fetch를 썼다. 커밋 전
503 재시도는 accepted 2/duplicates 0, 커밋 뒤 응답 손실 재시도는 accepted 0/duplicates 2,
각 attempts 2·본문 동일 바이트였다. 발행자 회수 뒤 403/attempts 1·집계 불변을 확인했다.
receipts 8·completedRuns 2였고 결과는 `.tmp/server-recovery/run-2AgRt3`에 있다.

서버 SDK 안내·로드맵·검증 기록을 갱신했다. API·DB 계약·SDK 공개 타입·의존성·위생 정책·
CI 러너 변경은 없다. 관리자와 수집기 소스가 그대로라 전체 UI·백엔드 검사를 반복하지 않았고,
일반 소스 lint는 명령이 없어 생략했다. 실제 OIDC·원격 D1·운영 부하는 환경 미정으로
미검증이다. 기존 DB 접근·푸시·배포·Sembom 활성화는 없다.

## 브라우저 SDK 본문 정리·리다이렉트 개선 — 2026-10-11

네이티브 어댑터 회귀 검사 2개를 먼저 추가해 기존 코드에서 2/2 실패를 확인했다. 응답
본문의 cancel이 멈추면 200 응답을 받았어도 pending이 1로 남았고, fetch의 redirect 설정도
없어 기본 따라가기 정책을 사용했다. native 어댑터를 테스트용 document·fetch로 실행했으며
초기 실패 검사는 실제 운영 네트워크 사고 재현이 아니다.

본문 정리는 Promise 실패를 소비하고 완료를 기다리지 않는다. ReadableStream의
underlying cancel이 throw/reject/stall하는 경우 모두 200·401·403·422 상태를 바로 처리하고
재전송하지 않는다. 네이티브 fetch는 manual redirect를 사용하며 필터링된 리다이렉트의
상태 0은 내부 비재시도 3xx 분기로 보낸다. 요청에는 이 내부 상태를 넣지 않는다. 실제 HTTP
리다이렉트 코드가 드러나면 그대로 처리하고, 네트워크 예외/커스텀 포트의 상태 0은 기존대로
재시도한다. 네이티브 기본 CORS·omit·no-referrer·keepalive 정책도 유지한다.

스키마의 이벤트·규칙·퍼널 목록을 한 번만 순회하고, 배치 포장 때 queue.slice 복사와
퍼널 링크의 두 번째 객체 복사를 없앴다. 숫자 속성은 공용 safe-integer 검사에서 확인하고,
필수 속성은 기존 스냅샷에서 확인한다. 검증을 약하게 하거나 공개 키를 압축하지 않았다.
초기 수정의 크기 초과와 관리자 생성 코드의 별도 3KiB 초과를 수정한 뒤 최종 검사로
브라우저 32/32, 관리자 퍼널 SDK 생성 6/6, 루트 `npx --no-install tsc --noEmit`,
`npm run build:browser`, `npm run check:browser-size`, `git diff --check`를 통과했다.
최종 gzip은 기본 2746·Sembom 3023·퍼널 2918·퍼널 예제 3044 bytes이며 관리자 생성
코드도 기존 3072 bytes 한도를 통과했다. 예산·의존성·검사 명령은 바꾸지 않았다.

최종 소스로 `npm run bench:browser -- --samples 2`를 실행해 종료 코드 0을 확인했다.
로컬 합성 페이지·새 브라우저 컨텍스트·실제 Chromium·루프백 수집기·새 D1을 사용했다.
baseline은 계산 성공/시작 각 22·view/validation 각 2, 응답 유실 복구 후 workflow 시작/성공
각 34와 receipts 74였다. 복구 중 계산 12회·응답 유실 이벤트 20개 중복 처리·수집기 중단 중
계산 11회·쿠키/자격증명/referrer 없는 요청을 확인했다. 원시 기록은
`.tmp/browser-bench/1791709452481.json`이다. 이 측정용 번들 gzip 3016 bytes는 Sembom
예제의 3023 bytes와 다른 값이다. 소표본으로 운영 성능 개선을 주장하지 않는다.

별도 ignore된 `.tmp/native-browser-redirect.mjs`로 SDK 소스를 번들해 Chromium
156.0.8078.4와 두 로컬 HTTP 서버를 썼다. 수집기가 307로 다른 origin의 대상 서버를
가리키도록 했다. 실제 응답 type=opaqueredirect/status=0/redirect=manual,
수집 요청 1·대상 서버 요청 0·추가 재시도 없음·pageerror 없음·pending 0을 확인했다.
결과는 `.tmp/native-browser-redirect-result.json`이며 검증 브라우저·서버는 종료했다.

브라우저 SDK 안내·로드맵·검증 기록을 갱신했다. API·DB 계약·SDK 공개 타입·위생 정책·
CI 러너·의존성 변경은 없다. 변경 없는 관리자 전체/백엔드 전체 검사는 반복하지 않았고,
일반 소스 lint는 명령이 없어 생략했다. 실제 Sembom 연동·모바일/타 브라우저·원격 운영
환경은 미검증이며 푸시·배포·활성화는 없다.

## 분석·CSV 권한 상실 후속 — 2026-10-12

새 `npm run verify:admin-analysis-access`를 기존 소스에 먼저 실행했다. 실제 로컬
RS256 로그인·Miniflare D1에서 읽기 권한을 회수한 뒤 이벤트 상세 GET이 403을 받았지만,
상세를 닫으면 요약 CSV가 다시 활성화되어 `denied-export` 단계에서 실패했다.
수정은 분석 GET의 권한 거부를 부모 화면에 전달해 요약·상세·비교·분류 결과와 CSV를
함께 숨긴다. 오류 본문 정체·로그인 갱신 실패도 처리하며 소유자 전용 403과 구별한다.

최종 브라우저 검사는 Chromium 156.0.8078.4, 로그인 1·읽기 거부 1·일반 API 읽기
22·보류한 읽기 1·API 쓰기 0·pageerror 0으로 통과했다. 요약 제거·CSV 잠금, 다른
프로젝트 CSV 파일명과 실제 내용에 이전 프로젝트가 없는 점, 권한 복구·명시적 새로고침,
프로젝트 전환 후 늦은 403 폐기, 연결 해제 후 데이터 제거를 확인했다. 결과는
`.tmp/admin-analysis-access-z2VrRW/report.json`이다. 앞선 보류 응답 검사에서는
취소된 소켓에 workerd Windows WSASend 10054 진단이 있었고 검사는 통과했다.
최종 실행에는 해당 진단이 없었다. 합성 로컬 제공자·D1 검사이며 원격 운영 검증은 아니다.

클라이언트·요청 수명 검사 53/53과 분석·스키마 검사 64/64(새 검사 4개 중복)가
통과했다. 마지막 상태 분류 변경 뒤 새 검사 4/4를 다시 통과했다. 관리자 타입·빌드와
번들/Sites 11/11, `git diff --check`를 확인했다. 변경 없는 백엔드 전체와 실제 제공자·
원격 DB 검사는 반복하지 않았다. 일반 소스 lint 명령은 없다. 프론트엔드 설계와 이
검증 기록만 소유 문서로 갱신했다. API·DB·SDK·의존성·위생 정책·CI 러너 변경 및
푸시·배포는 없다. 새 브라우저 명령은 옵트인이며 기본 CI에 연결하지 않았다.

## 지원하지 않는 시간대 응답 차단 — 2026-10-12

API가 프로젝트나 조회 메타에 지원하지 않는 시간대 이름을 돌려주면 관리자 클라이언트가
그 값을 검증 없이 React로 넘겼다. 대시보드가 조회 날짜를 계산할 때 `Intl.DateTimeFormat`이
던진 예외를 부모 `DeferredPanel`의 오류 경계가 잡아 "화면 새로고침"만 안내했고, 새로고침은
메모리에만 둔 토큰을 지워 다시 로그인해야 했다.

`apps/admin/src/api/validate.ts`는 프로젝트와 쿼리 메타의 시간대를 Core의
`validateRegistry`와 같은 계약으로 확인한다(1~64자, `^[A-Za-z][A-Za-z0-9_+./-]*$`,
`Intl.DateTimeFormat` 생성 성공). 위반 응답은 렌더 전에 `contract` 종류의 `ApiError`로
거부되어 대시보드가 `응답이 계약과 맞지 않아요`와 `다시 시도`를 표시하고 연결과 로그인은
남는다. 지원되는 이름과 별칭은 다시 쓰지 않고 그대로 전달하며 UTC로 대체하지 않는다.

새 `apps/admin/src/api/time-zone.test.mjs` 3개 중 2개는 수정 전 실패했다. 최종
client·dates·collection-diagnostics·schema·time-zone 검사 74/74, `typecheck:admin`·
`build:admin`·runner `node --check`·`git diff --check`를 통과했고 번들/Sites 검사는
11/11이었다.

옵트인 `npm run verify:admin-analysis-access`는 실제 로컬 D1 프로젝트 목록 응답에만
`Mars/Olympus`를 주입하며 DB는 바꾸지 않는다. 최종 Chromium 156.0.8078.4 실행은
invalidZoneReads 1·복구 true·deniedReads 1·heldReads 1·로그인 1·API 읽기 25·쓰기 0·
pageerror 0·routeError false로 verified=true였고, 기존 접근 회수·CSV 잠금·다른 프로젝트
다운로드·늦은 403 폐기·연결 해제 검사도 함께 통과했다. 결과는
`.tmp/admin-analysis-access-v0JmYQ/report.json`이다. 수정 전 소스로 같은 명령을 실행하면
초기 `invalid-time-zone` 단계에서 실패하고 캡처에 오류 경계가 남는다.

합성 로컬 RS256 로그인과 격리된 Miniflare D1/Vite를 쓴 검사이며 실제 운영 제공자는
확인하지 않았다. API·DB·SDK·의존성·위생 정책·CI 러너 변경은 없고 푸시·배포도 없다.

## CSV 조회 출처 열 — 2026-10-12

`CSV_COLUMNS` 마지막에 `query_source`를 추가해 기존 열 순서와 `source` 동작을 유지한다.
`event_total` 행의 `source`는 선언된 이벤트 출처, 다른 행은 `meta.source`이고,
`query_source`는 모든 행에서 조회한 browser/server를 가리킨다. 선택하지 않은 출처의
`event_total` 행은 `availability=not_selected`와 빈 `count`를 유지하며 0을 만들지 않는다.

새 `client.test.mjs` 검사는 수정 전 실패하고 수정 후 통과했다. 최종
`node --test apps/admin/src/api/client.test.mjs apps/admin/src/api/server-source.test.mjs`
41/41, `typecheck:admin`·`build:admin` 통과, `verify:admin-analysis-access`의 실제
내려받은 CSV 헤더 `query_source` 검사를 통과했다. 최종 Chromium 156.0.8078.4 실행은
verified=true, pageErrors 0·routeError false·읽기 23·쓰기 0·로그인 1,
invalidZoneReads 1·deniedReads 1·heldReads 1이었다.

CSV 열이 하나 늘어 소비자는 고정 열 개수 대신 헤더를 읽어야 한다. API·DB·SDK·의존성·
위생 정책·CI 러너 변경은 없고 푸시·배포도 없다.

## 스키마 버전 불러오기 초안 교체 확인 — 2026-10-12

설정의 스키마 버전 불러오기가 작성 중인 초안을 확인 없이 덮어쓰던 문제를 고쳤다.
`SchemaEditor`가 마지막으로 확인한 정의를 기준선으로 기억하고, 기준선과 다른 초안일 때만
교체 확인을 요구한다. 기준선은 로드(`#accept`), 서버에서 확인한 발행(`#read`), 버전
불러오기와 발행 성공, 초안 유지(`keepDraft`)에서 갱신된다.

새 회귀 검사 3개는 수정 전 3/3 실패했다. 수정 후 `schema.test.mjs`는 추가 4개를 포함해
31/31을 통과했다. 네 번째 검사는 `keepDraft`로 서버 최신과 다른 이전 정의를 명시적으로
유지할 때도 교체 확인이 유지되는지 확인한다. `typecheck:admin`·`build:admin`,
bundle-split 2·sites-worker 9(합계 11/11), runner `node --check`, `git diff --check`를
통과했다.

`npm run verify:admin-onboarding`은 Chromium 156.0.8078.4, 합성 로컬 RS256 로그인 1회,
실제 Miniflare D1로 통과했다. replacementDialogs 3(취소 1, 503 실패 후 재시도 동의 2)·
pageErrors 0·routeError false·apiReads 27·apiWrites 4·browserBatches 1·firstEventCount
1이었고 기록은 `.tmp/admin-onboarding-VlLaeP/report.json`이다.

원격 OIDC 제공자와 운영 DB는 검증하지 않았다. 변경 없는 백엔드 전체와 SDK 전체 검사는
반복하지 않았고 일반 소스 lint 명령은 없다. API·DB 계약·의존성·위생 정책·CI 러너 변경은
없고, 기존 옵트인 browser runner만 확장해 기본 CI에는 추가하지 않았다. 푸시·배포도 없다.
