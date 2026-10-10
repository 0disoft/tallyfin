# 관리자 조회·설정 경계 (apps/collector)

상태: 관리자 조회(GET)·출처별 집계 조회(source)·프로젝트 설정 조회/변경(PATCH)·프로젝트
권한 부여/역할 변경/회수(PUT·DELETE)·프로젝트 변경 이력 조회(GET)·검증기 포트·OIDC JWT
서명 검증 어댑터를 로컬에서 구현·검증했다. 실제 인증 제공자·로그인 흐름·토큰 발급과 운영
설정은 아직 연결하지 않았다.

호스트는 `createWorker(verifyBearer)`로 신뢰하는 검증기를 연결한다. `verifyBearer`는
서명·신뢰하는 발급자·대상·유효기간을 확인한 뒤 `{ issuer, subject }`를 돌려주거나
null을 돌려준다. `apps/collector/src/index.ts`의 기본 export는 검증기 없이 만들어져
관리자 경로를 401로 닫는다. 검증기가 없거나 bearer·issuer·subject가 비면 401이다.
프로젝트 설정 경로는 GET·PATCH를 받고 그 밖은 405(Allow: GET, PATCH), 프로젝트 권한
경로는 GET·PUT·DELETE를 받고 그 밖은 405(Allow: GET, PUT, DELETE), 초안 검증 경로는
POST만 받고 그 밖은 405(Allow: POST), 프로젝트 목록/생성 경로는 GET·POST
(Allow: GET, POST), 버전별 스키마 경로는 GET·PUT을
받으며 나머지 조회 경로는 GET이 아니면 405(Allow: GET)다.

저장소 루트의 호스트 어댑터 파일 예시다. `@tallyfin/collector` 패키지에는 `exports`가
없으므로 소스 경로로 가져온다. `hostVerify`는 호스트가 채워야 할 자리이고 이 저장소에는
구현이 없다.

```ts
// worker.ts (호스트 어댑터, 저장소 루트)
import { createWorker } from './apps/collector/src/index.ts';

export default createWorker(bearer => hostVerify(bearer));
```

일반 JWT access token 제공자에는 `createOidcWorker(options)`도 사용할 수 있다.
운영자가 issuer·API audience·HTTPS 공개키 주소를 지정한다. 지원 프로필과 캐시
갱신 한계는 [OIDC 어댑터](./oidc.md)에 설명한다.

검증된 issuer/subject로 매 조회마다 `project_grants`의 role(reader/owner)을 확인한다.
화면 선택·cursor·공개 projectId로 권한을 얻지 않는다. grant가 없으면 403, 정의·버전이
없으면 404, 저장소 오류는 503이다. 단순 JWT decode로 인증하지 않는다.

지원 조회 경로는 아래 GET이고, 쓰기는 프로젝트 생성 POST·설정 PATCH·버전별 스키마 PUT·
프로젝트 권한 PUT·DELETE다. 초안 검증 POST는 저장하지 않는 읽기 작업이다.

