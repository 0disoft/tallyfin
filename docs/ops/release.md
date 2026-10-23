# 릴리스

상태: 문서 전용 런북이다. 실제 배포·원격 마이그레이션·백업·복원·운영 로그인은 실행하지 않았다.

준비·빌드·dry-run은 로컬 파일을 생성할 수 있지만 원격을 바꾸지 않는다. `--help`는 사용법만
표시한다. 원격 DB 목록·export와 설치 검사는 읽기 작업이고, `wrangler deploy`·
`d1 migrations apply --remote`·`wrangler rollback`은 원격 상태를 바꾼다.
아래 원격 변경 명령은 승인된 대상과 범위에서 실행한다.

## 릴리스 단위

한 릴리스는 코드 번들, 설치 묶음(다섯 파일), DB 스키마를 함께 묶는다.

- 마이그레이션: `0001`~`0013` 열세 개, 애플리케이션 테이블 16개. 이 문서의 기준 마이그레이션 head는
  `0013_workflow_failure_reasons.sql`이다. 이벤트 스키마 버전(`schema_version`)은 마이그레이션 번호와 별개로 프로젝트 스키마
  발행 흐름에서 정한다.
- 설치 묶음: `install:prepare`가 만드는 `collector.wrangler.json`·`admin.wrangler.json`·
  `admin-login.json`·`oidc-registration.json`·`installation.json`. 대화형 터미널에서는
  `install:setup`이 같은 writer로 같은 다섯 파일을 만든다.
- 실제 provider·account·D1·domain·issuer·audience·client·resource 값은 아직 없다. 값을 지어내지
  않고 운영자가 확인한 실값만 쓴다. 문법 검사는 리소스 소유·존재를 증명하지 않는다.

## 준비와 업로드 없는 검사 (원격 미변경)

저장소 루트에서 실행한다. Node 24 이상과 루트 lockfile 설치를 전제로 한다.

```powershell
npm ci --ignore-scripts
npm run install:prepare -- --file .tmp/installation-input.json --out .tmp/installation
npm run admin:build-configured -- --dir .tmp/installation
npm run admin:dry-run -- --config .tmp/installation/admin.wrangler.json
npm run collector:dry-run -- --config .tmp/installation/collector.wrangler.json
```

`install:prepare`의 출력은 새 경로여야 하고 이미 있으면 실패한다. 값을 바꾸려면 입력을 고친 뒤
새 디렉터리를 만든다. dry-run 성공은 로컬 패키징 확인일 뿐 로그인·DNS·원격 바인딩·DB 검증이
아니다.

대화형 터미널에서는 `npm run install:setup -- --out <새-디렉터리>`가 같은 다섯 파일을 만든다.

## 읽기 검사 셋 (서로 분리)

셋은 서로 다른 대상을 본다. 하나가 통과했다고 운영 준비 완료가 아니다.

| 검사 | 명령 | 확인하는 것 | 확인하지 않는 것 |
| --- | --- | --- | --- |
| 공개 제공자 | `npm run install:check -- --dir .tmp/installation` | 준비 묶음 재검증, 공개 OIDC discovery·JWKS, token endpoint 진단 OPTIONS | 실제 로그인·코드 교환·토큰 발급·클라이언트 등록 |
| 원격 DB 메타데이터 | `npm run install:database-check -- --remote --dir .tmp/installation` | 원격 `sqlite_master`와 `0001`~`0013` 기준 스키마 비교. `d1_migrations`는 비교에서 제외된다 | 데이터 무결성·정리 Cron·백업·런타임 |
| 관리자 읽기 접근 | `npm run install:access-check -- --dir .tmp/installation --token-stdin` | 검토한 관리자 출처의 `GET /v1/identity` → `GET /v1/health` → `GET /v1/projects?limit=1` 3단계 게이트. `/v1/health`는 `projects`·`project_grants` 읽기까지다 | 토큰 발급·갱신·최초 owner/생성자 권한·수집 쓰기·Cron·전체 저장 정상 |

세 보고서 모두 `operationalReadinessVerified`가 false다. 필수 검사 통과만으로 준비 완료를
선언하지 않는다. `install:access-check`는 이미 발급된 bearer 토큰을 비대화형 표준 입력에서만
받고 토큰을 인자·파일·보고서·대화에 남기지 않는다.

## 인계 기록

- 설치 묶음 다섯 파일의 SHA-256을 남긴다. Windows에서는 `Get-FileHash -Algorithm SHA256 <file>`로
  직접 계산한다. 별도 게이트 도구는 없다.
- 기록 항목: 커밋 해시, 다섯 파일 이름과 SHA-256, 마이그레이션 head, 대상 계정·DB·Worker·도메인
  (원문 대신 해시), 적용 전 백업 경로·시각·해시.
- `install:check`·`install:database-check`·`install:access-check`는 실행 전에 다섯 파일을 다시
  검증하고 수정·이동된 묶음을 거부한다.

## 순서 (기존 DB 업그레이드 또는 신규 DB)

