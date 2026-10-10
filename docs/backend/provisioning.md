# 프로젝트 등록·권한 관리 CLI

오프라인에서만 도는 운영자용 도구다. Node 24와 Miniflare의 로컬 영속 D1을 쓰고 원격 모드는 없다. 이 도구는 사용자 인증을 하지 않는다.

## 명령

```sh
npm run provision -- --help
npm run provision -- init --local --state-dir .tmp/provision-db
npm run provision -- init --local --state-dir .tmp/provision-db --apply
npm run provision -- register --local --state-dir .tmp/provision-db --file api/examples/registry.json
npm run provision -- register --local --state-dir .tmp/provision-db --file api/examples/registry.json --apply
npm run provision -- publisher-grant --local --state-dir .tmp/provision-db --file .tmp/publisher-grant.json
npm run provision -- publisher-revoke --local --state-dir .tmp/provision-db --file .tmp/publisher-revoke.json --apply
```

기본은 미리보기다. `--apply`를 줘야 실제로 쓴다.

- `--state-dir`: D1 파일을 두는 디렉터리. Git이 추적하지 않는 경로에 둔다.
- `--file`: 입력 JSON 경로. 64KiB 이하이고 모르는 필드는 거부한다.
- `--expect-plan`: 미리보기에서 받은 planHash와 현재 입력·DB 스냅샷이 같은지 확인한다. `--apply`와 함께 쓸 때만 되고 `init`에는 못 쓴다.
- `--allow-local-http`: 로컬 루프백 브라우저 origin만 허용한다. issuer는 그대로 HTTPS여야 한다.

미리보기는 상태 디렉터리를 열어 영속 D1을 만들지만 프로젝트·스키마·grant는 쓰지 않는다.

## init

`init --apply`가 저장소 마이그레이션 `0001_initial.sql`부터 `0006_server_collection.sql`까지 중 아직 적용되지 않은 것을 로컬 DB에 적용한다. 0006은 재생성 테이블 대신 `project_publishers` 존재로 적용 여부를 판단한다. 적용할 마이그레이션이 없으면 변경하지 않는다. 한 마이그레이션의 테이블이나 열이 일부만 있는 상태면 `partial_database`로 멈춘다.

## register

[registry.json](../../api/examples/registry.json) 형태를 받는다. 초기화된 DB가 필요하다. 프로젝트 이름·상태·origin·limit을 바꾼다. active/retired 스키마를 지원한다. 시간대와 이미 발행된 스키마 정의는 바꿀 수 없고, 새 버전은 기존 최대 버전보다 커야 한다.

## grant / revoke

grant JSON은 projectId, issuer, subject, role(`reader`|`owner`)를 담는다. revoke JSON은 projectId, issuer, subject를 담는다. issuer와 subject는 설정된 OIDC provider에서 실제로 확인한 값을 쓴다. 값을 지어내지 않는다.

이 도구는 사용자 로그인을 확인하지 않는다. D1의 reader/owner grant는 관리자 조회를 허용하는 것이지 CLI 접근 권한이 아니다. 첫 owner 등록은 허용하지만 마지막 owner를 빼거나 강등하는 건 막힌다. 자세한 권한 모델은 [02-authorization.md](./02-authorization.md)에 있다.

## 동시성과 적용

### creator-grant / creator-revoke

프로젝트 생성 권한은 프로젝트 owner와 별개로 운영자가 부여한다. `creator-grant`의
JSON은 실제 확인한 issuer·subject·maxProjects(1~1000)를 받는다. `creator-revoke`는
issuer·subject만 받는다. 명령의 --local·--file·미리보기·--expect-plan·--apply 방식은
기존 grant와 같다. 출력에는 원본 issuer/subject 대신 principalHash를 넣는다.
생성 권한·생성 개수를 적용 직전에 비교하며, 권한 회수는 기존 프로젝트 grant와
생성 이력을 지우지 않는다. 한도를 사용 개수 이하로 낮추면 추가 생성만 막힌다.

### publisher-grant / publisher-revoke

