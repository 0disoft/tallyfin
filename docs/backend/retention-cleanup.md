# 만료 데이터 자동 정리

상태: Worker `scheduled` 핸들러와 D1 순회 위치 저장을 로컬에서 구현·검증했다.
원격 DB 적용·Cron Trigger 등록·배포는 하지 않았다.

## 실행과 한도

`apps/collector`의 `scheduled` 핸들러는 `ScheduledController.scheduledTime`을 기준으로
`runCleanup`을 실행하고 모든 작업을 await 한다. HTTP 수집·관리자 조회 요청에서는
정리를 실행하지 않는다. `createWorker`·`createOidcWorker`·기본 export 모두 포함한다.

- 회당 프로젝트 최대 5개를 ID 오름차순으로 처리한다. 중지된 프로젝트도 대상이다.
- 프로젝트마다 6개 테이블에서 각각 최대 500행을 삭제한다. 한 번에 전부 비우는 반복은 없다.
- 영수증 48시간·시도 72시간·일일 할당량 UTC 날짜 끝 + 72시간 만료 규칙을 유지한다.
- 거부 기록이 없는 분당 카운터는 지난 2분 밖을, 거부 기록이 있는 분은 오늘을 포함한
  최근 7개 UTC 날짜 밖을 삭제한다. 이벤트/목표 집계는 프로젝트 시간대의 오늘을 포함한
  90일 밖을 삭제한다. 프로젝트·스키마·관리자 권한은 삭제하지 않는다.

커서는 `retention_cleanup_state` 1행(id=1)의 `last_project_id`·`revision`으로 저장한다.
Worker가 다시 생성돼도 마지막 처리 위치 뒤부터 이어가고 끝에서는 처음으로 돌아온다.
프로젝트가 삭제돼도 커서가 유지되도록 외래 키를 두지 않는다. 새로 추가된 프로젝트는
그 위치에 따라 현재 또는 다음 순회에서 처리된다.

한 프로젝트의 실패는 다른 프로젝트를 막지 않는다. 실패한 프로젝트도 커서를 앞으로
옮겨 다음 순회에서 다시 시도한다. 커서 갱신은 revision CAS로 처리해 겹친 실행의 오래된
결과가 커서를 되돌리지 못하게 한다. 중복 실행은 삭제 조건을 다시 적용하므로 보존 중인
데이터를 삭제하지 않는다. 실행 중 중단되면 커서 저장 전의 페이지를 다시 처리할 수 있다.

## 실패와 관측

프로젝트 실패가 하나라도 있거나 CAS 충돌로 커서가 갱신되지 않으면, 나머지를 처리한 뒤
고정 오류로 실행을 실패시킨다. 프로젝트 목록/커서 DB 접근 실패도 실행 실패다.
로그에는 runId·고정 코드·attempted/completed/failed/cursorAdvanced만 남기며 DB 오류
본문·프로젝트/이벤트 ID·설정값은 넣지 않는다. completed는 호출 성공한 프로젝트 수이며
삭제한 행 수나 해당 프로젝트의 모든 만료 데이터가 소진됐다는 뜻으로 쓰지 않는다.

최대 SQL 문장은 실행당 35개(상태 2 + 목록 최대 2 + 삭제 최대 30 + 커서 1)다.
보존기간이 지났어도 순회·삭제 한도·실패 때문에 물리 삭제는 늦어질 수 있다. 지연된 실행은
예약 시각 기준으로 처리하고 이후 실행에서 따라잡는다. 만료 잔량과 DB 쓰기 비용을
측정한 뒤 주기/처리량을 조정해야 한다. 만료 시각 자체를 바꾸어 적체를 숨기지 않는다.

## 호스트 활성화와 롤백

호스트는 `0001_initial.sql` 뒤에 `0002_retention_cleanup.sql`을 적용하고 D1 `DB`
바인딩과 Worker의 `scheduled` export를 연결해야 한다. 새 테이블만 추가하며 기존
프로젝트/이벤트 행을 바꾸지 않는다. 원격 Cron Trigger는 아직 등록하지 않았다.
파일럿 시작안은 매분 실행이며 운영 호스트 설정에 다음 조각을 합친다.

```json
{ "triggers": { "crons": ["* * * * *"] } }
```

중단하려면 호스트 Cron Trigger를 제거한다. 코드 롤백 시 새 테이블은 남겨도 이전
수집기에 영향을 주지 않는다. 지운 만료 데이터는 코드 롤백으로 복구되지 않으며
복구가 필요하면 별도 백업/복원 정책을 따른다. 원격 작업은 승인한 배포 범위에서 실행한다.

구조는 [DBML](../../db/schema.dbml), 마이그레이션은
[적용 메모](../../db/migrations/README.md), 실행 증거는 [VALIDATION](../../VALIDATION.md)을 따른다.
호스트 동작 근거는 [Cloudflare scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/),
쿼리 예산 근거는 [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)다.
