# 저장 계약과 마이그레이션 상태

## 0013_workflow_failure_reasons.sql

0012 다음 적용한다. workflow_attempts.failure_reason_slot과 workflow_daily_counts의
33칸 failure_reason_counts_json을 추가한다. 0~31은 해당 버전 enum을 정렬한 위치이며
32는 원인 누락이다. 기존 행은 0 배열로 확장하여 기존 실패를 미측정으로 남긴다.
각 값은 음이 아닌 안전 정수이고 합계는 failed_count 이하이며 시도의 슬롯은 실패에만 허용한다.
기존 CAS batch의 완료 갱신과 같은 UPDATE에서 더하며 별도 쿼리를 추가하지 않는다.

DB 확장 후 새 Collector를 배포한다. 이전 수집기로 롤백할 때 열과 집계는 남긴다.
과거 실패를 역산하거나 원문 오류를 보관하지 않는다. CHECK 검증의 운영 소요시간은
미측정이므로 운영 데이터량에 따른 적용 시간을 확인해야 한다. 적용 뒤
PRAGMA foreign_key_check, 슬롯 합계 <= failed_count, 반복 initialize 결과를 확인한다.
로컬 검사만 수행했으며 원격 D1 마이그레이션은 실행하지 않았다.


상태: [DBML](../schema.dbml) 논리 계약과 초기 빈 DB용 SQL `0001_initial.sql`, 추가·확장
마이그레이션 `0002`~`0013`가 있다. 모두 로컬 Miniflare 저장 테스트에서만 적용했고
원격 D1에는 어느 것도 적용하지 않았다.

저장 구조는 [schema.dbml](../schema.dbml), 의미는
[이벤트 계약](../../docs/backend/event-contract.md), 구현 상태와 만료 정리는
[수집기 구현](../../docs/backend/collector.md)을 따른다. 실행 명령은
[DEVELOPMENT.md](../../DEVELOPMENT.md), 현재 검증 상태는
[VALIDATION.md](../../VALIDATION.md)에 있다.

## 0012_workflow_duration.sql

기존 workflow_daily_counts에 고정 길이 12칸 JSON 정수 배열을 추가한다. 구간 순서는
1초 미만·1~5초·5~30초·30초~2분·2~10분·10분~24시간이며 성공/실패가 번갈아 저장된다.
각 값은 안전한 음이 아닌 정수이고 결과별 측정 합계는 기존 성공/실패 건수를 넘을 수 없다.
과거 행 기본값은 0 배열이며 완료 건수와 차이를 미측정으로 보고한다. 오래된 시도는
역산하거나 채우지 않는다. 새 수집기는 기존 CAS 보호 batch의 같은 UPDATE에서 집계한다.

배포 순서는 DB 확장 적용 후 새 Collector·관리자다. 기존 수집기는 이름을 지정한
INSERT/UPDATE를 사용하므로 확장 후에도 동작하지만 그동안 추가된 완료는 미측정이다.
롤백은 열을 유지하고 이전 수집기로 되돌리는 방식이며 열 삭제·집계 역산은 하지 않는다.
ALTER의 CHECK 검증은 기존 행을 읽을 수 있어 운영 적용 전 데이터량과 적용 시간을
별도로 확인해야 한다. 로컬 initialize는 열 존재와 필수 제약을 확인하고 재적용을 건너뛴다.
적용 후 PRAGMA foreign_key_check와 측정 합계/성공·실패 건수 불변식을 검사한다.

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

검증은 저장 어댑터·수집기 테스트가 Miniflare D1에 0001·0002·0003·0004·0005·0006·0007·0008·0009를 로드해 제약·트리거·CAS·
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

## 0006_server_collection.sql

`project_publishers`를 추가하고 `event_receipts`·`event_daily_counts`의 source CHECK를
`browser`에서 `browser|server`로 넓힌다. SQLite는 CHECK를 바꾸는 ALTER를 지원하지 않아 두
테이블을 새 정의로 만들고 기존 행을 옮긴 뒤 기존 테이블을 지우고 이름을 바꾼다. 옮기는
열은 그대로이고 `event_receipts_expiry`·`event_daily_counts_retention` 인덱스는
재생성한다. `(project_id, schema_version)` 외래 키와 기존 CHECK도 새 정의에 다시 둔다.
`workflow_attempts`·`workflow_daily_counts`는 browser 전용 제약을 유지하고 손대지 않는다.
임시 이름은 `event_receipts_next`·`event_daily_counts_next`이며 0006 전체를 한 batch로
적용한다.
테스트는 0006의 마지막 문장이 실패하도록 강제한 경우에도 기존 행과 제약, marker가
그대로 롤백되는지 확인한다.

