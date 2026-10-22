# 수집기 구현 (apps/collector)

상태: 최소 브라우저 수집기와 서버 발행 endpoint를 구현했고 로컬 Miniflare HTTP 테스트로
확인한다. 워커는 네이티브 fetch 경계이며 `packages/core`(검증·정규화·해시)와
`packages/storage-d1`(D1 원자 저장)을 호출한다. 브라우저 SDK(`packages/browser`)는
별도로 로컬 구현·검증했고 [브라우저 SDK](./browser-sdk.md)에 정리했다. 관리자 라우트와
발행자 검증기 포트는 로컬에서 구현·검증했고, 실제 인증 제공자 설정·원격 DB 적용·운영
배포는 아직 없다. 이 문서는 계약을 수집 경계에 어떻게 적용했는지와 구현/배포 상태만
기록한다.

동작 의미는 [이벤트·집계 계약](./event-contract.md), 요청/응답 형태는
[OpenAPI](../../api/openapi.yaml), 본문 정책은 [HTTP API 정책](./04-http-api-policy.md),
오류·로그는 [오류 응답](./05-error-response.md)과
[로그 경계](./06-logging-and-observability.md)를 따른다. 관리자 조회 경로와 검증기
포트는 [관리자 조회 경계](./administrator.md)에 있다. 실행 명령과 현재 검증 상태는
[VALIDATION.md](../../VALIDATION.md)에 있다.

## 경계와 라우트

`apps/collector`는 네이티브 fetch 기반 Worker다. `index.ts`의 기본 `fetch`가 D1
바인딩으로 `D1Store`를 만들고 `createCollector(store, { now, observe })`가 요청을
처리한다. `observe`·`monotonicNow`는 선택 포트이고, 오류 전용 `log` 포트도 호스트가 넘길
수 있게 남아 있다. 네이티브 Worker는 `log` 대신 `observe`를 넘긴다.
`ALLOW_LOCAL_HTTP === 'true'`일 때만 로컬 HTTP 오리진을 허용한다.
프로젝트·버전·정책 설정은 저장 어댑터가 D1에서 읽는다. 코어는 Cloudflare 런타임에
의존하지 않는다.

- `POST /v1/projects/{projectId}/batches` — 공개 수집, 관리자 자격증명 없음.
- `POST /v1/projects/{projectId}/server-batches` — 발행자 bearer 인증 필수, CORS 없음.
  계약은 [서버 발행 이벤트](./server-events.md)에 있다.
- 관리자 라우트는 [OpenAPI](../../api/openapi.yaml)의 경로·메서드와 같다. 검증기를 연결하지
  않은 기본 export는 401로 닫고, 허용 밖 메서드는 405와 그 endpoint의 `Allow`를 보낸다.

  - `GET`·`POST`: `/v1/projects`
  - `GET`·`PATCH`: `/v1/projects/{projectId}`
  - `GET`·`PUT`·`DELETE`: `/v1/projects/{projectId}/grants`,
    `/v1/projects/{projectId}/publishers`
  - `GET`·`PUT`: `/v1/projects/{projectId}/schemas/{schemaVersion}`
  - `POST`: `/v1/projects/{projectId}/schemas/validate`
  - `GET`: `/v1/health`, `/v1/identity`, `/v1/projects/{projectId}/changes`,
    `/v1/projects/{projectId}/collection/rejections`, `/v1/projects/{projectId}/schemas`,
    `/v1/projects/{projectId}/summary`, `/v1/projects/{projectId}/events/{eventName}/daily`,
    `/v1/projects/{projectId}/workflows/{workflowId}/daily`,
    `/v1/projects/{projectId}/workflows/{workflowId}/breakdown`,
    `/v1/projects/{projectId}/funnels/{funnelId}/daily`,
    `/v1/projects/{projectId}/funnels/{funnelId}/breakdown`

- `GET /v1/health` — 검증된 관리자 bearer로 `projects`·`project_grants` 두 제어면 테이블
  읽기를 검사한다. 계약은 [OpenAPI](../../api/openapi.yaml)에 있다.
- 그 밖의 경로는 `not_found`(404)이다.

