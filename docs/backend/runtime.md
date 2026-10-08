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
- 기본 관리자 인증은 꺼져 있고 관리자 API는 401을 반환한다.
- Ctrl+C로 정지하면 예약 타이머·서버·런타임을 정리한다. 코드·설정을 바꾸면 다시 시작한다. 자동 새로고침은 지원하지 않는다.
- 로컬 정리는 60초마다 실제 scheduled handler를 호출한다. 같은 프로세스에서 정리가 겹치지 않고, close는 진행 중 정리를 기다린다.

## 설정 파일

- JSON은 중첩 없는 설정 객체다. 알려진 키만 허용하고 빠진 값에는 기본값을 적용한다.
- `ADMIN_AUTH_MODE`는 `disabled` 또는 `oidc`를 명시한다. `ALLOW_LOCAL_HTTP`는 `"true"`/`"false"` 문자열이고 기본 false다.
- OIDC: `OIDC_ISSUER`/`OIDC_AUDIENCE`/`OIDC_JWKS_URI`는 `oidc`일 때 필수다. issuer는 정확한 HTTPS여야 한다.
- `OIDC_ALGORITHMS`는 콤마 구분, 기본 `RS256`, 허용 `RS256,ES256`, 중복은 안 된다.
- `OIDC_TOKEN_TYPE`은 `at+jwt` 또는 `JWT`다.
- `OIDC_CLOCK_TOLERANCE_SECONDS`는 문자열 정수 0..60, 기본 5다.
- disabled인데 issuer/audience/jwks가 비어 있지 않으면 실패한다.
- 알 수 없는 mode, 잘못된 플래그, 불완전한 구성은 정적 오류로 거부한다. 원문 settings와 토큰은 노출하지 않는다.
- `configureCollector`는 키를 조회하지 않고 검증한다. 배포된 워커는 첫 fetch/scheduled에서 env를 검증하고, 같은 구성이면 verifier 캐시를 재사용한다.
- DB 바인딩은 필수다.
- auth의 `allowLocalHTTP`는 등록된 브라우저 origin에만 적용한다. OIDC 엔드포인트는 여전히 HTTPS다.
- 예시 registry를 그대로 쓴다고 localHTTP가 허용되지는 않는다. origin을 명시적으로 바꾸고 필요하면 `provision --allow-local-http`를 붙인다.
- 실제 자격 증명이나 리소스 ID를 지어내지 않는다.

## 배포 준비

```
npm run collector:config -- --file .tmp/collector-target.json --out .tmp/collector-deploy/wrangler.json
```

- 입력 필드는 `workerName`, `accountId`, `databaseName`, `databaseId`, `workersDev`(boolean 명시), `settings`(object)다.
- 실제 ID는 운영자가 제공한다. 문법 검증은 소유/존재를 증명하지 않는다.
- settings의 `ADMIN_AUTH_MODE`는 반드시 `oidc`, `ALLOW_LOCAL_HTTP`는 false다.
- 시크릿/토큰은 받지 않고 알려진 키만 허용한다. 입력은 8KiB 이하이고, 출력은 새 경로만 허용하며 기존 파일 덮어쓰기를 거부한다.
- 결과 설정은 실제 account+DB ID를 고정하고 entry/migration 경로를 절대 경로로 쓴다. 타깃마다 별도 파일이라 환경 상속으로 인한 바인딩 혼동이 없다.
- `workers_dev`는 명시한 `workersDev`를 따르고, `previewURLs`는 false, crons는 `["* * * * *"]`다.
- 루트 `wrangler.jsonc`는 실제 ID가 없고 타입/패키지 확인용이다. 직접 배포하지 않는다. 자동 프로비저닝이 일어날 수 있다.
- `npm run collector:dry-run`은 기본 번들을 검사하고 업로드하지 않는다.
- 준비된 파일은 `npm run collector:dry-run -- --config .tmp/collector-deploy/wrangler.json`으로 검사한다. 운영자가 실제 config를 넣어야 하고 이번 세션에서는 실행하지 않았다.
- 실제 배포·원격 마이그레이션·프로젝트 등록·권한 부여·인증 제공자 연결·도메인 연결·운영 검증은 승인한 후속 작업에서 진행한다. 등록 CLI는 로컬만 지원한다.

## 타입과 검증

- `npm run collector:types`의 생성물은 `.tmp`에 둔다. 기준 문서는 `wrangler.jsonc`와 운영자가 준비한 대상별 설정이다.
- `npm run typecheck`는 바인딩을 생성한 뒤 공통 코드와 플랫폼 연결 코드를 각각 검사한다.

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
