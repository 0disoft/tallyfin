# 수집기 구현 (apps/collector)

상태: 최소 브라우저 수집기를 구현했고 로컬 Miniflare HTTP 테스트로 확인한다. 워커는
네이티브 fetch 경계이며 `packages/core`(검증·정규화·해시)와 `packages/storage-d1`
(D1 원자 저장)을 호출한다. 브라우저 SDK(`packages/browser`)는 별도로 로컬 구현·검증했고
[브라우저 SDK](./browser-sdk.md)에 정리했다. 관리자 GET 조회는 검증기 포트와 함께 로컬에서 구현·검증했고, 실제
인증 제공자 설정·원격 DB 적용·운영 배포는 아직 없다. 이 문서는 계약을 수집 경계에
어떻게 적용했는지와 구현/배포 상태만 기록한다.

동작 의미는 [이벤트·집계 계약](./event-contract.md), 요청/응답 형태는
[OpenAPI](../../api/openapi.yaml), 본문 정책은 [HTTP API 정책](./04-http-api-policy.md),
오류·로그는 [오류 응답](./05-error-response.md)과
[로그 경계](./06-logging-and-observability.md)를 따른다. 관리자 조회 경로와 검증기
포트는 [관리자 조회 경계](./administrator.md)에 있다. 실행 명령과 현재 검증 상태는
[VALIDATION.md](../../VALIDATION.md)에 있다.

## 경계와 라우트

`apps/collector`는 네이티브 fetch 기반 Worker다. `index.ts`의 기본 `fetch`가 D1
바인딩으로 `D1Store`를 만들고 `createCollector(store, { now, log })`가 요청을
처리한다. `ALLOW_LOCAL_HTTP === 'true'`일 때만 로컬 HTTP 오리진을 허용한다.
프로젝트·버전·정책 설정은 저장 어댑터가 D1에서 읽는다. 코어는 Cloudflare 런타임에
의존하지 않는다.

- `POST /v1/projects/{projectId}/batches` — 공개 수집, 관리자 자격증명 없음.
- 관리자 GET 조회는 `/v1/projects`,
  `/v1/projects/{projectId}/schemas/{schemaVersion}`, `.../summary`,
  `.../events/{eventName}/daily`, `.../workflows/{workflowId}/daily`다. 검증기를
  연결하지 않은 기본 export는 401로 닫고, GET이 아니면 405(Allow: GET)다.
- 그 밖의 경로는 `not_found`(404)이다.

`projectId`는 정규식 `^[a-z][a-z0-9-]{0,47}$`를 통과해야 한다. 등록되지 않은
프로젝트는 `not_found`(404), paused 프로젝트는 `project_unavailable`(403)이다.

## 요청 처리 순서

1. `Origin`과 프로젝트를 먼저 읽어 허용 오리진이면 `Access-Control-Allow-Origin`을
   설정한다. 응답 헤더는 항상 `Cache-Control: no-store`, `Vary: Origin`을 둔다.
2. 분당 admission을 확인한다(`admit`). 거부·preflight·잘못된 요청·중복도 여기서 센다.
3. 오리진이 허용되지 않으면 `origin_denied`(403), 프로젝트가 active가 아니면
   `project_unavailable`(403)이다.
4. `OPTIONS`는 `Access-Control-Request-Method: POST`와
   `Access-Control-Request-Headers`가 `content-type`만일 때 204로 답한다. 그 밖은
   `invalid_request`(400)이다. `POST`가 아니면 `Allow: POST, OPTIONS`와 함께
   `invalid_request`(405)이다.
5. 본문을 스트림으로 읽어 UTF-8 16KiB를 넘으면 `invalid_request`(413)로 끊는다.
   `application/json`과 `text/plain`(charset utf-8)만 받고 둘 다 JSON으로 파싱한다.
   `Content-Encoding`이 `identity`가 아니면 `invalid_request`(415)이다.
