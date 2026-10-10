# 서버 발행 이벤트 계약 (코어·저장·endpoint 슬라이스)

상태: 서버 이벤트의 코어 검증·정규화·해시·ingest 계획, 저장·발행 권한, 전용 발행
endpoint와 발행자 인증·런타임 설정 배선까지 로컬에서 구현했고 좁은 범위 검증을
통과했다. `project_publishers` 부여·회수 CLI와 dependency-free 서버 SDK까지 로컬
구현했다. 출처별 조회 API(`source` 선택, 기본 browser)는 로컬에서 구현·검증 완료했고 실제
발행자 OIDC 제공자 설정은 아직 없고 서버 출처 조회 화면은 로컬에서 연결했다. 이 문서는
확정한 것과 아직 계획인 것을 나눠 적는다.

형태는 [OpenAPI](../../api/openapi.yaml), 저장 구조는 [DBML](../../db/schema.dbml),
동작 의미는 [이벤트·집계 계약](./event-contract.md)을 따른다. 브라우저 수집 경로는
[수집기 구현](./collector.md)과 [브라우저 SDK](./browser-sdk.md)에 있다.

## 코어 슬라이스에 포함된 것

- 코어의 `parseServerBatch`·`prepareServerBatch`. 브라우저 `parseBatch`·`prepareBatch`와
  같은 규칙으로 배치 구조·시간 범위·등록 정의를 검사하고 이벤트를 정규화·정렬한다.
  `packages/core/src/batch.ts`·`types.ts`·`value.ts`에 둔다. `parseServerBatch`는
  계약 검증만 하며 발행자 인증과 프로젝트 권한 검사는 하지 않는다.
- source별 payload hash. 영수증 키와 해시 입력에 출처가 들어가 server 이벤트가
  browser와 같은 해시 바이트를 쓰지 않는다. 브라우저 canonical 해시 입력은 바이트
  그대로 유지한다.
- `planIngest`의 서버 지원. 순수 함수로 영수증과 이벤트 일별 집계 delta만 만들고
  attempt·workflow 상태는 만들지 않는다.
- `ServerBatch`·`ServerEvent` 계약. OpenAPI 스키마·예제·테스트를 함께 둔다.

## 저장·발행 권한 슬라이스에 포함된 것

- `project_publishers` 테이블. `(project_id, issuer, subject, created_at)`만 보관하고
  새로 적용하는 DB에서는 빈 테이블로 시작한다. 기존 관리자 grant(`project_grants`)에서
  발행 권한을 만들어 주지 않고 backfill도 하지 않는다. 관리자 reader/owner 여부와 발행
  권한은 서로 독립이며, owner도 발행 권한을 자동으로 얻지 않는다.
- `0006_server_collection.sql`. `project_publishers`를 추가하고 `event_receipts`·
  `event_daily_counts`의 source 제약을 `browser`에서 `browser|server`로 넓힌다. SQLite는
  CHECK를 직접 바꿀 수 없어 두 테이블을 복사·재생성한다.
- 저장 어댑터의 `publisherAccess`·`commitServer`. `D1Store`가 `ServerCollectionStore`를
  구현하고 서버 배치 저장 경로를 맡는다.
- 코어의 `ServerPrincipal`(issuer·subject)과 `ServerCollectionStore`. 호스트가 검증해
  넘기는 발행자 주체와 `publisherAccess`·`commitServer` 포트를 나타낸다.

## ServerEvent 계약

`ServerEvent`는 네 필드만 갖는 닫힌 객체다.

- `eventId` — 새 이벤트마다 새로 만드는 소문자 UUIDv4. 재시도는 원래 eventId·
  occurredAt·내용을 그대로 다시 보내며 새 ID를 만들지 않는다. 같은 ID를 다른 이벤트에
  재사용하지 않는다.
- `name` — 프로젝트에 등록된 이벤트 이름.
- `occurredAt` — 실제 달력의 UTC RFC3339 Z. 소수 초는 0~3자리이며 밀리초로
  정규화한다.
- `properties` — 등록 정의의 속성만. boolean·enum·integer와 이벤트당 4개 한도는
  browser와 같다.

`attempt`는 넣지 않는다. server 이벤트에 attempt가 있으면 배치 전체를 거부한다.
출처는 배치 하나로 정하고 `source`는 `server`다. 배치는 최대 20개·16KiB UTF-8이며
`occurredAt`은 수신 시각 기준 과거 24시간~미래 5분만 허용한다.

`name`은 source가 `server`인 등록 정의에서만 고른다. 브라우저 정의로 server 이벤트를
보내거나 server 정의로 browser 이벤트를 보내면 거부한다. v0.1 작업 흐름 정의는 browser
출처만 지원하므로 server 이벤트는 흐름 단계가 되지 않는다.

