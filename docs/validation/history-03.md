# 검증 이력 03

원문의 구간 순서를 유지한 과거 기록이다. 명령과 코드 경로는 저장소 루트 기준이다.

## 자원 수명·경합 개선 최종 검증 (2026-10-23)

전체 테스트를 `node --test --test-concurrency=2 --test-timeout=30000`과 기존
package script의 테스트 경로로 실행해 489/489를 통과했다. 관리자 테스트 276/276,
최종 OIDC/인증 테스트 18/18도 통과했다. 실제 Worker에서 인증 요청 12개를 동시에
실행했을 때 모두 성공했고 JWKS 조회는 총 2회, 최대 동시 2개, 종료 후 활성 0개였다.
역순으로 끝난 이전 조회의 실패가 최신 성공 이후 cooldown을 덮지 않도록 보호했다.
관리자 빌드, 계약 검사 63개, 최종 루트 TypeScript 검사도 통과했다.

기본 전체 병렬 실행에서는 로컬 Wrangler/Miniflare 부하로 30초 timeout이 발생했다.
동시 실행 수 2에서는 전체 통과했으며 package script·CI 설정은 변경하지 않았다.
관리자 브라우저 권한 초안/모드 이탈 검사도 pageErrors=0, routeError=false로 통과했다.

API 목록의 grantRevision과 쓰기의 expectedRevision, DB 0010의 컬럼 및 세 트리거는
함께 반영해야 한다. 원격에는 0010을 먼저 적용하고 Collector와 갱신된 관리자 UI를
함께 배포한다. JWKS 제한은 verifier 인스턴스별이며 분산 전역 한도는 아니다.
원격 DB 적용·푸시·배포·게시·의존성·CI 변경은 수행하지 않았다.

## 관리자 fallback 응답 수명 (2026-10-23)

SPA fallback에서 버리는 404 본문은 관리자 Worker의 finally에서 즉시 취소한다.
정상 반환되는 asset/fallback 본문은 호출자가 소유하며, 취소의 예외·거부·끝나지 않는
정리 Promise가 fallback 응답이나 원래 오류를 바꾸지 않는다. 성공/동기 예외/비동기
실패/AbortError와 cleanup 네 가지 조합을 포함한 Sites Worker 검사 11/11 및 diff
검사를 통과했다. API·DB·의존성·CI 변경은 없다.

## OIDC 외부 조회와 대기 수명 제한 (2026-10-23)

verifier마다 JWKS 외부 조회를 최대 2개, 대기자를 최대 32개로 제한한다. 대기는 각
요청의 deadline/Promise에 속하며 취소 시 큐와 리스너를 제거한다. 슬롯은 finally에서
반환하고 먼저 대기한 요청에 예약해 중복 반환/새 호출의 가로채기를 막는다. 대기 중
갱신된 공개 JSON만 재사용하며 Response/stream은 요청별로 만든다. 역순 완료된 이전
조회가 최신 공개 데이터 캐시를 덮지 않도록 시작 순서를 비교한다. 제한은 인스턴스별이며
분산 전역 한도를 주장하지 않는다. OIDC/실제 Worker 검사 18/18, 순서 보호 후 OIDC
17/17와 루트 TypeScript 검사를 통과했다. API·DB·의존성·CI 변경은 없다.

## 관리자 권한 revision CAS (2026-10-23)

0010은 기존 grant 행을 보존하고 projects.grant_revision과 세 트리거를 추가한다.
직접 SQL/운영 도구/API의 권한 생성·삭제·역할 변경이 revision을 올린다. 목록은
grantRevision을 제공하고 관리자 UI는 검토 시 expectedRevision을 고정해 PUT/DELETE에
전달한다. 오래되거나 누락된 revision은 상태를 바꿀 수 없으며 grant_conflict로 끝난다.
상태가 이미 같으면 쓰기 없는 재확인은 유지한다. 운영 도구 계획도 revision을 비교한다.
필수 함수 인자는 유지하며 OpenAPI·DBML·마이그레이션 지침을 갱신했다. 0010 적용 후
Collector와 관리자 UI를 함께 갱신해야 기존 관리자도 권한을 편집할 수 있다.