`project_publishers`는 `(project_id, issuer, subject, created_at)`만 보관하고 새 DB에서는
빈 테이블로 시작한다. 기존 `project_grants`에서 발행 권한을 자동으로 만들지 않고
backfill하지 않는다. 관리자 reader/owner 여부와 발행 권한은 서로 독립이다.
0009가 이 테이블을 재생성해 `grant_id`를 더한다. 그 뒤 정의는 0009 절을 따른다.

이 파일은 테이블 복사가 있어 0001~0005보다 비용이 크다. 운영 적용 전에 수집을 멈추고
백업한 뒤 아래를 확인한다. 지금은 로컬 Miniflare에서만 확인했고 운영 백업·적용은
실행하지 않았다.

| 시점 | 확인 |
| --- | --- |
| 적용 전 | `0001`~`0005` 적용 상태, 제어 영역·스키마·영수증·집계 행 수, 백업 존재 |
| 적용 중 | 수집 중지 상태, batch 롤백 시 이전 테이블이 그대로 남는지 |
| 적용 후 | 영수증·집계 행 수가 적용 전과 같은지, source CHECK·인덱스·외래 키 존재, `project_publishers` 비어 있음, browser 수집·조회 정상 |

로컬 초기화(`provision init`)는 `sqlite_master`의 name·sql을 읽어 0006의 안정 marker인
`project_publishers` 존재와 `event_receipts`·`event_daily_counts`의 source CHECK가
`browser|server`로 넓혀졌는지를 함께 본다. 두 조건이 어긋나거나
`event_receipts_next`·`event_daily_counts_next`가 남아 있으면 불완전한 DB로 보고 적용을
중단한다. 빈 DB에 `0001`~`0006`을 적용하는 fresh 경로와 `0001`~`0005`가 있는 DB에
0006만 추가하는 upgraded 경로를 나눠 기존 행 보존과 source 제약 확장을 확인한다.

롤백은 이전 browser 코드로 되돌리고 확장 테이블은 남긴다. 이미 저장된 server 행을 지워
롤백하지 않고 서버 수집을 끈다. `project_publishers` 권한도 삭제하지 않는다.

## 0007_task_funnels.sql

연결 상태 `funnel_runs`와 퍼널 단계 집계 `funnel_daily_counts` 두 테이블을 추가한다.
기존 테이블을 복사하거나 데이터를 backfill하지 않고 `0001`~`0006` 뒤 한 batch로
적용한다. 새 테이블은 빈 상태로 시작한다.

- `funnel_runs`는 `(project_id, run_id)` 기본 키로 프로젝트·스키마 버전·퍼널·시작
  시각·시작일·dimensions·단계 시각 배열을 보관한다. `run_id`는 코어에서 UUIDv4를,
  SQL에서 36자 길이를 검사한다.
  `funnel_id`는 1~48자, 단계 시각 배열은 2~10개·256bytes 이하다.
- `expires_at = started_at + 72시간`을 CHECK로 강제하고 재전송으로 늘리지 않는다.
  `funnel_runs_expiry` 인덱스가 `(project_id, expires_at)` 정리를 받치며
  `(project_id, schema_version)` 외래 키를 둔다.
- `funnel_daily_counts`는 `(project_id, schema_version, cohort_date, funnel_id,
  dimension_key, step_index)` 기본 키로 시작일 cohort의 연속 도달 수를 보관한다.
  `funnel_daily_retention` 인덱스가 `(project_id, cohort_date)` 90일 정리를 받친다.
- `funnel_run_insert`·`funnel_run_update` 트리거가 단계 시각의 타입, 24시간 창,
  첫 단계 = 시작 시각, 비감소 순서를 검사하고 어긋나면 batch를 롤백한다.
- `funnel_daily_insert`·`funnel_daily_update` 트리거가 인접 단계 도달 수의 비증가를
  강제한다. 기존 키 후보는 delta 값이 아니라 이 UPDATE 조건으로 검증한다.
- 추가되는 것은 테이블 2개, 트리거 4개, 인덱스 2개다.

| 시점 | 확인 |
| --- | --- |
| 적용 전 | `0001`~`0006` 적용 상태, 기존 `projects`·`project_schemas`·영수증·집계 행 수 |
| 적용 후 | 두 테이블·트리거 4개·인덱스 2개 존재, 기존 행 수 변동 없음, `funnel_runs`가 비어 있음, `PRAGMA foreign_key_check` 결과 없음 |

