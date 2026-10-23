# 검증 이력 09

원문의 구간 순서를 유지한 과거 기록이다. 명령과 코드 경로는 저장소 루트 기준이다.

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

[설치 설정 준비](../backend/installation.md)에 `field` 안내를, [README](../../README.md)에 현재
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
전송·본문 무저장 규칙은 그대로다. [이벤트·집계 계약](../backend/event-contract.md)과
[브라우저 SDK](../backend/browser-sdk.md)의 실패 정책·전송 계약 문장을 갱신했다.

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
