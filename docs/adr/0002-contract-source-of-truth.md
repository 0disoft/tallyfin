# ADR 0002: 계약 기준 문서

상태: Draft(계획). 현재 API·DB 예제는 아직 교체하지 않았다.

## 결정
- 명세(spec)와 프라이버시 정의가 제품 범위의 기준이다([ADR 0003](./0003-minimal-privacy-preserving-events.md) 참조).
- 미래의 API 와이어 포맷과 DB 스키마는 다음 설계 슬라이스에서 확정한다.

## 현재 상태
api/openapi.yaml과 db/schema.dbml은 생성된 제네릭 resource/users/org 예시이며 Tallyfin 계약이 아니다. 런타임 이전에 다음 계약 슬라이스에서 명시적으로 교체한다.

## 지금 하지 않는 것
새 와이어 필드/라우트를 발명하지 않는다. 기존 ops/auth 문서는 템플릿으로 유지한다.
