# 운영 관측

상태: 수집기 완료 관측 로그를 로컬에서 구현·검증했다. 운영 로그 수집·대시보드·알림
수신자·헬스 프로브·traces는 배포하지 않았다. 임계값·담당자·로그 보존 기간 같은 실제
운영 설정값은 정하지 않았다(UNDECIDED).

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

## 지금 할 수 있는 증거

- 고정 필드로 묶어 `operation`·`status`·`code`별 빈도와 `latencyBucket` 분포를 볼 수 있다.
- 4xx(입력·권한·설정 문제)와 5xx(저장소·서버 문제)를 나눠 급증을 볼 수 있다.
- 같은 `requestId`가 오류 응답 본문과 로그에 함께 있으므로 한 건을 짚어 본문과 로그를
  대조할 수 있다.

`latencyBucket`은 거친 분포다. 배포된 Worker의 `performance.now()`는 I/O 뒤에만 진행하므로
CPU 시간이나 실제 전체 지연이 아니고 SLO 판정 근거가 아니다. 로컬 타이머는 배포 시계와
다르다.

## 로그 요약 도구

```powershell
Get-Content app-log.ndjson | node tools/runtime/summarize-observations.ts --stdin
```

표준 입력의 앱 NDJSON에서 직접 낸 `http_request` 줄을 세어 `operation`·`status`·`code`·
`latencyBucket`별 관측 수와 가중 어림을 JSON 한 건으로 낸다. `requestId`·원문은 출력에 넣지
않고 조회·파일 쓰기·네트워크를 하지 않는다. Windows에서는 `npm.ps1` 파이프 대신 직접 node나
`npm.cmd` 별칭을 쓴다. 계약과 한계는
[로그 요약 안내](../../tools/runtime/LOG-SUMMARY.md)에 둔다.

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

운영 알림 수신자·대시보드·헬스 프로브·로그 보존 기간은 배포하지 않았다. 임계값과 담당자는
정하지 않았고 임의로 만들지 않는다(UNDECIDED).

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
