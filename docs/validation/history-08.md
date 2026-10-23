# 검증 이력 08

원문의 구간 순서를 유지한 과거 기록이다. 명령과 코드 경로는 저장소 루트 기준이다.

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

계약 원본 [로그 경계](../backend/06-logging-and-observability.md)·[수집기
구현](../backend/collector.md)·[운영 관측](../ops/observability.md)·[로드맵](../product/01-roadmap.md)과
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

계약 원본 [설치 안내](../backend/installation.md)·[로드맵](../product/01-roadmap.md)·
[접근 확인 안내](../../tools/runtime/INSTALL-ACCESS-CHECK.md)를 갱신했다. API·DB·SDK·의존성·CI
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

이번 DB 슬라이스에서 바뀐 계약 원본은 [db/schema.dbml](../../db/schema.dbml)의 `project_publishers`
`grant_id` 하나이고, HTTP 회수 계약(`api/openapi.yaml`)과 관리자 화면 UI는 다음 슬라이스로
넘긴다. 마이그레이션은 [마이그레이션 안내](../../db/migrations/README.md)와
[0009 SQL](../../db/migrations/0009_publisher_generations.sql), 발행자 CLI·설치 안내에 기록했다.
설치 메타데이터 기준 참조도 9개 마이그레이션·16개 테이블로 갱신했다. 의존성·CI 러너·저장소
위생 정책 변경은
없다. 실제 운영 OIDC·원격 D1 적용·권한 이관·푸시·배포는 미실행이며, 원격 D1에는 어느
마이그레이션도 적용하지 않았다.