`projectId`는 정규식 `^[a-z][a-z0-9-]{0,47}$`를 통과해야 한다. 등록되지 않은
프로젝트는 브라우저 경로에서 `not_found`(404), server 경로에서 `forbidden`(403)이다.
paused 프로젝트는 두 경로 모두 `project_unavailable`(403)이다.

## 요청 처리 순서

아래 1~8은 브라우저 수집 경로 순서다. 서버 발행 경로는 뒤의 별도 절을 따른다.

1. `Origin`과 프로젝트를 먼저 읽어 허용 오리진이면 `Access-Control-Allow-Origin`을
   설정한다. 응답 헤더는 항상 `Cache-Control: no-store`, `Vary: Origin`을 둔다.
2. 허용되지 않은 오리진은 `origin_denied`(403)로 거부하고 분당 admission을 쓰지 않는다.
3. 허용 오리진의 분당 admission을 확인한다(`admit`). preflight·잘못된 요청·중복도 센다.
   이후 프로젝트가 active가 아니면 `project_unavailable`(403)이다.
4. `OPTIONS`는 `Access-Control-Request-Method: POST`와
   `Access-Control-Request-Headers`가 `content-type`만일 때 204로 답한다. 그 밖은
   `invalid_request`(400)이다. `POST`가 아니면 `Allow: POST, OPTIONS`와 함께
   `invalid_request`(405)이다.
5. 본문을 스트림으로 읽어 UTF-8 16KiB를 넘으면 `invalid_request`(413)로 끊는다.
   `application/json`과 `text/plain`(charset utf-8)만 받고 둘 다 JSON으로 파싱한다.
   `Content-Encoding`이 `identity`가 아니면 `invalid_request`(415)이다.
6. `parseBatch` → `loadRegistry` → `prepareBatch` 순으로 검증한다. 레지스트리를 읽은
   뒤 오리진을 다시 확인한다.
7. `commit`으로 영수증·시도·할당량·집계를 한 트랜잭션에 반영한다. 성공 응답은
   `accepted`/`duplicates`만 반환한다. 응답 본문과 별개로, 응답이 준비되면 선택된 응답에
   대해 완료 관측 로그 한 줄을 남긴다(성공은 UUID 앞 두 글자 기준 4/256 표본).
8. `accepted + duplicates`가 배치 이벤트 수와 다르면 `storage_unavailable`(503)이다.

검증 순서와 시간 경계는 [이벤트 계약](./event-contract.md)과 같다. `occurredAt`은
수신 시각 기준 과거 24시간~미래 5분만 허용한다.

### 서버 발행 경로 순서

서버 발행 경로는 브라우저 경로와 순서가 다르다.

1. `Authorization: Bearer`를 발행자 검증기(`PublisherAccess.verifyBearer`)로 검증한다.
   검증기를 주입하지 않았거나 헤더·토큰이 유효하지 않으면 `unauthorized`(401)이고,
   프로젝트 읽기·admission·본문 읽기 전에 끝난다.
2. 프로젝트 ID 형식을 확인하고 저장 어댑터의 `publisherAccess`로 `project_publishers`
   권한을 본다. 권한이 없거나 모르는 프로젝트면 `forbidden`(403)이다.
3. 프로젝트를 읽고 분당 admission을 확인한 뒤 `POST` 여부, 조회 파라미터,
   `Content-Type`(`application/json`만)을 검사한다. `OPTIONS` preflight를 처리하지
   않고 CORS 헤더를 만들지 않는다. `POST`가 아니면 `Allow: POST`와 405다.
4. `parseServerBatch` → `loadRegistry` → `prepareServerBatch` → `commitServer` 순으로
   진행한다. 오리진 재확인 단계는 브라우저 경로에만 있다.

## 오류와 로그

오류는 `{ error: { code, message, requestId } }` 형태다. `code`는 고정 enum, `message`는
안전한 짧은 안내, `requestId`는 요청마다 만든 무작위 UUIDv4다. 요청 본문·속성 값·
SQL·토큰·IP·Origin·전체 URL·경로·조회 파라미터·메서드·헤더·대상 식별자는 메시지나
로그에 남기지 않는다. 이 배제는 오류 메시지와 운영 로그 줄에 한정하고, 프로젝트 키로
저장되는 제품·관리 데이터의 계약을 바꾸지 않는다.

