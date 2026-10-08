# 검증

상태: 코어·저장 어댑터·최소 수집기·브라우저 SDK와 관리자 조회 API(GET)·검증기 포트의 로컬 검증, 그리고 v0.1 계약·샘플 UI 검증이 해당한다. 브라우저 SDK는 커밋 `cb3f2ff`(SDK 본체)와 뒤이은 예제·크기 검사·수집기 통합 테스트로 로컬 구현·검증했다. Sembom 예제는 저장소 안에만 두었고 실제 Sembom 저장소에 설치·활성화하지 않았다. 실제 인증 제공자·운영 로그인·원격 DB 마이그레이션·실브라우저 측정은 아직 없다.

2026-10-08 관리자 조회 슬라이스 검증: `apps/collector/src/admin.ts`에 관리자 GET 조회를, `index.ts`에 `createWorker(verifyBearer)` 검증기 포트를 구현했고, 모킹한 trusted 검증기와 실제 D1 grant 경계를 Miniflare에서 확인하는 native Worker 팩토리 smoke 테스트 1개를 추가했다. `node --test`로 `apps/collector/test/admin.test.ts` 9/9 통과. 부모 검증은 루트 `npm run check`(typecheck + 테스트 86개 + SDK+Sembom gzip 2949 bytes 예산)와 `tools/contracts` lint/check 27개 통과다. 이후 추가한 관리자 테스트 1개로 현재 전체 테스트는 87개지만 루트 full check 87은 다시 돌리지 않았다(루트 check 86 → 이후 관리자 9/9). DB 스키마·SQL 마이그레이션 변경은 없고 OpenAPI는 관리자 GET 405 응답 추가와 설명 문구 갱신만 있었다(경로·본문 형태는 그대로). 검증기는 테스트에서만 모킹했고 실제 서명 검증·인증 제공자·토큰 발급은 미구현·미검증이다. 자격증명·토큰은 만들지 않았다. backend 커밋 `404875c`, smoke 추가는 별도 커밋.

## OIDC 검증 어댑터

2026-10-08 OIDC 슬라이스 검증: `packages/auth-oidc`와 `createOidcWorker(options)`를
구현했다(코드 커밋 `7e85001`). 서명/issuer/API audience/만료/발행 시각/필수 클레임,
알고리즘·토큰 타입, JWKS 키 갱신·실패 재시도 제한·크기·본문 시간 제한을 검증한다.
실행 중 생성한 키로 실제 서명을 검증하며 운영용 자격증명은 생성하지 않는다.

관련 테스트 10/10, 루트 `npm run check`(타입 검사 + 전체 테스트 97/97 + 크기 검사)
통과. Miniflare Worker에서도 정상 토큰 200, 잘못된 audience/변조 401, grant 회수 후
403을 확인했다. SDK gzip 2667 bytes, SDK+Sembom gzip 2949 bytes로 유지된다.
`jose ^6`을 서버용 어댑터에 추가했고 새 workspace는 기존 루트 명령으로 검사한다.
OpenAPI·DB·마이그레이션·브라우저 UI·루트 러너 변경은 없다.

실제 인증 제공자·원격 JWKS·브라우저 로그인/PKCE·토큰 발급/갱신·운영 배포는
설정값과 연동 환경이 없어 실행하지 않았다. 공개키 캐시 수명은 10분이고 키 갱신
재조회 간격은 30초다. 토큰별 폐기/로그아웃 반영은 아직 구현하지 않았다.
운영 외부 키 조회·동시 부하는 미검증이며 로컬 transport와 Worker 암호 런타임을
확인한 결과다. 상세 정책은 [OIDC 어댑터](./docs/backend/oidc.md)를 따른다.

## 만료 데이터 예약 정리 — 2026-10-08

Worker `scheduled` 핸들러·D1 순회 커서·0002 추가 마이그레이션을 로컬 구현했다.
회당 최대 5개 프로젝트·6개 테이블별 500행을 처리하고, 중지된 프로젝트를 포함하며
개별 실패 뒤에도 진행한다. CAS로 겹친 실행의 오래된 커서 갱신을 거부한다.

루트 `npm run check`(타입 검사 + 테스트 102/102 + 브라우저 크기 검사) 통과.
추가한 테스트 5개는 프로젝트 순회/재생성/끝 순환/삭제된 대상/중지 프로젝트,
실패 격리/DB 실패/커서 충돌, 실제 workerd 예약 핸들러와 D1 삭제를 확인한다.
501개 만료 영수증 중 500개만 첫 실행에 삭제하고 아직 만료되지 않은 1개는 유지한다.
프로젝트-local 오늘을 포함한 90일 집계 경계와 ingest revision 유지도 확인했다.
기존 0001 데이터가 있는 DB에 0002를 적용해 프로젝트·영수증이 유지됨을 검사했다.