- `GET /v1/projects` — 접근 가능한 프로젝트 목록. limit 기본 25·최대 100, cursor 페이지.
- `POST /v1/projects` — 별도 생성 권한을 가진 관리자만 프로젝트 생성. 아래 생성 규칙을 따른다.
- `GET /v1/projects/{projectId}` — 현재 설정과 settingsHash. reader/owner.
- `GET /v1/projects/{projectId}/grants` — 현재 owner 전용 권한 목록. 아래 목록 규칙을 따른다.
- `PUT /v1/projects/{projectId}/grants` — owner의 reader/owner grant 등록·역할 변경. 아래 변경 규칙을 따른다.
- `DELETE /v1/projects/{projectId}/grants` — owner의 grant 회수. 아래 변경 규칙을 따른다.
- `GET /v1/projects/{projectId}/changes` — 현재 owner 전용 변경 이력 조회. 아래 변경 이력 규칙을 따른다.
- `GET /v1/projects/{projectId}/collection/rejections?from={UTC-date}&to={UTC-date}` — reader/owner의 수집 거부 진단. 아래 UTC 진단 규칙을 따른다.
- `GET /v1/projects/{projectId}/schemas/{schemaVersion}` — 불변 레지스트리 스냅샷.
- `GET /v1/projects/{projectId}/schemas` — reader/owner의 버전 목록·최신 버전 조회.
- `PUT /v1/projects/{projectId}/schemas/{schemaVersion}` — owner의 새 버전 발행.
- `POST /v1/projects/{projectId}/schemas/validate` — owner 전용 초안 검증, 저장 없음.
- `GET /v1/projects/{projectId}/summary` — 한 버전·기간의 이벤트별 건수. 선택 `source`(기본 browser, browser|server).
- `GET /v1/projects/{projectId}/events/{eventName}/daily` — 일별 건수와 선택 속성 버킷. 선택 `source`.
- `GET /v1/projects/{projectId}/workflows/{workflowId}/daily` — 시작일 cohort. browser 출처 전용.
- `GET /v1/projects/{projectId}/workflows/{workflowId}/breakdown?groupBy={dimension}` — 시작 시점 속성별 cohort. browser 출처 전용.

집계 조회는 정확한 schemaVersion, 프로젝트 시간대의 from/to, 보존 90일 안에서 최대
31일을 요구한다. retired 버전과 paused 프로젝트도 같은 grant로 조회한다. 빈 날짜는 0으로
채우고, 흐름 완료율은 시작 cohort의 succeeded/started이며 실패 단계가 없으면
failedAttempts는 null, 날짜 끝 + 48시간까지 provisional=true다.

`summary`와 `events/{eventName}/daily`만 선택 `source`(기본 browser)를 받고 한 요청에 한
출처만 읽는다. browser와 server 건수를 합치거나 서로 바꿔 세지 않는다. server 정의도 daily
속성 분류를 지원하고 등록된 출처·속성 이름만 허용한다. 그 출처에 정의가 없으면 summary는
`events=[]`·`totalEvents=0`이고, 다른 출처에만 있는 이벤트 이름을 daily로 요청하면 404다.
workflow 경로는 `source`를 받지 않고 browser 기록만 읽는다(source를 주면 400). meta.source는
요청 출처(기본 browser)이고 meta.latestReceivedAt는 프로젝트 전체의 최신 수신 시각이라 특정
출처·버전·날짜 값이 아니다. 조회 권한은 매 요청마다 `project_grants` reader/owner로 다시
검사하며 `project_publishers` 발행 권한으로는 조회할 수 없다.

속성별 흐름 조회는 등록 workflow.dimensions 중 한 속성만 groupBy로 받는다. 시작
시점에 저장한 차원 키를 사용하고 이벤트 발생일별 건수로 완료율을 추론하지 않는다.
기존 daily 응답은 바꾸지 않는다. 응답은 meta·workflowId·cohortBasis·groupBy·summary와
최대32개 buckets다. 각 bucket은 자료형을 유지한 value·summary·최대31일 days를 담는다.
다른 차원 조합은 같은 값에 합산하며 완료율은 합산된 성공/시작이다. 필수 차원이므로
null 버킷은 없고 관찰된 값만 반환한다. 빈 결과는 buckets=[], 0시도 완료율은 null이다.
기존 reader/owner grant를 정의·집계와 같은 D1 batch에서 다시 확인한다. 최대7936개
원본 행을 읽고 초과·손상 데이터는503으로 실패한다. 저장/마이그레이션 변경은 없다.

## 수집 거부 진단 — UTC 수신일

`from`/`to`는 필수 UTC 날짜이며 오늘과 앞 6일 안에서 최대 7개 날짜를 읽는다.
프로젝트 시간대·스키마 버전·이벤트 발생일과 무관하다. reader/owner는 중지 프로젝트나
스키마가 없는 프로젝트도 읽을 수 있고, 같은 D1 batch에서 grant와 집계를 검사한다.
추가/중복 파라미터는 400, 미인증은 401, grant 없음은 403, 프로젝트 없음은 404,
GET 아닌 메서드는 405, 손상된 JSON/시각/원인/안전 정수·합계/DB 실패는 503이다.