호스트가 넘기는 오류 전용 `log` 포트는 `{ requestId, code }`만 남기며 실패해도 응답을
바꾸지 않는다. 네이티브 Worker는 이 포트 대신 완료 관측 포트(`observe`)를 넘겨 선택된
응답 하나당 최대 한 줄(`event: http_request`)만 남긴다. 필드·표본·측정 구간과 한계는
[로그 경계](./06-logging-and-observability.md)에 있다.

- 분당 admission 429에는 다음 고정 분까지 남은 초(1~60)를 `Retry-After`로 보낸다.
- 일일 할당량 429에는 다음 UTC 자정까지 남은 초를 `Retry-After`로 보낸다.
- 503에는 `Retry-After: 1`을 보낸다.
- 429의 `Retry-After`는 최대 86400초(다음 UTC 자정)다. [OpenAPI](../../api/openapi.yaml)도
  같은 상한을 쓴다.
- 관리자 라우트는 호스트가 검증기를 연결하지 않으면 401로 닫는다(기본 export 상태).
  연결 뒤에는 endpoint별 허용 메서드만 지원하고, 그 밖의 메서드는 405와 그 endpoint의
  `Allow`다.
- 발행자 경로도 검증기가 없으면 401로 닫고, 401에는 `WWW-Authenticate: Bearer`를
  보낸다. 401 메시지는 관리자·발행자가 같은 문구를 쓴다.
- server 경로 응답은 `Vary: Authorization`을 쓰고 `Access-Control-Allow-Origin`을
  넣지 않는다. `Origin`은 인증에 쓰지 않는다.

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
  요청 수를 센다. 허용 오리진의 중복·잘못된 요청·거부·preflight도 포함하며 전체 최대 한도+1인
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
- Worker `scheduled` 핸들러는 기본 회당 최대 5개 프로젝트·테이블별 500행을 처리한다.
  호스트가 충분한 쿼리 예산을 확인하고 cleanupMaxPages 옵션을 지정하면
  최대 4페이지·20개 프로젝트를 순차 처리한다. 20초가 지나면 추가 프로젝트를 시작하지
  않으며 전체 DB 대기는 30초로 제한한다. 실행당 프로젝트 중복 처리는 하지 않는다.
  D1에 순회 위치를 보관하고 실패한 프로젝트 뒤에서도 계속 진행한다. 정리 실패나
  커서 CAS 충돌은 실행 실패로 기록한다. [자동 정리](./retention-cleanup.md)를 따른다.
  원격 Cron Trigger 등록과 활성화는 아직 하지 않았다.

## 구현·배포 상태

- 구현·로컬 검증: `packages/core`(등록·배치·시간·해시), `packages/storage-d1`(D1 원자
  커밋·CAS·할당량·정리, grant 조건 조회, 발행 권한과 서버 배치 저장), `apps/collector`
  (네이티브 fetch 최소 browser 수집, HTTP 경계, 관리자 라우트, 서버 발행 endpoint),
  `packages/auth-oidc`(관리자·발행자 OIDC 검증), `packages/browser`(브라우저 SDK)와
  `examples/sembom` 예제, 초기 빈 DB용 SQL `0001_initial.sql`(로컬 Miniflare 전용).
- 관리자 조회: 검증기 포트 `createWorker(verifyBearer)`와 `admin.ts`의 관리자 라우트를
  로컬 구현·검증했다. 테스트는 모킹한 trusted 검증기와 D1 grant 경계를 쓴다. 경로는
  [관리자 조회 경계](./administrator.md)에 있다.
- 완료 관측 로그: 선택적 `observe`·`monotonicNow` 포트와 네이티브 Worker 배선을 로컬
  구현·검증했다. 성공 1/64 표본·실패 전량, 고정 필드 7개, 별도 DB·네트워크·의존성 없음.
  필드·한계는 [로그 경계](./06-logging-and-observability.md)에 있다.
- 서버 발행: `PublisherAccess` 검증기 포트와 `POST .../server-batches`를 로컬
  구현·검증했다. `createOidcWorker(adminOptions, publisherOptions?)`와
  `createPublisherOidcWorker(publisherOptions)`가 발행자 검증기를 붙인다. 경로·인증
  규칙은 [서버 발행 이벤트](./server-events.md)에 있다.
