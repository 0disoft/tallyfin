# 검증 이력 16

원문의 구간 순서를 유지한 과거 기록이다. 명령과 코드 경로는 저장소 루트 기준이다.

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

## 외부 평가 후속: 조회 범위·버전·정리·공개 수집 보호 — 2026-10-23

로컬 커밋 86dabbd는 이벤트/개요/목표 화면의 조회 범위를 분리한다. 브라우저 이벤트 화면은
요약만, 개요는 첫 workflow만, 목표는 전체 workflow를 읽으며 직전 기간과 CSV도 같은
범위를 검증한다. 기존 전체 스냅샷 호출과 권한 상실 후 결과 제거를 유지한다.
README의 마이그레이션 수는 실제 0011까지 11개로 수정했다.
4c319a2는 최신 활성 스키마를 기본 선택하고, 수동 선택은 연결·프로젝트별로 보관한다.
SDK 안내도 retired 최신 버전을 건너뛰며 활성 버전이 없으면 코드를 제공하지 않는다.

cb9dd29는 매분 정리의 행 예산을 프로젝트 수·프로젝트별 일일 수신 한도에 맞춰
500~10,000행으로 조절한다. 2배 여유를 둔 계산값이며 실제 원격 처리량을 보장하지 않는다.
기본은 4개 프로젝트·페이지당 최대 45개 SQL, 선택적 4페이지는 최대 180개 SQL이다.
9개 삭제와 삭제 후 남은 만료 영수증 MIN 조회를 같은 batch에서 수행한다.
삭제 행·한도 도달 테이블·관측 프로젝트·만료 영수증 지연·계산상 용량 부족을 선택적
metrics로 로그/로컬 요약/관리자 보고서에 연결했다. 과거 20개 프로젝트 로그도 계속 읽는다.
만료/집계 보존기간, 커서 CAS, 20초 실행 예산과 30초 DB 수명을 유지했다.

139ce1e는 거부 Origin을 분당 DB 한도 쓰기 전에 반환한다. 따라서 admission 전 거부는
DB 거부 진단에 더하지 않고 기존 HTTP 관측 로그로 확인한다. 과거 원인 enum/저장값은
유지한다. 선택적 BROWSER_INGEST_LIMITER 호스트 포트는 브라우저 경로에서 DB/본문 전에
동작하며 429·Retry-After 60 또는 장애/취소/기한의 503을 반환한다. 기존 실제 I/O 동시성
제한을 공유하고 재시도하지 않는다. 서버 인증/발행 권한 순서는 유지한다.

최종 로컬 검증:
- 관리자 전체 `npm run test:admin`: 295/295. 신규 범위/CSV 회귀와 최신 활성 버전,
  빈/retired-only 목록, 페이지 순서, 취소·원본 오류 검사를 포함한다.
- 정리/로그 요약/진단/CLI 29/29; 수집/공개 admission/거부 진단 25/25;
  저장·거부·서버 발행·요청 수명 회귀 35/35. 직접 Node test runner로 순차 실행했다.
  마지막 admission 파일 3/3은 제한기 기한 검사를 추가한 뒤 다시 통과했다.
- 실제 임시 Miniflare D1: 1,201개 만료 영수증을 500개 삭제한 뒤 701개 잔량의
  만료 지연 1,234ms, 추가 삭제 후 null, 미만료 영수증 유지, 기본 SQL 50개 이하 확인.
- `npm run typecheck`(생성된 Collector/Admin 호스트 타입 포함), 관리자 최종 타입 검사,
  `npm run build:admin`, bundle 2/2·Sites 11/11, `git diff --check` 통과.
- 강화한 `npm run verify:admin-analysis-access`: Chromium 156.0.8078.4,
  latestActiveSchemaSelected/projectVersionSelectionsIsolated true, 이벤트 화면 workflow
  요청 0회, API 읽기 36·쓰기 0, pageErrors 0·routeError false. 합성 로컬 OIDC와 실제 D1로
  최신 v3 retired를 건너뛰고 v2 선택, 프로젝트별 수동 v1 유지, CSV 격리, 권한 회수/복구,
  늦은 403 폐기, 연결 해제, 기존 시간대/응답 크기 경계를 확인했다.
  증거는 `.tmp/admin-analysis-access-zLgePr/report.json`이다. runner는 자기 프로세스를 정리한다.