처음 예약 실패 검사는 Miniflare 호출의 reject를 기대해 실패했다. 실제 호스트는
예약 결과의 `outcome: exception`으로 전달하므로 그 결과를 검사하도록 수정했고
단독 예약 검사 3/3 및 위 루트 102/102에서 통과했다.

`tools/contracts` 검사 27/27, `git diff --check` 통과. SDK gzip 2667 bytes,
SDK+Sembom gzip 2949 bytes로 유지된다. DBML에 운영용 커서 테이블을 추가하고
0002와 테스트의 마이그레이션 로더·DB 계약 검사 기대값을 갱신했다. OpenAPI·
브라우저 SDK·루트 package scripts·의존성·CI는 변경하지 않았다.

원격 Cron Trigger 등록·배포·D1 적용은 승인한 배포 범위와 리소스 설정이 없어 실행하지
않았다. 장기 적체·처리량·비용은 운영 측정 전이다. 관리자 UI 검사는 이번 서버 정리
변경 범위 밖이므로 반복하지 않았다. 조건과 롤백은
[자동 정리](./docs/backend/retention-cleanup.md)에 기록한다.

## 로컬 프로젝트 등록·권한 관리 CLI — 2026-10-08

`tools/provision`에 init/register/grant/revoke를 구현했다(코드 커밋 `d8019cf`).
Node 24·Miniflare 영속 로컬 D1을 사용하며 기본은 미리보기다. `--apply`로만
반영하고 `--expect-plan`으로 검토한 입력·DB 상태와 일치하는지 확인한다.
시간대·발행 스키마 불변성, 새 버전 증가, 마지막 owner 보호, CAS 충돌 시
원자적 롤백을 검사한다. CLI는 신뢰된 파일시스템 운영자용이며 로그인을 검사하지 않는다.

타입 검사, CLI 관련 테스트 6/6과 루트 `npm run check`의 전체 108/108 통과.
권한 회수 후 조회 목록에서 제외, 두 owner 제거 계획 사이 충돌, 변경 없는 계획의
오래된 스냅샷 거부, 재등록 no-op, 실제 CLI 프로세스의 help/실패 종료 코드와
영속 DB 재실행을 확인했다. `tools/contracts` 검사 27/27 통과.
SDK gzip 2667 bytes, SDK+Sembom gzip 2949 bytes로 3072 bytes 예산 안이다.
`git diff --check` 통과. 설치된 `@types/node` 24.19.1을 개발 의존성 `^24`로
추가하고 CLI를 루트 타입 검사·테스트 러너에 포함했다. 실행 코드·설치 버전은 검사 후
변경하지 않았고 의존성 선언 범위만 같은 메이저로 넓혔다.

OpenAPI·DBML·SQL 마이그레이션·브라우저 SDK·CI 변경은 없다.
권한 문서 `docs/backend/02-authorization.md`에 로컬 운영자와 조회 grant 경계를
명시하고 사용법·복구를 `docs/backend/provisioning.md`에 기록했다.
실제 인증 제공자 사용자·운영 권한·원격 DB·배포·부하는 환경 설정과 승인 범위가 없어
실행하지 않았다. UI 검사는 이번 CLI 범위 밖이므로 반복하지 않았다.
원격 푸시·배포·마이그레이션은 실행하지 않았다.

## 검증 이름
스캐폴드 `ssealed update . --yes`, `ssealed doctor . --strict` 통과.
매니페스트의 기존 키 정렬을 유지해 체크섬 갱신만 남겼다.

기존 체크리스트와 연결되는 이름을 유지한다: `format`, `lint`, `typecheck`, `test`, `contract`, `migration-check`, `smoke`, `docs`, `check`.

