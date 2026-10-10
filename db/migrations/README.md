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

검증은 저장 어댑터·수집기 테스트가 Miniflare D1에 0001·0002·0003·0004·0005를 로드해 제약·트리거·CAS·
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

## 0004_collection_rejections.sql

기존 `ingest_minute_usage`에 기본값 `{}`의 `rejections_json`만 추가한다. 기존 admission
건수·키는 유지하며 과거 거부를 backfill하지 않는다. JSON 객체·2 KiB CHECK를 적용하고
어댑터는 고정 원인 코드·건수·해당 분 안의 시각만 허용한다. 분당 한도 초과는 기존
admission SQL에서 원자적으로 집계한다. 다른 거부 기록은 admission을 통과한 요청에만
한 번 추가한다. 정상 요청의 DB 왕복은 늘지 않는다. HTTP 수집/관리자 조회도 로컬 연결했다.

거부가 기록된 분만 오늘을 포함한 7개 UTC 날짜에 보존하고 기록 없는 분은 기존 2분
정리를 유지한다. 조회도 같은 7일 밖을 제외한다. 기간 안의 물리 행 상한은 프로젝트당
10080개이며 정리 호출당 삭제 한도는 그대로다. 조회는 프로젝트 reader/owner grant와
기록을 한 D1 batch에서 검사한다. 기록은 best-effort이고 원문·출처·IP·토큰을 넣지 않는다.

로컬 초기화 도구는 ALTER 대상 열의 존재를 확인해 preview/apply/재실행을 구분한다.
0001~0003 뒤에 먼저 적용한 다음 새 코드를 사용한다. 로컬 Miniflare에서는 기존 카운터
보존과 재실행·제약·새 DB 초기화를 확인한다. 운영 적용 전후 열 존재·기존 카운터·
프로젝트 행 수를 확인해야 하며 원격 적용은 하지 않았다. 이전 코드로 롤백할 때 열은
남겨도 되지만 이전 정리가 거부 기록을 2분 뒤 지우므로 7일 이력이 보존되지 않을 수 있다.

## 0005_admin_changes.sql

제어 영역 변경 이력을 담는 append-only `admin_changes` 테이블을 추가한다. 기존 테이블과
데이터를 바꾸지 않고 이전 변경을 backfill하지 않는다. API의 프로젝트 생성·설정 변경·
스키마 발행·grant 변경과 오프라인 provisioning CLI의 register·grant 변경이 각각 같은
D1 batch에서 기록된다. 한 동작이 여러 종류를 바꾸면 변경 종류마다 한 행이 생기므로, CLI
register 한 번은 생성·설정·스키마 발행·상태 변경 행을 함께 남길 수 있다.

- `actor_kind`는 `administrator` 또는 `local_operator`다. 관리자 API는 검증한
  issuer/subject를, CLI는 인증된 사람이 없으므로 NULL 식별자를 남기며 변경 대상 계정을
  실행자로 추정하지 않는다.
- `fields_json`은 설정에서 실제로 바뀐 필드명만, `schema_version`은 스키마 동작과
  번호만, `target_issuer`·`target_subject`·`before_role`·`after_role`은 grant 변경의
  대상과 이전/이후 역할만 담는다. 원문 요청 body·설정값·스키마 정의·토큰·방문자 자료는
  넣지 않는다.
- 값이 없는 재요청·실패·실제 값이 바뀌지 않은 설정 요청은 행을 추가하지 않는다. 관리자 API는
  직전 쓰기가 1행을 바꿨을 때만 INSERT하고, 오프라인 CLI는 변경이 있을 때만 적용 batch에
  넣는다. 어느 쪽이든 batch가 롤백되면 이력도 함께 사라진다.
- `validate_admin_change_fields` BEFORE INSERT 트리거가 설정 필드명을 허용 목록
  (name·status·allowedOrigins·requestsPerMinute·newReceiptsPerUtcDay)으로 제한하고 같은
  필드명 중복을 거부한다.
- `immutable_admin_change` BEFORE UPDATE 트리거가 수정·갱신을 막고,
  `admin_changes_project_time` 인덱스가 `(project_id, occurred_at DESC, id DESC)` 정리를
  받친다.
- 기록은 프로젝트별 90일 rolling으로 보존한다. scheduled 정리는 프로젝트마다 500행까지,
  `cleanup`을 직접 호출하면 프로젝트·테이블당 최대 1000행까지 지운다. owner 전용 조회
  API와 화면은 다음 슬라이스이며 아직 없다.

0001~0004 뒤에 0005를 적용한 다음 새 코드를 사용한다. 0005는 추가 전용이라 기존
프로젝트·스키마·집계 행이 변하지 않아야 한다.

| 시점 | 확인 |
| --- | --- |
| 적용 전 | `0001`~`0004` 적용 상태, 기존 `projects`·`project_schemas`·집계 테이블 행 수 |
| 적용 후 | `admin_changes` 테이블·인덱스·트리거 존재, 기존 행 수 변동 없음, 새 변경이 batch 안에서만 기록됨 |

로컬 Miniflare에서는 두 경로를 나눠 본다. 빈 DB에 0001~0005를 순서대로 적용한 fresh
경로와 0001~0004가 적용된 DB에 0005만 추가한 upgraded 경로다. 두 경우 모두 테이블·CHECK
제약·트리거·인덱스와 batch 밖 기록 부재를 확인하고 원격 D1에는 적용하지 않는다.

롤백은 이전 코드로 되돌리고 추가 테이블은 남겨도 된다. 다만 새 변경 기록이 멈추고,
정리가 이미 지운 만료 이력은 마이그레이션 롤백으로 복구되지 않는다.
