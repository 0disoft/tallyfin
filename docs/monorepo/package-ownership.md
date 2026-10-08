# 패키지 소유권

상태: 계획. npm 스코프는 미결정.

## 책임
- core: 향후 스키마/검증/코호트 로직 구현.
- browser: 최소 SDK. 동기 수집 I/O 없음, 렌더링/계산 대기 없음.
- storage-d1: D1 집계 저장 어댑터.
- collector: Worker 수신 엔드포인트.
- admin: 대시보드 표시.
- Sembom 호스트 어댑터: Sembom 저장소 소유.

## 공개/비공개 통합
공개 프로젝트 ID는 라우팅 메타데이터이며 비밀/인증이 아니다. 비공개 ZDP/Cloudflare 의존성은 core/SDK에 넣지 않는다.

## 기준 문서
제품 범위는 제품 명세, API 전송 형식은 OpenAPI, DB 구조는 DBML을 기준으로 구현한다. 향후 core는 계약에 맞는 검증 코드를 제공하며 [ADR 0002](../adr/0002-contract-source-of-truth.md)를 따른다. api/openapi.yaml, db/schema.dbml은 현재 제네릭 예시이며 실제 계약이 아니다.

## 버전 계획
이벤트에 스키마 버전을 포함한다. 패키지 버전/배포 방식은 미결정.
