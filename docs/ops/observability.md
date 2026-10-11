# 운영 관측

상태: 수집기 완료 관측 로그를 로컬에서 구현·검증했다. 운영 로그 수집·대시보드·알림
수신자·traces는 배포하지 않았고, 관리자 저장소 read 프로브는 코드에만 있고 원격 실행·
스케줄이 없다. 임계값·담당자·로그 보존 기간 같은 실제 운영 설정값은 정하지 않았다
(UNDECIDED).

## 지금 있는 관측

운영 관측은 수집기 앱 로그를 기본으로 한다. 응답이 준비된 시점에 `request-observation.ts`가
고정 필드 `event: http_request`·`requestId`·`operation`·`status`·`code`·`latencyBucket`·
`samplingDenominator` 일곱 개만 담은 JSON 한 줄을 남긴다. 성공(200·204)은 UUID 앞 두
글자 기준 4/256(1/64)만 남기고 `samplingDenominator=64`, 실패는 전량 남기고 1이다.
로그 수준은 5xx `console.error`, 4xx `console.warn`, 그 밖 `console.log`다. 정리 작업
로그(`retention_cleanup`·`retention_cleanup_failed`)는 그대로다. 필드·측정 구간·한계는
[로그 경계](../backend/06-logging-and-observability.md)에 둔다.

Wrangler 관측 설정도 그대로다. `observability.logs`는 enabled·`invocation_logs` false·
`head_sampling_rate` 1이고 `traces`는 disabled, `send_metrics`는 false다. 자동 traces와
호출 로그에는 요청 URL이 들어가 제품 프라이버시 계약과 충돌하므로 켜지 않는다.

## 관리자 저장소 read 프로브

수집기에 관리자 전용 `GET /v1/health` 계약이 있다. 공개 헬스 체크가 아니고 검증된 관리자
bearer가 있어야 한다. `/v1/identity`와 같은 `validGrantIdentity` 검사를 통과한 principal을
요구하며 project grant나 creator 권한은 필요 없다. GET만 허용하고 쿼리 파라미터를 받지
않고 요청 몸체를 읽지 않는다. 응답은 `Cache-Control: no-store`·`Vary: Authorization`을 쓰고
CORS 허용 헤더를 붙이지 않는다.

성공하면 `{status:'ok', scope:'administrator_storage_read'}` 두 필드만 돌려준다. 그때 D1에
`projects`·`project_grants` 각각 `SELECT 1 AS available ... LIMIT 1`을 한 배치 두 읽기로
실행한다. 빈 테이블도 성공이고 행 내용·project·identity는 노출하지 않는다. DB 쓰기·수집
할당량·부하 백오프는 쓰지 않는다. `scope`의 뜻은 관리자 제어면 테이블 두 개를 그 시점에
읽을 수 있었다는 것까지다.

실패는 기존 오류 형식 그대로다. 인증 없음·무효·비활성은 401에 `WWW-Authenticate: Bearer`,
허용하지 않는 쿼리 파라미터는 400, GET이 아니면 405에 `Allow: GET`, D1 읽기 실패나 호스트
probe 미연결은 503에 `Retry-After: 1`을 붙이고 `{error:{code,message,requestId}}`를
돌려준다(기존 상관 ID 그대로).

이 성공은 수집 쓰기·집계 정확성·16개 테이블 전체·Cron·로그 완전성·서비스 전체 정상을
증명하지 않는다. native `createWorker`는 verifier가 있을 때 `admin.checkReadiness` 포트를
연결하고, 호스트가 `createCollector`에 `admin.checkReadiness`를 넘기지 않으면 항상 503
`storage_unavailable`이다. 지금은 코드 로컬 구현뿐이라 운영 probe 스케줄·실제 provider
OIDC·알림 수신자·원격 배포는 없다. 이 계약은 로컬 검증을 마쳤고 결과는
[VALIDATION.md](../../VALIDATION.md)에 있다.

