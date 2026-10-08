# 개발 가이드

상태: 설계 문서와 샘플 관리자 UI가 있다. 실제 API·DB 계약과 수집 런타임은 아직 구현하지 않았다.

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
다음 슬라이스는 API/DB 계약 확정과 런타임 이전 스키마 교체다.
샘플 UI의 실행과 검증 명령은 [프로토타입 README](./prototypes/admin/README.md)에 있다.

## 가짜 명령 금지
운영 명령·CI·자격증명을 가정하지 않는다. 프로토타입 폴더의 실제 package.json 명령만 실행한다.

## 로컬 git
작은 작업 단위로 변경 파일만 커밋한다. 푸시·배포·게시는 사용자가 요청한 범위에서 진행한다.

## 소스 한도
파일 하나가 40KiB를 넘으면 분리할지 검토한다.
