# 수집기의 로그 경계

상태: requestId/고정 코드 로그와 프로젝트별 거부 진단 집계를 로컬 구현·검증했다.
원격 관측·운영 배포는 아직 없다.

요청 본문·토큰·IP·Origin·전체 URL·속성 값을 로그나 분석 DB에 남기지 않는다.
진단에는 임시 requestId·고정 오류 코드·허용된 운영 카운터만 사용한다.
일별 제품 집계와 인프라 운영 관측은 분리한다. 악용 방지용 IP 처리와 보존 정책은
운영 활성화 전에 정하며, 그 목적의 IP를 제품 분석으로 재사용하지 않는다.
[이벤트 계약](./event-contract.md)을 참고한다.

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