관리자 앱의 설정 화면에는 이 엔드포인트를 수동으로 부르는 `저장소 읽기 확인` 패널이 있다. 펼쳐도 요청하지
않고 버튼을 눌러야 한 번 호출하며 자동 폴링·JSON·식별자 표시가 없다. 성공하면 이번 확인 시각을
보여주는데 지표 갱신 시각이 아니고, 실패하면 오류 문구만 남기고 성공 표시는 지운다. 닫기·
연결 교체에서는 요청을 취소하고 늦은 응답을 폐기한다. 요청은 5초 뒤 취소하고 직접 재시도할
수 있다. Chrome·임시 서명 OIDC·로컬 D1로 정상·장애·잘못된 응답·시간 초과·재연결과
320px 화면을 검증했다. 실제 OIDC 제공자·원격 상태 확인은 아직 없고 결과는
[VALIDATION.md](../../VALIDATION.md)에 있다.

## 지금 할 수 있는 증거

- 고정 필드로 묶어 `operation`·`status`·`code`별 빈도와 `latencyBucket` 분포를 볼 수 있다.
- 4xx(입력·권한·설정 문제)와 5xx(저장소·서버 문제)를 나눠 급증을 볼 수 있다.
- 같은 `requestId`가 오류 응답 본문과 로그에 함께 있으므로 한 건을 짚어 본문과 로그를
  대조할 수 있다.

`latencyBucket`은 거친 분포다. 배포된 Worker의 `performance.now()`는 I/O 뒤에만 진행하므로
CPU 시간이나 실제 전체 지연이 아니고 SLO 판정 근거가 아니다. 로컬 타이머는 배포 시계와
다르다.

## 로그 요약 도구

관리자 설정의 `운영 로그 보고서`는 이 도구의 v2 JSON 파일을 브라우저 안에서 읽어 표로
표시한다. 관측 수·가중 요청 어림·진단·HTTP 응답/지연 구간·정리 실행/처리 횟수를 구분한다.
파일은 전송·저장하지 않고, 8MiB 상한과 합계 검증·페이지 나누기·닫기/재연결 시 지우기를
적용한다. 로그 확보·원격 모니터링은 별도이며 [로컬 보고서 안내](local-report-viewer.md)에
사용법과 범위를 적었다.

```powershell
Get-Content app-log.ndjson | node tools/runtime/summarize-observations.ts --stdin
```

표준 입력의 앱 NDJSON에서 직접 낸 `http_request` 줄을 세어 `operation`·`status`·`code`·
`latencyBucket`별 관측 수와 가중 어림을 JSON 한 건으로 낸다. `requestId`·원문은 출력에 넣지
않고 조회·파일 쓰기·네트워크를 하지 않는다. Windows에서는 `npm.ps1` 파이프 대신 직접 node나
`npm.cmd` 별칭을 쓴다. 계약과 한계는
[로그 요약 안내](../../tools/runtime/LOG-SUMMARY.md)에 둔다.

확보한 Wrangler tail JSON은 `--stdin --wrangler-tail`로 읽는다. 여러 줄 객체에서 단일
console JSON 문자열만 검증·집계하고 URL·헤더·예외는 버린다. 플랫폼의 추가 샘플링과 누락은
보정하지 않으며, 앱 관측이 없으면 `no_observations`로 거부한다. 이 경로도 로컬 입력만 읽고
원격 세션을 열지 않는다. 상한과 보고서 입력 수의 의미는 위 안내에 적었다.

`coverage`는 받은 앱 로그 줄에 한정하고 `exactRequestCounts`·`latencyPercentilesAvailable`·
`timeWindowAvailable`은 항상 false다. 관측 응답 수와 가중 어림은 다르며 실패율·p95·SLO 근거로
쓰지 않는다.