권한 집중 검사 31/31, 마이그레이션/클라이언트 보강 13/13, 수정된 서버 수집/클라이언트
검사 17/17, 계약 검사 63개와 루트/관리자 TypeScript 검사를 통과했다. 실제 브라우저의
권한 저장 응답 손실·초안/이탈 검사도 성공했고 pageErrors=0, routeError=false였다.
최초 전체 병렬 검사에서 새 컬럼 기대값 불일치와 부하에 따른 30초 타임아웃이 발생해
기대값을 수정했으며 최종 전체 검사는 동시 실행 수를 낮춰 수행한다. 원격 DB 적용·
푸시·배포·의존성·CI 변경은 없다.

## 분당 한도 판정의 설정 경합 제거 (2026-10-23)

admit의 필수 호출 인자는 유지하지만 승인과 minute_limit 집계는 같은 SQL 문에서
읽은 projects.requests_per_minute로 판정한다. 설정을 읽은 뒤 한도가 낮아지거나
높아져도 오래된 호출자 값으로 승인/거부하지 않는다. 거부 집계 SQL에 남아 있던
TypeScript 상수 이름도 숫자 보간으로 바로잡았다. 실제 D1/Worker 집중 검사 28/28,
루트 TypeScript 검사·diff 검사를 통과했다. API·DB 구조·의존성·CI 변경은 없다.

## 리팩토링 최종 패키지 연계 검증 (2026-10-22)

SDK 정책 파일 분리로 생성되는 내부 타입 선언 두 개를 정확한 tarball 파일 목록에
추가했다. verify:sdk-packages는 두 SDK 재빌드·stale 출력 제거·오프라인 pack·작업공간
밖 설치·NodeNext 선언 컴파일·세 진입점 실행을 통과했다. 네트워크/credential 호출은
0이며 공개 API 형식과 런타임 의존성은 유지한다. 루트 전체 타입 검사도 통과했다.
이번 후속 범위의 SDK 98/98·관리자 275/275·모니터/접근 19/19가 통과했다. 전체
npm test와 원격 운영 검사는 범위 밖이라 실행하지 않았다. 푸시·배포·게시는 하지 않았다.

## 모니터 파일 수명 분리 (2026-10-22)

상태 파일 처리에서 잠금 소유·제한된 파일 읽기·취소 가능한 관측·임시 파일 발행을
별도 함수로 분리했다. 다른 writer의 잠금/임시 파일을 삭제하지 않으며 close/unlink
순서와 rename 이후 저장 성공 규칙을 유지한다. 파일/모니터/접근 검사 19/19와 루트
TypeScript 검사·diff 검사를 통과했다. 실제 접근 장애 검사에서 기존 Windows
workerd WSARecv #64 진단이 있었지만 검사는 정상 종료했다. API·DB·의존성·CI 변경은 없다.

## 관리자 상태 소유권과 조회 수명 분리 (2026-10-22)

SettingsEditor는 private 상태와 읽기 전용 getter/구독 view를 제공한다. API 스냅샷을
복사해 동결하고 saved 콜백에도 별도 복사본을 전달하므로 호출자 원본을 동결하거나
외부 변경으로 초안·권한·오류 상태가 바뀌지 않는다. 프로젝트 목록/페이지의 generation과
AbortController는 useProjectPages에 모으고 본 조회·기간 비교·시계열은 별도 훅으로 옮겼다.
검증 순서와 Hook 이전 반환 금지를 유지한다. 관리자 검사 275/275, 타입 검사·빌드와
브라우저 설정 탐색(생성 후 전환·분석 새로고침 포함)/분석 권한 검사를 통과했다.
초기 전체 검사에서 기존 100ms native 요청 테스트가 병렬 부하로 실패해 credential
기한을 가상 시계로 검증하도록 바꾼 뒤 전체 통과했다. 브라우저 pageErrors/routeError는
0/false다. Worker 종료 중 Windows WSASend #10053 진단이 있었으나 검사는 성공했다.
API·DB·의존성·CI 변경과 원격 반영은 없다.

