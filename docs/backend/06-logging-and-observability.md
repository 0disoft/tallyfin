# 수집기의 로그 경계

보존 정리의 retention_cleanup 로그는 정상·예외·취소 모두 최종 execution 진단을 남긴다.
실행 시간·예약 지연·중단 이유·결과 미확인 작업·CAS로 확인한 진행량만 기록하고 원본 오류와
프로젝트 식별자는 배제한다. 같은 runId의 retention_cleanup_failed 표시는 중복 실행이 아니다.
로그 호환성과 시간 측정의 한계는 [운영 관측](../ops/observability.md#정리-실행의-지연과-중단-이유)을 따른다.

상태: requestId/고정 코드 로그와 프로젝트별 거부 진단 집계, 완료 관측 로그(`http_request`)를
로컬에서 구현·검증했다. 원격 로그 수집·대시보드·알림 수신자·운영 배포는 아직 없다.
운영 관측 설정값은 정하지 않았고 [운영 관측](../ops/observability.md)에 UNDECIDED로 둔다.

요청 본문·토큰·IP·Origin·전체 URL·속성 값을 로그나 분석 DB에 남기지 않는다.
진단에는 임시 requestId·고정 오류 코드·허용된 운영 카운터만 사용한다.
일별 제품 집계와 인프라 운영 관측은 분리한다. 악용 방지용
IP 처리와 보존 정책은 운영 활성화 전에 정하며, 그 목적의 IP를 제품 분석으로 재사용하지
않는다. [이벤트 계약](./event-contract.md)을 참고한다.

## 완료 관측 로그

`request-observation.ts`가 응답이 준비된 시점에 한 줄을 남긴다. 필드는 고정 일곱 개다.
`event`·`requestId`·`operation`·`status`·`code`·`latencyBucket`·`samplingDenominator`
밖의 값은 투영하지 않으므로 나중에 늘어난 내부 필드가 로그로 새지 않는다. 관측 때문에 DB를
더 읽거나 쓰지 않고 네트워크를 부르지 않으며 의존성도 늘리지 않는다.

이 운영 로그 한 줄에는 경로·조회 파라미터·메서드·헤더·프로젝트 ID·발행자/관리자
식별자가 들어가지 않는다. 프로젝트 ID·grant 식별자 같은 값은 제품·관리 데이터로서
프로젝트 키로 저장되는 별도 계약에 속하며, 여기서 정하는 배제는 이 로그 줄에 한정한다.

- `event`: 항상 `http_request`.
- `requestId`: 요청마다 만든 무작위 UUIDv4. 오류 응답 본문의 `requestId`와 같은 값이다.
- `operation`: `browser_collection`·`server_collection`·`administrator`·`other` 중 하나.
  경로를 담지 않으므로 그 밖의 요청은 `other`로만 남는다.
- `status`: HTTP 상태 코드.
- `code`: `ok` 또는 고정 `ErrorCode`.
- `latencyBucket`: `lt_10ms`·`lt_50ms`·`lt_250ms`·`lt_1000ms`·`gte_1000ms`·`unknown`.
- `samplingDenominator`: 성공 64, 실패 1.

표본은 성공 응답만 줄인다. `code`가 `ok`이고 `status`가 200·204인 응답은 UUID 앞 두 글자가
가리키는 256칸 중 4칸, 즉 1/64만 남기고 `samplingDenominator`에 64를 적는다. 그 밖의 응답은
상태와 상관없이 모두 남기고 1을 적는다. 로그 수준은 5xx `console.error`, 4xx `console.warn`,
그 밖 `console.log`다.

선택된 응답 하나에 앱 로그는 최대 한 줄이다. 네이티브 Worker(`index.ts`)는 오류 전용 `log`
포트 대신 이 관측 포트만 넘기므로 같은 응답에 줄이 겹치지 않는다. `log` 포트는 남아 있고
호스트가 넘기면 `{requestId, code}`만 남긴다. 관측 콜백은 동기다. 프로미스를 돌려주는
비동기 관측은 지원하지 않는다.

측정 구간은 핸들러 시작부터 응답 객체가 준비될 때까지다. `waitUntil`로 넘긴 백그라운드
작업(거부 기록 등)과 네트워크 전송·클라이언트 수신은 포함하지 않는다. 시계는 선택적
`monotonicNow` 포트(기본 `performance.now()`)를 쓴다. 값이 유한하지 않거나 음수면 시각을
쓰지 않고, 끝 시각이 시작 시각보다 작으면 `unknown`이다. 관측 콜백이 예외를 던지거나 시계
호출이 실패해도 응답은 그대로다.

배포된 Worker의 `performance.now()`는 I/O 뒤에만 진행한다. 그래서 이 버킷은 CPU 시간이나
실제 전체 지연, SLO 판정 근거가 아니라 거친 분포다. 로컬 Miniflare/Node 타이머는 배포
시계와 다르다.
[Workers performance](https://developers.cloudflare.com/workers/runtime-apis/performance/)를 따른다.

성공과 실패의 표본 비율이 달라 원시 로그 줄 수로 실패 비율을 계산하면 왜곡된다. 전체
규모는 성공 줄에 64, 실패 줄에 1을 곱해 어림하며, 그 값은 정확한 방문자 수·요청 수나
p95 같은 백분위가 아니다.

응답을 만든 요청만 이 로그에 남는다. Worker 시작 실패, 요청 처리 밖 예외, 플랫폼이 거부한
요청, 호스트가 관측 포트를 넘기지 않은 구성은 남지 않는다. 플랫폼의 로그 수집·표본·절단은
앱이 통제하지 않으므로 로그가 없다고 장애가 없었다는 근거가 되지 않는다.

## 거부 진단

거부 진단은 기존 분당 admission 행에 고정 원인별 건수·거부 요청 수신 시각만 기록한다.
분당 초과는 같은 SQL 쓰기 안에서 기록하고 그 밖은 admission 통과 후 한 번만 기록한다.
실제 Worker는 ExecutionContext.waitUntil으로 응답 뒤 작업을 추적한다. 별도 호스트에
waitUntil이 없으면 await하고, sink 오류는 원래 응답을 바꾸지 않고 재시도/원시 오류
로그를 남기지 않는다. [Workers waitUntil](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil)을 따른다.

최근 7개 UTC 날짜의 거부 기록만 보존하고 제품 이벤트/목표 집계와 구분한다. 고정
원인은 minute_limit/daily_limit·origin_denied·project_unavailable·unknown_schema·
invalid_request·invalid_event·event_conflict·attempt_conflict·storage_unavailable이다.
minute/daily는 HTTP quota_exceeded의 범위를 구분한다. 공개 수집 요청은 신뢰할 수
없는 입력이며 이 수치는 그 요청의 거부 현황이지 진짜 방문자 수나 전달 완전성이 아니다.
coverage best-effort로 누락 가능성을 명시하고, 알 수 없는 프로젝트·관리자 실패·
admission DB 실패·기록 기능 도입 전 이력은 집계하지 않는다. 거부율 분모는 제공하지 않는다.

2026-10-23부터 admission 전 거부 Origin과 선택적 앞단 제한은 DB 진단에 합산하지 않고
HTTP 로그에 남긴다. 과거 origin_denied DB 기록은 보존기간까지 계속 조회할 수 있다.
