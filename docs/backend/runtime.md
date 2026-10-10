# 수집기 실행·배포 준비

## 전제

- Node 24 기반 네이티브 Worker + D1 구성이다.
- compatibility date는 기존 검증 베이스라인인 2026-08-06을 유지한다.
- wrangler는 로컬 의존성 `^4`, 설치 버전 4.148.0이다.
- 실제 provider/account/D1/도메인 값은 제공되지 않았다. 이번 작업에서 원격 명령은 수행하지 않았다.

## 로컬 실행

루트에서 실행한다.

```
npm run provision -- init --local --state-dir .tmp/collector-db --apply
npm run provision -- register --local --state-dir .tmp/collector-db --file api/examples/registry.json --apply
npm run collector:dev -- --local --state-dir .tmp/collector-db
```

- 선택 플래그는 `--port`(기본 5188)와 `--settings .tmp/collector-settings.json`이다.
- 로컬 수집기와 등록 CLI는 같은 상태 디렉터리와 DB 식별자를 사용한다.
- 127.0.0.1에만 바인딩한다.
- 구동을 완료하기 전에 초기화된 DB와 실행 설정을 확인한다. 개발 서버는 마이그레이션을 적용하지 않는다.
- 기본 관리자·발행자 인증은 꺼져 있어 관리자 API와 `POST /v1/projects/{projectId}/server-batches`가 둘 다 401을 반환한다.
- Ctrl+C로 정지하면 예약 타이머·서버·런타임을 정리한다. 코드·설정을 바꾸면 다시 시작한다. 자동 새로고침은 지원하지 않는다.
- 로컬 정리는 60초마다 실제 scheduled handler를 호출한다. 같은 프로세스에서 정리가 겹치지 않고, close는 진행 중 정리를 기다린다.

## 통합 개발 실행

루트의 `npm run dev`는 수집기와 `apps/admin` 관리자 앱을 함께 실행한다.
Node 24 이상이 필요하며 루트 lockfile로 워크스페이스 의존성을 설치한다. DB 초기화와
프로젝트 등록은 [등록 CLI](./provisioning.md)로 먼저 마친다. 개발 실행은
마이그레이션·등록·권한 부여를 자동으로 수행하지 않는다.

```powershell
npm ci --ignore-scripts
npm run provision -- init --local --state-dir .tmp/collector-db --apply
npm run provision -- register --local --state-dir .tmp/collector-db --file api/examples/registry.json --apply
npm run dev -- --local --state-dir .tmp/collector-db

# 기본 포트가 사용 중일 때
npm run dev -- --local --state-dir .tmp/collector-db --admin-port 5190 --collector-port 5198
```

기본 주소는 관리자 `http://127.0.0.1:5180`, 수집기 `http://127.0.0.1:5188`이다.
`--settings`는 위 수집기 실행과 같은 평면 JSON 설정을 받는다. 두 포트는 서로
달라야 한다. 사용 중인 포트는 오류로 처리하며 다른 프로세스를 종료하지 않는다.
양쪽 서버가 준비된 뒤에만 통합 ready 메시지를 출력한다.

Ctrl+C·SIGTERM·부모 IPC 연결 종료·시작 실패·자식의 예기치 않은 종료 시,
실행기가 만든 두 자식을 정리한다. 먼저 종료 IPC를 보내고 10초가 지나면
남아 있는 자식을 강제로 종료한다. Windows에서는 해당 자식 트리만 종료한다.
프론트엔드는 HMR을 지원하고 수집기 코드나 설정 변경은 전체 재시작이 필요하다.

관리자 서버의 `/v1`과 그 하위 경로만 수집기로 전달한다. 경로·쿼리·헤더를
유지하고 `changeOrigin`은 false다. `/auth/callback`과 `/v10`은 프록시 대상이
아니며 관리자 SPA가 처리한다. 설정은 `apps/admin/vite.config.mjs`와
`apps/admin/scripts/local-proxy.mjs`에 있다.