## SDK 전송 단계와 정책 분리 (2026-10-22)

서버 SDK의 배치 복사/검증·단일 요청·HTTP 종료 분류를 분리하고 전송 진행 상태의
소유권을 send에 모았다. 실제 요청 횟수·오류 분류·인증/본문/재시도 취소 순서를 유지한다.
브라우저의 Retry-After 계산은 순수 함수이며 큐·요청·재시도 한도는 경량 상수로 관리한다.
SDK 검사 98/98, 서버 빌드·루트 TypeScript 검사를 통과했다. 브라우저 gzip 검사는
Sembom 3056, 퍼널 3029, 생성 퍼널 3054 bytes로 3072 bytes 이하다. 내부 파일 분할을
허용하도록 번들 검사를 소스 경로 기준으로 바꿨다. API·DB·의존성·CI 변경은 없다.

## D1 스냅샷과 SQL/응답 계산 분리 (2026-10-22)

수집 스냅샷의 선택적 publisher/funnel 결과는 어댑터 내부에서 이름으로 해석한다.
commitIngest는 기존 권한/설정 확인·순수 계획·원자적 SQL 실행·충돌 재시도만 조율한다.
관리자 조회 SQL과 응답 계산도 분리했다. 쿼리 순서와 grant predicate·단일 snapshot·
write guard를 유지하며 SQL 행 한도는 도메인 정책에서 계산한다. D1/관리자 집중 검사
59/59·루트 타입 검사를 통과했다. DB 스키마·API 형식·의존성·CI 변경은 없다.

## Core 전이 계산과 정책 소유권 (2026-10-22)

workflow 전이는 입력 상태를 복사한 순수 계산으로 분리했다. 영수증/단계 중복과 일일
한도 순서는 유지하고 스키마 검증은 이벤트·workflow·차원 비교로 나눴다. 정의 투영은
읽기 전용 borrowed view로 표시하며 퍼널 결과의 속성은 복사한다. 시간/보존/스키마/
조회 정책 상수를 Core에서 공유하고 관리자 경로에도 적용했다. Core·실제 D1 집중
검사 70/70·루트 타입 검사를 통과했다. 응답 형식·DB·의존성·CI 변경은 없다.

## 관리자 경로와 수집 오류 처리 분리 (2026-10-22)

administrator는 인증 뒤 기존 순서로 경로만 분기하며 읽기/쓰기 핸들러와 본문 해석을
분리했다. Collector 오류 헤더는 입력 Headers를 복사해 계산하고 거부 집계는 별도
함수에서 처리한다. 권한 확인 전 본문을 읽지 않는 경로와 settings PATCH의 기존
본문 우선 검증을 유지한다. 집중 검사 61/61·루트 타입 검사·diff 검사를 통과했다.
응답 형식·DB·의존성·CI 변경과 원격 반영은 없다.

## 모니터 상태 파일 포트와 취소 (2026-10-22)

withMonitorFile의 마지막 선택 옵션으로 좁은 files 포트·uuid·signal을 받는다. 관측
콜백이 취소를 무시해도 대기를 끝내고 잠금을 해제하며 늦은 결과는 저장하지 않는다.
파일 생성·쓰기·sync는 완료 후 소유 파일을 정리하고 rename 성공을 저장 완료로 취급한다.
CLI는 signal과 선택적 파일/UUID/timeoutSignal 포트를 전달한다. 메모리 파일 회귀와
기존 실제 파일/접근 검사 19/19, 루트 타입 검사·diff 검사를 통과했다. 쓰기/sync/rename
실패·단계별 취소·4096바이트 전후·공유 잠금을 확인했다. DB·API·의존성·CI 변경은 없다.

최종 관리자/서버 수집 검사 21/21와 Collector 런타임 타입 검사도 통과했다. 이번 변경의
집중 검사 합계는 178/178이다. 실제 프록시 장애 검사에서 기존 Windows workerd WSARecv
#64 진단이 있었지만 검사는 정상 종료했다. 전체 CI·원격 운영 검증·푸시·배포는 미실행이다.

## SDK 재시도 시계와 가상 deadline (2026-10-22)

