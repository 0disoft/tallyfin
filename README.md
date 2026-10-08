# Tallyfin

Tallyfin은 Rodisoft의 여러 서비스에서 공통으로 사용하는 가벼운 제품 이벤트 분석 플랫폼이다. 프로젝트별 설정으로 회원가입·파일 변환·구매·계산 등 서로 다른 행동을 분석하며, 개인정보 수집을 최소화한다. Sembom은 첫 적용 사례다.

현재 저장소에는 설계 문서와 [실행 가능한 샘플 관리자 UI](prototypes/admin/README.md)가 있다. 개요·이벤트 분석·목표·설정 화면을 가상 데이터로 검토할 수 있다. 아래 운영 구성은 계획이며 실제 수집기·SDK·API·DB와 벤치마크는 아직 없다.

MVP는 프로젝트별로 등록한 이벤트의 건수·추이·허용 속성별 집계와 작업 흐름의 완료/오류를 다룬다. 서비스별 이벤트 연결은 각 서비스가 담당하고, 공통 SDK에는 특정 서비스 이벤트명을 내장하지 않는다. 브라우저부터 구현하며 서버 연동은 계약에서 발행 출처를 구분한 뒤 후속으로 구현한다.

초기 기술 방향은 TypeScript, 외부 런타임 의존성 없는 브라우저 SDK, 네이티브 fetch Cloudflare Worker와 별도 D1 저장 어댑터다. 코어/SDK는 비공개 ZDP 패키지나 Cloudflare에 의존하지 않는다. SDK와 한 서비스의 연동 코드·필수 설정 합계는 gzip 3KiB 이하를 목표로 하며 아직 측정하지 않았다. 수집 실패가 서비스 화면이나 업무 처리를 막지 않도록 설계한다.

계획된 구성: `packages/core`, `packages/browser`, `packages/storage-d1`, `apps/collector`, `apps/admin`, `examples/sembom`. 이 디렉터리와 실행 워크스페이스는 아직 생성하지 않았다.

문서: [제품 개요](docs/product/00-product-brief.md), [제품 명세](docs/product/02-spec.md), [화면 설계](docs/frontend/FRONTEND_DESIGN.md), [아키텍처](ARCHITECTURE.md), [ADR 0004](docs/adr/0004-general-product-analytics.md), [Sembom 연동 예시](docs/integrations/sembom.md), [성능 목표](docs/engineering/03-performance-budget.md), [로드맵](docs/product/01-roadmap.md).

원문·영구 방문자 식별자·암묵적 DOM 수집, 인프라 텔레메트리·세션 리플레이·광고 어트리뷰션은 초기 범위 밖이다. 인증 방식·보관 기간·도메인·라이선스는 미정이다. `api/openapi.yaml`과 `db/schema.dbml`은 아직 일반 스캐폴드 예제이며 실제 계약으로 교체한 뒤 구현한다.
