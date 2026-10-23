# 롤백

상태: 문서 전용 런북이다. 실제 롤백·원격 복원·장애 전환은 실행하지 않았다.
원격 `rollback`과 복원·트래픽 전환은 원격 상태를 바꾼다. 원격 export는 DB를 읽어 로컬 SQL을
만든다. 변경은 승인된 대상과 범위에서 실행한다.

## 결정 트리

1. 실패가 코드에만 있는지, DB 데이터에도 있는지 먼저 나눈다.
2. 코드·API·DB 호환이 검증된 경우에만 이전 코드로 되돌리고 DB는 그대로 유지한다.
3. 스키마를 되돌리는 다운 마이그레이션은 없다. 앞으로 고치는 편을 먼저 검토한다.
4. 기존 DB를 백업으로 덮어쓰는 복원은 코드 롤백이 아니다. 새 DB 복원은 별도 승인 작업으로 한다.

## Worker 롤백

`wrangler rollback [version-id]`는 Worker 코드와 버전에 포함된 설정(바인딩·vars)을 되돌린다.
D1 데이터와 스키마는 되돌리지 않는다.

```powershell
node node_modules/wrangler/bin/wrangler.js deployments list --config .tmp/installation/collector.wrangler.json --json
node node_modules/wrangler/bin/wrangler.js rollback <version-id> --config .tmp/installation/collector.wrangler.json
```

- 롤백은 배포 ID가 아니라 Worker 버전 ID를 받는다. `deployments list`의 최근 10개 기록에서 확인한 값만
  쓴다.
- 루트 `wrangler.jsonc`가 아니라 재검증한 준비 묶음 config를 `--config`로 쓴다.
- 참조하는 바인딩 리소스가 삭제됐으면 롤백이 막힐 수 있다. D1·서비스 바인딩이 살아 있는지 먼저
  확인한다.
- 라우팅·도메인·Cron Trigger는 별도 인벤토리로 확인한다. 버전 롤백만으로 그 설정이 복원됐다고
  판단하지 않고 필요하면 따로 복원한다.
- 관리자 문제만 있으면 검토한 관리자 config와 버전 ID로 같은 절차를 수행한다. 수집기와
  관리자 버전은 독립이므로 API·자산 호환을 확인하고 DB는 그대로 유지한다.
