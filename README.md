# Tallyfin

Tallyfin은 Rodisoft의 여러 서비스에서 공통으로 사용하는 가벼운 제품 이벤트 분석 플랫폼이다. 프로젝트별 설정으로 회원가입·파일 변환·구매·계산 등 서로 다른 행동을 분석하며, 개인정보 수집을 최소화한다. Sembom은 첫 적용 사례다.

현재 저장소에는 설계 문서, v0.1 이벤트/API/논리 DB 계약, [샘플 관리자 UI](prototypes/admin/README.md)와 로컬로 구현한 코어·저장·수집기·브라우저 SDK 패키지가 있다. `packages/core`는 등록 정의·browser/server 배치 검증·시간 정규화·SHA-256 입력을, `packages/storage-d1`는 D1 영수증·시도·할당량·집계를 원자적으로 반영하는 어댑터를, `apps/collector`는 네이티브 fetch 최소 브라우저 수집기와 관리자 GET 조회를, `packages/browser`는 의존성 없는 브라우저 SDK(배치 전송·유계 재시도·숨김 전송)를 구현했고 `examples/sembom`에 연동 예제를 두었다. 저장소 루트 npm 검사(`npm run check`)로 확인하며, Sembom 예제는 실제 Sembom 저장소에 설치·활성화하지 않았다. 관리자 조회 API와 검증기 포트는 로컬에서 구현·검증했고, 서버 이벤트는 코어 검증·정규화·해시와 `ServerBatch`·`ServerEvent` 계약까지 구현했으며 HTTP 서버 발행 API·서버 인증·DB 저장 경로·서버 SDK·서버 출처 조회 화면은 아직 없다. 실제 운영 인증·원격 DB 적용도 아직 없다.

서버용 OIDC JWT 검증은 `packages/auth-oidc`에 구현했고 `createOidcWorker(options)`로 연결한다. 실제 로그인 제공자 설정과 브라우저 로그인은 후속이다. 정책은 [OIDC 어댑터](docs/backend/oidc.md)에 있다.

MVP는 프로젝트별로 등록한 이벤트의 건수·추이·허용 속성별 집계와 작업 흐름의 완료/오류를 다룬다. 서비스별 이벤트 연결은 각 서비스가 담당하고, 공통 SDK에는 특정 서비스 이벤트명을 내장하지 않는다. 브라우저 수집을 먼저 구현했고, 서버 발행은 계약에서 출처를 구분한 코어 검증 단계까지 왔다. HTTP 서버 발행 API·서버 인증·DB 저장 경로·서버 SDK·서버 출처 조회 화면은 후속이며, 브라우저 공개 ID나 허용 오리진을 서버 인증 수단으로 재사용하지 않는다.

초기 기술 방향은 TypeScript, 외부 런타임 의존성 없는 브라우저 SDK, 네이티브 fetch Cloudflare Worker와 별도 D1 저장 어댑터다. 코어/SDK는 비공개 ZDP 패키지나 Cloudflare에 의존하지 않는다. SDK와 한 서비스의 연동 코드·필수 설정 합계는 gzip 3KiB 이하를 목표로 하며 측정도 예산 안이다. SDK는 네이티브 `sendBeacon` 대신 keepalive fetch로 credentials/referrer를 생략한다. 수집 실패가 서비스 화면이나 업무 처리를 막지 않도록 설계한다.

구성: `packages/core`, `packages/browser`, `packages/storage-d1`, `apps/collector`, `apps/admin`(예정), `examples/sembom`. npm workspaces를 초기화했고 core·storage-d1·collector·browser를 생성했으며 `examples/sembom`에 연동 예제를 두었다.

문서: [제품 개요](docs/product/00-product-brief.md), [제품 명세](docs/product/02-spec.md), [화면 설계](docs/frontend/FRONTEND_DESIGN.md), [아키텍처](ARCHITECTURE.md), [ADR 0004](docs/adr/0004-general-product-analytics.md), [Sembom 연동 예시](docs/integrations/sembom.md), [성능 목표](docs/engineering/03-performance-budget.md), [로드맵](docs/product/01-roadmap.md), [전송·집계 계약](docs/backend/event-contract.md), [수집기 구현](docs/backend/collector.md), [브라우저 SDK](docs/backend/browser-sdk.md), [서버 발행 이벤트](docs/backend/server-events.md), [관리자 조회 경계](docs/backend/administrator.md), [검증](VALIDATION.md).

원문·영구 방문자 식별자·암묵적 DOM 수집, 인프라 텔레메트리·세션 리플레이·광고 어트리뷰션은 초기 범위 밖이다. [이벤트·집계 계약](docs/backend/event-contract.md)에 따라 OpenAPI와 DBML 예제를 v0.1 계약으로 교체했다. SQL 마이그레이션 `0001_initial.sql`은 초기 빈 DB용이며 로컬 Miniflare 테스트에서만 적용하고 원격 DB에는 적용하지 않는다. 운영 인증 제공자·IP 보호 정책·도메인·라이선스는 미정이다.
