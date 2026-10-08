# ADR 0002: 계약 기준 문서

상태: 계약 기준 확정(2026-10-08). 구현·운영 전이다.

## 결정
- 명세(spec)와 프라이버시 정의가 제품 범위의 기준이다([ADR 0003](./0003-minimal-privacy-preserving-events.md) 참조).
- 와이어 포맷은 api/openapi.yaml, 논리 저장 구조는 db/schema.dbml이 기준이다. 의미 정의는 [ADR 0005](./0005-event-and-aggregation-contract.md)를 따른다.

## 현재 상태
OpenAPI와 DBML의 제네릭 예제를 Tallyfin 공개 수집·관리자 조회·프로젝트 설정·집계 계약으로 교체했다. 서버 수집과 설정 쓰기 API는 이 버전에서 제공하지 않는다.

## 지금 하지 않는 것
계약 확정을 실행 구현이나 운영 인증 완료로 표시하지 않는다. SQL 마이그레이션·수집기·SDK·조회 서버는 후속 구현이다.
