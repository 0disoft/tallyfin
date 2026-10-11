# 문서 색인

현재 작성된 설계 문서와 미작성 템플릿을 구분한다.

## 작성된 계획 문서
- [제품 개요](./product/00-product-brief.md)
- [제품 명세](./product/02-spec.md)
- [로드맵](./product/01-roadmap.md)
- [아키텍처](../ARCHITECTURE.md)
- [초기 아키텍처 방향](./adr/0001-initial-architecture-boundaries.md)
- [성능 예산](./engineering/03-performance-budget.md)
- [ADR 0002 계약 기준 문서](./adr/0002-contract-source-of-truth.md)
- [ADR 0003 최소·프라이버시 이벤트](./adr/0003-minimal-privacy-preserving-events.md)
- [ADR 0004 범용 제품 분석](./adr/0004-general-product-analytics.md)
- [ADR 0005 이벤트·집계 계약](./adr/0005-event-and-aggregation-contract.md)
- [전송·집계 계약](./backend/event-contract.md)
- [수집기 구현](./backend/collector.md)
- [브라우저 SDK](./backend/browser-sdk.md)
- [관리자 조회 경계](./backend/administrator.md)
- [로컬 운영 로그 보고서 화면](./ops/local-report-viewer.md)
- [OpenAPI](../api/openapi.yaml), [DBML](../db/schema.dbml)
- [Sembom 연동 예시](./integrations/sembom.md)
- [워크스페이스 경계](./monorepo/workspace-boundaries.md)
- [패키지 소유권](./monorepo/package-ownership.md)
- [위험 등록부](./product/03-risk-register.md)
- [프론트엔드 설계](./frontend/FRONTEND_DESIGN.md)
- [선택한 화면 디자인](./frontend/SELECTED_VISUAL.md)
- [개발 가이드](../DEVELOPMENT.md)
- [기여 안내](../CONTRIBUTING.md)
- [검증](../VALIDATION.md)

## 채워지지 않은 템플릿
운영 ops/auth 문서 중 아직 채우지 않은 항목은 템플릿이다. OpenAPI·DBML은 v0.1 Tallyfin 계약으로 교체했고 코어·저장·수집기·브라우저 SDK와 관리자 조회 API 런타임도 로컬에서 구현·검증했으나, 운영 배포와 실제 인증 제공자 설정을 뜻하지 않는다.