스키마는 최소 이벤트 하나만 요구하고 server 정의만 있어도 등록할 수 있다.
server 전용 스키마는 workflows를 빈 배열로 둔다. allowedOrigins도 빈 배열로 둘 수 있으며
이때 browser 수집은 origin_denied로 거부하고 server 발행은 전용 인증·발행 권한을 계속 검사한다.
해당 스키마의 browser summary는 events=[]·totalEvents=0이고 browser workflow 조회는 404다.

## 중복·해시

영수증 키는 프로젝트·source·eventId다. payload hash는 프로젝트·스키마 버전·출처와
정규화된 이벤트 전체의 SHA-256이다. canonical 입력 형식은 browser와 같고, server
이벤트는 마지막 attempt 슬롯을 null로 둔다. server 해시에는 attempt 식별자나 내용이
들어가지 않는다.

- 같은 키·같은 내용은 duplicates로 세고 새 영수증·집계를 만들지 않는다.
- 같은 키·다른 내용이나 다른 스키마 버전은 `event_conflict`(409)로 배치 전체를
  거부한다.
- 같은 배치 안에서 같은 eventId가 반복되면 `invalid_event`(422)다.
- 배치는 occurredAt·eventId 순으로 처리한다.

브라우저 canonical 해시 입력은 바뀌지 않는다. 이미 저장된 browser 영수증과 비교해도
같은 값이 나온다.

## planIngest 범위

`planIngest`는 I/O 없는 순수 함수다. 입력 snapshot의 영수증을 event_id로 비교하므로
호출자가 그 프로젝트·source에 속한 영수증만 담아야 한다. server 배치에서는 영수증과
이벤트 일별 집계 delta만 만들고 attempt·workflow 상태는 만들지 않는다. 저장 어댑터는
영수증을 프로젝트·source로 걸러 읽고, UTC 일일 사용량은 source 구분 없이 프로젝트
단위로 읽어 넘긴다.

## 저장 구조와 출처 분리

- `event_receipts`와 `event_daily_counts`의 source는 `browser`와 `server`를 받는다.
  영수증 키와 집계 키에 source가 들어가므로 같은 날·같은 이벤트·같은 속성이라도 출처가
  다르면 다른 행이다.
- `workflow_attempts`와 `workflow_daily_counts`는 browser 전용 제약을 그대로 유지한다.
  server 이벤트는 시도·목표 상태를 만들지 않는다.
- 조회는 한 번에 한 출처만 다룬다. browser와 server 건수를 합쳐 이중 집계하지 않는다.

## 서버 커밋과 발행 권한

서버 배치는 관리자 조회·설정 권한과 다른 경로로 저장한다.

- `publisherAccess`는 프로젝트·발행자 주체의 `project_publishers` 행만 확인하는
  조회다. 프로젝트 ID나 발행자 형식이 맞지 않거나 행이 없으면 `forbidden`(403),
  조회 자체가 실패하면 `storage_unavailable`(503)이다.
- `commitServer`는 일관 읽기 batch에서 프로젝트·스키마·해당 source 영수증·UTC 일일
  사용량과 함께 발행 권한 행을 읽고, 그 읽기에서 권한이 없으면 쓰기 전에
  `forbidden`(403)이다. 쓰기 CAS batch는 `EXISTS`로 같은 발행 권한을 다시 확인한다.
- 읽기와 쓰기 사이에 발행자 행이 지워지면 CAS가 실패해 batch 전체가 롤백되고, 다시
  읽어 권한이 없으면 `forbidden`(403)이다.

브라우저 저장 경로는 server 배치를 `invalid_request`(400)로, `commitServer`는 attempt나
workflow가 섞인 배치를 `invalid_event`(422)로 거부한다. 권한 검사와 저장이 같은
트랜잭션이므로 발행자 회수 경쟁에서 부분 저장이 남지 않는다.
`project_publishers`에는 발행자 주체(issuer·subject)와 생성 시각만 둔다. 이벤트 입력·
원문·발행자 토큰은 저장하지 않는다.

호스트(수집 HTTP 경계)는 서명·issuer·audience·exp를 검증한 principal만 넘긴다. 전용
endpoint와 발행자 검증기, `PUBLISHER_*` 런타임 배선을 구현했지만 기본값은 `disabled`다.
발행자 인증을 켜지 않은 배포에서는 이 계약만으로 서버 발행이 열리지 않는다. 발행자
토큰은 저장하지 않고 요청 처리 동안에만 쓴다.

## 할당량

분당 admission과 프로젝트 UTC 일일 신규 영수증 한도는 browser와 server가 공유한다.
두 출처가 한 프로젝트의 같은 분당·일일 예산을 나눠 쓰며, 출처별로 따로 계산하지 않는다.
같은 ID 재전송도 분당 요청 한도는 소비한다. 같은 내용의 중복은 UTC 일일 신규 영수증
수와 이벤트 집계를 늘리지 않는다.

