# 장애 대응

상태: 문서 전용 런북이다. 자동 알림·대시보드·헬스 엔드포인트는 배포하지 않았다. 대응은 콘솔
운영 로그, 배포 기록, D1을 사람이 직접 보며 진행한다. 이 문서는 대응 도구를 새로 만들지 않는다.

## 원칙

- 증거 먼저. 확인한 것과 추정을 구분하고, 확인 못 한 값은 비워 둔다.
- 통제는 이미 승인된 범위 안에서 먼저 한다. 노출 경로·writer 중지는 승인을 다시 받지 않는다.
  범위 밖의 새 외부 변경(재배포·복원·자격 증명 발급·provider 조정)만 별도 승인을 받는다.
- 증거는 비밀이 아닌 것만: `requestId`, 고정 `code`, 운영 카운터, UTC 시각, 배포 버전 ID.
- 평시 보고에 요청 본문·헤더·경로·쿼리·IP·토큰·계정 식별자를 넣지 않는다.
- 관리자 변경 이력·SQL 백업은 접근이 제한된 기존 자료로 다루고 평시 보고에 그대로 붙이지 않는다.

## 첫 10분

1. UTC 시각, 심각도, 영향을 받는 프로젝트 수를 적는다.
2. 운영 로그의 `http_request` 줄을 본다: `operation`(`browser_collection`·`server_collection`·
   `administrator`·`other`)·`status`·`code`·`latencyBucket`·`samplingDenominator`.
3. 실패 응답이 있으면 본문의 `requestId`로 그 응답과 로그 줄을 짝지어 확인한다.
4. 관리자 조회가 JSON 503으로 실패하면 관리자 edge 로그의 `admin_api_unavailable`(COLLECTOR
   바인딩 불가)을 본다. 이 코드는 `/v1` 프록시 JSON 503을 가리키며 정적 관리자 자산·화면 전체의
   상태가 아니다. 이 오류 본문에는 `requestId`가 없으니 없는 값을 만들지 않는다. 수집기 503은
   Retry-After 1이다.
5. 배포 버전 ID를 `deployments list`로 확인한다.
6. 확인된 노출·권한 침해가 보이면 해당 경로와 writer를 먼저 멈춘다. 통제할 수 없는 새 외부
   변경이 필요할 때만 그 범위에서 승인을 받는다.

로그 해석 한계: 성공은 1/64 표본, 실패는 전량이라 원시 줄 수로 실패율·p95를 계산할 수 없다.
`latencyBucket`은 I/O 뒤에만 진행하는 시계로 잰 거친 분포이므로 전체 응답 지연·CPU 시간·SLO의
근거로 쓰지 않는다. 로그가 없다고 장애가 없었다고 할 수 없다.

## 심각도 (영향 기준)

숫자 SLA는 없다. 대응·복구 시간 목표는 UNDECIDED이고 여기서 만들지 않는다.

| 등급 | 기준 |
| --- | --- |
| S1 | 확인된 데이터 노출·권한 침해, 전체 수집 중단 또는 광범위한 데이터 오염. 노출·침해는 프로젝트가 하나여도 S1이다. |
| S2 | 한 프로젝트 수집 중단·오집계, 또는 관리자 쓰기 불가 |
| S3 | 부분 저하, 우회 경로 있음, 영향 범위가 좁음 |
| S4 | 보존·데이터 위험이 없는 관측·정리 지연. 위험이 있으면 영향에 따라 상향한다. |

## 분류별 분기

### 수집 중단 (browser·server)

- `code`로 나눈다: `origin_denied`(browser Origin), `project_unavailable`(프로젝트 상태),
  `unknown_schema`(등록 스키마·버전 없음), `unauthorized`·`forbidden`(server 발행자 인증·권한),
  `quota_exceeded`(429 분당/일별 한도), `storage_unavailable`(503 저장소).
- 거부 진단 카운터(최근 7 UTC 날짜)의 고정 원인을 본다. 분모가 없어 거부율을 계산할 수 없다.
- **project status `paused`**: browser와 server 수집이 admission 뒤에서 멈춘다. 하지만 관리자
  읽기·쓰기, 발행자 등록·회수 CLI, scheduled 정리는 계속 돈다. `runCleanup`은 paused 프로젝트도
  처리한다. "paused = 완전 정지"로 보면 안 된다.

### 관리자·프록시·인증

- `/v1` JSON 503에 `admin_api_unavailable`이 보이면 COLLECTOR 서비스 바인딩 문제를 먼저 본다.
  이는 프록시 JSON 경로의 진단이고 정적 UI 전체 장애를 뜻하지 않는다. 정적 자산 문제는 따로 본다.
- 수집기 자체 오류면 401 `unauthorized`·403 `forbidden`·503 `storage_unavailable`을 나눈다.
- OIDC 검증기는 JWKS를 10분 캐시하고 갱신 실패 뒤 30초 쿨다운을 둔다. 키 삭제·회전이 캐시된
  토큰을 즉시 무효화하지 않고 로그아웃도 서버 측 폐기가 아니다.
