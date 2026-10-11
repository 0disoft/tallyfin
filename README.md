# Tallyfin

Tallyfin은 Rodisoft의 여러 서비스가 공통으로 쓰는 가벼운 제품 이벤트 분석 플랫폼이다. 프로젝트별 설정으로 회원가입·파일 변환·구매·계산 같은 서로 다른 행동을 세고, 개인정보 수집은 최소화한다. Sembom이 첫 연동 예시다.

이 문서는 처음 내려받아 로컬에서 실행해 보려는 사람을 위한 안내다. 운영 인증 제공자·원격 DB·도메인·라이선스는 아직 정해지지 않았고, 실제 운영 배포와 서비스 파일럿은 진행하지 않았다.

## 지금 로컬에서 되는 것

- `packages/core`: 등록 정의, browser/server 배치 검증, 시간 정규화, SHA-256 입력.
- `packages/storage-d1`: D1 영수증·시도·할당량·집계와 서버 발행 권한을 원자적으로 반영하는 어댑터. 발행 권한 변경은 관리자 변경 이력 감사 기록과 같은 batch로 처리한다.
- `apps/collector`: 네이티브 fetch 최소 브라우저 수집기, 관리자 GET 조회, 서버 발행 endpoint, 발행자 권한 등록·회수 API, 발행자 인증 배선.
- `packages/browser`: 의존성 없는 브라우저 SDK. 배치 전송·유계 재시도·숨김 전송.
- `packages/server`: 의존성 없는 서버 발행 SDK. `createEvent`·재시도 배치 `send`.
- `packages/auth-oidc`: 관리자·발행자 OIDC JWT 검증기.
- `apps/admin`: 프로젝트 개요·이벤트 분석·설정·목표·퍼널 화면, browser/server 출처 선택 조회, 권한 조회·변경, 설정의 owner 전용 발행자 관리(`LivePublishers`), 관리자 변경 이력, 자기 계정 조회, 공개 클라이언트 OIDC PKCE 로그인 코드. 퍼널 단계 편집 폼과 퍼널 CSV도 로컬에서 연결했다.
- `db/migrations`: `0001_initial.sql`과 `0002`~`0009`. 0007은 다단계 퍼널(`funnel_runs`·`funnel_daily_counts`), 0008은 발행 권한 감사 action(`publisher.granted`·`publisher.revoked`)을 넣는 `admin_changes` 재생성, 0009는 발행 권한에 불변 부여 ID `grant_id`를 더하는 `project_publishers` 재생성이다. 지금까지 9개 마이그레이션·16개 테이블이다.

2~10단계 퍼널은 등록·검증·발행·정의 조회까지 로컬에서 구현했고, browser·server 수집 경로가 연결 이벤트를 영수증·할당량·집계와 같은 D1 batch에 저장한다. 연결 상태 72시간과 단계 집계 90일 정리도 로컬에서 확인했다. 서버 발행은 코어 검증부터 전용 `POST /v1/projects/{projectId}/server-batches` endpoint, 발행자 OIDC 검증 배선, 발행자 권한 등록·회수 API(`PUT`·`DELETE /v1/projects/{projectId}/publishers`), `publisher-grant`·`publisher-revoke` CLI, 서버 출처 조회 화면까지 로컬에서 구현·검증했다. 발행 권한 부여·회수는 API와 CLI 모두 관리자 변경 이력에 감사 행을 같은 D1 batch로 남기고, 다시 실행해 이미 원하는 상태면 새 이력을 만들지 않는다.

설정의 owner 전용 `LivePublishers`는 25건 목록·페이지 이동과 발행 권한 부여·회수를 제공한다. 쓰기는 명시적 확인 뒤에만 보내고, 회수는 목록에서 관측한 불변 부여 ID(`grantId`)를 CAS로 보내 같은 밀리초에 다시 부여된 권한을 지우지 않는다. 사람에게는 등록 시각 표를 그대로 보여주고 부여 ID는 화면에 쓰지 않는다. 충돌 복구·원래 요청 재시도·설정/grant 잠금·변경 이력 갱신을 적용했다. 실제 Chrome·임시 OIDC·로컬 D1 스모크(같은 밀리초 재부여 뒤 stale 회수 409)와 관리자 검사·타입 검사·빌드·번들 2/2·sites 9/9를 통과했다. 상세 결과는 [검증 기록](VALIDATION.md)에 둔다.