응답은 `meta`(UTC/receivedAt/retentionDays=7/coverage=best-effort), 전체 `summary`,
모든 요청 날짜의 `days`다. 각 요약은 거부 요청 수·마지막 거부 요청의 수신 시각과
고정 10개 원인 버킷을 포함한다. 기록이 없으면 0/null이고 저장 실패를 0으로 채우지
않는다. minute_limit/daily_limit는 공개 응답에서 모두 quota_exceeded지만 여기서는
구분한다. OPTIONS·잘못된 메서드의 거부도 포함될 수 있다. 이벤트 수·방문자 수·거부율·
할당량 사용량을 의미하지 않는다. 원문·출처·IP·토큰·requestId·이벤트 ID를 반환하지 않는다.

브라우저와 발행 권한을 통과한 서버 수집의 거부 기록을 합산한다. 출처별 건수는
구분하지 않으며, 서버 인증·발행 권한 검사에서 처음 거부된 요청은 기록하지 않는다.
추가 진단 기록은 best-effort이며 저장 실패·알 수 없는 프로젝트·관리자/API 인증 실패·
admission DB 실패·마이그레이션 이전 이력은 포함하지 않는다. 진단이 응답 뒤 저장될 수
있으므로 직후 조회에는 아직 반영되지 않을 수 있다. 조회는 최대 10080분과 7일/10원인
출력으로 제한하며 프로토타입 진단 화면 연결은 후속이다. [응답 예제](../../api/examples/collection-rejections-response.json)를 따른다.

## 프로젝트 설정 조회·변경

`GET /v1/projects/{projectId}`는 reader/owner에게 `{project, allowedOrigins, limits,
settingsHash, canEdit}`를 돌려준다. `canEdit`는 요청을 보낸 검증된 principal이 그
프로젝트의 owner grant를 가졌는지 나타내는 snapshot boolean이라 reader에게는 false다.
paused 프로젝트도 조회하고 schemaVersion은 요구하지 않는다. settingsHash는
`project`·`allowedOrigins`·`limits`의 canonical JSON SHA-256이라
ingest_revision·집계·스키마는 해시에 들어가지 않고 `canEdit`도 해시에서 제외한다.

`PATCH /v1/projects/{projectId}`는 owner 전용이다. 본문은 UTF-8 16KiB 이하
`application/json` 또는 `text/plain`(identity 인코딩)이고 닫힌 JSON으로 검증한다.
`name`·`status(active/paused)`·`allowedOrigins`·`limits`만 바꿀 수 있고 보낸 limits
키만 병합한다. `expectedSettingsHash`와 변경할 항목이 최소 하나 필요하다. allowedOrigins는
정확한 HTTPS origin만 받고, 명시적으로 켠 `allowLocalHttp`에서만 loopback HTTP를
허용한다. `id`·`timeZone`·`schemas`·`grants`·`aggregates`는 바꿀 수 없고 이미
사용한 한도와 기존 스키마·데이터는 그대로 둔다.

`canEdit`는 조회 스냅샷의 표시용 값이라 저장 권한 판단에 그대로 쓰지 않는다. 변경은
저장 시점에 grant를 다시 확인하고 `expectedSettingsHash`를 현재 값과 비교해 원자
UPDATE로 반영한다. owner 자격이 회수되면 403, 해시가 오래됐거나 다른 설정 변경과
겹치면 `settings_conflict`(409)다. 수집만 일어나 ingest_revision이 올라간 경우는 충돌이
아니다. 설정 변경은 ingest_revision을 1 올려 진행 중인 수집의 충돌 검사와 맞물린다. 응답이
유실되거나 409를 받으면 현재 설정을 다시 읽어 비교한 뒤 재시도하고, 새 해시를 그대로
덮어쓰지 않는다.

## 스키마 초안 검증