## 루트 패키지
저장소 루트는 npm workspaces와 Node 24 실행 러너를 쓴다.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run check
```

- `typecheck`: `tsc --noEmit`로 코어·저장 어댑터·수집기·브라우저 SDK 소스와 `examples/sembom` 예제 소스를 검사한다.
- `test`: `node --test`로 `packages/core`·`packages/storage-d1`·`packages/browser`·`apps/collector` 테스트를 실행한다.
- `test:core`: 코어 테스트만 실행한다. 등록·배치·시간·해시 검증은 통과 상태다.
- `test:browser`: 브라우저 SDK 테스트만 실행한다.
- `build:browser`: esbuild로 `packages/browser/dist/index.js`를 만들고 `tsc -p tsconfig.build.json`으로 타입 선언을 낸다.
- `check:browser-size`: 예제 스키마 투영 일치와 브라우저 번들 크기 예산을 검사한다.
- `check`: `typecheck`·`test`·`check:browser-size`를 순서대로 실행한다.

저장 어댑터 테스트는 Miniflare D1에 `db/migrations/0001_initial.sql`을 적용해 원자적
커밋·CAS 가드·중복·할당량·만료 정리를 확인한다. 수집기 테스트는 esbuild로 번들한
Worker를 Miniflare에서 호출해 HTTP 경계(오리진·본문 한도·CORS·오류 응답·관리자 401)를
확인한다. 테스트는 Node 24와 Miniflare 4의 workerd 바이너리를 쓰며 `compatibilityDate`는
`2026-08-06`이다. 더 새로운 날짜(예: 2026-10-08)는 아직 검증하지 않았다.

2026-10-08 검증: 루트 `npm run check`(실행 당시 typecheck + 테스트 78개)와 별도 `check:browser-size` 통과. 이후 기본 `check`에 크기 검사도 연결했다. 테스트는 기존 58개에 브라우저 SDK 19개와 SDK→Worker→D1 통합 1개를 더한 78개다. `npm run build:browser`와 `npm run check:browser-size` 통과, 크기는 SDK 5747 bytes/gzip 2667 bytes, SDK+Sembom 어댑터·스키마 6628 bytes/gzip 2949 bytes로 3072 bytes 예산 안이다. 개발 전용 계약 검사 `tools/contracts` lint/check 27개 통과, OpenAPI Redocly lint와 타입 검사 통과. `npm ci`는 기존 설치 상태라 이번에 다시 돌리지 않았고 `git diff --check` 통과.

## 계약 검사
개발 전용 계약 검사 패키지는 `tools/contracts/`이며 운영 코드와 분리한다.

```sh
npm ci --prefix tools/contracts --ignore-scripts
npm run lint --prefix tools/contracts
npm run check --prefix tools/contracts
```

`lint`는 Redocly의 OpenAPI 3.1 구문·참조 검사다. `check`는 JSON 예시, 잘못된 wire
입력, 예시의 등록/카디널리티/날짜/집계 일치, DBML 파싱과 문서 링크를 검사한다.
수집 상태 머신·DB 트랜잭션·운영 인증·원격 마이그레이션을 실행하지 않는다.

## 브라우저 SDK
`packages/browser`(SDK 본체), `examples/sembom` 예제, 배포 크기 검사는 루트 npm 명령으로 확인한다.

```sh
npm run test:browser
npm run build:browser
npm run check:browser-size
```

- `test:browser`는 결정적 `FakeBrowser` 호스트로 배치 상한·재시도·Retry-After·숨김 전송·`destroy`를 검사하고, 네이티브 어댑터가 `credentials: omit`·`referrerPolicy: no-referrer`·keepalive로 전송하는지 확인한다.
- `apps/collector` 테스트는 Sembom 예제가 여섯 이벤트와 작업 흐름을 Worker→D1로 전달하고 재전송이 duplicate로만 계산되는지 통합 확인한다.
- `check:browser-size`는 `examples/sembom/browser-schema.json`이 `api/examples/registry.json`의 browser 투영과 같은지 검사하고, esbuild 번들에 런타임 임포트나 `packages/core`·`packages/storage-d1`·`apps/collector` 코드가 들어가지 않았는지 확인한 뒤 gzip 예산 3072 bytes를 검사한다. 실측 크기는 위 2026-10-08 기록에 있다.

브라우저 SDK 변경은 API·DB 계약을 바꾸지 않는다. SDK는 네이티브 `sendBeacon`을 쓰지 않고 keepalive fetch로 credentials/referrer를 생략하며, 서버 코어·D1 런타임을 번들에 포함하지 않는다.

## 프로토타입
`prototypes/admin/`에는 `typecheck`·`test`·`build` 명령이 있다. UI smoke와 디자인
비교는 [design-qa.md](./prototypes/admin/design-qa.md)에 기록한다.

2026-10-08 API 연결 모드 검증: `npm run typecheck`, `npm test` 19/19,
`npm run build`, `npm run test:sites` 4/4 통과. 클라이언트는 같은 출처 `/v1`만
조회하고 응답의 프로젝트·버전·기간·이벤트·작업 흐름을 요청과 대조한다. 연결 해제 시
토큰과 데이터를 지우고 헤더 및 본문을 읽는 중인 요청도 취소한다. 최초 테스트 실패
1개는 유효한 빈 프로젝트 목록을 형식 오류로 기대한 테스트를 수정해 해결했다.

로컬 Miniflare D1(5188)과 Vite 프록시(5187), 모킹한 검증기 포트로 브라우저에서
수집 이벤트 3건·시작 1건·성공 1건·완료율 100%, 일별 시계열과 `tool=loan` 버킷,
목표·읽기 전용 설정, 빈/잘못된 버전 입력, 존재하지 않는 버전의 404,
토큰 없는 401, 연결 해제 후 초기화와 재연결을 확인했다. 증명은 로컬 무시 파일
`.tmp/admin-api-d1-local-20261008.jpg`다. 실제 인증 제공자·서명 검증·운영 로그인은
시험하지 않았다. 403·503·응답 계약 오류는 관리자/클라이언트 테스트에서 확인했고
브라우저에서 별도 재현하지 않았다. 편집 중 이전 HMR 실패 로그가 남아 있었지만
최종 타입 검사·빌드와 정상 API 화면을 확인했다.

관리자 JS 번들은 약 653kB(압축 전)로 chunk-size 경고가 남는다. SDK gzip 3KiB
예산과 별개이며 운영 UI의 코드 분할·폰트 최적화는 후속이다. API/DB 계약과 루트
러너·의존성은 이 화면 슬라이스에서 바꾸지 않았고 프로토타입 테스트 명령에 API
클라이언트 검사를 추가했다. 원격 푸시·배포·마이그레이션은 실행하지 않았다.

## 포맷·문서·스캐폴드

2026-10-08 OIDC 로그인 연결 검증: `prototypes/admin`의 `npm run typecheck`,
`npm test` 31/31, `npm run build`, `npm run test:sites` 4/4 통과. 기존 28개에
요청별 현재 bearer 조회·갱신 실패의 고정 401·공유 갱신 대기 중 취소/연결 해제
검증 3개를 추가했다. PKCE 클라이언트 9개는 생성한 키로 ID 서명·state/nonce·
중복 코드 교환·회전 갱신·만료·늦은 응답 취소를 검사한다.

로컬 Vite 5180 브라우저에서 설정 없음, 직접 연결 접기/펼치기, 다른 출처 거부,
실패 콜백 쿼리 제거·대기 종료, 샘플 모드 복귀/재진입을 확인했고 콘솔 오류는
수집되지 않았다. 증거는 `.tmp/admin-oidc-login-20261008.png`다. 실제 제공자
로그인/CORS·운영 access token·운영 배포는 설정이 없어 실행하지 않았다.
전체 접근성 감사와 부하 테스트는 이번 로그인 연결 범위에서 실행하지 않았다.
프로토타입에는 lint 스크립트가 없으며 `git diff --check`를 통과했다.

로그인 코드는 지연 로드 청크 30.65kB/gzip 10.85kB로 분리됐다. 메인 청크는
657.25kB/gzip 191.91kB로 기존 크기 경고가 남는다. API/OpenAPI·DB·루트 러너와
의존성 계약은 이번 화면 연결에서 변경하지 않았다. 설정/보관/갱신 조건은
`docs/backend/oidc.md`, 화면 책임은 `docs/frontend/FRONTEND_DESIGN.md`에 반영했다.
스캐폴드 `ssealed update . --yes`와 `ssealed doctor . --strict`도 통과했다.
원격 푸시·배포·마이그레이션은 실행하지 않았다.

- `format`: `git diff --check`로 공백 오류를 확인한다.
- `docs`: 변경 문서의 상대 Markdown 링크와 계획/구현 상태의 일관성을 확인한다.
- `check`(스캐폴드): 외부 CLI의 `ssealed doctor . --strict`로 상태를 확인한다. 의도적인
  문서 수정은 `ssealed update . --yes`로 인정한 후 확인한다. 파일 내용을 덮어쓰는
  `--force`는 사용하지 않는다.

## 아직 실행하지 않음
- 브라우저 SDK 초기 실행 비용과 실브라우저 지연·처리량, 원격 배포
- 서버 발행 수집과 실제 인증 제공자 연결, 운영 관리자 조회 배포(로컬 grant 강제는 관리자 테스트로 확인)
- 원격 D1 마이그레이션과 운영 smoke
- 원격 만료 정리 예약 등록과 운영 Worker·도메인·인증 제공자
- 쓰기 처리량·지연 성능 측정

서술(prose) 테스트는 작성하지 않는다.