6. `parseBatch` → `loadRegistry` → `prepareBatch` 순으로 검증한다. 레지스트리를 읽은
   뒤 오리진을 다시 확인한다.
7. `commit`으로 영수증·시도·할당량·집계를 한 트랜잭션에 반영한다. 성공은
   `accepted`/`duplicates`만 반환하고 성공 로그를 남기지 않는다.
8. `accepted + duplicates`가 배치 이벤트 수와 다르면 `storage_unavailable`(503)이다.

검증 순서와 시간 경계는 [이벤트 계약](./event-contract.md)과 같다. `occurredAt`은
수신 시각 기준 과거 24시간~미래 5분만 허용한다.

## 오류와 로그

오류는 `{ error: { code, message, requestId } }` 형태다. `code`는 고정 enum, `message`는
안전한 짧은 안내, `requestId`는 요청마다 만든 무작위 UUIDv4다. 요청 본문·속성 값·
SQL·토큰·IP·Origin·전체 URL은 메시지나 로그에 남기지 않는다. 진단 로그는
`{ requestId, code }`만 남기며 실패해도 응답을 바꾸지 않는다.

- 분당 admission 429에는 다음 고정 분까지 남은 초(1~60)를 `Retry-After`로 보낸다.
- 일일 할당량 429에는 다음 UTC 자정까지 남은 초를 `Retry-After`로 보낸다.
- 503에는 `Retry-After: 1`을 보낸다.
- 429의 `Retry-After`는 최대 86400초(다음 UTC 자정)다. [OpenAPI](../../api/openapi.yaml)도
  같은 상한을 쓴다.
- 관리자 라우트는 호스트가 검증기를 연결하지 않으면 401로 닫는다(기본 export 상태).
  연결 뒤에도 GET 조회만 지원하고 그 밖의 메서드는 405다.

## 중복·원자성 (저장 어댑터)

`D1Store.commit`은 매 시도마다 일관된 스냅샷(프로젝트, 스키마, 영수증, 시도,
UTC 일별 할당량)을 한 번에 읽는다. 이미 있는 영수증은 해시·버전이 같으면
`duplicates`로 세고 아무것도 쓰지 않는다. 내용이나 버전이 다르면
`event_conflict`(409)로 배치 전체를 거부한다. 재전송만 있는 배치는 읽기만 하고
끝낸다.

쓰기가 필요한 배치는 `projects.ingest_revision`을 포함한 한 배치로 반영한다.
CAS(compare-and-swap) 가드는 트랜잭션 시작 시 읽은 `ingest_revision`, 활성 상태,
시간대, 허용 오리진, 일일 한도, 분당 한도, 활성 스키마 `definitions_json`이 그대로일
때만 revision을 1 올리고, 하나라도 달라지면 `-1`을 써서 CHECK 제약
`tallyfin_ingest_revision`을 실패시킨다. CHECK 실패는 배치 전체를 롤백한다.

- provisioning에서 프로젝트 설정이나 활성 스키마 정의가 바뀌면 CAS가 fail-closed로
  동작한다. 어댑터는 커밋 직전에 읽은 레지스트리와 호출자가 넘긴 레지스트리를
  비교해 다르면 `storage_unavailable`(503)로 끝낸다.
- CAS 실패는 이름이 `tallyfin_ingest_revision`인 경우에만 재시도로 본다. 그 밖의 DB
  오류는 즉시 `storage_unavailable`(503)이다.
- 재시도는 초기 시도를 포함해 최대 3회이며 매 시도마다 스냅샷을 다시 읽는다. 3회
  안에 성공하지 못하면 `storage_unavailable`(503)로 끝낸다.
- 집계 `count`가 안전 정수 범위를 넘으면 CHECK로 배치 전체가 롤백된다. 부분
  accepted는 만들지 않는다.