- 되돌린 뒤 [릴리스의 배포 후 검증](./release.md#배포-후-검증-필수)을 다시 확인하고
  오류가 해소되면 쓰기를 재개한다. 호환되지 않으면 쓰기를 중단한 채 앞으로 고친다.

## 마이그레이션별 되돌림 위험

이전 코드로 돌아갈 때 스키마는 보존한다. 예전 리더·writer가 새 스키마를 해석하지 못하면
되돌리지 않는다.

| 마이그레이션 | 되돌릴 때 위험 | 판정 |
| --- | --- | --- |
| `0006_server_collection.sql` | 예전 browser 코드가 source 필터·server 지원을 확인하지 않으면 확장 CHECK·저장된 server 행과 어긋날 수 있음 | 재사용 전 예전 코드의 source 처리 지원을 확인한다. 확장 테이블·server 행·발행 권한은 유지 |
| `0008_publisher_history.sql` | 새 action을 모르는 예전 관리자 이력 리더 | 예전 리더로 되돌리지 않음. action을 아는 리더를 유지 |
| `0009_publisher_generations.sql` | 예전 CLI의 `createdAt` CAS 회수는 같은 밀리초 재부여를 지울 수 있음 | 예전 발행자 writer 차단. `grant_id` 기준 코드 유지 |
| `0009` + 관리자 화면 | 새 API 뒤 예전 화면의 `expectedCreatedAt` DELETE는 400 | 자산과 API를 맞춘다. 예전 자산만 올리지 않음 |
| `0010_grant_revision.sql` | 예전 관리자·CLI가 `grant_revision`·`expectedRevision`을 보내지 않거나 읽지 못하면 grant 쓰기가 거부되거나 호환되지 않음 | revision 열과 세 트리거는 남긴다. 새 관리자/API를 유지하고 예전 grant writer를 차단 |
| `0011_analytics_lookup.sql` | 인덱스를 지우면 조회 계획·지연이 달라질 수 있고 재생성은 기존 집계를 다시 스캔함 | 인덱스는 남긴다. 공간을 회수해야 할 때만 두 인덱스를 한 batch로 지우고, 0011 재적용으로 복원 |
| `0012_workflow_duration.sql` | 예전 Collector는 계속 동작하지만 새 완료의 소요시간을 집계하지 않아 미측정이 늘어남 | 열은 남긴다. 이전 완료를 역산·backfill하지 않는다 |
| `0013_workflow_failure_reasons.sql` | 예전 Collector는 새 실패 원인 슬롯을 쓰지 않아 미측정이 늘어남 | 열은 남긴다. 과거 실패 원인을 역산하지 않고 새 Collector를 앞으로 수정 |

발행 권한 회수의 호환 경로는 두지 않는다. 새 화면은 `grantId` CAS를 쓰고 예전 `expectedCreatedAt`
요청은 400으로 거부된다.

## 되돌리기 전 쓰기 중지

- 코드 롤백도 새 스키마에 맞는 writer를 다시 세우는 작업이다. 이전 코드가 재생성 테이블(0008
  `admin_changes`, 0009 `project_publishers`)과 호환되는지 확인하기 전에는 쓰기를 재개하지 않는다.
- 재생성 구간에는 Cron과 관련 writer를 전역으로 멈춘다. server 전용 쓰기만 있어도 백업과 행
  무결성 확인이 필요하다.
- 0010 적용 뒤에는 grant 수정 경로를 새 revision 계약에 맞춘 상태로 유지한다. 0012·0013은
  열을 유지한 채 코드를 되돌릴 수 있지만 새 측정값은 늘지 않는다. 0011 인덱스는 코드 롤백의
  대상이 아니다.
- Cron만 멈추면 수집이 멈추지 않는다. 프로젝트 일시 중지로도 관리자 읽기·쓰기와 신뢰된 CLI는
  막히지 않는다. 외부 호스트 ingress와 writer를 호스트 운영에서 함께 막는다.

## DB 복원 (별도 승인)

- 기존 DB를 백업으로 덮어쓰지 않는다. 새 DB에만 복원하고 접근을 제한한다.
- 복원은 백업 이후의 영수증·권한 회수·집계·감사 변경을 되돌린다. 백업 시각 이후 회수·재부여·
  감사가 사라진다.
- 전체 백업 SQL을 빈 DB에 넣을 때 같은 마이그레이션을 먼저 중복 적용하지 않는다.
- 복원 후 행 내용·개수, 스키마·외래 키, `PRAGMA quick_check`, `foreign_key_check`를 확인하고,
  회수·재부여·중복 재전송을 복구 환경에서 확인한다.
- 트래픽을 전환하기 전에 손실 범위·복구 시간·새 대상·전환 계획을 검토한다.
- 실제 준비 검사는 운영 DB와 분리한 별도 검증 프로젝트에서 한다.
- 세부 명령은 [백업·복구](./backup-and-restore.md)를 따른다.

## 중지 조건

- 롤백 대상 코드·API·DB 호환이 검증되지 않았다.
- 마이그레이션 head 상태를 알 수 없다.
- DB 복원이 필요한데 적용 전 백업이 없거나 복구 가능성이 검증되지 않았다.
- 예전 리더·writer가 새 스키마나 새 action을 해석하지 못한다.
- 되돌릴 바인딩 리소스가 삭제됐다.
- 개인정보·비밀값이 노출됐다.

## Owners

- Primary owner: UNASSIGNED
- Backup owner: UNASSIGNED
- Escalation path: UNDECIDED

## Validation

- 필수 검증 이름: [VALIDATION.md](../../VALIDATION.md)
- 릴리스 차단 여부: UNDECIDED
- 남은 운영 위험: UNDECIDED

## 근거

- [Cloudflare Workers 롤백](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [Wrangler D1 명령](https://developers.cloudflare.com/d1/wrangler-commands/)
- [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
