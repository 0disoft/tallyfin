# 개발 가이드

상태: 설계 문서·v0.1 계약·샘플 관리자 UI에 더해 코어 검증·D1 저장 어댑터·최소 브라우저 수집기·브라우저 SDK·서버 발행 SDK·관리자 조회 API를 로컬로 구현·검증했다. Sembom 연동 예제는 저장소 안에만 두었고 실제 Sembom 저장소에 설치·활성화하지 않았다. 실제 인증 제공자·원격 DB 마이그레이션·운영 배포는 아직 없다. 서버 SDK의 로컬 Node·Worker·D1 통합도 검증했다.

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

`typecheck`는 `tsc --noEmit`로 코어·저장·수집기·브라우저 SDK·서버 발행 SDK 소스와 `examples/sembom` 예제와 `tools/provision` CLI 소스를 검사하고, `test`는 `packages/core`·`packages/storage-d1`·`packages/browser`·`packages/server`·`apps/collector`·`tools/provision` 테스트를 실행한다. `check`는 여기에 `check:browser-size`를 더한다. 저장 어댑터 테스트는 Miniflare D1에 `db/migrations/0001_initial.sql`을 적용해 원자적 커밋·CAS 가드·중복·할당량·정리를 확인하고, 수집기 테스트는 esbuild로 번들한 Worker를 Miniflare에서 호출해 HTTP 경계를 확인하며 Sembom 예제의 여섯 이벤트·작업 흐름 전달과 재전송 duplicate도 검사한다. `test:core`는 코어 테스트만, `test:browser`는 브라우저 SDK 테스트만, `test:server`는 서버 발행 SDK 테스트만 실행한다.

`tools/runtime` 실행기 소스와 테스트도 루트 검사에 포함한다. 통합 실행 테스트가
관리자 서버를 띄우며 `apps/admin` 의존성은 루트 lockfile로 함께 설치한다.

개발 전용 계약 검사는 별도 패키지다.

```sh
npm ci --prefix tools/contracts --ignore-scripts
npm run lint --prefix tools/contracts
npm run check --prefix tools/contracts
```

브라우저·서버 SDK와 Sembom 예제, 배포 크기 검사도 루트 명령으로 실행한다.

```sh
npm run test:browser
npm run build:browser
npm run test:server
npm run build:server
npm run check:browser-size
```

`build:browser`는 esbuild 번들과 `tsc` 타입 선언을 만들고, `check:browser-size`는 예제 스키마 투영 일치와 번들 경계, gzip 3KiB 예산을 검사한다. `test:server`·`build:server`는 서버 발행 SDK의 단위 테스트와 번들·타입 선언 빌드를 실행한다. SDK 동작은 [브라우저 SDK](./docs/backend/browser-sdk.md)와 [서버 SDK](./docs/backend/server-sdk.md), 실행 결과와 실측값은 [VALIDATION.md](./VALIDATION.md)에 있다.

## 다음 구현
브라우저 SDK와 관리자 조회 API의 로컬 구현은 끝났고, 남은 것은 운영 요소다. 만료 정리 예약 핸들러와 로컬 등록·권한 관리 CLI도 구현했다. 서버 발행 수집과 서버 발행 SDK도 로컬에서 구현했고 서버 SDK의 로컬 Node·Worker·D1 통합도 검증했다. 실제 인증 제공자 연결, 원격 D1 마이그레이션과 예약 등록은 후속이다. 초기 실행 비용과 실브라우저 지연·처리량·원격 배포는 아직 검증하지 않았다. 계약과 명령 상태는 [VALIDATION.md](./VALIDATION.md)에 기록한다.
관리자 UI의 실행과 검증 명령은 [관리자 README](./apps/admin/README.md)에 있다.
API 연결은 같은 출처 `/v1`에서 조회·설정·권한·스키마 발행을 처리한다.
운영 설정과 공개 로그인 빌드는 [설치 안내](./docs/backend/installation.md)를 따른다.

## 가짜 명령 금지
관리자와 수집기를 함께 띄우려면 `npm run dev -- --local --state-dir .tmp/collector-db`를
실행한다. 루트 의존성을 설치하고 아래 등록 CLI로 DB를
먼저 준비한다. 기본 포트는 관리자 5180·수집기 5188이며, 실행·프록시·종료 절차는
[통합 개발 실행](./docs/backend/runtime.md#통합-개발-실행)을 따른다.

수집기는 `npm run collector:dev -- --local --state-dir .tmp/collector-db`로 실행한다.
같은 디렉터리를 등록 CLI에서 먼저 초기화하고 프로젝트를 등록한다.
실행 설정·배포 파일 준비·업로드 없는 묶음 검사는 [수집기 실행](./docs/backend/runtime.md)을 따른다.
`typecheck`는 Wrangler 바인딩 타입을 생성하고 공통 코드와 플랫폼 연결 코드를 검사한다.

로컬 프로젝트 등록·권한 관리는 `npm run provision -- --help`로 시작한다.
기본은 미리보기이며 초기화·등록·권한 변경에는 `--apply`가 필요하다.
입력 형식·명령·복구 절차는 [등록·권한 관리 CLI](./docs/backend/provisioning.md)를 따른다.

운영 명령·CI·자격증명을 가정하지 않는다. 저장소에 실제로 있는 package.json 명령만 실행한다.

## 브라우저 SDK 비용 측정

`npm ci --prefix tools/browser-bench --ignore-scripts`로 개발용 도구를 설치한 뒤
`npm run bench:browser -- --channel chrome --samples 5`로 로컬 브라우저·수집기·D1을
연결해 확인한다. 기본 검사나 CI에는 포함하지 않는다. 설치된 Edge와 전용 Chromium도
선택할 수 있다. [실행·측정 안내](./tools/browser-bench/README.md)를 따른다.

## 로컬 git
작은 작업 단위로 변경 파일만 커밋한다. 푸시·배포·게시는 사용자가 요청한 범위에서 진행한다.

## 소스 한도
파일 하나가 40KiB를 넘으면 분리할지 검토한다.
