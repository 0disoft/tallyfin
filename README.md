# Tallyfin

Tallyfin은 Rodisoft/제로디가 준비하는 제품 이벤트 분석 도구입니다. 최소한의 수집과 빠른 응답, 프라이버시 우선을 목표로 합니다. 첫 소비자는 Sembom 계산기 포털이며, 이후 여러 제품에서 재사용하는 것을 지향합니다.

> **상태: Draft / 초기 계획 기록.** 이 저장소에는 현재 문서만 있습니다. 애플리케이션, `package.json`, 런타임, 배포, 벤치마크는 없습니다. 모든 내용은 계획이며 구현·검증·운영된 상태가 아닙니다.

## 현재 상태

- 문서만 존재하는 계획 단계입니다. 실행 가능한 릴리스가 없습니다.
- 저장소는 monorepo/fullstack 형태의 0.7.0 스캐폴드만 있습니다.
- 라이선스는 미정입니다.

## 계획된 구성 요소 (아직 생성 안 됨)

- `packages/core` — 이벤트 스키마/검증/코호트
- `packages/browser` — 브라우저 SDK
- `packages/storage-d1` — D1 분석 저장 어댑터
- `apps/collector` — Cloudflare Worker 수집기
- `apps/admin` — 관리자 대시보드 (프레임워크 미정)
- `examples/sembom` — 파일럿 예시

코어/SDK는 비공개 ZDP 패키지나 Cloudflare에 의존하지 않는 이식 가능한 구조를 지향합니다. Sembom 전용 호스트 어댑터는 Sembom 저장소에 남으며 엔진을 복사하지 않습니다.

## MVP 이벤트 (계획)

`tool_view`, `input_start`, `calculation_success`, `validation_error`, `result_copy`, `feedback_submit` (성공한 제출만).

완료율은 같은 코호트/시간 기준에서 입력 시작 방문 중 성공 방문 비율로 계산하며, 원시 이벤트 수를 나누지 않습니다. 분모가 없으면 unknown입니다.

## 설계 문서

- [제품 개요](./docs/product/00-product-brief.md)
- [명세](./docs/product/02-spec.md)
- [로드맵](./docs/product/01-roadmap.md)
- [아키텍처](./ARCHITECTURE.md)
- [성능 예산](./docs/engineering/03-performance-budget.md)
- [ADR 0001](./docs/adr/0001-initial-architecture-boundaries.md)

`api/openapi.yaml`와 `db/schema.dbml`은 일반 예시 리소스/사용자/조직 예제이며 Tallyfin 계약이 아닙니다. 런타임 전에 계약 슬라이스에서 교체해야 합니다.