기존 `GET /v1/projects/{projectId}/schemas/{schemaVersion}`로 발행된 정의를 읽고,
`POST /v1/projects/{projectId}/schemas/validate`에 `{events, workflows}`만 보내 검증한다.
프로젝트·버전·상태·허용 출처 등 다른 필드는 받지 않는다. POST는 인증한 뒤 프로젝트
설정과 owner grant를 같은 DB 조회에서 확인하며, 권한이 없으면 본문을 읽기 전에 403을
반환한다. 일시정지된 프로젝트도 검증할 수 있다. reader는 발행된 스키마 조회만 가능하다.

본문은 identity 인코딩의 `application/json` 또는 `text/plain`이며 UTF-8 32KiB가
상한이다. 다른 수집·설정 경로의 16KiB 상한은 그대로다. 쿼리 파라미터는 받지 않는다.
JSON 오류·닫힌 envelope 위반·배열이 아닌 events/workflows는 400, 크기 초과는 413,
지원하지 않는 미디어·인코딩은 415다.

정의의 의미 검증 결과는 200으로 `{valid, issues, privacyReviewRequired: true}`를
반환한다. 정상 초안의 issues는 빈 배열이고, 오류가 있으면 첫 오류 하나의 JSON pointer
`path`와 안정된 `code`를 반환한다. 입력값·DB 오류를 응답이나 로그에 넣지 않는다.
코드는 invalid_definition, definition_limit, duplicate, cardinality_limit,
invalid_reference, dimension_mismatch다. browser_event_required는 구버전 응답 호환을 위해
계약에 남겨 두지만 현재 검증기는 내보내지 않는다. server 정의만 있는 초안도 검증한다.

검증은 실제 등록과 같은 코어 함수로 이벤트 1~50개·흐름 최대 10개·속성 최대 4개·
종류 수/가능 조합 한도·흐름 참조·필수 차원 일치를 확인한다. 이벤트 출처는 browser/server
문자열만 허용한다. 검증 성공 후에도 enum의 개인정보 포함 여부는 운영자가 검토해야 한다.
초안·스키마·설정·사용량·집계는 쓰지 않으므로 반복 요청에 idempotency key가 필요 없다.
버전 예약이나 발행 가능성을 확정하지 않으며, 발행 때 다시 검증·권한 확인한다.

## 새 스키마 버전 발행

목록 GET은 버전 번호 내림차순으로 메타데이터를 반환한다. limit 기본 25·최대 100,
beforeVersion은 이전 페이지 마지막 버전보다 작은 번호를 조회하는 배타적 커서다.
latestVersion은 커서와 무관하게 해당 snapshot의 최고 번호이며, 등록된 스키마가
없으면 null이다. 매 페이지에서 grant를 다시 검사하고 paused 프로젝트·retired 버전도
표시한다. 정의 전체는 기존 버전별 GET으로 읽는다.

발행 PUT 본문은 `{expectedLatestVersion, privacyReviewed: true, events, workflows}`다.
identity 인코딩의 application/json 또는 text/plain을 받고 본문은 UTF-8 33KiB,
정의 자체는 32KiB가 상한이다. 이벤트·흐름 규칙은 초안 검증과 같은 함수로 다시 검사한다.
privacyReviewed는 owner의 검토 확인이며 자동 개인정보 탐지가 아니다. 프로젝트·상태·
허용 출처·수집 한도는 본문에 넣을 수 없다. 닫힌 입력·잘못된 정의는 400이다.

새 번호는 모든 기존 버전보다 커야 하고 expectedLatestVersion이 현재 최고 번호와
같아야 한다. 스키마가 없을 때만 null로 첫 버전을 발행한다. owner 조건·최고 번호 검사·
삽입·ingest_revision 증가는 한 D1 batch에서 수행한다. 저장 직전에 권한이 회수되면
403, 다른 내용으로 같은 번호를 쓰거나 최고 번호가 바뀌면 schema_conflict(409)다.
설정이나 수집에 의한 revision 변화만으로 발행을 거부하지 않는다.

