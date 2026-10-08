# 개발 가이드

상태: 문서 전용. 애플리케이션/패키지/런타임 없음. 이 저장소는 현재 docs-only 스캐폴드이며 실제 API·DB 계약 변경 없음.

## 읽기 순서

1. [제품 명세](./docs/product/02-spec.md)와 [아키텍처](./ARCHITECTURE.md)
2. [문서 색인](./docs/README.md)
3. [ADR 0002 계약 기준 문서](./docs/adr/0002-contract-source-of-truth.md)
4. [ADR 0003 최소·프라이버시 이벤트](./docs/adr/0003-minimal-privacy-preserving-events.md)
5. [워크스페이스 경계](./docs/monorepo/workspace-boundaries.md), [패키지 소유권](./docs/monorepo/package-ownership.md)
6. [위험 등록부](./docs/product/03-risk-register.md)
7. [프론트엔드 설계](./docs/frontend/FRONTEND_DESIGN.md)
8. [VALIDATION.md](./VALIDATION.md)

## 다음 구현
다음 슬라이스는 API/DB 계약 확정과 런타임 이전 스키마 교체. 이번 슬라이스는 애플리케이션/의존성/배포/실제 계약 변경 없음.

## 가짜 명령 금지
실행 가능한 bun 스크립트/CI/통과 테스트/자격증명을 만들지 않고 package.json 스크립트를 가정하지 않는다.

## 로컬 git
작은 작업 단위로 변경 파일만 커밋한다. 푸시·배포·게시는 사용자가 요청한 범위에서 진행한다.

## 소스 한도
파일 하나가 40KiB를 넘으면 분리할지 검토한다.
