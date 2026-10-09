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
이번 범위에서 실행하지 않았다. 만료 정리는 어댑터의 `cleanup`과 로컬 구현한 Worker
스케줄러가 담당한다. 원격 활성화는 별도 작업이다.

검증은 저장 어댑터·수집기 테스트가 Miniflare D1에 0001·0002·0003을 로드해 제약·트리거·CAS·
할당량·정리를 확인한다.

## 0002_retention_cleanup.sql

0001 뒤에 `retention_cleanup_state` 단일 행 테이블을 추가한다. 예약 실행 사이의 마지막
프로젝트 ID와 커서 CAS revision만 보관하며 기존 테이블·데이터를 변경하거나 backfill하지
않는다. 최초 정리 호출이 id=1 행을 초기화한다. 별도 인덱스나 기존 대형 테이블 스캔은 없다.

적용 검증은 기존 프로젝트·영수증이 있는 Miniflare DB에 0002를 적용해 행이 유지되는지
확인하고, 순회·중지 프로젝트·삭제된 커서 대상·동시 결과 충돌을 테스트한다. 운영 적용 전후
새 테이블 존재와 기존 프로젝트/영수증 행 수를 확인한다. 원격 마이그레이션은 실행하지 않았다.

롤백은 Cron Trigger를 중단하고 이전 코드를 사용한다. 새 테이블은 그대로 남겨도 된다.
정리가 이미 삭제한 만료 데이터는 마이그레이션 롤백으로 되돌릴 수 없으며 복원이 필요하면
별도 백업을 사용한다. [운영 조건](../../docs/backend/retention-cleanup.md)을 따른다.

## 0003_project_creation.sql

`project_creators`는 issuer/subject별 명시적 생성 권한과 1~1000개 한도를 보관한다.
기존 프로젝트 owner는 자동으로 생성 권한을 얻지 않는다. `project_creations`는 API로
만든 프로젝트의 생성자·원본 요청 해시·생성 시각을 불변으로 보관한다. 기존 프로젝트나
grant를 backfill하지 않는다. 생성 기록은 프로젝트 수명 동안 유지하며 권한 회수·재부여로
개수 한도를 초기화하지 않는다. 방문자 데이터·원시 요청 본문은 저장하지 않는다.

프로젝트 INSERT·생성 기록·최초 owner grant는 하나의 D1 batch다. INSERT에서 생성 권한과
개수 한도를 다시 검사하고 이후 쓰기는 직전 INSERT 성공 때만 실행한다. 로컬 D1에서
동시 요청·한도·권한 회수·중간 실패 rollback을 검증한다. 원격 적용은 하지 않았다.
이전 코드로 돌아갈 때 추가 테이블은 남겨도 된다. 운영 DB에는 0001·0002 뒤에 적용한다.