## 서버 발행 endpoint

`POST /v1/projects/{projectId}/server-batches` 하나만 연다. 브라우저 수집 경로와 다른
요청 경계를 쓴다.

- 인증은 `Authorization: Bearer` 헤더만 쓴다. 헤더는 8192자 이하이고 형식이 맞아야
  하며, 서명·issuer·audience·exp를 검증한 발행자 주체(issuer·subject)만 통과한다.
  호스트가 `PublisherAccess{store, verifyBearer}`로 검증기를 주입한다.
- 호스트가 발행자 검증기를 주지 않으면 이 경로는 `unauthorized`(401)다. 관리자 검증기를
  대신 쓰지 않고 fallback도 두지 않는다. 검증기가 예외를 던지거나 null을 돌려줘도 401이다.
- 통과한 주체는 형식 검사를 다시 거친 뒤 issuer·subject만 복사해 저장 포트로 넘긴다.
  토큰과 클레임은 저장하거나 응답에 넣지 않는다.
- 권한 검사가 프로젝트 읽기와 분당 admission보다 먼저다. 인증이나 발행 권한이 처음부터
  거부된 요청은 프로젝트 분당 quota를 쓰지 않는다. 인증을 통과한 뒤의 잘못된 요청·중복
  요청은 브라우저 수집과 같이 분당 admission을 쓴다.
- 이 경로는 CORS를 지원하지 않는다. `Origin`은 인증에 쓰지 않고 무시하며 응답에
  `Access-Control-Allow-Origin`을 넣지 않는다. `OPTIONS` preflight를 처리하지 않는다.
  `POST`가 아니면 `invalid_request`(405)와 `Allow: POST`다.
- 본문은 `application/json`만 받는다. 다른 미디어 타입은 `invalid_request`(415)다.
  조회 파라미터가 있으면 `invalid_request`(400)로 거부한다. 16KiB·20개 한도와 필드
  검사는 코어 `parseServerBatch`·`prepareServerBatch`를 따른다.
- 등록되지 않았거나 다른 출처의 이름은 거부하고, 일시 중지 프로젝트는
  `project_unavailable`(403)다. 모르는 프로젝트는 404 대신 `forbidden`(403)으로 답해
  프로젝트 존재를 숨긴다.
- 저장은 D1 `commitServer`가 발행 권한을 다시 확인한다. UTC 일일 신규 영수증 한도와
  분당 admission은 browser와 공유하며, 한도 초과 429에는 `Retry-After`를 보낸다.

### 팩토리 배선

- `createWorker(adminVerifier?, publisherVerifier?)` — 관리자와 발행자 검증기를 따로
  받는다. 발행자를 주지 않으면 server 경로만 닫힌다.
- `createOidcWorker(adminOptions, publisherOptions?)` — 둘 다 주면 audience가 서로 달라야
  하고 같으면 생성 시점에 거부한다.
- `createPublisherOidcWorker(publisherOptions)` — 발행자 전용. 관리자 경로를 열지 않는다.
- 기본 export는 검증기를 붙이지 않으므로 관리자·발행자 경로가 모두 401로 닫힌다.
- 발행자용 OIDC 검증기는 `exclusiveAudience`로 만든다. 서명 검증 뒤에 `aud`가 audience
  문자열 하나이거나 같은 값을 가진 1원소 배열일 때만 통과시키고, 다른 audience가 섞인
  토큰은 거부한다. 관리자 검증기는 기존 `includes` 정책을 유지한다.
- 인증은 기존 `packages/auth-oidc`의 jose 기반 검증을 재사용한다.

발행자 검증기는 호스트가 주입한다. 배포 설정에서 발행자 인증을 켜지 않으면(기본값
`disabled`, 발행자 설정이 없는 기존 배포 포함) server 경로는 401로 닫혀 있다. 발행자
OIDC 제공자 값과 원격 등록·배포는 아직 넣지 않았다.

## 마이그레이션과 롤백

`0006_server_collection.sql`은 `project_publishers`를 추가하고 `event_receipts`·
`event_daily_counts`를 복사·재생성해 source 제약을 넓힌다. 테이블 복사가 큰 작업이라
운영 적용 전에 수집을 잠시 멈추고 백업한 뒤, 적용 전후 행 수와 스키마·외래 키를
검증해야 한다. 절차와 확인 항목은 [적용 메모](../../db/migrations/README.md)에 둔다.
이 문서 작성 시점에 운영 DB 백업·적용은 실행하지 않았고 원격 D1에도 적용하지 않았다.