## 아직 확인하지 않은 것

- 실제 운영 인증 제공자, 원격 D1, 도메인·배포, 서비스 파일럿, 라이선스는 미정이거나 미실행이다.
- 발행자 OIDC 운영 설정값은 아직 없고, 실제 제공자 로그인은 검증하지 않았다.
- 로컬 부하·정리·복구 실험은 검증했고, 실제 원격 마이그레이션·정리 Cron·백업/복구와 운영 SLO는 미검증이다. 운영 SLO는 UNDECIDED다.
- 관리자 기본 설정의 API 401은 인증을 끈 실제 응답이다. 실제 로그인에는 별도 OIDC 설정이 필요하다.

## 로컬 실행

Node 24 이상이 필요하고 의존성은 저장소 루트 lockfile로 설치한다. 아래 명령은 저장소 루트에서 실행한다.

```sh
npm ci --ignore-scripts
npm run provision -- init --local --state-dir .tmp/collector-db --apply
npm run provision -- register --local --state-dir .tmp/collector-db --file api/examples/registry.json --apply
npm run dev -- --local --state-dir .tmp/collector-db
```

관리자는 `http://127.0.0.1:5180`, 수집기는 `http://127.0.0.1:5188`에서 실행된다. 두 포트는 서로 달라야 하고 사용 중이면 오류로 끝낸다. 포트·설정·종료 절차는 [통합 실행 안내](docs/backend/runtime.md#통합-개발-실행)를 따른다.

기본 설정은 관리자·발행자 인증이 꺼져 있어 관리자 API와 `POST /v1/projects/{projectId}/server-batches`가 둘 다 401을 돌려준다. 그래서 관리자의 `/`(`http://127.0.0.1:5180/`)는 관리자 로그인이 설정되지 않았다는 안내를 보여주고, 그 화면의 `샘플 데모 둘러보기` 링크를 누르면 `/demo` 샘플 화면으로 간다. 데모 상단 안내의 `관리자 로그인으로 돌아가기` 링크는 다시 `/`로 돌아오고, 샘플 숫자와 편집은 운영 데이터와 분리돼 있어 실제 API·DB를 바꾸지 않는다. `/demo`에 바로 접속해도 된다. 실제 로그인과 실제 데이터 조회에는 별도 OIDC 설정이 필요하고, 등록·권한 부여·마이그레이션은 자동으로 일어나지 않는다.

저장소 검사는 루트 `npm run check`로 실행한다(타입 검사·테스트·브라우저 SDK 크기 예산).

서버 SDK의 실패 후 재전송·중복 제거·발행자 회수는 `npm run verify:server-recovery`로 로컬에서 확인할 수 있다. 실제 `fetch`로 보낸 같은 본문이 재시도되고 수집기가 중복을 정리하는지, 발행자 회수 뒤 `403`이 나는지까지 Miniflare 루프백에서 종료 코드 0과 `verified: true`로 통과했다. 최종 검사는 이벤트별 `SUM(count)` 2와 `funnel_runs` 2건·두 run의 4단계 `step_times_json`까지 D1 SQL로 직접 확인한다. 원격 D1·실제 발행자 로그인은 범위 밖이다. 안내는 [서버 SDK 복구 확인](tools/runtime/SERVER-RECOVERY.md)에 있다.

## 운영 설치와 검사

운영 설정 준비와 검사는 [설치 설정 준비](docs/backend/installation.md)에 정리했다(`install:setup`, `install:prepare`, `admin:build-configured`, `install:check`, `install:database-check`, `install:access-check`). `install:setup`은 대화형 터미널에서 공개 설정값만 묻고 `install:prepare`와 같은 다섯 파일을 새 디렉터리에 쓴다. 이 명령들은 설정 파일 생성, 관리자 빌드, 공개 제공자·원격 DB 메타데이터·관리자 읽기 접근 검사를 제공한다. 세 검사는 서로 다른 대상을 보며 어느 것도 운영 준비 완료를 뜻하지 않는다. 원격 쓰기·로그인·배포는 자동 실행하지 않는다. 검사 상세는 [설치 검사 안내](tools/runtime/INSTALL-CHECK.md)와 [접근 확인 안내](tools/runtime/INSTALL-ACCESS-CHECK.md)에 있다. 실제 리소스 값과 인증 설정은 운영자가 정한 뒤 별도로 실행한다.

실제 첫 설치·업그레이드·배포·롤백 절차는 [릴리스 런북](docs/ops/release.md)과 [롤백 런북](docs/ops/rollback.md)에 정리했다. 원격 배포·마이그레이션·백업/복원은 승인 후 수동으로 실행하고 실제 환경에서는 아직 실행하지 않았다.

운영 로그 요약은 표준 입력에 앱 NDJSON을 넣어 실행한다(`node tools/runtime/summarize-observations.ts --stdin`, Windows에서는 `npm.cmd run --silent logs:summary -- --stdin`). `http_request` 고정 7필드와 scheduled 정리 로그를 집계하고 `diagnostics`에서 관측된 오류·거부·정리 실패와 확인할 항목을 구분한다. `requestId`·프로젝트 ID·원문은 보고서에 넣지 않는다. 사용법과 한계는 [로그 요약 안내](tools/runtime/LOG-SUMMARY.md)에 있다.

확보한 Wrangler tail JSON에는 같은 CLI의 `--stdin --wrangler-tail`을 쓴다. 여러 줄 객체에서
앱 console 기록을 추려 같은 보고서를 만들고 URL·헤더·예외는 버린다. 입력은 30초 내 끝나는
유한한 로그여야 하며 원격 로그 세션은 자동으로 열지 않는다.

관리자 전용 `GET /v1/health`는 검증된 관리자 bearer로 두 제어 테이블의 읽기 상태를 확인한다.
성공 응답은 `{status:"ok",scope:"administrator_storage_read"}`이며, 수집 쓰기나 정리 실행까지
확인한 결과는 아니다. 조회는 읽기 전용이고 원문 행·계정·프로젝트 정보를 반환하지 않는다.
범위와 오류는 [운영 관측](docs/ops/observability.md)에 적었다. 반복 실행과 운영 인증 설정은
아직 연결하지 않았다.
`install:access-check`도 계정 확인 → 이 읽기 프로브 → 프로젝트 조회 순서로 검사하며,
앞 단계가 실패하면 뒤 단계는 요청하지 않는다.

관리자 설정의 `저장소 읽기 확인`에서도 버튼으로 같은 읽기 검사를 실행하고 확인 시각을 볼 수
있다. 요청은 5초 뒤 취소하며, 닫기·연결 교체에서는 이전 결과를 지운다. 자동 폴링 없이
로컬 Chrome·D1로 검증했고, 실제 운영 인증·원격 상태 확인은 아직 없다.

브라우저 로그인 흐름은 `npm run verify:admin-login -- --channel chrome`으로 따로 검증할 수
있다. 격리된 제공자 응답과 로컬 D1을 사용해 PKCE 리다이렉트·콜백·API 조회·토큰 갱신과
재로그인을 확인한다. Playwright 준비와 출력 범위는 [로그인 검증 안내](tools/browser-bench/ADMIN-LOGIN.md)에 있다.

브라우저 온보딩 흐름은 `npm run build:browser` 뒤
`npm run verify:admin-onboarding -- --channel chromium`으로 따로 검증할 수 있다. 빈 프로젝트
목록에서 실제 로그인·UI 프로젝트 생성·첫 스키마(v1) 발행·생성한 브라우저 SDK 코드의 실제
전송·D1 집계 1건·관리자 이벤트 표 1건과 온보딩 3단계 전환을 격리된 로컬 D1에서 확인한다.
원격 서비스는 쓰지 않는다. Playwright 준비와 출력 범위는 [온보딩 검증 안내](tools/browser-bench/ADMIN-ONBOARDING.md)에 있다.
`--lost-responses`를 붙이면 생성·발행을 저장한 뒤 응답을 끊고, 화면의 명시적 확인으로
초안과 첫 이벤트 조회까지 복구되는지도 확인한다.
권한 거부·복구와 저장 중 프로젝트 전환/연결 해제는
`npm run verify:admin-access -- --channel chromium`으로 별도 확인한다.
[권한 검증 안내](tools/browser-bench/ADMIN-ACCESS.md)를 따른다.

관리자 설정에는 `logs:summary` JSON 파일을 읽는 `운영 로그 보고서`도 있다. 브라우저
Worker에서 8MiB 이하 보고서를 검증하고 오류·응답·정리 기록을 표로 표시한다. 파일 전송이나
저장 없이 사용하며 보고서의 범위는 프로젝트·기간 필터와 구분한다. [사용 안내](docs/ops/local-report-viewer.md)를 따른다.

## 문서

- 제품: [개요](docs/product/00-product-brief.md), [명세](docs/product/02-spec.md), [로드맵](docs/product/01-roadmap.md)
- 설계: [아키텍처](ARCHITECTURE.md), [화면 설계](docs/frontend/FRONTEND_DESIGN.md), [ADR 0004](docs/adr/0004-general-product-analytics.md), [ADR 0007](docs/adr/0007-admin-application.md)
- 계약·구현: [이벤트·집계](docs/backend/event-contract.md), [수집기](docs/backend/collector.md), [브라우저 SDK](docs/backend/browser-sdk.md), [서버 SDK](docs/backend/server-sdk.md), [서버 발행](docs/backend/server-events.md), [관리자 조회 경계](docs/backend/administrator.md), [OIDC](docs/backend/oidc.md)
- 연동·검증: [Sembom 예시](docs/integrations/sembom.md), [성능 목표](docs/engineering/03-performance-budget.md), [검증 기록](VALIDATION.md)
- 운영: [릴리스 런북](docs/ops/release.md), [롤백 런북](docs/ops/rollback.md), [장애 대응](docs/ops/incident-response.md), [운영 계약](docs/ops/00-operational-contract.md), [시크릿](docs/ops/secrets.md), [백업·복구](docs/ops/backup-and-restore.md), [운영 관측](docs/ops/observability.md)
- 앱: [관리자 앱](apps/admin/README.md), [통합 실행·배포](docs/backend/runtime.md)

## 범위 밖

원문·영구 방문자 식별자·암묵적 DOM 수집, 인프라 텔레메트리·세션 리플레이·광고 어트리뷰션은 초기 범위 밖이다. SQL 마이그레이션은 로컬 Miniflare 테스트에서만 적용했고 원격 DB에는 적용하지 않았다. `0006_server_collection.sql`은 영수증·이벤트 집계 테이블을 복사·재생성하므로 운영 적용 전 수집 중지·백업·행 수 검증이 필요하다. `0008_publisher_history.sql`도 `admin_changes`를 복사·재생성하므로 관리자 API·CLI 쓰기를 멈춘 상태에서 한 batch로 적용하고, 적용 전후 행 수·스키마·외래 키를 확인해야 한다. `0009_publisher_generations.sql`은 `project_publishers`를 복사·재생성하므로 발행자 CLI·HTTP 쓰기를 멈추고 백업한 뒤 한 batch로 적용하고 적용 전후 발행 행 수와 행별 부여 ID를 확인해야 한다.

SDK와 한 서비스의 연동 코드·필수 설정 합계는 대표 예제 기준 gzip 3KiB 이하를 목표로 한다. 이 예산은 호스트 앱 전체나 모든 프로젝트 설정의 합계가 아니고, 로컬 측정값이며 운영 수치가 아니다.
