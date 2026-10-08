# 저장 모델

상태: [DBML](../../db/schema.dbml)와 SQL 마이그레이션을 Miniflare D1에서 로컬 검증했다.
원격 DB에는 적용하지 않았다.

프로젝트/불변 스키마/관리자 grant와 일별 이벤트/목표 집계를 저장한다.
event_receipts는 원문 대신 eventId와 정규화된 payload 해시를 48시간,
workflow_attempts는 작업별 최소 연결 상태를 시작 후 72시간 유지한다.
방문자·원시 이벤트 테이블은 없다. 관리자 issuer/subject는 제어 영역이며
방문자 분석에 사용하지 않는다.

영수증·시도·UTC 일별 신규 영수증 할당량·집계는 단일 트랜잭션으로 반영한다.
일별 집계는 프로젝트-local 오늘을 포함한 90일이다. 프로젝트와 버전은 모든
집계 키와 외래 키에 포함한다. 만료/범위/정수/흐름 제약은 SQL 구현과 코어에서
강제하며 로컬 테스트로 확인했다. 자세한 규칙은 [이벤트 계약](./event-contract.md)을 따른다.

`retention_cleanup_state`는 방문자/집계와 분리된 단일 행 운영 상태다. 만료 정리의
마지막 프로젝트 ID와 revision을 보관해 Worker 재생성 뒤에도 순회를 이어간다.
자세한 조건은 [자동 정리](./retention-cleanup.md)를 따른다.