표준 입력의 정리(cleanup) 로그도 같은 도구가 `runId`로 이어 붙인다. `attempted`는 프로젝트
시도 횟수 합계, `completed`는 정리 호출 성공 수이지 삭제 행 수가 아니며 `cursorAdvanced=true`도
프로젝트 실패가 없었다는 뜻이 아니다. 상세 보고가 없는 실행은 미관측으로 남는다. 정리 기록만
있으면 `observedResponses=0`으로 정상 보고한다.
`cleanup.reportedRuns`가 처리 횟수 집계의 범위이고, `cleanup.reportlessFailureRuns`는 상세가
누락된 실패 실행 수다. `cleanup.failedProjects`·`cursorNotAdvancedReports`·`failureMarkerRuns`를
함께 보되 서로 겹치는 실행 수를 더해서 총 실패 실행 수로 쓰지 않는다.

보고서에는 진단 객체 `diagnostics`가 additive로 붙는다(`tallyfin.observation-diagnostics/v1`).
`serviceHealth`는 항상 `unknown`이고 `coverage`가 http·cleanup·cleanupDetails·otherLogsIgnored를 나눠
본다. `findings`는 `error`·`review` 항목과 `observedCount`·고정 `action` 코드를 담고, HTTP 응답
하나는 최대 한 항목에만 든다. `cleanup_failures`는 실패 표시·`failed>0`·커서 미전진 실행의 고유
`runId` 합집합이고 `cleanup_report_missing`과 겹칠 수 있다. `observedCount`는 관측 수이지 가중치나
실패율이 아니며, 관측 수가 0인 항목은 넣지 않으므로 오류 0건도 서비스 정상 근거가 아니다. 4xx
`review`는 정상 보호 동작일 수 있다. CLI 옵션·상한·종료 코드는 그대로이고 알림·네트워크·임계값은
없다.

## 지금 할 수 없는 증거

로그 줄 수로 실패 비율을 바로 계산할 수 없다. 성공은 1/64, 실패는 전량이라 섞어 세면
왜곡된다. 전체 규모는 성공 줄×64 + 실패 줄×1로 어림하며, 그 값은 정확한 방문자·요청 수나
p95 같은 백분위가 아니다.

로그가 없다고 장애가 없었다고 할 수 없다. 앱은 실패 응답도 전량 남기려 하지만 플랫폼의
로그 수집·표본·절단이 줄일 수 있고, Worker 시작 실패·요청 처리 밖 예외·플랫폼이 거부한
요청·호스트가 관측 포트를 넘기지 않은 구성은 남지 않는다. 관측 콜백이 실패하면 그 줄만
없어지고 응답은 그대로이며, 실패 자체를 알리는 경로는 없다.

운영 알림 수신자·대시보드·로그 보존 기간은 배포하지 않았다. 관리자 read 프로브는 코드에만
있고 원격 실행·스케줄이 없다. 임계값과 담당자는 정하지 않았고 임의로 만들지 않는다
(UNDECIDED).

## 알림 설계 근거

임계값·수신자·억제 규칙은 운영 리소스와 담당자를 정한 뒤 확정한다. 그전에 쓸 수 있는
근거는 위 고정 필드 그룹이다. 예를 들어 `operation`·`status`·`code`로 묶은 5xx 급증이나
`storage_unavailable`·`quota_exceeded`·`origin_denied` 같은 특정 코드의 증가를 보는 식이다.
어떤 그룹을 어떤 값으로 어디에 알릴지는 UNDECIDED다.

관측 로그는 증거의 일부일 뿐이다. 거부 진단은 프로젝트별 분당/일별 고정 원인만 최근 7개
UTC 날짜 동안 보존하고 거부율 분모를 제공하지 않는다. 장애 조사 기록과 보존 정책은
[장애 대응](./incident-response.md)과 [운영 계약](./00-operational-contract.md)을 따르며,
실제 수치와 담당자는 그 문서들이 확정될 때 맞춘다.

## 검증

- 필수 검증 이름: [VALIDATION.md](../../VALIDATION.md)
- 릴리스 차단 여부: UNDECIDED
- 남은 운영 위험: UNDECIDED