1. 마이그레이션 head를 확인한다.
2. 기존 DB는 Cron과 관련 writer를 멈추고 진행 중 쓰기가 끝났는지 확인한다.
3. 그 상태에서 적용 전 백업과 대상 테이블 행 수를 기록한다. 빈 새 DB는 비어 있음을 확인한다.
4. 마이그레이션을 순서대로 적용한다. 이미 적용한 것은 다시 돌리지 않는다.
5. 스키마·행 수·외래 키를 확인한다. 문제가 있으면 배포로 넘어가지 않는다.
6. 수집기를 배포한다.
7. 관리자를 배포한다.
8. 배포 후 검증을 수행하고 호환이 확인된 writer와 Cron을 재개한다. 제한한 일반 수집은
   검증 프로젝트 확인을 마친 뒤 연다.

원격 명령은 모두 재검증한 준비 묶음 config를 `--config`로 지정한다. 루트 `wrangler.jsonc`는
타입·패키지 기준선이라 원격 명령의 기본값으로 쓰지 않는다.

```powershell
node node_modules/wrangler/bin/wrangler.js d1 migrations list DB --remote --config .tmp/installation/collector.wrangler.json
node node_modules/wrangler/bin/wrangler.js d1 export DB --remote --output <새-백업.sql> --config .tmp/installation/collector.wrangler.json
node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --remote --config .tmp/installation/collector.wrangler.json
```

`d1 migrations list`는 적용 이력이 아니라 미적용 파일을 나열한다. 적용 이력은 `d1_migrations`를
포함한 별도 확인으로 정한다. `d1 migrations apply` 도움말은 실패한 마이그레이션만 롤백하고 앞서
성공한 마이그레이션은 적용된 채로 남는다고 적는다. 부분 적용 상태가 생길 수 있다. 같은 도움말이
안내하는 백업은 적용 이후 시점이라 적용 전 백업의 증거로 쓰지 않는다. 적용 전 백업은 미리 만든다.
`d1 export <name> --remote`는 `--output`이 필요하고 `<name>`에 DB 바인딩 이름을 쓸 수 있다.

## 마이그레이션 적용 (빈 DB·업그레이드·복원)

| 상황 | 절차 |
| --- | --- |
| 빈 새 DB | `0001`부터 `0013`까지 순서대로 적용한다. 테이블 복사 대상이 비어 있다. |
| 기존 DB 업그레이드 | 마지막 적용 번호를 먼저 확인한다. 이미 적용한 마이그레이션을 다시 돌리지 않는다. |
| 전체 백업 SQL 복원 | 빈 DB에 백업 SQL 전체를 넣는다. 같은 마이그레이션을 먼저 중복 적용하지 않는다. |

테이블 재생성 마이그레이션은 Cron과 관련 writer를 전역으로 멈춘 뒤 백업하고, 적용 전후 행 수와
스키마를 확인한다.

| 마이그레이션 | 재생성 대상 | 멈출 쓰기 |
| --- | --- | --- |
| `0006_server_collection.sql` | `event_receipts`·`event_daily_counts` | browser·server 수집, 관리자·권한 writer, Cron |
| `0008_publisher_history.sql` | `admin_changes` | 관리자 API·CLI 쓰기, Cron |
| `0009_publisher_generations.sql` | `project_publishers` | 발행자 CLI·HTTP 쓰기, Cron |

`0010_grant_revision.sql`은 기존 grant 행을 바꾸지 않고 `projects.grant_revision`과
grant insert/delete/role-update 트리거를 한 batch로 더한다. 관리자 목록의 `grantRevision`을
`expectedRevision`으로 보내는 새 API·화면보다 먼저 적용하고, 예전 관리자 편집 화면은 grant
수정에 쓰지 않는다. 일부 트리거만 있거나 revision 열이 없는 상태는 로컬 초기화가 거부한다.

`0011_analytics_lookup.sql`은 event·funnel 조회 인덱스 두 개만 추가한다. 기존 행·key·응답은
바꾸지 않으며 인덱스 생성이 기존 집계를 스캔한다. 적용 전 백업·행 수·인덱스 부재를 확인하고
한가한 시간에 두 문장을 한 batch로 적용한다. 적용 뒤 두 정의·행 수·외래 키·기존 조회 결과를
확인한다.

`0012_workflow_duration.sql`은 `workflow_daily_counts`에 12칸 소요시간 배열을 더하고,
`0013_workflow_failure_reasons.sql`은 `workflow_attempts.failure_reason_slot`과 33칸
실패 원인 배열을 더한다. 0012 다음 0013을 적용하고 새 Collector·관리자를 올린다. 확장만
하는 마이그레이션이라 이전 Collector도 명시한 기존 열로 수집·완료 건수 갱신을 계속할 수
있지만 새 소요시간·실패 원인 측정은 남기지 않는다. 전환 전 완료와 과거 실패는 미측정으로
남는다. 적용 뒤 배열 길이·정수·합계 제약, 실패 슬롯의 terminal failure 조건, 외래 키와
재실행 시 변경 없음까지 확인한다.