BrowserPlatform에 선택적 monotonicNow를 추가했다. 기본 호스트는 날짜/HTTP-date와
재시도 경과 시간을 분리하며 기존 커스텀 호스트는 now로 호환된다. 유한 입력 제한으로
항상 16KiB에 들어가는 최대 20건을 한 번에 조립해 반복 문자열/크기 검사를 줄였다.
ServerPlatform의 선택적 timer는 모든 제한 시간 대기에 사용하고 생략 시 기존 타이머다.
SDK 검사 98/98, 두 SDK 빌드·루트 타입 검사·diff 검사를 통과했다. 원본/minified의
10분 직전/정확히/직후·시계 역행/전진·최대 길이 20건·가상 credential/request/body/wait
기한을 확인했다. gzip은 Sembom 3048, 퍼널 예제 3021, 생성 퍼널 3041 bytes로
3072 bytes 이하다. 필수 호출 인자·응답 형식·DB·의존성·CI 변경은 없다.

## OIDC 대기 제한과 선택적 시계/취소 (2026-10-22)

JWKS 전송을 deadline과 경합하고 오류/초과/취소 본문 정리를 기다리지 않는다. 선택적
now·monotonicNow·timeoutSignal로 JWT 시각·실패 cooldown·deadline을 제어한다. 호출별
signal은 공유 키 조회를 취소하지 않고 자기 대기만 끝낸다. 수집기 관리자/발행자 인증은
request.signal을 전달한다. 필수 인자·반환 타입·인증 실패 null 계약을 유지한다.
OIDC/실제 Worker 인증 검사 16/16, 루트 타입 검사를 통과했다. 기본 5초 허용 오차,
만료 경계·지연된 키 조회·끝나지 않는 cleanup·전송·공유 조회 취소를 확인했다.
API 응답 형식·DB·의존성·CI 변경은 없다. jose 내부 캐시 시계는 기존 구현을 유지한다.

## 수집 본문 취소와 요청 ID 주입 (2026-10-22)

`readBody`는 요청/선택적 caller signal과 기본 10초 읽기 기한을 처리한다. 초과 본문과
취소 시 reader 정리를 기다리지 않아 끝나지 않는 cancel promise가 오류 반환을 막지
않는다. 기존 필수 인자·반환 타입을 유지하고 CollectorOptions에 선택적 uuid를 추가했다.
본문·요청 ID·실제 Worker/D1 수집 검사 24/24를 통과했다. 16KiB 전후·멈춘 정리·
읽기 중 취소·읽기 기한을 확인했다. API 응답 형식·DB·의존성·CI 변경은 없다.

## SDK tarball과 외부 소비 프로젝트 (2026-10-21)

`npm pack --dry-run --json --ignore-scripts`에서 browser tarball에 현재 빌드가 생성하지
않는 `dist/src/index.d.ts`(1,999 bytes)가 포함되는 것을 확인했다. 두 SDK 빌드가 출력
폴더를 정리하지 않아 예전 산출물이 섞일 수 있었다. SDK 실제 경로가 checkout 안에
있는지 확인한 뒤 해당 `dist`만 지우도록 공통 출력 정리를 추가했다.

선택 명령 `npm run verify:sdk-packages`는 오래된 파일 회귀 probe를 넣고 두 SDK를
빌드·오프라인 pack한다. 정확한 파일 목록을 검사하고 작업공간 밖의 새 npm 프로젝트에
tarball을 오프라인·ignore-scripts·no-save로 설치한다. 그곳에서 세 ESM 진입점과 선언을
TypeScript NodeNext로 컴파일하고 비활성 browser/funnel 생성·해제와 server 이벤트
생성을 실행했다. 네트워크/토큰 콜백 호출 0, 실제 설치가 workspace symlink가 아님을 확인했다.

- 최종 `verify:sdk-packages`: 통과. browser 7파일/6,222 bytes, server 3파일/4,995 bytes.
  SHA-256·파일 목록·타입/실행 결과는 `.tmp/sdk-packages/run-IIxWCx/report.json`과 tarball에 있다.