롤백은 이전 browser 코드로 되돌리고 확장 테이블은 남겨 둔다. 이미 저장된 server 행을
지워 롤백하지 않으며, 서버 수집을 끄고 server 출처 조회를 열지 않는다.
`project_publishers` 권한도 삭제하지 않는다.

`0006`은 한 batch로 적용한다. 저장 어댑터 테스트는 0006의 마지막 문장이 실패하도록
강제했을 때 기존 행·제약·marker가 롤백되는지도 확인한다.

## 발행자 권한 CLI

`project_publishers` 부여·회수는 오프라인 provisioning CLI의 `publisher-grant`·
`publisher-revoke`로 로컬 구현했다. 닫힌 JSON `{projectId, issuer, subject}`만 받고
issuer·subject는 코어 `validGrantIdentity`로 검사한다. role이나 프로젝트 한도는 없다.
프로젝트가 없으면 미리보기에서 `project_not_found`로 멈춘다. 기본은 미리보기이고
`--apply`·`--expect-plan`으로 검토한 계획만 적용한다. 계획 출력은 원본 식별값 대신
`principalHash`를 넣고, 프로젝트 생성 시각과 현재 권한 상태를 CAS로 비교한다.

이 명령은 `project_publishers`만 바꾸고 관리자 `project_grants`·마지막 owner 검사·
자격증명 발급은 건드리지 않는다. 발행 권한 변경은 관리자 변경 이력(`admin_changes`)에
남지 않는다. 이 이력의 action 형식이 프로젝트·설정·스키마·관리자 grant만 다루기 때문이다.
0006이 `project_publishers`를 이미 만들어 스키마·마이그레이션 변경은 없다. 세부 형식은
[등록·권한 관리 CLI](./provisioning.md)에 있다.

## 서버 SDK

`@tallyfin/server`(`packages/server`)가 서버 발행 클라이언트를 로컬 구현했다. 호스트가
`createTallyfinServer`에 endpoint·검토한 server 스키마·`getToken`을 주면 `createEvent`가
eventId·UTC occurredAt·속성을 얼려 만들고, `send`가 1~20개·16KiB 이하 배치 하나를 보낸다.
재시도·취소·영수증·재전송 규칙은 [서버 SDK](./server-sdk.md)에 있고, 실제 발급자 선택과
자격증명 발급은 호스트 책임이다.

## 서버 출처 조회

`GET .../summary`와 `GET .../events/{eventName}/daily`가 선택 `source`(기본 browser,
browser|server)를 받는다. 한 요청에 한 출처만 읽고 browser·server 건수를 합치지 않는다.
server 정의도 daily 속성 분류를 지원한다. 그 출처에 정의가 없으면 summary는 `events=[]`·
`totalEvents=0`, 다른 출처에만 있는 이름의 daily는 404다. workflow 조회는 browser 전용이라
`source`를 받지 않는다. 조회 권한은 관리자 `project_grants` reader/owner로만 검사하고
`project_publishers` 발행 권한으로는 읽을 수 없다. meta.latestReceivedAt는 출처·버전·날짜를
가리지 않은 프로젝트 전체 최신 수신 시각이다. 화면은 로컬에서 연결했고 로컬 브라우저 검증을 마쳤다.

## 아직 정하지 않은 것

- 브라우저 시작과 서버 완료를 연결하는 전환율. 지금은 server 이벤트 건수만 다룰 수
  있고 browser/server 시도 연결은 별도 설계다.
- 발행자 OIDC 운영 설정과 실제 audience 값·발급 절차. 공개 프로젝트 ID와 허용 오리진을
  발행자 인증 수단으로 재사용하지 않는다는 것만 정했다. 운영 제공자와 audience 값 확정은
  사용자가 운영 인증을 정한 뒤로 미룬다.
- 출처별로 분당·일일 한도를 따로 둘지. 지금은 프로젝트 한 값을 공유한다.
- 서버 출처 조회 화면의 실제 배포·운영 인증 연결. 화면 연결은 로컬에서 완료했고 로컬 브라우저 검증을 마쳤다.

## 다음 슬라이스

1. 브라우저/서버 사이의 작업 연결과 다단계 퍼널 계약. 서버 전용 등록·수집·조회와
   관리자 SDK 연결 안내·진단의 출처 선택은 로컬에서 구현했다.

발행자 OIDC 운영 설정값과 원격 등록·배포는 별도의 운영 후속이다. 사용자가 운영 인증
방식을 정한 뒤에 채워 server 경로를 켠다.

관련: [이벤트·집계 계약](./event-contract.md), [수집기 구현](./collector.md),
[관리자 조회·설정 경계](./administrator.md), [적용 메모](../../db/migrations/README.md),
[OpenAPI](../../api/openapi.yaml).