- 적용 전: 마이그레이션 head, 재생성 대상 행 수, 적용 전 백업 존재, 진행 중 쓰기 소진.
- 적용 후: 행 수가 같은지, 열·CHECK·인덱스·트리거·외래 키가 있는지, `PRAGMA foreign_key_check`
  위반이 없는지.
- server 전용 쓰기만 있는 환경에서도 백업과 행 무결성 확인은 필요하다.
- Cron만 멈추면 수집이 멈추지 않는다. 프로젝트 일시 중지로도 관리자 읽기·쓰기와 신뢰된 CLI는
  막히지 않는다. 외부 호스트 ingress와 writer를 호스트 운영에서 함께 막는다.
- 0008의 새 action(`publisher.granted`·`publisher.revoked`)을 모르는 예전 리더는 새 행 위에서
  호환되지 않는다. 0009는 `grant_id` 기준 회수를 요구하고 예전 `expectedCreatedAt` 경로는 없다.
  0010 이후의 관리자 목록·쓰기는 `grantRevision`/`expectedRevision`을 함께 다뤄야 한다.

원격 적용의 파일 단위 원자성은 로컬에서만 확인했고 운영 실행은 검증 전이다. 일반
`wrangler d1 migrations apply`를 파일별 원자적 재구성의 증거로 쓰지 않는다. 리허설로 승인한
절차가 생기기 전까지 원격 적용은 막힌다. 실제 준비 검사는 운영 DB와 분리한 별도 검증 프로젝트에서
한다.

## 배포 (승인 후 수동)

```powershell
node node_modules/wrangler/bin/wrangler.js deploy --config .tmp/installation/collector.wrangler.json --dry-run
node node_modules/wrangler/bin/wrangler.js deploy --config .tmp/installation/collector.wrangler.json
node node_modules/wrangler/bin/wrangler.js deploy --config .tmp/installation/admin.wrangler.json
```

- `wrangler deploy`는 `--dry-run`과 `--keep-vars`(기본 false)를 지원한다. 기존 vars를 유지하려면
  `--keep-vars`를 명시한다. 기본 배포는 config에 없는 일반 vars를 삭제하므로 원격 설정과
  검토한 config를 먼저 대조한다. 이 플래그로 오래된 인증 설정을 무조건 남기지 않는다.
- 배포 기록은 `wrangler deployments list --config <config> --json`으로 최근 10개를 본다.
- 확인 프롬프트를 건너뛰는 `--yes` 같은 우회를 쓰지 않는다.
- 배포 뒤 라우팅·도메인·Cron Trigger를 별도 인벤토리로 확인한다.

## 배포 후 검증 (필수)

- 실제 제공자로 관리자 로그인, 토큰 갱신 또는 만료 뒤 재로그인 경로 확인.
- owner로 프로젝트 목록·설정 읽기, reader가 grant 목록과 발행자 목록을 403으로 못 읽는지 확인.
- 다른 프로젝트(테넌트) 접근이 거부되는지 확인.
- 별도 검증 프로젝트에서 browser 신규+중복 재전송, server 신규+중복 재전송이 집계를 한 번만
  올리는지 확인.
- Cron이 관측되고 정리 커서가 진행하는지 확인.
- 설치 묶음 다섯 파일과 빌드 자산의 SHA-256을 기록하고 배포한 Worker 버전 ID와 대조한다.
  `install:database-check`로 원격 스키마, `install:access-check`로 관리자 읽기 접근을 확인한다.

## 중지 조건

- 준비 묶음이 검토한 SHA-256과 다르거나 수정·이동됐다.
- 마이그레이션 head를 알 수 없거나 로컬·원격이 어긋난다.
- 적용 전 백업이 없거나 복구 가능성이 검증되지 않았다.
- 개인정보·비밀값이 출력·로그·자산에 노출됐다.
- 인증·권한 게이트(issuer·audience·PKCE·owner/reader·테넌트) 검사가 실패했다.
- 필수 검사가 실패·미확인이다.

## 관측

릴리스 판정 근거는 [운영 관측](./observability.md)이다. 완료 관측 로그는 고정 필드 `event`·
`requestId`·`operation`·`status`·`code`·`latencyBucket`·`samplingDenominator` 일곱 개이고,
성공은 1/64 표본, 실패는 전량이다. 대시보드·알림 수신자·헬스 프로브·로그 보존 기간은 배포하지
않았고 임계값·담당자는 UNDECIDED다. 확인되지 않은 알림 수신자를 만들지 않는다.

## Owners

- Primary owner: UNASSIGNED
- Backup owner: UNASSIGNED
- Escalation path: UNDECIDED

## Validation

- 필수 검증 이름: [VALIDATION.md](../../VALIDATION.md)
- 릴리스 차단 여부: UNDECIDED
- 남은 운영 위험: UNDECIDED
- SLO: UNDECIDED
- 위 명령·옵션은 설치된 CLI 도움말과 저장소 문서를 근거로 적었다. 실제 원격 실행 증거가 아니다.

## 근거

- [Cloudflare Workers 롤백](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [Wrangler D1 명령](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Wrangler 배포 명령](https://developers.cloudflare.com/workers/wrangler/commands/)