로컬 초기화(`provision init`)는 두 테이블이 있으면 `sqlite_master`에서 트리거 4개와
`funnel_runs_expiry`·`funnel_daily_retention` 인덱스가 모두 있는지 확인하고, 빠져 있으면
불완전한 DB로 보고 적용을 중단한다. 빈 DB에 `0001`~`0007`을 적용하는 fresh 경로와
`0001`~`0006`이 있는 DB에 0007만 추가하는 upgraded 경로를 나눠 기존 행 보존과 새 테이블
생성을 확인한다.

롤백은 이전 코드로 되돌리고 추가 테이블은 남겨도 된다. 퍼널 수집을 끄면 새 연결·단계
집계가 쌓이지 않는다. 정리가 이미 지운 만료 연결과 오래된 시작일 cohort는 마이그레이션
롤백으로 복구되지 않는다.

## 0008_publisher_history.sql

`admin_changes`를 복사·재생성해 action CHECK에 `publisher.granted`·`publisher.revoked`를
넓힌다. SQLite가 CHECK를 바꾸는 ALTER를 지원하지 않아 새 정의로 만든 뒤 기존 행을 옮기고
이름을 바꾼다. 열은 13개로 그대로이고 기존 이력 행은 보존하며 backfill하지 않는다.
발행자 action의 `target_issuer`·`target_subject`는 그 발행 권한 변경 대상을 담고, 관리자
grant 변경과 달리 역할 열(`before_role`·`after_role`)은 쓰지 않는다.
`admin_changes_project_time` 인덱스와 `validate_admin_change_fields`·
`immutable_admin_change` 트리거도 새 정의에 다시 둔다. 0008 전체를 한 D1 batch로 적용한다.

기존 `admin_changes`를 바꾸는 유일한 마이그레이션이라, 운영 적용 전에 관리자 API·CLI
쓰기를 멈추고 백업한 뒤 적용 전후 행 수와 외래 키를 확인한다. 지금은 로컬 Miniflare에서만
확인했고 원격 D1에는 적용하지 않았다.

| 시점 | 확인 |
| --- | --- |
| 적용 전 | `0001`~`0007` 적용 상태, `admin_changes` 행 수·action별 분포, 백업 존재, 관리자 API·CLI 쓰기 중지 |
| 적용 후 | 열 13개·기존 행 보존, action CHECK에 `publisher.granted`·`publisher.revoked` 포함, 인덱스·트리거 존재, `PRAGMA foreign_key_check` 결과 없음 |

롤백은 이전 코드로 되돌리고 확장 스키마는 남겨도 된다. 다만 새 action을 해석하지 못하는
예전 관리자 이력 리더를 새 행 위에 다시 올리면 안 된다. 예전 리더로 되돌리는 대신 action을
인식하는 리더를 유지하고 앞으로 고치는 방식을 우선한다.

## 0009_publisher_generations.sql

`project_publishers`를 복사·재생성해 발행 권한마다 불변 부여 ID `grant_id`를 더한다. SQLite가
기존 표에 UNIQUE 열과 자동 기본값을 붙이는 ALTER를 지원하지 않아 새 정의로 만들고 행을 옮긴
뒤 이름을 바꾼다. 옮기는 열은 `project_id`·`issuer`·`subject`·`created_at` 그대로이고 기존
발행 행은 보존하며 backfill하지 않는다.

- `grant_id`는 `lower(hex(randomblob(16)))` 기본값의 32자 소문자 hex다. CHECK가 길이 32와
  `0-9a-f`만 허용하고 `UNIQUE`가 중복을 막는다. 자격증명·인증 토큰이 아니라 회수·재부여를
  구분하는 비밀 아닌 동시성 표식이다.
- `immutable_publisher_generation` BEFORE UPDATE 트리거가 기존 행 수정을 거부한다. 권한을
  바꾸려면 지원 도구로 지웠다가 다시 넣는다. 삭제 후 재부여는 같은 밀리초여도 새 ID를 받는다.
- `(project_id, issuer, subject)` 기본 키와 `projects(id)` 외래 키는 그대로 둔다.
- 0009 전체를 한 D1 batch로 적용한다. 복사 대상은 발행 권한 표뿐이라 0006의 영수증·집계
  복사보다 작다.