관리자 프로토타입을 따로 실행해도 기본 프록시 대상은 `http://127.0.0.1:5188`이다.
서버 환경 변수 `TALLYFIN_COLLECTOR_ORIGIN`으로 다른 포트를 지정할 수 있다.
명시적인 HTTP `127.0.0.1` 오리진만 허용하며 원격 주소·자격 증명·경로·쿼리·
프래그먼트는 거부한다. 브라우저에 노출하는 `VITE_` 변수로 만들지 않는다.

기본 설정에서 관리자 API가 반환하는 401은 실제 수집기의 인증 응답이다.
로그인하려면 실제 인증 제공자 설정과 로컬 관리자 권한이 필요하다.
클라이언트 `VITE_OIDC_` 설정은 `apps/admin/.env`에 따로 두고, 콜백 주소는
선택한 관리자 오리진의 `/auth/callback`을 등록한다.
[OIDC 연결 안내](./oidc.md#브라우저-관리자-로그인)를 따른다.
실제 제공자 로그인과 원격 실행은 아직 검증하지 않았다.

## 설정 파일

- JSON은 중첩 없는 설정 객체다. 알려진 키만 허용하고 빠진 값에는 기본값을 적용한다.
- `ADMIN_AUTH_MODE`는 `disabled` 또는 `oidc`를 명시한다. `ALLOW_LOCAL_HTTP`는 `"true"`/`"false"` 문자열이고 기본 false다.
- OIDC: `OIDC_ISSUER`/`OIDC_AUDIENCE`/`OIDC_JWKS_URI`는 `oidc`일 때 필수다. issuer는 정확한 HTTPS여야 한다.
- `OIDC_ALGORITHMS`는 콤마 구분, 기본 `RS256`, 허용 `RS256,ES256`, 중복은 안 된다.
- `OIDC_TOKEN_TYPE`은 `at+jwt` 또는 `JWT`다.
- `OIDC_CLOCK_TOLERANCE_SECONDS`는 문자열 정수 0..60, 기본 5다.
- disabled인데 issuer/audience/jwks가 비어 있지 않으면 실패한다. 관리자·발행자 양쪽에 같은 규칙을 적용한다.
- 발행자는 `PUBLISHER_AUTH_MODE`(`disabled` 기본 또는 `oidc`)와 `PUBLISHER_OIDC_ISSUER`/`PUBLISHER_OIDC_AUDIENCE`/`PUBLISHER_OIDC_JWKS_URI`, `PUBLISHER_OIDC_ALGORITHMS`/`PUBLISHER_OIDC_TOKEN_TYPE`/`PUBLISHER_OIDC_CLOCK_TOLERANCE_SECONDS`로 관리자와 같은 검증 규칙을 쓴다.
- 발행자 키가 없는 기존 배포는 기본값 `disabled`로 보고, 마이그레이션 없이도 server 경로가 닫힌 상태를 유지한다.
- 관리자와 발행자를 둘 다 `oidc`로 두면 audience가 서로 달라야 하고 같으면 정적 오류다. 발행자 검증기는 관리자 검증기를 재사용하지 않는다. 관리자를 `disabled`로 두고 발행자만 `oidc`로 켜면 발행자 전용 워커가 되고 관리자 경로는 401로 남는다.
- 발행자 인증은 관리자와 같은 OIDC 어댑터를 쓴다. 실제 제공자와 issuer·audience·jwks 값은 **UNDECIDED**다. endpoint·발행자 검증기·런타임 설정 키는 로컬 구현했고 좁은 범위 검증을 통과했으며, 전체 검사 기록은 [검증 기록](../../VALIDATION.md)에 둔다.
- 알 수 없는 mode, 잘못된 플래그, 불완전한 구성은 정적 오류로 거부한다. 원문 settings와 토큰은 노출하지 않는다.
- `configureCollector`는 키를 조회하지 않고 검증한다. 배포된 워커는 첫 fetch/scheduled에서 env를 검증하고, 같은 구성이면 verifier 캐시를 재사용한다.
- DB 바인딩은 필수다.
- auth의 `allowLocalHTTP`는 등록된 브라우저 origin에만 적용한다. OIDC 엔드포인트는 여전히 HTTPS다.
- 예시 registry를 그대로 쓴다고 localHTTP가 허용되지는 않는다. origin을 명시적으로 바꾸고 필요하면 `provision --allow-local-http`를 붙인다.
- 실제 자격 증명이나 리소스 ID를 지어내지 않는다.

## 배포 준비

관리자와 수집기·로그인 설정을 함께 준비할 때는 [운영 설치 설정](./installation.md)의
`install:prepare`를 사용한다. 아래 명령은 각 Worker의 개별 설정 준비를 위한 대안이다.

```
npm run collector:config -- --file .tmp/collector-target.json --out .tmp/collector-deploy/wrangler.json
```

- 입력 필드는 `workerName`, `accountId`, `databaseName`, `databaseId`, `workersDev`(boolean 명시), `settings`(object)다.
- 실제 ID는 운영자가 제공한다. 문법 검증은 소유/존재를 증명하지 않는다.
- settings의 `ADMIN_AUTH_MODE`는 반드시 `oidc`, `ALLOW_LOCAL_HTTP`는 false다. 발행자 인증을 켤 때는 `PUBLISHER_AUTH_MODE`를 `oidc`로 두고 발행자 OIDC 값을 함께 넣으며, 두 audience가 달라야 한다. 발행자 키를 넣지 않으면 server 경로는 닫힌 채로 배포된다.
- 시크릿/토큰은 받지 않고 알려진 키만 허용한다. 입력은 8KiB 이하이고, 출력은 새 경로만 허용하며 기존 파일 덮어쓰기를 거부한다.
- 결과 설정은 실제 account+DB ID를 고정하고 entry/migration 경로를 절대 경로로 쓴다. 타깃마다 별도 파일이라 환경 상속으로 인한 바인딩 혼동이 없다.
- `workers_dev`는 명시한 `workersDev`를 따르고, `previewURLs`는 false, crons는 `["* * * * *"]`다.
- 루트 `wrangler.jsonc`는 실제 ID가 없고 타입/패키지 확인용이다. 직접 배포하지 않는다. 자동 프로비저닝이 일어날 수 있다.
- `npm run collector:dry-run`은 기본 번들을 검사하고 업로드하지 않는다.
- 준비된 파일은 `npm run collector:dry-run -- --config .tmp/collector-deploy/wrangler.json`으로 검사한다. 운영자가 실제 config를 넣어야 하고 이번 세션에서는 실행하지 않았다.
- 실제 배포·원격 마이그레이션·프로젝트 등록·권한 부여·인증 제공자 연결·도메인 연결·운영 검증은 승인한 후속 작업에서 진행한다. 등록 CLI는 로컬만 지원한다.

## 관리자 Worker 배포 준비

관리자 자산과 API를 같은 출처에서 제공하는 기준은 `apps/admin/wrangler.jsonc`다.
`/v1`·`/v1/*`는 고정 `COLLECTOR` 서비스 바인딩으로 별도 수집기 Worker에 전달한다.
인증·grant·본문 한도·수집 Origin 검사는 기존 수집기 정책을 따르고, 정적 API 경로가
있어도 API가 우선한다. API 응답을 HTML로 바꾸지 않으며 본문·헤더·쿼리를 유지한다.
호출은 한 번만 하고 리다이렉트·자동 재시도·API 캐시를 사용하지 않는다.

다음 명령은 로컬 파일 생성과 업로드 없는 검사다.

```powershell
npm run build:admin
npm run admin:config -- --file .tmp/admin-target.json --out .tmp/admin-deploy/wrangler.json
npm run admin:dry-run -- --config .tmp/admin-deploy/wrangler.json
npm run admin:types
```

입력은 `workerName`, `accountId`, `collectorWorkerName`, `workersDev`(boolean 명시),
선택 `domain`이다. 앞 세 값은 실제 운영자가 제공하고 Worker 이름 둘은 달라야 한다.
`workersDev=false`면 `domain`이 필수다. domain은 URL·경로·와일드카드 없는 소문자
호스트 이름으로 받아 custom domain route를 만든다. 환경별 실제 수집기 배포 이름을
`collectorWorkerName`에 넣으며 별도 environment 상속은 사용하지 않는다.
8KiB 이하의 닫힌 JSON만 받고 시크릿·토큰·OIDC 값을 받지 않으며 기존 출력은 덮어쓰지 않는다.
ID·도메인 문법 검사는 소유권·실제 리소스 존재를 증명하지 않는다.

기본 admin config는 타입·패키지 확인용이므로 실제 배포에 그대로 사용하지 않는다.
생성 파일에는 계정·수집기 이름과 자산/entry 절대 경로가 들어간다. 실제 Wrangler
배포 때 custom domain 연결이 일어날 수 있으므로 파일을 먼저 검토한다. 수집기와
관리자는 같은 Cloudflare 계정에 배포하고 수집기를 먼저 준비한다. 관리자 Worker에는
DB·관리자 JWT 키·발행자 자격 증명을 넣지 않는다.

바인딩 누락·호출 예외는 `admin_api_unavailable` 503 JSON과 `Retry-After: 5`다.
HEAD 오류 응답은 본문이 없다. 관리자 화면은 저장소 오류와 구별해 연결 실패를 안내한다.
로그에는 고정 코드만 쓰고 예외·토큰·요청 URL은 쓰지 않는다. callback code/state를
보호하려고 invocation 로그·자동 trace를 끄고 query redaction을 유지한다.
API/DB 계약은 유지하며 이 오류는 관리자 전송 경계에서만 발생한다.

`/auth/callback`·`/demo`는 관리자 앱 경로다. OIDC client 설정은 빌드 때
`apps/admin/.env`의 `VITE_OIDC_`에서 별도로 읽고 토큰을 번들에 넣지 않는다.
callback은 최종 관리자 HTTPS 출처의 `/auth/callback`이어야 한다.
실제 제공자·로그인·원격 서비스 바인딩·DNS·D1·배포는 아직 검증하지 않았다.
Sites 패키징은 유지하지만 기본 hosting에는 collector 바인딩이 없으므로 운영 연결은
위 Wrangler 구성을 사용한다. 되돌릴 때는 관리자 Worker 코드와 바인딩 설정을 함께
복원한다. 수집기 코드·DB·기록은 변경하지 않는다.

## 타입과 검증

- `npm run collector:types`의 생성물은 `.tmp`에 둔다. 기준 문서는 `wrangler.jsonc`와 운영자가 준비한 대상별 설정이다.
- `npm run typecheck`는 바인딩을 생성한 뒤 공통 코드와 플랫폼 연결 코드를 각각 검사한다.
- `npm run admin:types`는 관리자 바인딩을 생성하고 `tsconfig.worker.json`의 checkJs로
  Worker를 검사한다. 루트 typecheck에 포함한다.
- `node --test --test-timeout=30000 apps/admin/test/edge.test.ts tools/runtime/test/admin-target.test.ts`는
  임시 키·정적 fixture와 실제 로컬 수집기·D1으로 검증한다. 원격 리소스는 쓰지 않는다.

## 로깅·관측

- 앱 로그에는 구조화된 오류 코드·실행 ID·정리 건수만 남긴다.
- `observability.logs`는 enabled, `invocation_logs`는 false, `redact_query_string`는 true, traces는 disabled다. 자동 traces와 호출 로그에 요청 URL이 들어가 제품 프라이버시 계약과 충돌할 수 있기 때문이다. 플랫폼 측 access 로그는 앱이 통제하지 못한다.
- Wrangler의 `send_metrics`는 false다.
- 이번 작업에서 스키마/OpenAPI 변경은 없다.

## 롤백

- 로컬 중단은 프로세스를 멈춘다. 원격 코드 롤백이나 정리 예약 변경은 승인한 후속 작업에서 진행한다.
- 이전 config 리비전은 이미 삭제된 데이터를 되돌리지 않는다.
- 실험 전에 정지된 로컬 디렉터리를 백업한다.

## 참고

- [provisioning.md](./provisioning.md), [oidc.md](./oidc.md), [retention-cleanup.md](./retention-cleanup.md), [VALIDATION.md](../../VALIDATION.md)
- [Cloudflare Wrangler 구성](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Workers 로그](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
