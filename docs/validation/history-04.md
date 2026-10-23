# 검증 이력 04

원문의 구간 순서를 유지한 과거 기록이다. 명령과 코드 경로는 저장소 루트 기준이다.

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
