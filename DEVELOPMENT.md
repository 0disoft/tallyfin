# 개발 가이드

상태: 설계 문서·v0.1 계약·샘플 관리자 UI에 더해 코어 검증·D1 저장 어댑터·최소 브라우저 수집기·브라우저 SDK·관리자 조회 API를 로컬로 구현·검증했다. Sembom 연동 예제는 저장소 안에만 두었고 실제 Sembom 저장소에 설치·활성화하지 않았다. 실제 인증 제공자·원격 DB 마이그레이션·운영 배포는 아직 없다.

## 읽기 순서

1. [제품 명세](./docs/product/02-spec.md)와 [아키텍처](./ARCHITECTURE.md)
2. [문서 색인](./docs/README.md)
3. [ADR 0002 계약 기준 문서](./docs/adr/0002-contract-source-of-truth.md)
4. [ADR 0003 최소·프라이버시 이벤트](./docs/adr/0003-minimal-privacy-preserving-events.md)
5. [워크스페이스 경계](./docs/monorepo/workspace-boundaries.md), [패키지 소유권](./docs/monorepo/package-ownership.md)
6. [이벤트·집계 계약](./docs/backend/event-contract.md), [수집기 구현](./docs/backend/collector.md)
7. [브라우저 SDK](./docs/backend/browser-sdk.md), [관리자 조회 경계](./docs/backend/administrator.md)
8. [위험 등록부](./docs/product/03-risk-register.md)
9. [프론트엔드 설계](./docs/frontend/FRONTEND_DESIGN.md)
10. [VALIDATION.md](./VALIDATION.md)

## 로컬 명령
저장소 루트에서 실행한다.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run check
```

`typecheck`는 `tsc --noEmit`로 코어·저장·수집기·브라우저 SDK 소스와 `examples/sembom` 예제 소스를 검사하고, `test`는 `packages/core`·`packages/storage-d1`·`packages/browser`·`apps/collector` 테스트를 실행한다. `check`는 여기에 `check:browser-size`를 더한다. 저장 어댑터 테스트는 Miniflare D1에 `db/migrations/0001_initial.sql`을 적용해 원자적 커밋·CAS 가드·중복·할당량·정리를 확인하고, 수집기 테스트는 esbuild로 번들한 Worker를 Miniflare에서 호출해 HTTP 경계를 확인하며 Sembom 예제의 여섯 이벤트·작업 흐름 전달과 재전송 duplicate도 검사한다. `test:core`는 코어 테스트만, `test:browser`는 브라우저 SDK 테스트만 실행한다.

개발 전용 계약 검사는 별도 패키지다.

```sh
npm ci --prefix tools/contracts --ignore-scripts
npm run lint --prefix tools/contracts
npm run check --prefix tools/contracts
```

브라우저 SDK와 Sembom 예제, 배포 크기 검사도 루트 명령으로 실행한다.

```sh
npm run test:browser
npm run build:browser
npm run check:browser-size
```

`build:browser`는 esbuild 번들과 `tsc` 타입 선언을 만들고, `check:browser-size`는 예제 스키마 투영 일치와 번들 경계, gzip 3KiB 예산을 검사한다. SDK 동작은 [브라우저 SDK](./docs/backend/browser-sdk.md), 실행 결과와 실측값은 [VALIDATION.md](./VALIDATION.md)에 있다.

## 다음 구현
브라우저 SDK와 관리자 조회 API의 로컬 구현은 끝났고, 남은 것은 운영 요소다. 만료 정리 스케줄러, 서버 발행 수집, 실제 인증 제공자와 grant provisioning, 원격 D1 마이그레이션이 후속이다. 초기 실행 비용과 실브라우저 지연·처리량·원격 배포는 아직 검증하지 않았다. 계약과 명령 상태는 [VALIDATION.md](./VALIDATION.md)에 기록한다.
Sample/API 연결 관리자 UI의 실행과 검증 명령은 [프로토타입 README](./prototypes/admin/README.md)에 있다. API 연결은 같은 출처의 `/v1` GET 조회만 사용한다.

## 가짜 명령 금지
운영 명령·CI·자격증명을 가정하지 않는다. 저장소에 실제로 있는 package.json 명령만 실행한다.

## 로컬 git
작은 작업 단위로 변경 파일만 커밋한다. 푸시·배포·게시는 사용자가 요청한 범위에서 진행한다.

## 소스 한도
파일 하나가 40KiB를 넘으면 분리할지 검토한다.