- 초기 격리 설치는 상위 npm run이 재전달한 allow-scripts 설정 때문에 EALLOWSCRIPTS로
  실패했다. 설치된 npm의 정책 코드를 확인해 자식 환경의 재전달 값만 지웠다. 사용자
  .npmrc 정책과 ignore-scripts는 유지한다. 검증용 잘못된 프로젝트 ID도 수정한 뒤 최종 통과했다.
- `npm run check:browser-size`: 통과. Sembom 포함 gzip 3,067 bytes, 퍼널 예제 3,046,
  생성 퍼널 코드 3,068로 모두 3,072 bytes 이하이며 기존 값과 같다.
- CLI `--help`, 문서 상대 링크, `git diff --check` 통과. 실행 중 만든 외부 소비 프로젝트는
  정리했고 Git 제외 경로에 tarball과 보고서만 남겼다.

SDK 실행 소스·공개 API·DB·의존성·runner는 변경하지 않았다. 변경 없는 기능 테스트와
브라우저 온보딩 재실행은 생략했다. 버전 0.0.0·private true를 유지하며 registry 로그인·
게시·원격 변경은 없다. 라이선스·공개 scope·실제 서비스 설치는 미결정/미실행이다.

## 공개 제공자 검사 대기 제한 (2026-10-21)

공개 OIDC discovery/JWKS 검사에도 취소를 무시하는 전송과 끝나지 않는 body.cancel이
대기를 붙잡는 문제가 있었다. 새 회귀 검사는 수정 전 1초 제한으로 취소됐다. 기존 요청
생명주기 함수로 헤더·본문 대기를 취소와 경합하고, 실패/OPTIONS 응답과 reader 정리는
결과를 기다리지 않도록 고쳤다. 늦은 응답은 정리하고 검사 결과로 채택하지 않는다.

`node --test tools/runtime/test/install-check.test.ts` 5/5·루트 타입 검사·`git diff --check`
통과. 초기 수정 후 회귀 검사의 “모두 reject” 기대는 즉시 실패 보고서를 반환하는 정상
거부 경로와 맞지 않아, 제한 안에 reject하거나 실패 보고서를 내는지 확인하도록 수정했다.
공개 설정·키 fixture만 사용했으며 실제 제공자·원격 요청은 없다. API·DB·SDK·의존성·
runner 변경은 없고 변경 없는 관리자/SDK 빌드와 전체 검사는 생략했다.

## 현재 SDK 온보딩과 로컬 복구 확인 (2026-10-21)

- `npm run build:browser` 및 `npm run verify:admin-onboarding -- --channel chromium --lost-responses`
  통과. Chromium 156.0.8078.4에서 격리된 서명 로그인·빈 프로젝트 생성·첫 스키마 발행·
  생성된 SDK 실행·첫 이벤트 1건·관리자 표 표시를 확인했다. 생성/발행 성공 응답을 각각
  한 번 끊은 뒤 명시적 복구, 초안 교체, SDK 연결 단계도 통과했다. API read 31·write 5·
  browser batch 1, route/page 오류 0이다. 실제 서비스·제공자 요청은 없다.
- `npm run verify:restore` 통과. 새 합성 DB의 0001~0009 마이그레이션·16개 테이블을
  실제 로컬 Wrangler SQL export/import로 복원했다. 스키마/행 fingerprint 일치,
  quick_check ok·외래 키 위반 0·보호 쓰기 거부 5건을 확인했다. 복원 뒤 browser 재전송은
  accepted 0/duplicates 2, server는 accepted 0/duplicates 1이다. 발행자 회수·같은 밀리초
  재부여·stale 회수 거부·no-op 감사 보존도 통과했다. 백업 28,398 bytes, 총 약 18.3초다.
  보고서는 `.tmp/restore-drill/run-tlQofv/report.json`에 있다.

각 실행이 만든 브라우저·Vite·Miniflare는 종료했다. 합성 보고서/백업은 Git 제외 경로에
남겼다. 원격·기존 DB·운영 계정은 사용하지 않았으며 실제 RTO/RPO·서비스 파일럿·
모바일 검증으로 확대하지 않는다. 이 기록은 실행 코드·API·DB·의존성·runner를 바꾸지 않는다.