CLI `publisher-grant`·`publisher-revoke`는 프로젝트 생성 시각과 함께 현재 행의 `grant_id`를
CAS 기준으로 쓴다. 그래서 같은 밀리초에 재부여된 권한을 지우는 stale 회수를 0행 변경으로
감지해 `apply_conflict`로 끝낸다. HTTP `DELETE /v1/projects/{projectId}/publishers`와 관리자
발행 화면도 `grantId` CAS로 전환했고 예전 `expectedCreatedAt` DELETE는 400으로 거부된다.

운영 적용 전에 발행자 CLI·HTTP 쓰기를 멈추고 백업한 뒤 적용 전후 발행 행 수와 ID를 확인한다.
지금은 로컬 Miniflare에서만 확인했고 원격 D1에는 적용하지 않았다.

적용 순서는 쓰기 중지·백업 → 0009 적용 → 수집기 API와 관리자 화면 함께 갱신 → 목록·회수
확인 후 쓰기 재개다. 이전 화면의 응답 검증기는 추가된 `grantId`와 맞지 않으므로 새 화면을
새로고침해야 한다. 예전 `expectedCreatedAt` 요청으로 회수하는 호환 경로는 두지 않는다.

| 시점 | 확인 |
| --- | --- |
| 적용 전 | `0001`~`0008` 적용 상태, `project_publishers` 행 수와 `(project_id, issuer, subject, created_at)` 값, 백업 존재, 발행자 CLI·HTTP 쓰기 중지 |
| 적용 중 | batch가 롤백되면 이전 표와 행이 그대로 남는지 |
| 적용 후 | 발행 행 수가 적용 전과 같은지, 각 행의 `project_id`·`issuer`·`subject`·`created_at`이 그대로인지, `grant_id`가 행마다 다른 32자 소문자 hex인지, UNIQUE·CHECK·트리거 존재, `PRAGMA foreign_key_check` 결과 없음 |

로컬 초기화(`provision init`)는 `sqlite_master`에서 `project_publishers` 정의에 32자 hex
`grant_id`·UNIQUE·CHECK와 `immutable_publisher_generation` BEFORE UPDATE 트리거가 있는지 본다.
`project_publishers_next`가 남아 있거나 제약·트리거가 빠지면 불완전한 DB로 보고 중단한다.
빈 DB에 `0001`~`0009`를 적용하는 fresh 경로와 `0001`~`0008`이 있는 DB에 0009만 추가하는
upgraded 경로를 나눠 기존 행 보존과 ID 생성을 확인한다.

롤백은 이전 코드로 되돌리고 새 열·트리거는 남겨도 된다. 다만 예전 CLI 코드는 다시 생성 시각
CAS를 쓰므로 같은 밀리초 재부여에서 stale 회수가 다시 가능해진다. 되돌리는 대신 `grant_id`
기준 코드를 유지하고 앞으로 고치는 편을 우선한다.

## 0010 administrator grant revision

Apply `0010_grant_revision.sql` atomically before updating the Collector and admin.
Existing grant rows remain unchanged. Grant insert/delete/role-update triggers advance
`projects.grant_revision`, independently of ingestion. Reviewed writes send the list's
`grantRevision` as `expectedRevision`; missing or stale revisions cannot change state
and return `grant_conflict`. No-op readback remains available for exact retries.
Older admin builds must be upgraded to edit grants. Offline plans also compare this
revision. Local initialization refuses a revision column without all three triggers.

## 0011_analytics_lookup.sql

Adds event and funnel lookup indexes without changing rows, keys or query responses.
The event index places event_name before the date range, removing the daily query's
temporary sort. The funnel index places funnel_id before the date range and orders
steps for daily grouping. Breakdown still sorts dimension/step within a cohort date.
No workflow index is added: the existing primary key already supports that query plan.

Apply both CREATE INDEX statements as one D1 batch after 0010. Before applying, verify
backups, current row counts and index absence; schedule the build for a quiet period.
Index creation scans existing aggregates, consumes storage and blocks other work on
the database; additional ingest writes must maintain both indexes. No production
latency or index-build duration is claimed by the local EXPLAIN QUERY PLAN checks.
After applying, verify both index definitions, unchanged row counts, foreign keys and
event/funnel results. Local initialization detects complete indexes and refuses partial
or changed definitions. The installation schema checker includes both indexes.

Rollback leaves the indexes in place with older code. To reclaim space, drop both
indexes in one batch; row data and older query behavior remain intact. Reapplying
0011 restores them. Remote application has not been performed.