미실행/남은 범위:
- 루트 전체 테스트와 변경하지 않은 SDK 검사는 반복하지 않았다. 이번 실행은 변경한
  관리자/저장 정리/수집 보호와 연결 회귀에 한정한다. 일반 소스 lint 명령은 없다.
- 실제 OIDC 제공자·원격 D1 처리량/비용·운영 Cron·제한기 바인딩 활성화는 하지 않았다.
  운영 설정 묶음과 실제 트래픽이 없어 원격 정확도·용량을 주장하지 않는다.
- 앞단 제한기는 호스트가 연결해야 동작하고 위치별 근사 제한이므로 기존 DB 한도를
  대체하지 않는다. Origin 위조 자체를 인증으로 차단하지 않는다.
- SDK 진단 훅·공개 릴리스/라이선스, 통합 서비스 화면과 소요시간/장기 집계는 이번
  결함 수정 묶음에 포함하지 않았다.

소유 문서: OpenAPI 수집 동작 설명, backend collector/event-contract/retention-cleanup/
logging 문서, frontend 설계, ops observability, LOG-SUMMARY, README와 이 기록을 갱신했다.
API 요청·응답 형태와 DB 스키마/마이그레이션은 그대로다. 저장 내부 cleanup 한도와
공개 수집 거부 순서/DB 진단 포함 범위는 변경됐다. 선택적 로그 metrics는 이전 형식과
함께 읽는다. 의존성·저장소 위생·CI 러너 설정은 바꾸지 않았으며 기존 옵트인 브라우저
검사만 확장했다. 푸시·배포·SDK 게시는 하지 않았다.

## 장애 격리·부분 분석·전달 진단·통합 현황 후속 — 2026-10-23

c715e58은 공개 제한기와 DB의 실제 I/O 실행 한도를 분리한다. 제한기 기본 상한은 4이며
선택적 maxPublicOperations로 조절한다. 기존 maxDatabaseOperations는 DB에만 적용한다.
제한기 2개가 응답하지 않은 채 요청이 취소된 조건에서도 인증된 관리자 프로젝트 조회는
200을 유지한다. 제한기 자리만 포화되며 실제 I/O 종료 전 조기 반환하지 않는다.

444e022는 스키마 자동 선택 체크로 수동 고정을 해제하고 최신 활성 버전을 다시 읽는다.
다른 프로젝트의 고정값은 유지한다. 14a8f47은 목표 workflow의 일반 장애/계약 오류를
패널별 실패로 분리하고 정상 workflow·퍼널을 유지한다. 재시도는 실패한 현재 workflow만
조회하고 정의 순서대로 합친다. 401/403은 전체 권한 처리로 전파하며 현재/직전 기간에
빠진 workflow가 있으면 CSV를 잠근다. 이전 기간 비교는 현재 패널 복구만으로 재조회하지
않으며 별도 재시도를 제공한다. 비교할 수 없는 값은 null로 유지한다.

3fd006b·eaccd35는 브라우저의 선택적 동기 onDelivery(state, events) 콜백을 추가한다.
HTTP 수락·재시도·실패·기한·큐 초과·destroy 폐기·주입 호스트의 beacon 큐 수락을 구분한다.
원문·이벤트 이름/ID·URL을 전달하지 않는다. 관측 콜백의 예외/재진입은 전송에 영향을
주지 않는다. accepted는 HTTP 수락 수이고 신규 집계 건수/전달 완전성을 뜻하지 않는다.
SDK 단독 3KiB 한도는 유지한다. 진단 추가로 대표 연동 합계가 기존 3KiB를 초과하여,
통합 예산을 3.25KiB(3328B)로 명시적으로 조정했다. 스키마/입력 검증을 제거하지 않았다.
공용 size-policy를 생성 코드 검사와 공유한다. 최종 gzip은 기본 SDK 2903B·Sembom 3179B·
퍼널 SDK 3028B·퍼널 예제 3157B·관리자 생성 퍼널 코드 3182B다.

