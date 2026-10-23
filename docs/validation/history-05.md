# 검증 이력 05

원문의 구간 순서를 유지한 과거 기록이다. 명령과 코드 경로는 저장소 루트 기준이다.

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