- 자격 증명 사고는 provider·캐시 키와 함께 조정하고, D1에서는 관측한 `expectedRole`·
  `expectedGrantId`와 마지막 owner 보호를 지키며 grant·발행자·생성 권한을 회수한다. public
  client ID 삭제가 토큰을 폐기한다고 주장하지 않는다. 세부는 [OIDC](../backend/oidc.md)를 따른다.

### 집계·정리

- 일별 이벤트는 browser·server 출처를 따로 센다. workflow/funnel은 `startedAt` cohort라 이벤트
  발생 시각과 다르다. 프로젝트 시간대 날짜 끝 뒤 48시간 동안 잠정 집계다.
- 정리 로그는 `attempted`·`completed`·`failed`·`cursorAdvanced`만 담고 삭제 행 수는 없다. 실패한
  프로젝트도 커서를 앞으로 옮기므로 `cursorAdvanced=true`가 전체 정상의 근거가 아니다.
- 수집 정지·Cron 정지·paused는 서로 다르다. Cron만 멈추면 수집은 계속되고, 수집을 멈춰도
  scheduled 정리와 관리자 쓰기는 계속된다. 정리는 호스트 Cron을 빼고, 수집은 ingress·writer를
  따로 막는다.

### 프라이버시 침해

- 노출이 확인되면 먼저 노출을 멈춘다. 해당 경로·writer를 중지하고 필요하면 노출 키·공유를 멈춘다.
  이 통제는 이미 승인된 범위 안에서 즉시 한다.
- 조사에 필요한 고정 필드 운영 로그와 기존 관리자 감사·SQL 백업을 접근이 제한된 위치에서
  보존한다. 원문·토큰·식별자를 일반 보고서에 붙이지 않는다.
- 범위 밖의 새 외부 변경(재배포·복원·provider 조정)만 별도 승인으로 한다.

## 하지 말 것

- 디버깅하려고 인증·권한을 끄지 않는다.
- 저장된 eventId·재전송 한도 밖으로 ID나 시각을 바꿔 재전송하지 않는다. `occurredAt`은 수신 24시간
  전~5분 후만 받고, 영수증은 수신+48시간, workflow·funnel은 시작+72시간에서 만료된다. 날짜를
  옮기거나 시각을 되돌려 우회하지 않는다.
- 과거 구간을 backfill하거나 카운터를 임의로 만들지 않는다. 없는 수치를 추정으로 채우지 않는다.
- Tallyfin은 원본이 남지 않은 유실을 재구성하지 못한다. 다만 호스트가 정당한 원본을 보존하고
  있으면 그 원본으로 복구할 수 있으니, 유실 범위와 호스트 보존 여부를 나눠 보고한다.
- 브라우저 SDK는 메모리 40개·배치 20개, 상태 0/408/429/5xx만 최대 2회 재시도(총 3회 시도), TTL
  10분이다. `track`·`succeed`·`fail`의 true는 메모리 큐 수락이지 저장 완료가 아니다.
  서버 SDK는 기본 `maxAttempts` 3·
  `retryBudgetMs` 30000이며 상한이 10분 이내다. 실패·중단 배치는 이미 저장됐을 수 있으니 원래
  ID·시각·본문을 보존한다.

## 복구와 재개

- 복원은 백업 이후 회수된 grant·영수증·감사를 되돌린다. 백업이 회수된 발행 권한을 되살릴 수
  있으니 트래픽 전환 전에 grant와 owner/reader 경계를 다시 확인한다.
- 재개 조건: 테넌트 경계와 owner/reader가 확인되고, 분리한 검증 프로젝트에서 browser·server
  신규·중복 건수가 맞고, 정리 상태가 확인된다. 절차는 [롤백 런북](./rollback.md)과
  [백업·복구](./backup-and-restore.md)를 따른다.

## 인계·후속 기록

- 타임라인: UTC 시각별 감지·통제·확인 항목.
- 영향 갱신 초안: 확인된 것과 미확인을 나눠 적고 추정 수치는 넣지 않는다.
- 증거: `requestId`(비밀 아님), 고정 `code`, 카운터, 배포 버전 ID.
- 취한 통제와 원격 변경 여부, 미확인 항목.
- 종료 근거: 통제·검증 결과와 재개 조건 충족 여부.
- 재발 방지 담당자 지정: 근본 원인·후속 조치를 특정 담당자에게 배정한다.
- 담당자·알림 수신자·보고 대상은 UNASSIGNED·UNDECIDED이고 이 문서는 메시지를 실제로 보내지
  않는다.

## Owners

- Primary owner: UNASSIGNED
- Backup owner: UNASSIGNED
- Escalation path: UNDECIDED

## Validation

- 필수 검증 이름: [VALIDATION.md](../../VALIDATION.md)
- 릴리스 차단 여부: UNDECIDED
- 남은 운영 위험: UNDECIDED

## 근거

- [로그 경계](../backend/06-logging-and-observability.md), [운영 관측](./observability.md)
- [OIDC](../backend/oidc.md), [프로젝트 권한](../backend/02-authorization.md)
- [만료 정리](../backend/retention-cleanup.md), [백업·복구](./backup-and-restore.md)
- [Cloudflare Workers 롤백](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