8bce2f3은 개요에 명시적으로 여는 서비스 통합 현황을 추가한다. 현재 페이지 최대 5개
프로젝트, 프로젝트 작업 2개와 기존 HTTP 상한으로 읽고 자동 폴링은 하지 않는다.
선택 출처/최신 활성 버전의 최근 7일 이벤트·직전 7일 변화, 첫 등록 workflow 완료율·
변화, 프로젝트 전체 최근 수신과 최근 UTC 7일 DB 거부 건수를 분리해서 보여준다.
완료율을 서비스 간 합산하지 않고 활성 스키마 없음/조회 실패/미수신/실제 0을 구분한다.
기존 API를 조합한 제한된 페이지 구현으로, 전체 서비스를 한 번에 읽는 벌크 API는 아니다.

검증:
- public-admission 4/4: 차단 시 DB 미접근, 서버 인증 순서, 장애/취소/기한,
  거부 Origin의 정상 한도 미소모와 새 실행 한도 격리 회귀.
- 브라우저 SDK 전체 64/64: 새 전달 진단 3개, 예외/재진입, 재시도 소진, 큐 초과와
  destroy, beacon 큐 수락과 HTTP 수락 구별을 포함한다.
- 관리자 전체 최종 298/298. 부분 실패/CSV 검증, 권한 오류 전파, 패널 복구와
  통합 현황의 5개 상한·작업 2개·순서·0/null 구분·취소 검사를 포함한다.
- npm run typecheck, 최종 관리자 타입 검사/빌드, build:browser, check:browser-size,
  bundle 2/2·Sites 11/11, git diff --check를 통과했다. 생성 코드 예산 검사도 6/6이다.
- 강화한 verify:admin-analysis-access: Chromium 156.0.8078.4,
  automaticVersionRestored/projectOverviewVerified/latestActiveSchemaSelected true,
  이벤트 화면 조회 완료 후 workflow 읽기 0회, pageErrors 0·routeError false,
  API 읽기 57·쓰기 0·브라우저 수집 0. 이전 CSV/권한/연결 종료 경계도 통과했다.
  증거는 .tmp/admin-analysis-access-gsIKQR/report.json, 화면은 project-overview.png다.
  취소된 소켓에 workerd Windows WSARecv #64 진단이 한 번 있었지만 검증은 통과했다.
- 최종 verify:admin-goal-access: Chromium 156.0.8078.4, workflow 503 패널 복구,
  정상 퍼널 유지와 기존 실제 D1 권한 회수/복구 7개 시나리오, 화면/내려받은 CSV 비교,
  늦은 거부 응답과 연결 종료를 통과했다. API 읽기 69·쓰기 0·pageErrors 0이다.
  증거는 .tmp/admin-goal-access-wnFSyB/report.json이다.
- 분석 브라우저 검사의 초기 event-workflow-count 실패는 화면 전환 전에 전송한 개요
  요청을 이벤트 화면 읽기로 세던 경계 문제였다. 이벤트 조회 완료 후부터 관측하도록
  바로잡았으며 초기 이벤트 loadPeriod가 workflow를 읽지 않는 단위 검사는 유지했다.
- SDK 통합 크기 검사의 초기 실패는 공유 예산과 관리자의 생성 코드 검사가 다른 상수를
  쓰던 문제를 드러냈다. 둘 다 같은 예산을 읽도록 정리한 뒤 전체 관리자 검사를 통과했다.

루트 전체 테스트와 변경하지 않은 저장/서버 SDK/운영 부하 검사는 반복하지 않았다.
변경한 경로와 연결 회귀에 집중했으며 일반 lint 스크립트는 없다. 실제 제공자/원격 D1,
제한기 바인딩 활성화, 트래픽 비용·용량·SLO는 검증하지 않았다. 합성 로그인/임시 D1
검증이며, 통합 현황의 수신 없음이나 단기 완료율 변화로 운영 장애를 확정하지 않는다.

제품 명세·성능 예산·browser-sdk·frontend 설계·collector 문서·README·이 검증 기록을
갱신했다. 공개 SDK 옵션/타입은 추가했고 기존 필수 시그니처는 유지한다. HTTP API 형태·
DB 스키마/마이그레이션·보존 정책·의존성·저장소 위생·CI 러너 설정은 바꾸지 않았다.
기존 옵트인 브라우저 검사만 확장했다. 로컬 main 커밋이며 푸시·배포·공개 배포는 없다.