- 발행 권한 부여·회수 CLI는 로컬 구현했다. [등록·권한 관리 CLI](./provisioning.md)를 따른다.
- 로컬 부하 실험: `npm run bench:collector`(opt-in, 기본 test/check/CI에 연결하지 않음)가
  새 합성 D1·loopback HTTP로 workflow 쓰기·인증 조회·중복 경쟁·혼합 퍼널·할당량 격리를
  확인한다. [로컬 수집기 부하 안내](../../tools/runtime/COLLECTOR-BENCH.md)를 따른다.
- 누적 데이터 실험: `bench:retained`는 6개 프로젝트·네 테이블의 합성 67,860행에
  2분 동안 HTTP 수집/조회를 보내며 실제 scheduled 정리를 함께 실행한다.
  [누적 데이터 부하 안내](../../tools/runtime/RETAINED-BENCH.md)에 범위와 한계를 적었다.
- 아직 없음: 발행자 OIDC 운영 설정값과 실제 제공자 연결·운영 토큰 발급,
  원격 D1 마이그레이션, 운영 Wrangler 바인딩·시크릿, 원격 정리 Cron Trigger 등록.
  정리 스케줄러와 커서는 로컬 구현·검증했다.
- 측정: 브라우저 SDK가 gzip 3KiB 예산 안(실측값은 [VALIDATION.md](../../VALIDATION.md)).
  SDK 초기 실행·전송 비용은 합성 화면(2026-10-08), 수집 경로 쓰기·조회 지연은 로컬 합성
  D1 부하 실험(2026-10-11)에서 확인했다. 둘 다 실제 서비스는 미측정이며 조건은
  [성능 예산](../engineering/03-performance-budget.md)에 있다.
- 로컬 `bench:cluster`는 초기 148,260행의 새 공유 D1과 수집 Worker 3개에서 같은 배치의
  동시 전송·브라우저/서버 퍼널·인증 조회·정리를 120초 실행하고 정확한 중복/단계 집계를
  확인했다. 한 workerd 안의 별도 Worker이며 다중 프로세스/지역과 구분한다. 범위는
  [동시 부하 안내](../../tools/runtime/CLUSTER-BENCH.md), 실제 결과는 VALIDATION.md에 둔다.
- 미측정: 프로젝트 수·등록 속성 조합 규모별 비용, 장기간·다중 프로세스/지역 Worker·원격/더 큰
  데이터셋·네 테이블 밖 대량 데이터의 부하, 운영 지연·비용.
- 배포·활성화: 원격 D1·운영 Worker·도메인·인증 제공자는 설정하지 않았다.

## 공개 수집 앞단 제한 — 2026-10-23

호스트가 선택적 `BROWSER_INGEST_LIMITER` Rate Limiting 바인딩을 제공하면 브라우저
경로에서 프로젝트 조회·DB 쓰기·본문 읽기 전에 프로젝트별 키로 제한한다. 초과는
429와 Retry-After 60, 제한기 장애·취소·기한 초과는 503이며 재시도하지 않는다.
요청 수명과 실제 I/O 동시성 한도를 공유한다. 이 단계는 프로젝트 존재와 허용 출처를
읽기 전이므로 CORS 권한을 추가하지 않는다. 서버 경로는 기존 인증·발행 권한 순서를 유지한다.

키는 프로젝트 ID만 포함하며 IP·UA·사용자 식별자를 새로 만들지 않는다. 바인딩이 없으면
기존 DB admission을 사용한다. 운영 호스트는 Wrangler ratelimits 설정에서 바인딩명·
namespace·한도를 구성해야 한다. 실제 호스트 설정과 원격 활성화는 아직 하지 않았다.
Rate Limiting은 위치별 근사 제한이므로 DB의 원자적 한도 검사를 대체하지 않는다.
[공식 바인딩 문서](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

Origin 허용 목록은 인증이 아니다. 위조된 허용 Origin은 여전히 DB admission에 도달한다.
거부 Origin과 앞단 제한은 HTTP 관측 로그로 확인하며, DB의 거부 진단에는 admission 전
요청을 합산하지 않는다. 이미 저장한 과거 origin_denied 기록과 API 원인 enum은 유지한다.