## 인증 접근 반복 점검 명령 (2026-10-21)

`monitor:access`를 추가했다. 기존 접근 검사 세 GET을 재사용하고 명시한 실패/복구 횟수·
최대 관측 간격으로 연속 실패·복구를 판단한다. 설치 공개 설정의 fingerprint와 정책을
상태에 묶으며 다른 대상·정책·시계 역행·손상 상태는 토큰을 읽기 전에 거부한다.
상태에는 고정 메타데이터만 쓰며 독점 잠금·sync/rename으로 교체한다. 취소 시 토큰 입력·
검사 대기를 끝내고 잠금을 정리한다. 알림 의도만 출력하며 실제 발송·주기 등록은 없다.

- `node --test tools/runtime/test/access-monitor.test.ts tools/runtime/test/install-access-check.test.ts`:
  14/14 통과. 실패/복구 임계값·간격 경계·정책/대상 불일치·손상/초과 파일·중첩 실행·
  토큰 입력 중 취소·이전 파일 보존을 확인했다.
- 실제 관리자 Worker 프록시·서명 OIDC·로컬 D1에서 정상 → 테이블 읽기 불가 3회 →
  복구 2회, 총 6회/GET 15건을 실행했다. event는 healthy·failure_pending·incident_opened·
  incident_ongoing·recovery_pending·incident_resolved였고 알림 의도는 열림/복구 두 번뿐이다.
  설치 파일 불변과 출력/상태의 토큰·issuer·subject·URL·테이블명 미포함도 확인했다.
- 루트 타입 검사·CLI `--help`·문서 상대 링크·`git diff --check` 통과.

workerd의 기존 Windows WSARecv #64 경고가 있었지만 집중 검사는 종료 코드 0이다.
실제 OIDC·원격 DB·스케줄러·알림 수신자는 미연결이다. 상태 교체와 stdout 전달은
별도이므로 알림 전달 보장은 없다. 변경 없는 관리자/SDK 빌드·전체 검사는 생략했다.
API·DB·의존성·runner·저장소 위생 설정 변경과 푸시·배포·게시는 없다.

## 설치 접근 검사 대기 제한 (2026-10-21)

취소를 무시하는 전송이나 끝나지 않는 응답 정리가 `install:access-check`를 붙잡던 경로를
재현했다. 수정 전 새 회귀 검사는 2초 제한으로 취소됐다. 기존 요청 생명주기 함수를
재사용해 헤더·본문 대기를 취소와 경합하고 정리는 결과를 기다리지 않는다. 늦게 도착한
응답은 본문을 정리하고 후속 읽기를 시작하지 않는다. 401/403 판정·본문 한도는 유지한다.

접근 검사 8/8(실제 관리자 프록시·서명 OIDC·로컬 D1 포함), 루트 타입 검사,
`git diff --check`를 통과했다. workerd의 기존 Windows WSARecv #64 경고가 한 번 있었고
검사 종료 코드는 0이다. 원격 제공자·D1·배포는 미실행이다. API·DB·SDK·의존성·runner·
저장소 위생 설정 변경은 없으며 변경 없는 관리자 UI·수집기 전체 빌드는 생략했다.

## 설계 상태와 남은 작업 정리 (2026-10-21)

현재 소스·package scripts·OIDC/운영 문서를 대조해 ARCHITECTURE의 관리자 미구현 표기와
위험 등록부의 재시도·영수증 TTL·권한·스키마·서버 발행·퍼널 미정 표기를 바로잡았다.
CONTRIBUTING에 현재 코드 변경·검증·커밋 절차를 적고, 로드맵 맨 앞에 실제 운영 연결·
파일럿·악용 방지 결정·공개 준비와 별도 후속 기능을 나눴다.

문서 상대 링크 존재와 `git diff --check`를 확인했다. 실행 코드는 변경하지 않아 테스트·
빌드는 생략한다. 라이선스·운영 정책·실제 제공자·원격 DB·푸시·배포·게시 상태는 바꾸지
않았다. API·DB·의존성·runner·저장소 위생 설정 변경은 없다.

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
