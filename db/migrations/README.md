# 저장 계약과 마이그레이션 상태

상태: [DBML](../schema.dbml) 논리 계약과 초기 빈 DB용 SQL `0001_initial.sql`이 있다.
0001은 로컬 Miniflare 저장 테스트에서만 적용했고 원격 D1에는 적용하지 않았다.

저장 구조는 [schema.dbml](../schema.dbml), 의미는
[이벤트 계약](../../docs/backend/event-contract.md), 구현 상태와 만료 정리는
[수집기 구현](../../docs/backend/collector.md)을 따른다. 실행 명령은
[DEVELOPMENT.md](../../DEVELOPMENT.md), 현재 검증 상태는
[VALIDATION.md](../../VALIDATION.md)에 있다.

## 0001_initial.sql

프로젝트·관리자 grant·불변 스키마 스냅샷과 영수증·시도·UTC 일별 할당량·분당
admission·이벤트/목표 일별 집계 테이블을 만든다. 값 CHECK, 프로젝트를 포함한
복합 키, `(project_id, schema_version)` 외래 키, 만료·보존 인덱스를 포함한다.

- `projects.ingest_revision`은 수집 어댑터의 CAS 가드다. CHECK 제약
  `tallyfin_ingest_revision`이 정수 타입과 0 이상 안전 정수를 요구하며, 가드가 `-1`을
  쓰면 배치 전체가 롤백된다.
- `immutable_schema`, `immutable_project_zone` 트리거가 스키마 정의와 프로젝트
  ID·시간대 변경을 막는다. 시간대 변경은 새 프로젝트로 처리한다.
- 영수증의 `expires_at = received_at + 48h`와 시도의 `expires_at = started_at + 72h`는
  CHECK로 강제한다. 일일 할당량의 만료 시각(UTC 날짜 끝 + 72h)은 어댑터에서 계산한다.
- 시도 상태는 `terminal_kind`가 있으면 `terminal_at`이 NULL이 아니고 `started_at`
  이상·24시간 이내여야 한다.
- 목표 집계는 `succeeded + failed <= started`를 CHECK로 유지한다.
- 집계 `count`와 `started/succeeded/failed`는 정수 타입과 안전 정수 상한 CHECK를
  가진다.

이 파일은 새로 만든 빈 DB 전용이다. 기존 데이터를 바꾸는 이관, 원격 적용, 롤백은
이번 범위에서 실행하지 않았다. 만료 정리는 어댑터의 `cleanup`이 담당하며 스케줄러
연결은 아직 없다. 적용 전 실패·동시 요청·만료 정리 검증을 마친다.

검증은 저장 어댑터·수집기 테스트가 Miniflare D1에 0001을 로드해 제약·트리거·CAS·
할당량·정리를 확인한다.