한 트랜잭션에서 반영하는 것: 영수증(48h TTL), 시도 상태(72h TTL), UTC 일별 신규
영수증 할당량, 이벤트 일별 집계, 목표 일별 집계, 프로젝트의 `latest_received_at`과
`ingest_revision`.

## 할당량

- 분당 admission: 프로젝트·UTC 고정 분(`minute_start`) 단위로 `ingest_minute_usage`에
  요청 수를 센다. 중복·잘못된 요청·거부·preflight도 포함하며 전체 최대 한도+1인
  601에서 포화한다. 프로젝트 한도를 바꿔도 같은 분의 카운터는 줄지 않는다.
  고정 분이 바뀌면 새로 센다.
- 일일 신규 영수증: `projects.new_receipts_per_utc_day`를 프로젝트·UTC 수신일 기준으로
  센다. 같은 ID 재전송은 늘리지 않고, 이미 센 단계의 새 ID 중복은 영수증만 추가하고
  집계는 다시 세지 않는다. 한도를 넘으면 `quota_exceeded`(429)이며 배치 전체가
  거부된다.

## 보존과 정리

- 영수증 48시간, 최소 시도 상태 72시간, UTC 수신일 할당량은 UTC 날짜 끝 + 72시간.
- 일별 집계는 프로젝트-local 오늘과 앞 89일, 총 90일.
- `D1Store.cleanup(projectId, timeZone, now, limit = 500)`은 호출당 테이블별로 최대
  `limit`개(1~1000)를 지운다. 만료된 영수증/시도/할당량은 `expires_at <= now`, 분당
  카운터는 기록이 없으면 지난 2분을 넘긴 분, 거부 기록이 있으면 최근 7개 UTC 날짜 밖을,
  일별 집계는 90일 보존 밖을 지운다.
- 정리는 프로젝트 범위이며, 만료된 원래 이벤트는 시간 검사로 다시 거부되므로 정리
  뒤 재집계되지 않는다.
- Worker `scheduled` 핸들러는 회당 최대 5개 프로젝트·테이블별 500행을 처리한다.
  D1에 순회 위치를 보관하고 실패한 프로젝트 뒤에서도 계속 진행한다. 정리 실패나
  커서 CAS 충돌은 실행 실패로 기록한다. [자동 정리](./retention-cleanup.md)를 따른다.
  원격 Cron Trigger 등록과 활성화는 아직 하지 않았다.

## 구현·배포 상태

- 구현·로컬 검증: `packages/core`(등록·배치·시간·해시), `packages/storage-d1`(D1 원자
  커밋·CAS·할당량·정리와 grant 조건 조회), `apps/collector`(네이티브 fetch 최소 browser
  수집, HTTP 경계, 관리자 GET 조회), `packages/browser`(브라우저 SDK)와
  `examples/sembom` 예제, 초기 빈 DB용 SQL `0001_initial.sql`(로컬 Miniflare 전용).
- 관리자 조회: 검증기 포트 `createWorker(verifyBearer)`와 `admin.ts`의 GET 조회를
  로컬 구현·검증했다. 테스트는 모킹한 trusted 검증기와 D1 grant 경계를 쓴다. 경로는
  [관리자 조회 경계](./administrator.md)에 있다.
- 아직 없음: 실제 인증 제공자 연결·운영 토큰 발급, 서버 발행 수집, 관리자
  grant provisioning API, 원격 D1 마이그레이션, 운영 Wrangler 설정과 바인딩·시크릿,
  원격 정리 Cron Trigger 등록. 정리 스케줄러와 커서는 로컬 구현·검증했다.
- 측정: 브라우저 SDK가 gzip 3KiB 예산 안(실측값은 [VALIDATION.md](../../VALIDATION.md)).
- 미측정: SDK 초기 실행 비용·실브라우저 지연, 쓰기 처리량·지연, 프로젝트 수·조합 규모별 비용.
- 배포·활성화: 원격 D1·운영 Worker·도메인·인증 제공자는 설정하지 않았다.