서버 발행 권한(`project_publishers`)은 관리자 권한과 별개로 운영자가 부여·회수한다.
JSON은 `projectId`, `issuer`, `subject`만 받고 role이나 프로젝트 한도는 받지 않는다.
issuer·subject 형식은 코어 `validGrantIdentity`로 검사한다. 프로젝트가 DB에 없으면
미리보기 단계에서 `project_not_found`로 멈춘다.

- 이 명령은 `project_publishers` 행만 넣고 지운다. 관리자 `project_grants`는 건드리지
  않고 마지막 owner 검사도 하지 않는다. 자격증명·토큰 발급이나 관리자 역할 부여는 없다.
- 적용 직전에 프로젝트 생성 시각(`created_at`)과 현재 발행 권한 상태를 CAS로 비교한다.
  이미 원하는 상태면 no-op(변경 0)이고 기존 행의 생성 시각을 다시 쓰지 않는다. 프로젝트나
  권한이 그 사이 바뀌면 `apply_conflict`이고 아무것도 쓰지 않는다.
- 적용 SQL 자체가 실패하면 `database_unavailable`로 끝난다. 이때는 반영 여부가 확인되지
  않은 상태이므로 롤백됐다고 단정하지 말고 DB를 확인한 뒤 미리보기를 다시 뜬다.
- `--local`·`--file`(64KiB)·미리보기·`--expect-plan`·`--apply` 방식은 기존 명령과 같다.
- 계획 출력은 `operation`, `projectId`, `principalHash`(canonical `[issuer, subject]`의
  SHA-256), `granted`, `changes`(`target: publisher`, `field: granted`, before/after),
  `planHash`다. 원본 issuer·subject는 출력에 넣지 않는다. 출력 해시는 비교용이고 암호화가
  아니다. 계획은 도구 인스턴스 내부 WeakMap에만 두고 적용 시 지우므로 같은 프로세스에서
  만든 계획만 적용된다.
- 발행 권한 변경은 관리자 변경 이력(`admin_changes`)에 기록하지 않는다. 이 이력의 action
  형식은 프로젝트·설정·스키마·관리자 grant만 다룬다.
- 0006 마이그레이션이 `project_publishers`를 이미 만들므로 스키마·마이그레이션 변경은 없다.

### register / grant / revoke의 동시성

이 세 명령의 수정 SQL은 하나의 트랜잭션 D1 배치로 돈다. 충돌하면 롤백한다. 적용 전에 ingest 리비전과 스키마·grant 스냅샷을 CAS로 검사한다. no-op 계획도 스냅샷을 다시 확인한다. 계획에는 issuer/subject 대신 해시된 principal이 나온다. planHash는 입력과 DB 스냅샷을 비교한 값이다. 출력 해시는 비교용이고 암호화가 아니다. 수집이 동시에 돌면 계획이 무효가 될 수 있으니 미리보기를 다시 뜬다. 발행자 CLI의 동시성·실패 처리는 위 별도 절을 따른다.

## 롤백

발행된 스키마는 바꿀 수 없다. 프로젝트 삭제나 파괴적 롤백 명령은 없다. 되돌리려면 이전 프로젝트 이름·상태·허용 출처·한도와 스키마 상태를 다시 적용하고 grant를 이전 역할로 되돌린다. 쓰기 전에 도구를 멈춘 상태에서 로컬 상태 전체를 백업한다.

## 오류 코드

- `invalid_input`: JSON 형식이나 필드가 규칙에 안 맞음
- `project_not_found`: 발행 권한을 부여·회수할 프로젝트가 DB에 없음
- `immutable_timezone`: 시간대를 바꾸려 함
- `immutable_schema`: 발행된 스키마 정의를 바꾸려 함
- `invalid_version`: 새 버전이 기존 최대 버전 이하
- `last_owner`: 마지막 owner를 빼거나 강등하려 함
- `apply_conflict`: 스냅샷이 미리보기와 달라 적용을 취소함. `register`·`grant`·`revoke`는
  배치 쓰기 실패도 이 코드로 롤백하지만, 발행자 CLI는 스냅샷 충돌에만 쓴다.
- `plan_changed`: 스냅샷이 미리보기와 달라짐
- `database_unavailable`: 로컬 D1을 열거나 상태를 읽지 못함. 적용 SQL 실패도 여기로 오며,
  그때는 반영 여부가 확인되지 않았다. 초기화·경로·DB 상태를 확인한다.
