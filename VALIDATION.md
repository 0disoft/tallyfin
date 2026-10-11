# 검증

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