같은 버전·같은 canonical 정의로 재요청하면 200과 기존 발행 메타데이터를 반환하고
추가 저장·revision 증가가 없다. 따라서 응답 유실 후에도 같은 PUT을 재시도할 수 있다.
이후 더 높은 버전이 생기거나 해당 버전이 retired 상태여도 같은 정의의 재요청은
현재 상태를 반환하며 재활성화하지 않는다. 별도 Idempotency-Key는 요구하지 않는다.
동일성은 객체 키 순서만 정규화하고 배열 순서는 보존한다.

기존 버전·집계·설정은 유지하고 새 버전만 active로 만든다. 이전 버전은 자동으로
retired 처리하지 않는다. 발행이 SDK의 선택 버전을 바꾸지는 않으므로 적용 제품에서
새 정의를 확인하고 버전을 명시적으로 전환해야 한다. 응답은 projectId·schemaVersion·
schemaStatus·publishedAt과 canonical `{events,workflows}`의 SHA-256 definitionHash다.

D1 batch의 rollback·실행 순서는 [공식 D1 문서](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch),
직전 삽입 여부에 따른 revision 변경은 [SQLite changes()](https://www.sqlite.org/lang_corefunc.html#changes)를
기준으로 구현하고 Miniflare에서 발행·재요청·동시 발행·실패 rollback을 확인했다.

프로젝트 생성은 별도 생성 권한 API 또는 provisioning CLI를 사용한다.
스키마 상태 변경은 기존 provisioning CLI가 맡는다. grant 부여·역할 변경·회수는 새 owner
API(PUT·DELETE)로 로컬 구현했고 provisioning CLI는 대안으로 유지한다. 관리자 화면의
권한 변경 UI, 인증 제공자 설정, 원격 배포는 후속이다. 요청·응답 형태는
[OpenAPI](../../api/openapi.yaml)를 따르고, 동작 의미는
[이벤트·집계 계약](./event-contract.md)을 따른다.

## 프로젝트 권한 목록

`GET /v1/projects/{projectId}/grants`는 현재 프로젝트 owner만 읽는다. reader·다른
프로젝트 owner·권한이 없는 사용자·없는 프로젝트는 403이다. 프로젝트가 paused이거나
스키마가 없어도 조회하며, 검증된 호출자 issuer/subject로 매 페이지에서 owner를 다시
확인한다. 권한 검사와 목록은 같은 D1 batch에서 읽는다.
[D1 batch 문서](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)의
트랜잭션 의미를 따르며, 조회 도중 회수된 권한은 다음 페이지에서 다시 검사한다.

응답은 `{projectId,data:[{issuer,subject,role,createdAt}],page:{limit,nextCursor}}`다.
createdAt은 최초 grant 생성 시각이며 역할 변경으로 초기화되지 않는다. 이름·이메일을
추측하거나 인증 토큰·사용자 프로필을 반환하지 않는다. issuer/subject와 커서는 관리자
식별 정보로 다루고 요청/응답 로그에 기록하지 않는다. 응답은 no-store다.

limit은 기본 25·최대 100이고 issuer, subject의 SQLite BINARY 순서로 읽는다.
다음 페이지에는 nextCursor를 그대로 보내며 null이면 끝이다. 커서는 프로젝트와 마지막
식별값을 담은 base64url 위치값(최대 12288자)으로 권한을 부여하지 않는다. 잘못된 형식·
다른 프로젝트 커서·중복/추가 파라미터·12352자를 넘는 쿼리는 400이다. 첫 페이지는
cursor를 생략하거나 빈 값으로 보낸다. 식별자 둘의 최대 512자·Unicode도 지원한다.
각 페이지는 현재 DB를 읽으므로 이전 위치보다 앞에 추가된 grant는 목록을 처음부터
다시 읽어야 보인다. 조회로 grant·설정·수집 사용량을 변경하지 않는다.

## 프로젝트 권한 변경

`PUT /v1/projects/{projectId}/grants`와 `DELETE .../grants`는 현재 프로젝트
owner만 쓴다. reader·다른 프로젝트 owner·발급자가 다른 호출자·회수된 owner·없는
프로젝트는 403이다. 라우터는 본문을 읽기 전에 검증된 호출자가 owner인지 preflight로
확인하고, 쓰기 직전 원자 DB batch에서 owner 조건·CAS·last-owner 가드·결과 조회를 함께
수행한다. 본문은 닫힌 JSON이며 UTF-8 16KiB 이하 identity 인코딩만 받고 조회 파라미터는
받지 않는다. issuer·subject는 [provisioning CLI](./provisioning.md)와 같은 제약을 쓴다.
PUT 본문은 `{issuer,subject,role,expectedRole}`, DELETE 본문은
`{issuer,subject,expectedRole}`이다.

`expectedRole`은 호출자가 마지막으로 본 역할이다. PUT에서 null은 신규 등록,
reader/owner는 현재 저장 역할과 비교하는 CAS다. 대상이 이미 원하는 역할이면 다시 쓰지
않고 200 `changed=false`로 성공하며, 그 밖에 저장 역할이 expectedRole과 다르면
grant_conflict(409)다. DELETE에서 null은 grant가 없다고 본 경우이고 grant가 없으면
멱등 성공(changed=false)이다. 저장 역할이 expectedRole과 다르면 grant_conflict(409)다.

역할 변경은 최초 createdAt을 유지하고, 마지막 owner를 reader로 내리거나 회수하면
last_owner(409)다. 다른 owner가 있으면 자기 grant를 스스로 낮추거나 회수할 수 있고 그때
응답은 canManage=false이며 이후 owner API 호출은 403이다. 성공 응답은 200
`{projectId,issuer,subject,role,createdAt,canManage,changed}`이고 role이 null이면
createdAt도 null이다. 이 API와 관리자 화면의 권한 변경 패널을 로컬에서 구현·검증했다.
화면은 후보를 준비만 하고 확인 패널에서만 저장하며, 결과가 불명확하면 같은 요청만 다시
보내고, 권한을 잃으면 목록과 편집을 잠근다. DB·마이그레이션 변경·배포·운영 identity
자격 증명은 없다.

## 프로젝트 변경 이력 조회

`GET /v1/projects/{projectId}/changes`는 현재 프로젝트 owner만 읽는다. reader·다른
프로젝트 owner·없는 프로젝트·회수된 권한은 403이고, owner 권한과 기록을 같은 D1
batch에서 읽는다. 인증 실패는 401, 잘못된 프로젝트·페이지 파라미터는 400, GET이 아니면
405(Allow: GET), 손상 저장소는 503이다.

응답은 `{projectId,generatedAt,retentionDays:90,coverage:'recorded-changes-only',data,page}`다.
각 항목은 id·occurredAt·actor·change만 담고 설정값·스키마 정의·요청 본문·토큰은 넣지
않는다. actor는 관리자 API 변경이면 검증한 issuer/subject를 담은 administrator이고,
오프라인 provisioning CLI 변경이면 식별자 없는 local_operator다. 저장된 NULL 식별자는
응답에 넣지 않는다. change는 action에 필요한 값만 담는다. 프로젝트 생성은 action만,
설정 변경은 바뀐 필드명 목록, 스키마는 동작과 버전 번호, grant는 대상 issuer/subject와
이전/이후 역할이다.

기록 대상은 관리자 API의 프로젝트 생성·설정 변경·스키마 발행·grant 변경과 provisioning
CLI의 register·grant·revoke다. 직접 SQL 쓰기, creator 권한 관리, 시스템 정리, 방문자
활동은 기록하지 않는다.

limit은 기본 25·최대 100이고 occurredAt 내림차순, 같은 시각이면 기록 UUID
내림차순이다. 커서는 프로젝트에 묶인 base64url 위치값(최대 512자)으로
`[1,projectId,timestamp,recordUUID]`를 담고 권한을 부여하지 않는다. 잘못된 형식·다른
프로젝트 커서·중복/추가 파라미터·512자를 넘는 쿼리는 400이다. 첫 페이지는 cursor를
생략하거나 빈 값으로 보낸다.

조회 창은 generatedAt 기준 90일 rolling이고 cutoff 시각은 포함하며 미래 기록은 제외한다.
물리 정리 전이라도 창을 벗어난 만료 행은 숨긴다. coverage는 기록된 변경만 담는다는
뜻이며 이력이 비어도 과거에 변경이 없었다는 증거는 아니다. 페이지는 살아 있는 DB를
읽으므로 뒤에 추가된 변경은 처음부터 다시 읽어야 보인다. 관리자 API 연결 설정 화면에
소유자 전용 25건 목록·페이지 이동·재시도를 연결했다. reader는 요청하지 않고 설정·권한
저장 뒤 첫 페이지를 갱신한다. 운영 인증·원격 D1 적용·배포·Sembom 연동은 없다.

## 프로젝트 생성

`POST /v1/projects`는 신뢰하는 검증기가 확인한 issuer/subject와 `project_creators`의
별도 생성 권한을 요구한다. 프로젝트 reader/owner는 이 권한을 대신하지 못한다.
권한이 없으면 본문을 읽기 전에 403이다. 운영자는 [provisioning CLI](./provisioning.md)의
creator-grant/revoke로 권한과 1~1000개 한도를 부여·회수한다. 기존 프로젝트의 owner를
자동으로 생성자로 등록하거나 클라이언트의 issuer/subject/owner 주장을 받지 않는다.

입력은 `{id,name,timeZone,allowedOrigins,limits}`만 받는다. 두 수집 한도를 모두
명시하며 설정 API와 같은 이름 길이·HTTPS origin·loopback opt-in 규칙을 사용한다.
시간대는 IANA 이름을 검증하고 생성 후 변경할 수 없다. name은 공백뿐인 문자열·제어
문자를 거부한다. 쿼리 파라미터 없이 identity JSON/text/plain, 최대 16KiB다.
새 프로젝트는 active·스키마 없음으로 만들며 첫 발행은 기존 스키마 PUT을 사용한다.
스키마가 없으면 수집이 허용되지 않는다.

프로젝트·원본 생성 요청 해시·최초 owner grant를 같은 원자 D1 batch로 저장한다.
INSERT에서 생성 권한과 해당 principal의 API 생성 기록 개수를 다시 확인하므로
동시 생성으로 한도를 넘을 수 없다. CLI로 등록한 기존 프로젝트는 이 개수에 포함하지
않는다. 새 owner는 인증된 생성자이며 다른 프로젝트·스키마·집계·사용량은 변경하지 않는다.

성공은 최초와 재요청 모두 200 `{projectId,createdAt,creationHash}`다. 별도
Idempotency-Key 대신 공개 프로젝트 ID·인증된 생성자·초기 요청 해시를 사용한다.
허용 origin 목록만 정렬해 해시를 만들며 나머지 값을 추측하거나 기본값으로 대체하지 않는다.
같은 생성자의 같은 원본 내용은 설정 수정·스키마 발행·개수 한도 도달 뒤에도 원본
생성 결과를 반환한다. 현재 생성 권한과 owner grant는 계속 필요하다. 재요청은 변경된
설정을 되돌리거나 회수된 grant를 복원하지 않는다. 응답 유실은 같은 요청으로 재확인한다.

다른 내용·다른 생성자·CLI가 이미 점유한 ID는 project_conflict(409), 개수 한도는
project_limit_reached(409)다. 한도 도달과 ID 충돌이 겹치면 한도 오류가 우선할 수 있다.
두 오류는 기존 프로젝트 내용이나 생성자를 노출하지 않는다. 생성 이력은 프로젝트 수명 동안
유지하고 생성 권한 회수로 지우지 않는다. 요청 본문·DB 오류는 로그/응답에 넣지 않는다.
신규 DB는 0001·0002·0003, 기존 DB는 0003 추가 적용이 필요하며 원격 적용은 아직 없다.
