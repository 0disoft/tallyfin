# 검증 이력 06

원문의 구간 순서를 유지한 과거 기록이다. 명령과 코드 경로는 저장소 루트 기준이다.

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
README·서버 SDK 문서·[복구 확인 안내](../../tools/runtime/SERVER-RECOVERY.md)를 더했다.
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
