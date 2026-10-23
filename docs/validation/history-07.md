# 검증 이력 07

원문의 구간 순서를 유지한 과거 기록이다. 명령과 코드 경로는 저장소 루트 기준이다.

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
