# 검증

상태: 코어·D1 저장·수집기·브라우저 SDK·관리자 조회/설정 변경 API·OIDC 검증 어댑터와 v0.1 계약·샘플 UI를 로컬에서 검증했다. 브라우저 SDK는 커밋 `cb3f2ff`와 뒤이은 예제·크기 검사·수집기 통합 테스트 및 합성 화면의 실브라우저 측정으로 확인했다. Sembom 예제는 저장소 안에만 두었고 실제 서비스에는 설치·활성화하지 않았다. 실제 인증 제공자·운영 로그인·원격 DB 마이그레이션과 운영 배포는 아직 없다.

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

## 수집기 실행·배포 구성 — 2026-10-08

런타임 코드 커밋 `3eda6ef`: `apps/collector/src/runtime.ts`가 D1·OIDC 환경 설정을
검사하고 같은 설정의 검증기 캐시를 재사용한다. 공통 팩토리·닫힌 기본 export는
유지한다. `collector:dev`는 등록 CLI와 같은 영속 로컬 D1을 열고 초기화 상태를
확인한다. 127.0.0.1에서 구동하고 60초마다 정리를 예약하며 겹친 실행을 막고 종료 시
진행 중 정리·타이머·런타임을 정리한다. 코드·설정 변경 후 재시작이 필요하다.

`npm run check` 통과: Wrangler 생성 타입·공통/호스트 타입 검사, 전체 테스트 111/111,
브라우저 크기 검사. 추가한 config/runtime 검사 3/3은 설정 오류·네트워크 없는 검증,
환경 바인딩을 통한 실제 테스트 서명·401/200·grant 회수 후 403·scheduled 호출,
등록 CLI에서 만든 DB 재사용·초기화 없는 DB 거부·종료 후 리스너 해제를 확인했다.
60초 타이머 자체의 장시간 관측은 반복하지 않았고 정리 호출은 직접 검증했다.

`collector:config`는 입력한 계정·DB ID와 OIDC 설정의 형식을 검사하고 새 파일만 만든다.
원격 요청·리소스 생성·덮어쓰기는 없다. 이후 대상 준비 도구의 타입 검사와 관련 테스트
3/3 통과. 현재 테스트는 114개이며 전체 114개를 다시 돌리지 않았다(전체 111 + 추가 3).
`npm run collector:dev -- --help` 통과. `npm run collector:dry-run`으로 업로드 없이
기본 Worker 번들을 검사했다: 97.63KiB, gzip 24.61KiB. 실제 운영 대상 값이 없어
운영 설정으로 묶음을 만들거나 원격 ID 존재·소유권을 확인하지 않았다.

개발 의존성 `wrangler ^4`(설치 4.148.0)를 추가했다. 검증된 compatibility date
2026-08-06은 유지한다. 루트 타입 검사는 `.tmp`에 플랫폼 타입을 생성하고 별도 호스트
tsconfig로 검사한다. SDK gzip 2667 bytes, SDK+Sembom gzip 2949 bytes로 유지된다.
OpenAPI·DBML·SQL 마이그레이션·브라우저 SDK·CI 변경은 없다. `.wrangler`·`.dev.vars`
무시 규칙을 추가했다. 실행 설정·로그 정책은 `wrangler.jsonc`와
`docs/backend/runtime.md`, 운영 설정 문서는 `docs/ops/config-and-env.md`에 반영했다.
구조화 앱 로그만 켜고 요청 URL을 담는 호출 로그·자동 traces는 프라이버시 계약에 따라
끈다. 플랫폼 자체 로그의 저장·반출은 원격 환경에서 추가로 검토해야 한다.

원격 인증 제공자 연결·D1 마이그레이션·grant 등록·Cron Trigger·배포·부하는 실제
리소스/설정과 승인 범위가 없어 실행하지 않았다. UI 검사는 변경 범위 밖이다.
푸시·배포·원격 리소스 변경은 실행하지 않았다. 계약 검사 27/27,
`git diff --check`, `ssealed update . --yes`·`ssealed doctor . --strict` 통과.

## 검증 이름
스캐폴드 `ssealed update . --yes`, `ssealed doctor . --strict` 통과.
매니페스트의 기존 키 정렬을 유지해 체크섬 갱신만 남겼다.

기존 체크리스트와 연결되는 이름을 유지한다: `format`, `lint`, `typecheck`, `test`, `contract`, `migration-check`, `smoke`, `docs`, `check`.

## 루트 패키지
저장소 루트는 npm workspaces와 Node 24 실행 러너를 쓴다.

```sh
npm ci --ignore-scripts
npm ci --prefix prototypes/admin --ignore-scripts
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

루트 테스트에는 `tools/provision`·`tools/runtime`도 포함한다. 통합 실행 테스트가
관리자 서버를 사용하므로 `prototypes/admin` 의존성은 별도로 설치한다.

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

## 2026-10-08 통합 개발 실행

루트 `npm run check`(타입 검사·116/116 테스트·브라우저 크기 예산), 관리자
`npm run typecheck`·`npm test` 32/32·`npm run build` 통과. supervisor 테스트는
정상 종료·예기치 않은 종료·시작 실패 시 자식 정리를 확인한다. 실제 스택 통합
테스트는 초기화된 로컬 D1, 관리자 페이지·로그인 콜백 SPA, `/v1/projects`의
수집기 401 JSON 응답, 종료 후 양쪽 리스너 해제를 확인했다. 프록시 테스트는
경로·쿼리·헤더 전달, `/auth/callback`·`/v10` 제외와 비루프백 주소 거부를 확인했다.

브라우저에서 5190/5198 스택의 샘플 화면·API 연결 전환·실패 콜백의 SPA 처리와
OIDC 미설정 상태의 직접 연결 화면을 확인했다. 확인용 스택은 종료했다.
관리자 빌드의 기존 청크 크기 경고는 남는다. 실제 OIDC 제공자 로그인·원격
리소스·운영 배포·부하 시험은 설정이 없거나 이번 범위 밖이어서 실행하지 않았다.

API/OpenAPI·DB·의존성 계약은 변경하지 않았다. 루트 `dev` 러너, 관리자 테스트
명령, 로컬 프록시·IPC 종료 처리를 추가했다. 실행 문서는 `docs/backend/runtime.md`,
`DEVELOPMENT.md`, `prototypes/admin/README.md`에 반영했다. 원격 푸시·배포는 하지 않았다.
계약·문서 링크 검사 27/27과 `git diff --check` 통과. 종료 후 5190·5198에
리스너가 남지 않은 것을 확인했다.

## 2026-10-08 브라우저 SDK 측정과 배치 경계 수정

첫 실제 Chrome 실행에서 20개 배치 뒤의 완료 이벤트 저장이 503으로 실패했다.
시작과 완료가 다른 배치에 있는 회귀 테스트 2개가 동일하게 실패하는 것을 확인했다.
SQLite INSERT의 CHECK가 충돌 처리 전에 적용되므로 완료만 있는 증가분을 신규 행으로
넣을 수 없었다. 같은 CAS 가드·원자적 write batch 안에서 유효한 0 집계 행을 준비하고
기존 값에 증가분을 더하도록 수정했다. 스키마·마이그레이션·API 계약은 변경하지 않았다.
수정 후 저장/수집기 테스트 35/35, 루트 타입 검사·브라우저 크기 예산과 JS 구문 검사 통과.

`npm run bench:browser -- --channel chrome --samples 2`로 복구를 확인하고 최종
`--samples 5`를 실행했다. 비활성/활성 5회씩과 실제 수집기 종료 화면 1회를 확인했다.
DB의 이벤트 120건과 시작/성공 각각 55건, 각 화면의 계산 11회·필수 입력 오류·복구,
비활성 수집 0건, 활성 200 응답, 장애 503 재시도와 destroy 이후 중단을 검사했다.
Origin 존재, Cookie·Authorization·Referer 부재와 배치 16KiB 상한도 통과했다.
도구가 소유한 서버·브라우저·임시 DB는 실행 후 정리됐고, 원시 결과는
`.tmp/browser-bench/1791469967935.json`에 남겼다. 수치와 조건은
`docs/engineering/03-performance-budget.md`에 기록했다.

루트에 선택 명령 `bench:browser`, 타입 검사에 측정 도구를 추가했다. Playwright ^1은
`tools/browser-bench` 개발 패키지/lockfile로 분리했고 운영 SDK 번들은 바꾸지 않았다.
새 CI나 기본 테스트 반복을 추가하지 않았다. 기존 서비스·운영 데이터·자격 증명·
원격 리소스를 사용하지 않았다. 실제 서비스/모바일/원격 부하·운영 OIDC는 범위 밖이므로
실행하지 않았다. 전체 CWV/성능 trace 감사도 이 동기 호출 측정 범위에 포함하지 않았다.
문서는 `DEVELOPMENT.md`, `docs/backend/browser-sdk.md`, 성능 예산과 로드맵을 갱신했다.
계약·문서 링크 검사 27/27, 측정 명령 `--help`, `git diff --check` 통과.
푸시·배포는 하지 않았다.

## 2026-10-09 프로젝트 설정 조회·변경 API

`GET /v1/projects/{projectId}`와 owner 전용 `PATCH`를 로컬 구현했다. 이름·상태·
허용 출처·수집 한도를 부분 변경한다. 읽은 설정의 `expectedSettingsHash`를 필수로
받고, 저장 SQL에서 기존 설정과 owner grant를 다시 확인한다. 설정이 바뀌면
`settings_conflict` 409, 권한이 없거나 저장 전에 취소되면 403이다. 이벤트 수집의
revision 증가만으로 설정 저장을 거부하지 않는다. 설정 저장은 수집 guard revision을
늘리며, 기존 데이터·정의 버전·소비한 한도를 유지한다.

`npm run typecheck`, `npm test` 127/127, `npm run check --prefix tools/contracts`
30/30, `npm run lint --prefix tools/contracts`, `npm run check:browser-size`,
`git diff --check` 통과. 새 설정 테스트 9개는 owner 성공·reader 거부·잘못된 인증·
닫힌 입력·본문 상한·동시 수정·저장 직전 권한 취소·수집과 설정 간 충돌·로컬 HTTP
제약을 확인했다. 기존 실제 Worker 런타임 테스트에도 설정 조회·PATCH 저장을 추가했다.
첫 관련 테스트 실행은 일시정지 시 거부 코드의 기대값을 잘못 지정해 17/18이었다.
실제 `project_unavailable` 거부에 맞춰 수정한 뒤 위 전체 테스트를 통과했다.
브라우저 SDK+연동 예제는 gzip 2,949 bytes로 3KiB 예산을 통과했다.

API source of truth `api/openapi.yaml`, 제품 source of truth
`docs/product/02-spec.md`, 관리자·이벤트 계약과 로드맵을 갱신했다. DB 구조·
마이그레이션·의존성·러너·CI 설정은 변경하지 않았다. 운영 인증 제공자·원격 D1·
배포 smoke는 운영 설정이 없어 실행하지 않았다. 관리자 화면의 쓰기 연결과 브라우저
측정·부하 시험은 이번 API 범위 밖이어서 실행하지 않았다. 화면에서는 아직 기존
조회 기능만 사용한다. 저장 응답이 유실되면 현재 설정을 다시 읽어 결과를 확인해야 한다.
원격 푸시·배포·Sembom 연동은 실행하지 않았다.

## 2026-10-09 관리자 설정 화면 저장 연결

설정 응답에 서버가 확인한 owner 권한 표시 `canEdit`를 추가했다. reader는 false이고,
권한 표시는 설정 해시에서 제외하며 PATCH의 저장 시점 권한 검사는 유지한다.
백엔드 타입 검사·관련 설정 테스트 9/9·OpenAPI lint·계약 검사 30/30 통과.

`LiveSettings`와 프로젝트별 `SettingsEditor`를 연결했다. 변경 항목만 저장하고,
reader·저장 중·충돌 검토 중에는 편집을 잠근다. 409·저장 응답 유실·권한 취소에서는
입력을 보존하고 자동 재전송하지 않는다. 최신 값을 읽어 비교한 뒤 서버 값 사용 또는
내 변경 유지 후 재검토를 명시적으로 고른다. 내가 편집하지 않은 항목은 최신 서버 값을
유지한다. 프로젝트 전환·연결 해제·언마운트는 요청을 취소하고 늦은 응답을 무시한다.
설정 편집은 집계 기간이나 선택한 스키마 조회 실패에 의존하지 않는다.

관리자 `npm test` 38/38, `npm run typecheck`, `npm run build`, `npm run test:sites`
4/4 통과. API/모델 테스트 6개를 추가해 PATCH 전송·응답 검사, 부분 저장·중복 submit,
409 후 명시적 재검토, 응답 유실 후 조회 복구, reader/권한 취소, 늦은 저장 응답 취소를
확인했다. 기본 테스트 명령·의존성·러너·CI 설정은 바꾸지 않았다. 기존 메인 청크 크기
경고는 남으며 빌드 시 673.91kB/gzip 196.36kB였다.

127.0.0.1의 Vite와 격리된 Miniflare/D1를 연결해 인앱 브라우저에서 실제 저장 200과
DB 반영을 확인했다. 다른 설정 변경 후 409·초안 보존·비교 표·명시적 재검토를 거쳐
이름만 저장하면서 서버의 분당 한도 55를 유지했다. DB 저장 후 HTTP 응답을 끊어도
초안과 저장 잠금을 유지하고 재조회로 커밋된 결과를 복구했다. owner를 reader로 바꾼
테스트에서도 403 이후 입력을 보존했고, 재조회 후 변경 유지 버튼·폼을 비활성화했다.
스키마 999 조회가 실패한 상태에서도 설정 저장·복구는 동작했다. 빈 이름 오류 시
`settings-name`으로 포커스가 돌아왔고 CSS viewport 320px에서 가로 넘침이 없었다.
화면 증거는 `.tmp/admin-settings-conflict.jpg`와 `.tmp/admin-settings-mobile.jpg`다.
확인은 합성 프로젝트와 검증기 포트로 수행했으며 운영 자격 증명·서비스 데이터는
사용하지 않았다. 임시 API·D1 테스트 서버를 종료한 뒤 5198에 리스너가 없음을 확인했다.
Vite 미리보기 5180만 남겼고, 테스트 프록시 없이 샘플 모드로 전환했다.

변경한 source of truth는 `api/openapi.yaml`, `docs/product/02-spec.md`,
`docs/frontend/FRONTEND_DESIGN.md`이며 관리자 문서·로드맵·검증 기록도 갱신했다.
DB 스키마·마이그레이션·위생 정책은 변경하지 않았다. 문서 6개의 상대 링크 31개와
`git diff --check`, `ssealed update . --yes`·`ssealed doctor . --strict`를 확인하고
스캐폴드 승인 체크섬만 갱신했다.
실제 OIDC 제공자·운영 저장·원격 배포 smoke는 운영 설정이 없어 실행하지 않았다.
전체 접근성 감사·부하 시험은 이번 설정 화면 범위 밖이어서 생략했다.
푸시·배포·Sembom 연동은 실행하지 않았다.

## 2026-10-09 스키마 초안 검증 API

기존 발행 스키마 GET을 유지하고 owner 전용
`POST /v1/projects/{projectId}/schemas/validate`를 추가했다. 이벤트·흐름 배열만 받아
등록과 공유하는 코어 검증기로 검사하고 첫 오류의 JSON pointer·코드를 반환한다.
검증 성공은 개인정보 승인·버전 예약·발행을 뜻하지 않으며 초안을 저장하지 않는다.
인증·owner grant 조회는 본문 읽기 전에 수행하고 reader·다른 프로젝트·권한 회수는
403이다. 본문은 UTF-8 32KiB, 기존 수집·설정 본문은 16KiB를 유지한다.
등록 검증기를 분리하며 문자열이 아닌 이벤트 source를 명시적으로 거부했다.

`npm run typecheck`, 전체 `npm test` 136/136, 계약 검사
`npm run check --prefix tools/contracts` 31/31, OpenAPI lint와
`npm run check:browser-size`(SDK+예제 gzip 2,949 bytes), `git diff --check` 통과.
신규 코어 테스트 3개·수집기 테스트 6개에서 정의/참조/차원/종류 수 제한·권한·본문
상한·닫힌 입력·저장 실패를 확인했다. 기존 Miniflare 실제 Worker 테스트에 검증 API
요청도 추가해 200 응답을 확인했다. DB의 프로젝트·발행 정의·사용량 무변경도 확인했다.
초기 관련 테스트는 DB 응답의 실행 시간 meta까지 비교해 32/33이었고, 실제 행만
비교하도록 수정했다. 초기 계약 검사는 oneOf 배열 type 누락으로 실패했고 수정 후
31/31과 lint를 통과했다.

변경한 source of truth는 `api/openapi.yaml`, `docs/product/02-spec.md`다.
관리자 문서·로드맵·검증 기록을 갱신했다. DB·마이그레이션·의존성·CI·러너·저장소
위생 정책은 변경하지 않았다. 관리자 편집 화면·발행 API는 후속 범위로 남겼다.
UI 변경이 없어 브라우저 UI 검증을 생략했고, 운영 설정이 없어 실제 OIDC 제공자·원격
D1·배포 smoke는 실행하지 않았다. 푸시·배포·Sembom 연동은 실행하지 않았다.

## 2026-10-09 스키마 목록·새 버전 발행 API

`GET /v1/projects/{projectId}/schemas`로 최고 버전과 최신순 메타데이터를 reader/owner에
반환한다. limit 25/최대 100과 배타적 beforeVersion 커서를 사용하고 매 페이지 grant를
확인한다. owner 전용 `PUT /v1/projects/{projectId}/schemas/{schemaVersion}`은
expectedLatestVersion·privacyReviewed=true·events·workflows를 받아 새 active 버전을
발행한다. 프로젝트·기존 정의·집계·수집 사용량은 유지하고 ingest_revision만 1 증가한다.
새 버전 정의로 실제 이벤트 저장이 가능한 것도 확인했다.

owner·최고 번호 조건부 INSERT와 revision 갱신을 같은 원자 D1 batch에서 실행한다.
동시 다른 버전 발행은 한 번만 성공하고 다른 요청은 schema_conflict 409다.
같은 버전·같은 canonical 내용의 재요청은 200과 기존 메타데이터를 반환하고 추가
저장·revision 증가가 없다. 이후 버전이 생기거나 해당 버전이 retired여도 재요청은
기존 상태를 반환하고 재활성화하지 않는다. 저장 직전 권한 회수는 403, revision
오버플로는 삽입까지 rollback하고 503이다. 본문은 33KiB, 정의 자체는 32KiB 상한이다.

`npm run typecheck`, 전체 `npm test` 144/144, 계약 검사 32/32,
OpenAPI lint, `git diff --check` 통과. 신규 발행 테스트 8개와 기존 실제 Miniflare
Worker 테스트를 확장해 발행·재시도·동시 요청·권한 회수·페이지·전송 상한·rollback을
확인했다. 초기 관련 테스트 7/8은 예전 시도 ID를 재사용한 합성 데이터 오류였고 새
시도 ID로 수정했다. 초기 전체 143/144는 기존 테스트의 Allow: GET 기대값이 새
GET, PUT 계약과 달라서 수정했고 최종 144/144를 통과했다.

변경한 source of truth는 `api/openapi.yaml`, `docs/product/02-spec.md`다.
이벤트·관리자 문서와 로드맵을 갱신했다. DB 스키마·마이그레이션·의존성·CI·러너·
저장소 위생 정책은 바꾸지 않았다. UI 변경이 없어 브라우저 UI 검증을 생략했고,
SDK 소스/빌드 경계를 바꾸지 않아 이전 브라우저 크기 검증을 재사용했다.
실제 OIDC 제공자·원격 DB·운영 배포 smoke는 운영 설정이 없어 실행하지 않았다.
스키마 편집 화면은 다음 작업이며 푸시·배포·Sembom 연동은 하지 않았다.

## 2026-10-09 관리자 스키마 API·초안 상태 관리

프로토타입 ApiClient에 버전 목록 GET·초안 검증 POST·버전 발행 PUT과 응답 검증을
추가했다. 발행 응답의 프로젝트·버전·canonical 정의 hash를 요청과 비교한다.
SchemaEditor는 변경 시 검증·개인정보 검토 확인을 취소하고 reader 쓰기를 막는다.
409·403·응답 유실 시 초안을 보존하고 자동 재전송 없이 서버를 재조회한다.
이미 저장된 대상 정의가 제출 내용과 일치할 때만 발행 완료로 확인한다.
프로젝트 생명주기가 끝나면 요청을 중단하고 늦은 응답을 무시한다.

관리자 `npm run typecheck`, `npm test` 45/45, `git diff --check` 통과.
추가한 테스트 7개가 보호된 POST/PUT 전송·변경 후 재검증·충돌 검토·응답 유실 복구·
reader/권한 회수·늦은 응답 취소·잘못된 응답 거부를 확인했다. 관리자 test 명령에
새 테스트 파일을 추가했으며 의존성·CI·API·DB·위생 정책은 변경하지 않았다.
프론트엔드 source of truth `docs/frontend/FRONTEND_DESIGN.md`를 갱신했다.
UI는 다음 슬라이스라 브라우저·빌드 검증을 아직 실행하지 않았다. 운영 인증·
배포·Sembom 연동·푸시는 실행하지 않았다.

## 2026-10-09 관리자 스키마 편집·검증·발행 화면

API 연결 모드의 설정 아래 LiveSchemas를 연결했다. 버전 목록과 이전 버전 조회,
명시적 버전 불러오기, 새 번호·JSON 초안 편집, 서버 검증 오류 pointer·포커스,
개인정보 검토 확인, 검증된 초안 발행을 제공한다. reader textarea는 조회·복사가
가능한 readOnly이며 수정·검증·발행은 잠긴다. 충돌·응답 유실 후 서버 상태를 읽고
최신 정의와 초안을 비교한 뒤 명시적으로 선택한다. 비교는 모바일에서 세로 배치한다.

UI·메시지 변경 후 관리자 전체 테스트를 다시 실행해 45/45 통과했다. 관련 스키마 테스트 7/7,
`npm run typecheck`, `npm run build`, `npm run test:sites` 4/4,
`git diff --check`를 통과했다. 빌드의 기존 메인 청크 크기 경고는 남으며
695.19kB/gzip 201.63kB였다. 일반 lint 명령은 프로젝트에 없어서 실행하지 않았다.

기존 127.0.0.1:5180 Vite에 도구가 소유한 격리된 메모리 Miniflare/D1 수집기를
5188로 연결해 인앱 브라우저에서 오류·실제 v2 발행·409·비교/초안 유지 후 재검증을
확인했다. 저장 후 HTTP 응답을 끊은 v4 발행은 자동 재전송 없이 대상 버전 재조회로
복구했고 초안은 유지됐다. owner를 reader로 바꾼 뒤 readOnly/disabled를 확인했다.
잘못된 초안의 검증 오류에서는 schema-draft로 포커스가 이동했다. 실제 CSS viewport
320px에서 문서 clientWidth와 scrollWidth가 모두 303px로 페이지 가로 넘침이 없었다.
뷰포트 조정은 확인 후 해제했다. 화면 증거는 `.tmp/schema-editor-conflict.png`와
`.tmp/schema-editor-mobile.png`다. 합성 프로젝트와 not-a-credential 검증기 포트만
사용했으며 실제 서비스 데이터·자격 증명은 사용하지 않았다.
테스트 수집기를 종료하고 5188 포트에 리스너가 없음을 확인했다. 브라우저의 테스트
연결도 해제해 메모리 토큰을 지우고 Sample 모드로 복귀했다.

변경한 source of truth는 `docs/frontend/FRONTEND_DESIGN.md`,
`docs/product/02-spec.md`다. 프로토타입 README·로드맵·검증 기록을 갱신했다.
API·DB·마이그레이션·의존성·CI·위생 정책은 변경하지 않았다. 서버/SDK 변경이 없어
백엔드·SDK 크기 검사 결과는 재사용했다. 실제 OIDC 제공자·운영 저장·원격 배포·
전체 접근성 감사는 이번 범위 밖이라 실행하지 않았다. 푸시·배포·Sembom 연동은 없다.

## 2026-10-09 프로젝트 생성 저장·명시적 생성 권한

코어 생성 입력 검증·D1 원자 생성과 0003 마이그레이션을 추가했다. 프로젝트 설정·
최초 owner·불변 생성 요청 해시를 함께 저장한다. 기존 owner에게 생성 권한을 자동으로
주지 않으며 creator-grant/revoke CLI가 issuer/subject별 한도를 관리한다. 생성 이력은
권한 회수 뒤에도 유지한다. 아직 HTTP 생성 경로는 연결하지 않았다.

관련 저장·CLI 테스트 13/13, 루트 타입 검사와 계약 검사 32/32를 통과했다.
동시 생성·개수 한도·설정 변경 후 재요청·서로 다른 생성자·권한 회수·중간 실패 rollback을
실제 로컬 Miniflare D1에서 확인했다. CLI 실행 경로에 생성 권한 미리보기·적용·회수를
추가한 뒤 CLI 테스트 6/6도 통과했다. DBML·제품 명세·마이그레이션/등록 안내를 갱신했다. 의존성·CI·
위생 정책·운영 인증·원격 마이그레이션·푸시·배포·Sembom 연동은 변경/실행하지 않았다.

## 2026-10-09 프로젝트 생성 HTTP API

`POST /v1/projects`를 별도 creator 권한에 연결했다. 본문을 읽기 전에 인증·생성 권한을
확인하고 INSERT에서 권한·개수 한도를 다시 검사한다. ID·이름·IANA 시간대·허용 origin·
명시적 한도만 받으며 owner·status·스키마를 지정할 수 없다. 생성과 최초 owner 부여는
원자적이며 새 프로젝트에는 스키마가 없다. 첫 스키마를 기존 PUT으로 발행할 수 있다.
최초·동일 재요청은 200의 불변 생성 결과이고 설정을 덮어쓰거나 grant를 복원하지 않는다.
ID/원본 내용 충돌과 생성 개수 한도를 서로 다른 409 코드로 반환한다.

루트 `npm run typecheck`, 전체 `npm test` 156/156, 계약 검사 34/34와 OpenAPI lint가
통과했다. 관리자/생성 API 관련 14/14에서 본문·미디어·쿼리·인증·권한·한도·재요청·
첫 스키마 발행을 확인했고 실제 Worker/Miniflare smoke에서 생성·재요청·버전 목록을
확인했다. 전체 테스트 뒤 기존 DB 업그레이드 테스트를 추가했고 관련 저장 테스트 8/8도
통과했다. 추가 테스트를 포함한 전체 157개는 재실행하지 않았다. 업그레이드는 기존
프로젝트·스키마를 보존하고 생성 권한/이력을 backfill하지 않음을 확인했다.

변경한 source of truth는 `api/openapi.yaml`, `docs/product/02-spec.md`다. 앞 슬라이스에서
`db/schema.dbml`·0003 마이그레이션을 추가했고 이번에는 권한·API 정책·이벤트 계약·
로드맵·검증 기록을 맞췄다. `git diff --check`를 통과했다. UI·브라우저 SDK·의존성·CI·
러너·위생 정책은 변경하지 않았다. UI/SDK 변경이 없어 UI 빌드·브라우저 화면·SDK 크기
검사는 재실행하지 않았다. 운영 설정이 없어 실제 OIDC 제공자·원격 0003 적용·배포 smoke는
실행하지 않았다. 푸시·배포·Sembom 연동은 하지 않았고 프로젝트 추가 화면이 다음 단계다.

## 아직 실행하지 않음

## 2026-10-09 프로젝트 생성 클라이언트·상태 관리

관리자 ApiClient에 프로젝트 생성 POST·응답 검증과 project_conflict/project_limit_reached
오류 분류를 추가했다. ProjectCreator는 메모리 입력·동시 제출 차단·명시적 생성 확인·
설정 조회 재시도·취소를 제공한다. 생성 해시는 실제 코어 함수와 비교했다.
관리자 npm test 52/52·typecheck·git diff --check 통과. 새 테스트 7개가 응답 유실·
권한/한도/ID 충돌·잘못된 응답·입력·지연 응답·설정 GET 실패를 확인했다.
frontend 설계를 갱신했으며 프로토타입 test 명령에 해당 테스트만 추가했다.
API·DB·의존성·CI·위생 정책은 변경하지 않았다. UI는 다음 슬라이스라 UI build와
브라우저 검증은 아직 실행하지 않았고 운영 인증·배포·Sembom 연동·푸시는 하지 않았다.

## 아직 실행하지 않음
- 실제 서비스의 SDK 초기 실행 비용·지연·처리량, 모바일·원격 배포
- 서버 발행 수집과 실제 인증 제공자 연결, 운영 관리자 조회 배포(로컬 grant 강제는 관리자 테스트로 확인)
- 원격 D1 마이그레이션과 운영 smoke
- 원격 만료 정리 예약 등록과 운영 Worker·도메인·인증 제공자
- 쓰기 처리량·지연 성능 측정

서술(prose) 테스트는 작성하지 않는다.

## 2026-10-09 프로젝트 추가·스키마·SDK 온보딩 화면

API 연결 도구모음에서 프로젝트 추가 화면을 열고 이름·공개 ID·IANA 시간대·허용 출처와
접힌 수집 한도를 입력한다. 생성 후 목록에 추가·선택하고 설정 화면의 프로젝트 →
스키마 → SDK 안내로 이동한다. 403·ID 충돌은 입력을 보존하고, 응답 유실은 원본 입력을
잠근 뒤 명시적인 같은 요청 확인만 허용한다. SDK 안내는 최신 발행 스키마의 브라우저
정의만 투영하며 수집 서버 출처를 직접 입력받고 관리자 토큰·서버 이벤트를 제외한다.

관리자 `npm test` 53/53, `npm run typecheck`, `npm run build`,
`npm run test:sites` 4/4를 통과했다. URL 오류 문구 보완과 불필요한 방어 분기 제거 뒤
관련 생성·SDK 테스트 8/8을 다시 통과했다. 기존 메인 청크 크기 경고는 남으며
713.10kB/gzip 206.09kB였다. 일반 lint 명령은 없어 실행하지 않았다.

127.0.0.1:5180 관리자와 5188 격리 메모리 Miniflare/D1 수집기를 연결해 인앱 브라우저에서
정상 생성·403 입력 보존·409 ID 포커스·저장 후 응답 유실과 동일 요청 복구를 확인했다.
생성 기록은 ui-created/ui-normal 두 건이며 재확인으로 중복 생성되지 않았다.
첫 스키마를 v2로 검증·발행해 도구모음 버전과 SDK 안내가 v2로 갱신되는 것을 확인했다.
서버 이벤트가 섞인 정의에서는 브라우저 코드에 서버 이벤트가 없었고 코드 복사도 성공했다.
서버 이벤트만 있는 초안은 기존 서버 검증이 /events 오류로 거부했다.
실제 CSS viewport 320px에서 문서 clientWidth/scrollWidth는 모두 303px로 생성 폼의
페이지 가로 넘침이 없었다. 임시 뷰포트 설정은 해제했다. 화면 증거는
`.tmp/project-create-sdk.png`, `.tmp/project-create-mobile.png`, `.tmp/project-created.png`다.

테스트 연결을 해제하고 Sample 모드로 복귀했다. 테스트 수집기를 종료하고 5188 포트에
리스너가 없음을 확인했다. 합성 데이터와 not-a-credential 검증기 포트만 사용했다.
API·DB·마이그레이션·의존성·CI·러너·위생 정책은 변경하지 않았다.
변경한 source of truth는 `docs/frontend/FRONTEND_DESIGN.md`, `docs/product/02-spec.md`이며
프로토타입 README와 로드맵도 갱신했다. `git diff --check`를 통과했다.
백엔드·브라우저 SDK 소스는 바뀌지 않아 해당
검증과 SDK 크기 측정은 반복하지 않았다. 실제 OIDC 제공자·운영 DB·원격 배포·전체 접근성
감사는 이번 범위 밖이며 실행하지 않았다. Sembom 연동·푸시·배포는 하지 않았다.

## 2026-10-09 관리자 이벤트 기본 정보 편집 폼

설정의 스키마 섹션에 이벤트 추가·삭제·이름·표시 이름·발행 출처 폼을 연결했다.
폼과 접힌 JSON 직접 편집은 SchemaEditor 초안 하나를 공유하고, 변경 시 검증과
개인정보 검토 확인을 취소한다. 이벤트 속성·작업 흐름·추가 키를 그대로 보존한다.
연결된 작업 흐름의 이름 참조를 끊지 않도록 해당 이벤트의 이름·출처·삭제는 잠그고
표시 이름만 수정한다. 표현 불가·잘못된 JSON은 대체하지 않고 직접 편집으로 안내한다.
속성·작업 흐름 폼은 다음 슬라이스다.

관리자 `npm test` 57/57, `npm run typecheck`, `npm run build`,
`npm run test:sites` 4/4를 통과했다. 폼 보존·참조 보호·한도·오류 초점·검증 무효화와
reader/충돌 잠금 테스트를 추가했다. 충돌 상태의 폼 편집 차단 검증을 보강한 뒤
관련 스키마 테스트 11/11을 재실행했다. 다른 입력이 바뀌지 않은 테스트는 재사용했다.
기존 메인 청크 크기 경고는 남으며 720.22kB/gzip 207.86kB다.

5180 관리자와 5188 격리 메모리 수집기를 연결해 인앱 브라우저에서 기존 스키마를
폼으로 읽고, 작업 흐름 참조 보호·추가/삭제 후 포커스·속성/흐름 보존·JSON 동기화를
확인했다. 폼으로 새 이벤트를 추가해 v2를 발행하고 다시 불러왔다. 폼 변경 후 이전
개인정보 확인만으로 발행할 수 없음을 확인했다. 중복 이름 오류는 해당 폼 입력으로,
속성 오류는 JSON을 펼쳐 textarea로 포커스가 이동했다. 잘못된 JSON `{`도 그대로
보존됐다. 빈 프로젝트에서 첫 이벤트를 추가하고 마지막 이벤트 삭제 후 추가 버튼으로
포커스가 이동함을 확인한 뒤 폼으로 첫 v1을 발행했다. reader 검증기에서는 폼의 이름·
표시 이름이 readOnly이며 출처·추가·삭제·검증 버튼이 disabled였다.
실제 CSS viewport 320px에서 문서 clientWidth/scrollWidth가 모두 303px로 가로 넘침이
없었다. 임시 뷰포트는 해제했다. 화면 증거는 `.tmp/event-form.png`,
`.tmp/event-form-mobile.png`다. 테스트 연결을 해제하고 Sample로 복귀했으며 격리
수집기를 종료해 5188에 리스너가 없음을 확인했다.

`docs/frontend/FRONTEND_DESIGN.md`·`docs/product/02-spec.md`와 로드맵·README를 갱신했다.
API·DB·마이그레이션·의존성·CI·러너·위생 정책은 변경하지 않았다. 테스트 명령도 기존
파일에 테스트를 추가해 유지했다. lint 명령은 없고, 운영 인증·운영 DB·원격 배포·전체
접근성 감사는 범위 밖이라 실행하지 않았다. 백엔드·SDK 소스가 바뀌지 않아 해당 검증과
SDK 크기 검사는 재사용했다. 푸시·배포·Sembom 연동은 하지 않았다.

## 2026-10-09 이벤트 속성 편집 폼

각 이벤트의 접힌 속성 폼에서 추가·삭제·이름·자료형·필수 여부·수집 목적과 선택값·정수
범위를 편집한다. 이벤트마다 최대 4개 속성, 속성별 32종·이벤트 조합 256개 규칙을 안내한다.
자료형 전환은 이전 자료형의 전용 필드만 대체하며 목적·필수 여부·추가 키를 보존한다.
중복 이름은 다른 속성을 덮어쓰지 않고 거부한다. 빈 정수 칸·불완전 숫자·중복 선택값을
자동으로 수정하지 않고 초안에 남긴다. 작업 흐름의 dimensions 속성은 목적만 수정한다.
폼 변경은 기존 초안·승인 무효화·권한·충돌 잠금을 공유하며 미지원 정의는 JSON으로 안내한다.

관리자 `npm test` 62/62, `npm run typecheck`, `npm run build`,
`npm run test:sites` 4/4를 통과했다. 5개 속성 테스트는 보존·중복 이름·자료형 전환·
숫자/선택값 원문·dimension 잠금·한도·실제 코어 검증·발행 승인 무효화를 확인한다.
브라우저에서 확인한 실제 조합 오류 pointer(`/events/0/properties`)의 초점을 보완한 뒤
관련 스키마 테스트 16/16을 다시 통과했다. 변경 없는 나머지 테스트 결과는 재사용했다.
기존 메인 청크 크기 경고는 남으며 730.97kB/gzip 210.81kB다.

5180 관리자와 5188 격리 메모리 수집기를 연결해 브라우저에서 속성 추가·삭제 포커스,
dimension 이름/자료형/허용값 잠금과 목적 편집, 중복 속성 이름 거부를 확인했다.
빈 최솟값은 문자열 그대로 초안에 남고 해당 입력으로 오류 초점이 이동했다. 선택값 중복도
초안에 그대로 남고 허용값 textarea로 초점이 이동했다. 조합 수 초과는 속성 폼의 안내로
초점이 이동했다. 수정 후 재검증·개인정보 확인을 거쳐 속성을 포함한 v2를 실제 발행했다.
수집 목적을 바꾸면 이전 승인만으로 발행할 수 없음을 확인했다. reader는 이름·목적·허용값이
readOnly이고 자료형·추가·삭제는 disabled였다. 실제 CSS viewport 320px에서 문서
clientWidth/scrollWidth가 모두 303px로 가로 넘침이 없었고 뷰포트 설정은 해제했다.
화면 증거는 `.tmp/property-form.png`, `.tmp/property-form-mobile.png`다.
연결을 해제하고 Sample로 복귀했으며 격리 수집기 종료 후 5188 리스너 0개를 확인했다.

`docs/frontend/FRONTEND_DESIGN.md`·`docs/product/02-spec.md`와 로드맵·README를 갱신했다.
API·DB·마이그레이션·의존성·CI·러너·위생·테스트 명령은 변경하지 않았다.
lint 명령은 없고, 운영 인증·DB·배포와 전체 접근성 감사는 범위 밖이라 실행하지 않았다.
백엔드·SDK 소스가 바뀌지 않아 해당 검사와 SDK 크기 결과는 재사용했다.
푸시·배포·Sembom 연동은 하지 않았다. 작업 흐름 폼은 다음 단계다.

## 2026-10-09 작업 흐름 편집 폼

설정의 이벤트 폼 아래에 작업 흐름 추가·삭제·ID·표시 이름·시작·성공·실패 이벤트와
비교 기준 속성 폼을 연결했다. browser 이벤트만 선택하며 null 실패와 빈 문자열을
구분한다. 흐름 최대 10개, 비교 기준 최대 4개 규칙을 안내하고 단계 중복·필수 속성
자료형/허용 값 불일치는 실시간 경고로 표시한다. 최종 검증은 기존 서버가 수행한다.
폼과 JSON은 같은 초안을 공유하며 변경 시 검증·개인정보 확인을 초기화한다. 미지원
구조·추가 키·미완성 선택은 자동 수정하지 않는다. 중복 ID는 덮어쓰지 않고 거부한다.

관리자 npm test 67/67(스키마 관련 21/21), npm run typecheck, npm run build,
npm run test:sites 4/4를 통과했다. 새 테스트 5개는 보존·중복 ID·단계 참조/중복·
비교 기준 일치·이벤트/속성 잠금 갱신·한도·초점 대상·실제 코어 검증·승인 초기화와
reader/review/more 잠금을 확인한다. 실패 select 예약 값과 원문 문자열의 충돌을
보완한 뒤 타입 검사와 빌드를 다시 통과했다. 변경 없는 테스트 결과는 재사용했다.
기존 메인 청크 경고는 남으며 최종 743.14kB/gzip 213.39kB다.

5180 관리자와 5188 격리 메모리 Miniflare/D1 수집기를 연결해 브라우저에서 흐름 추가·
삭제 후 초점 이동, 중복 ID 거부, 중복 단계 서버 오류의 select 초점, 비교 기준 불일치
경고와 서버 오류의 비교 기준 그룹 초점을 확인했다. 비교 기준 해제 후 해당 속성 잠금이
풀렸고, 편집 후 개인정보 확인과 발행 가능 상태가 초기화됐다. 두 흐름과 선택한 실패
이벤트를 포함한 v2를 검증·발행·다시 불러와 확인했다. reader에서는 ID·표시 이름이
readOnly, 단계 선택·비교 기준·추가·삭제가 disabled였다. 실제 CSS viewport 320px에서
문서 clientWidth/scrollWidth는 모두 303px였다. 뷰포트 설정을 해제했다. 화면 증거는
.tmp/workflow-form.png와 .tmp/workflow-form-mobile.png다. 테스트 연결을 끊고 Sample로
복귀했으며 수집기를 종료해 5188 리스너 0개를 확인했다. 합성 정의와 기존 테스트 검증기만
사용했다. 브라우저 제어 일부 입력 지연은 기본 브라우저 API로 확인을 마쳤다.

source of truth인 docs/frontend/FRONTEND_DESIGN.md·docs/product/02-spec.md와
로드맵·프로토타입 README·이 검증 기록을 갱신했다. API·DB·마이그레이션·의존성·
CI·러너·위생 정책·테스트 명령 변경은 없다. git diff --check를 통과했다.
lint 명령은 없어 생략했다. 백엔드·SDK 소스가 바뀌지 않아 해당 검사와 SDK 크기 검사는
반복하지 않았다. 실제 운영 인증·DB·배포·전체 접근성 감사는 범위 밖이라 실행하지 않았다.
푸시·배포·Sembom 연동은 하지 않았다.

## 2026-10-09 이벤트 속성별 분석

API 연결 모드에서 groupBy 직접 입력을 선택한 이벤트의 등록 속성 목록으로 바꿨다.
속성 값별 기간 합계·비중과 선택한 값 하나의 일별 추이·수치 표를 연결했다. 비중은
선택한 이벤트의 전체 건수가 분모이며, 표시값은 소수점 한 자리로 반올림한다.
null·false·숫자 0을 구분하고 분모가 없으면 비중을 알 수 없음으로 표시한다.
프로젝트·스키마 버전·이벤트가 바뀌면 분류 기준을 해제한다. 등록되지 않은 속성은
요청하지 않고, 응답 키와 요청 취소로 이전 조건의 데이터가 현재 화면에 섞이지 않게 한다.
응답의 전체 날짜·버킷 중복·정의에 맞는 값·안전 정수·일별/전체 합계를 확인한 뒤 표시한다.

관리자 npm test 70/70, npm run typecheck, npm run build, npm run test:sites 4/4와
git diff --check를 통과했다. 새 테스트 3개는 선택 범위 격리, 합계·비중·일별 값과
null/false/0 구분, 누락·중복·잘못된 값/합계 거부를 확인한다. 관련 client 테스트는
26/26이다. 선택 컴포넌트의 표시를 보완한 뒤 타입 검사와 빌드를 다시 통과했다.
변경 없는 테스트 결과는 재사용했다. 메인 청크 748.38kB/gzip 215.08kB로 기존
500kB 청크 경고는 남는다.

5180 관리자와 5188 격리 메모리 Miniflare/D1 수집기를 reader 검증기로 연결했다.
합성 tool_view 27건의 loan 12·grade 10·timer 5와 44.4%·37.0%·18.5%, 합계100.0%를
확인했다. 값 선택과 Enter 키 조작으로 일별 그래프·수치가 바뀌었으며 grade는 전날10건,
다른 날짜0건이었다. 이벤트 전환 시 분류 기준이 해제되고 error 속성의 값 없음3/6=50.0%를
확인했다. v2에서는 tool_view의 flag만 선택 가능하고 데이터가 없어 알 수 없음으로 표시했다.
잘못된 테스트 dimension_key로 수집기가503을 반환했을 때 기존 결과/0으로 위장하지 않고
오류를 표시했다. 테스트 키를 코어 dimensionKey 형식으로 수정한 뒤 재조회가 성공했다.
실제 CSS viewport320px에서 문서 clientWidth/scrollWidth는 모두303px, 선택 목록 너비는
221.33px였다. 뷰포트 설정을 해제하고 연결을 끊어 Sample로 복귀했다. 테스트 수집기 종료
후5188 리스너0개를 확인했다. 화면 증거는 .tmp/event-property-analysis.png와
.tmp/event-property-analysis-mobile.png다. 실제 Sembom 서비스 데이터나 설정은 사용하지 않았다.

source of truth인 docs/frontend/FRONTEND_DESIGN.md·docs/product/02-spec.md와 로드맵·
프로토타입 README·이 검증 기록을 갱신했다. API·DB·마이그레이션·의존성·CI·러너·
위생 정책·테스트 명령 변경은 없다. lint는 명령이 없어 생략했고, 백엔드·SDK 검증과
SDK 크기 검사는 해당 소스가 바뀌지 않아 반복하지 않았다. 운영 인증·DB·배포·전체
접근성 감사는 이번 범위 밖이다. 푸시·배포·Sembom 연동은 하지 않았다.

## 2026-10-10 직전 기간 비교

관리자 API 연결 모드의 개요·이벤트 분석·목표에 선택적인 직전 기간 비교를 추가했다.
프로젝트 시간대의 최근 7·14·30일(오늘 포함)과 바로 앞 같은 일수를 같은 스키마로
조회한다. 기존 summary·workflow daily를 각 기간별로 호출해 31일 한도를 지킨다.
기본은 꺼짐이며 켰을 때만 이전 기간 요청을 추가한다. 현재·이전 응답의 메타·등록
이벤트·중복·안전 정수·일별 날짜·합계·완료율 일관성을 검사하고, 조회 키와 취소로
조건이 다른 데이터 혼입을 막는다. 비교 실패는 현재 결과와 분리해 재시도한다.

관리자 npm test 73/73, npm run typecheck, npm run build, npm run test:sites 4/4를
통과했다. 새 테스트 3개는 월·연도·윤년 경계의 동일 길이, 0건·null 완료율 처리,
누락·중복·잘못된 합계·날짜·시간대·흐름 응답 거부, 기존 API·버전·취소 신호 전달과
실패·취소 전파를 확인한다. 메인 청크 754.73kB/gzip 216.87kB로 기존 500kB 경고는
남는다. UI·문서 초안은 지정 DeepSeek 4.1 Flash high의 문구를 검토해 반영했다.

기존 5180 관리자와 5188 격리 메모리 Miniflare/D1 테스트 수집기를 reader로 연결했다.
7일 비교에서 이벤트 69/16=+331.3%, 시작20/10=+100.0%, 성공16/6=+166.7%,
완료율80%/60%=+20.0%p를 확인했다. 이전 기간 요청만503으로 실패시켜 현재
69·20·16·80%가 유지되는 것을 확인하고 비교 재시도로 복구했다. 30일 이전0건은
증감률 계산 불가, null 완료율은 비교 불가였다. 14일/v2로 바꾼 뒤0건·null 결과가
표시돼 v1의 수치가 남지 않았다. 이벤트별 비교 표와 목표별 비교, 비교 해제 시 표 제거도 확인했다. 오늘 집계 중과 확정 전
코호트 안내, 키보드 접근 가능한 표의 내부 가로 스크롤을 확인했다.
모바일 너비320px 설정을 요청했지만 이 브라우저는 실제 innerWidth356px,
문서 clientWidth/scrollWidth339px로 렌더링했다. 실제339px에서 본문 가로 넘침은
없었으며 정확한320px 확인으로 기록하지 않는다. 화면 증거는 .tmp/period-comparison-mobile.png다.

테스트 연결을 끊고 Sample로 복귀했으며 뷰포트 설정을 해제했다. 테스트 수집기를 종료해5188 리스너0개를 확인했다. 제품 명세·프론트엔드 설계(source of truth)와 로드맵·프로토타입 README를 갱신했다.
API·DB·마이그레이션·SDK·의존성·위생 정책·CI·러너·테스트 명령 변경은 없다.
lint 명령은 없어 생략했다. 백엔드·SDK 검증은 소스가 바뀌지 않아 반복하지 않았고,
운영 인증·DB·배포·전체 접근성 감사는 범위 밖이다. 푸시·배포·Sembom 연동은 없다.

## 2026-10-10 CSV 내보내기

관리자 API 연결 모드의 개요·이벤트 분석·목표에 CSV 내려받기를 추가했다.
현재 조회 키에 묶인 검증 데이터만 클릭 시 내보내고 추가 조회는 하지 않는다.
기간·스키마·시간대·검색·선택 이벤트·분류 조건을 각 행에 기록한다. 현재/직전/비교와
합계/일별/속성/흐름/비교 지표를 구분하고 화면과 CSV가 같은 비교 행 생성기를 쓴다.
숫자 원값과 null/false/0/문자열 타입을 구분하며 지원하지 않는 서버 집계와 계산
불가 값을0으로 채우지 않는다. 활성 비교나 선택 상세가 미완료/오류면 잠근다.
UTF-8 BOM·CRLF·따옴표 이스케이프를 적용하고 위험한 시작 문자의 텍스트에
작은따옴표를 추가한다. 숫자 음수는 원값으로 둔다. 링크와 Blob URL은 정리한다.

관리자 npm test 77/77, npm run typecheck, npm run build, npm run test:sites 4/4,
git diff --check를 통과했다. CSV 테스트4개는 한글/쉼표/따옴표/줄바꿈/수식 시작
문자·전각 문자, 0/null/false와 음수, 고정 열/파일명/조회 메타, 검색 조건/모든 관찰
속성 값/일별 행, 활성 비교/흐름 수치와 미지원/빈 값, 오래된 프로젝트·버전·시간대·
범위·출처·coverage·그룹 응답의 거부를 확인한다. 메타 검사 보완 뒤 테스트·타입·빌드를
재검증했고 변경 없는 Sites 검사 결과는 재사용했다. 메인 청크760.45kB/gzip218.99kB로
기존500kB 경고는 남는다. 지정 DeepSeek 4.1 Flash high 문구 초안을 검토해 반영했다.

기존5180 관리자와5188 격리 메모리 Miniflare/D1 수집기를 reader로 연결했다.
목표 CSV22행과 검색tool/선택tool_view/분류tool의 이벤트 CSV43행을 실제 다운로드했다.
파일의 EF-BB-BF BOM, 같은 프로젝트·버전·날짜·검색·분류, 비교69/16과331.25%,
80/60과20 percentage_point, 속성loan12·grade10·timer5와 비중을 Import-Csv로 확인했다.
CDP에서 다운로드 전후 새 Network.requestWillBeSent 이벤트가0개였다. 비교 조회만503으로
실패시켰을 때 버튼이 잠겼고 비교를 끄면 풀렸다. 잘못된 스키마에서도 잠겼다.
화면 증거는 .tmp/csv-export.png다. 테스트 연결을 끊고 Sample로 복귀했으며 수집기를
종료했다. 실제 서비스 데이터·인증·Sembom 설치·연동은 사용하지 않았다.

제품 명세 docs/product/02-spec.md와 프론트엔드 설계 docs/frontend/FRONTEND_DESIGN.md
(source of truth), 로드맵·프로토타입 README를 갱신했다. API·DB·마이그레이션·SDK·
의존성·위생 정책·CI·러너·테스트 명령 변경은 없다. lint는 명령이 없어 생략했다.
백엔드/SDK 검증은 해당 소스가 바뀌지 않아 반복하지 않았고 운영 배포·전체 접근성 감사·
스프레드시트 앱에서 재저장/재열기는 범위 밖이라 미검증이다. CSV 수식 방어가 모든 앱과
재저장까지 보편적으로 보장되지는 않으며 참고 근거는 프론트엔드 설계에 기록했다.
푸시·배포·Sembom 연동은 하지 않았다.

## 2026-10-10 작업 흐름 속성별 조회 API

GET /v1/projects/{projectId}/workflows/{workflowId}/breakdown?groupBy={dimension}을 추가했다.
등록된 필수 workflow.dimensions 한 속성의 시작 시점 차원 키를 사용하고 같은 값의
다른 차원 조합을 합산한다. 응답 summary와 최대32개 typed bucket별 summary·31일
days를 제공한다. 성공/시작으로 완료율을 계산하며0시도는 null, 빈 결과는 buckets=[]다.
기존 daily 응답과 DB는 그대로다. 기존 reader/owner grant를 정의·집계와 같은 D1 batch
에서 다시 검사한다. 원본7936행 상한을 넘거나 차원/집계가 손상되면503으로 실패한다.

관리자 API 테스트12/12(실제 Worker/D1 runtime 포함)를 통과했다. 이후 다른 차원 합산/
실패 수 유지 테스트를 추가하고 관련5/5를 통과했다. 변경 없는 나머지 관리자 테스트는
재사용했다. 코어·D1 저장·수집기 회귀72/72와 루트 npm run typecheck를 통과했다.
OpenAPI는 처음 시도한 Node yaml/Python yaml 모듈이 없어 해당 명령은 실패했으나
설치된 Bun.YAML.parse로 새 경로/스키마를 확인했다. git diff --check를 통과했다.
새 OpenAPI 응답 예제와 관리자 API 문서·제품 명세를 갱신했다. 프론트 연결은 다음 커밋이다.

API 계약(OpenAPI)과 core QueryKind를 확장했다. DB·마이그레이션·SDK·의존성·위생·
CI·러너는 변경하지 않았다. lint 명령은 없어 생략했다. 운영 인증/원격 DB/배포는
범위 밖이라 실행하지 않았다. 푸시·배포·Sembom 연동은 없다.

## 2026-10-10 작업 흐름 속성별 완료율 화면·CSV

관리자 API 연결 모드의 목표에 등록된 시작 시점 비교 속성 선택과 값별 시작·성공·
실패·대기·완료율·선택 값의 일별 내역을 연결했다. 기본은 분류 안 함이며 선택 때만
조회한다. 메타·등록 값·자료형·중복·일별 날짜/합계·버킷 합계·성공/시작 완료율을
검사한다. 전체 목표와 속성 응답은 조회 시각이 다를 수 있어 값을 억지로 맞추지 않는다.
부모의 조회 키와 취소로 조건이 다른 응답을 버리고 오류는 전체 목표와 분리한다.
CSV는 workflow_property_summary/total/day 행으로 선택 분류·모든 값·일별 수치를
보존하고 빈 결과의 분류도 summary 행에 남긴다. 오류/미완료 분류에서는 CSV를 잠근다.
속성별 직전 기간 비교는 아직 없다.

관리자 npm test81/81, npm run typecheck, npm run build, npm run test:sites4/4,
git diff --check를 통과했다. 새로운4개 테스트는 weighted 완료율·false/0·빈 결과,
메타/정의/값/날짜/중복/합계/정밀도/완료율 오류 거부, CSV의 모든 값/일별/빈 분류와
오래된 응답 거부, 새로운 API 전송과 echo/자료형 검증을 확인한다. 초기 신호 identity/
완료 후 취소 가정이 실제 클라이언트의 조합 신호·리스너 정리와 달라 테스트가 실패했다.
기존 취소 테스트는 유지하고 새 전송 테스트의 잘못된 가정을 수정해81/81을 통과했다.
변경 없는 타입·빌드·Sites 결과는 재사용했다. 메인 청크769.38kB/gzip221.00kB로
기존500kB 경고는 남는다. 지정 DeepSeek4.1 Flash high 문구 초안을 검토해 반영했다.

기존5180 관리자와5188 격리 메모리 Miniflare/D1 수집기를 reader로 연결했다.
loan20/16=80%, grade3/1=33.3%, timer2/0=0%와 전체17/25=68%를 확인했다.
grade 값 버튼으로7일 내역을 열어0시도 날짜의 완료율—와 집계 중 표시를 확인했다.
실제 CSV 다운로드 후 Import-Csv로 세 값의 수치·tool 분류와21개 일별 행을 확인했다.
속성 조회만503으로 실패시켜 전체68%는 유지되고 CSV는 잠기는 것을 확인했다.
별도 재시도로 복구해 CSV가 풀렸고 스키마v2 전환 시 분류가 해제되고 이전 값 표가
사라졌다. v2의 빈 분류 결과는 관찰 값 없음으로 표시되고 CSV는 활성화됐다.
화면 증거는 .tmp/workflow-property-analysis.png다. 연결을 끊고 Sample로 복귀했으며
테스트 수집기를 종료했다. 실제 Sembom 데이터/인증/설치는 사용하지 않았다.

제품 명세 docs/product/02-spec.md와 프론트엔드 설계 docs/frontend/FRONTEND_DESIGN.md
(source of truth), 로드맵·프로토타입 README를 갱신했다. 이전 커밋의 API 확장을
소비하고 이 커밋은 API·DB·마이그레이션·SDK·의존성·위생·CI·러너를 바꾸지 않는다.
관리자 test 명령은 src/api/*.test.mjs를 검색하도록 바꿔 새 테스트를 포함한다.
lint는 명령이 없어 생략했다. 백엔드는 이전 커밋에서 검증한 결과를 재사용했고,
운영 인증·원격 DB·배포·전체 접근성 감사는 범위 밖이다. 푸시·배포·Sembom 연동은 없다.

## 2026-10-10 수집 상태 진단

API 연결 설정 상단에 읽기 전용 진단을 추가했다. 기존 설정/스키마를 병렬 조회하고
선택 스키마를 읽은 뒤 프로젝트-local 오늘 요약을 조회한다. 프로젝트 전체 마지막
신규 수신과 오늘의 선택 스키마 browser 건수, 일시정지/중지 스키마와 설정 한도를
구분한다. 한도 사용량/잔여량·거부 이력은 만들지 않고 확인 순서를 별도로 제공한다.
서비스 주소는 탭 안에서 정확한 출처 목록과 비교하며 보내거나 저장하지 않는다.
각 조회의 부분 실패는 확인 불가, null 수신만 기록 없음으로 표시한다. 설정 저장과
프로젝트/버전 변경·명시적 갱신에 반응하며 자동 폴링/시험 이벤트는 없다. 키와 취소로
오래된 응답을 버리고 독립 조회를 원자 스냅샷으로 취급하지 않는다.

관리자 npm test 86/86, npm run typecheck, npm run build, npm run test:sites 4/4,
git diff --check를 통과했다. 새 테스트5개는 프로젝트-local 날짜·null/0·paused/retired,
부분 실패와 스키마 실패의 종속 조회 차단, 다른 프로젝트/버전/날짜/시간대·잘못된
시각/정의/합계/안전 정수 거부, 취소, 프로토콜/호스트/포트·경로·로그인 정보의 출처
판정을 검증한다. 최종 reader 안내 문구 변경 뒤 타입/빌드를 재검증했고 변경 없는
모델 테스트·Sites 결과는 재사용했다. 메인 청크778.29kB/gzip223.25kB이며 기존500kB
경고는 남는다. 지정 DeepSeek4.1 Flash high의 문서 초안을 검토해 반영했다. 앞선
두 초안은 출력 한도로 실용적 내용이 없어 사용하지 않았고 짧은 요청으로 다시 받았다.

기존5180 관리자에5188 격리 메모리 Miniflare/D1 reader로 연결했다. 시드된 오늘13건·
120회/100000건 한도와 신규 수신 기록 없음을 확인했다. 로컬 테스트 DB에서만 수신
시각·paused·retired 상태를 바꾸고 진단을 새로고침해 시각과 두 상태 안내를 확인했다.
이는 실제 수집 전송 테스트가 아닌 표시 검증이다. 출처 허용/불허, 없는v999의 조회
실패와 확인 불가 표시, v1 복귀의 복구를 확인했다. reader에게 소유자 요청 안내가
나오는 것도 확인했으며 콘솔 오류는 없었다. 증거는 .tmp/collection-diagnostics.png다.
연결을 끊어 Sample로 복귀했고 테스트 수집기를 종료해5188 리스너0개를 확인했다.

제품 명세 docs/product/02-spec.md와 프론트엔드 설계 docs/frontend/FRONTEND_DESIGN.md
(source of truth), 로드맵·프로토타입 README·이 검증 기록을 갱신했다. API·DB·마이그레이션·
SDK·의존성·위생 정책·CI·러너·검증 명령 변경은 없다. lint는 명령이 없어 생략했다.
백엔드/SDK 소스가 바뀌지 않아 해당 검증은 반복하지 않았다. 실제 운영 인증/원격 DB/
배포·전체 접근성 감사·모바일 실측·실제 거부 이력은 미검증이다. 푸시·배포·Sembom
연동은 하지 않았다.

## 2026-10-10 거부 원인 집계 저장 단계

기존 admission 카운터에 2KiB 이내 고정 원인별 count/lastRejectedAt JSON을 추가하는
0004 마이그레이션과 저장/조회 어댑터를 구현했다. 분당 초과는 admission SQL 한 개에
같이 반영하고 다른 원인은 기존 분의 단일 업데이트로 기록한다. 기록된 분만 최근
7개 UTC 날짜에 보존하며 기록 없는 분의 기존 2분 정리·호출당 삭제 한도를 유지한다.
조회는 UTC 수신일 기준이며 프로젝트 reader/owner grant를 같은 D1 batch에서 검사한다.
최대 10080분을 읽고 JSON/원인/시각/안전 정수/합계를 검사한다. 저장은 개인정보를
포함하지 않고 과거 거부를 채우지 않는다. HTTP 수집/조회 연결은 다음 커밋이다.

저장/기존 수집/등록 관련 테스트 첫 실행 28개 중 기존 23개와 신규 4개를 통과했고,
신규 집계 응답 테스트가 실패했다. closed 검증기의 필수/선택 키 사용을 수정한 뒤
신규 5/5를 통과했다. 변경 없는 기존 23개 결과는 재사용했다. 루트 npm run typecheck,
git diff --check를 통과했다. 실제 Miniflare에서 기존 카운터 보존·마이그레이션 preview/
apply/재실행과 새 DB 초기화, 분당 초과 SQL 1개 유지, 권한/다른 프로젝트 격리·UTC
날짜·빈 값·데이터 오류 거부·7일 보존과 삭제 한도를 확인했다. 지정 DeepSeek4.1 Flash
high의 문서 초안을 검토해 반영했다.

DB source of truth schema.dbml·0004 SQL·마이그레이션 설명·수집/정리 문서·이 기록을
갱신했다. API HTTP 계약·SDK·의존성·위생 정책·CI·러너·검증 명령은 변경하지 않는다.
로컬 초기화의 additive-column 감지를 확장했다. lint 명령은 없어 생략했고 HTTP/Worker
연결 검증은 다음 단계다. 원격 DB·운영 부하·배포는 미검증이며 푸시·배포·Sembom 연동은 없다.

## 2026-10-10 거부 원인 수집·관리자 조회 연결

GET /v1/projects/{projectId}/collection/rejections?from={UTC-date}&to={UTC-date}를 연결했다.
reader/owner는 스키마가 없거나 중지된 프로젝트도 조회하며 from/to는 오늘을 포함한
최근 7개 UTC 날짜 안에서 필수다. meta는 UTC/receivedAt/retentionDays=7/coverage=
best-effort, 전체 summary와 모든 날짜의 days, 고정 10개 reason/count/lastRejectedAt
버킷을 반환한다. 기록 수가0이면 시각은 null이고 날짜/권한/저장 손상 실패를0으로
채우지 않는다. 분당/일일 quota_exceeded는 minute_limit/daily_limit로 구분한다.

실제 수집기에서 admission 통과 뒤 발생한 거부만 추가 기록하며 분당 초과는 이미
기존 admission SQL에서 기록된다. 알려지지 않은 프로젝트·관리자 실패·admission DB
실패는 제외한다. 진단 저장은 Worker ctx.waitUntil에 묶고 그 포트가 없는 호스트는
await한다. 저장 실패는 원래 응답을 바꾸지 않고 재시도/원문 로그를 만들지 않는다.
정상 요청의 진단 기록 쓰기/DB 왕복은 추가하지 않는다. 같은 분의 카운터를 한도+1로
낮추는 기존 동작을601 포화로 보완하여 설정을 낮췄다가 올려도 카운터가 줄지 않고
허용/추가 기록 요청이 최대600개에 머물게 했다. 원문·Origin·IP·토큰·requestId는 진단
DB/응답에 없다. 응답 뒤 기록·진단 저장소 오류·과거 backfill 없음으로 누락될 수 있어
완전한 거부율이나 전달 증거로 쓰지 않는다. 프로토타입 화면 연결은 다음 슬라이스다.

루트 npm test171/171, npm run typecheck(생성 Worker 타입 포함), OpenAPI의 Bun.YAML
파싱·새 경로와 응답 예제 버킷/합계 확인, git diff --check를 통과했다. 새 HTTP 테스트
4개는 실제 거부 요청과 분당/일일 구분·Retry-After·응답/DB 원문 비포함, reader/owner·
미인증/다른 프로젝트/없는 프로젝트/날짜/중복 파라미터/메서드·권한 회수, 늦은 sink의
응답 비차단과 실패 무시·재시도 없음, native Worker 실행 컨텍스트와 실제 D1 기록/조회
smoke를 확인한다. native smoke의 첫 esbuild 실행은 테스트 문자열의 JSON 반환 괄호가
없어 실패했고 이를 고친 뒤4/4·최종171/171을 통과했다. 저장 테스트에 설정 변경 시
카운터 비감소·동시12건 기록의 건수/최종 시각 보존을 추가했다. 전체 검증은 약59.5초였고
변경 없는 관리자 빌드/브라우저 UI를 반복하지 않았다.

OpenAPI·예제, DBML, 제품 명세(source of truth), 관리자·로그·수집·마이그레이션 문서,
로드맵과 화면 문서의 API 미지원 표현·이 기록을 갱신했다. 최초 DB 변경은0004 additive
열 확장이고 원격 적용은 하지 않았다. core의 저장/관리자 포트와 Worker 컨텍스트 전달을
확장했다. SDK·의존성·위생 정책·CI·러너·검증 명령 변경은 없다. lint는 명령이 없어 생략했다.
운영 부하/실제 인증 제공자/원격 DB/배포·화면 연결은 미검증/후속이다. 단위 테스트 임시
Miniflare와 개발 서버는 각 테스트가 정리했다. 푸시·배포·Sembom 연동은 없다.

## 2026-10-10 관리자 수집 거부 집계 화면

API 연결 모드 설정의 CollectionDiagnostics에 CollectionRejections를 연결했다.
최근 7개 UTC 날짜·프로젝트 전체의 기록된 거부 요청 건수와 마지막 거부 시각을
보여주며 고정 10종 원인별 표·최근 날짜부터의 일별 표는 details로 접었다. 원문·
Origin·IP·토큰을 진단에 추가하지 않고 UTC 수신일과 best-effort 누락·과거 backfill
없음을 안내한다. 거부율·잔여 할당량은 추론하지 않는다. 설정·스키마·거부 조회는
병렬로 읽고 스키마가 있을 때만 수신 요약을 읽는다. 각 실패는 독립적으로 표시하며
0건이나 기록 없음으로 바꾸지 않는다. 기존 취소/클라이언트/프로젝트 키와 수동 갱신
방식을 유지하고 추가 폴링·시험 이벤트를 보내지 않는다.

관리자 npm test 첫 실행은 기존/관련 82개를 통과했고 9개는 새 테스트의 공식 JSON
예제 상대경로를 한 단계 더 올라가도록 잘못 적어 실패했다. 경로를 고친 뒤 관련
10/10, 최종 전체 91/91과 npm run typecheck를 통과했다. 날짜/원인/합계/중복/안전정수/
UTC 시각·0/null·7개 날짜·프로젝트/기간 일치·부분 실패·중지/스키마 미확인·취소를
검사했다. npm run build와 npm run test:sites 4/4를 통과했다. 빌드에는 기존 주요 JS
청크 500kB 초과 경고가 남아 있으며 이번 작업에서 의존성이나 번들 구성을 바꾸지 않았다.

기존 로컬 Vite 5180과 별도 in-memory Miniflare D1 5188에서 실제 관리자 reader 조회를
확인했다. origin_denied 1건/invalid_event 2건·고정 10종·7일 표, UTC 날짜와 서울 오늘의
구분, 503에서 다른 진단 값 유지·0으로 미표시, 복구 후 재조회·진짜 0건/null 화면을
확인했다. 360px에서는 페이지 가로 넘침 없이 표 영역만 스크롤되고 글자는 16px이었다.
브라우저 콘솔 오류는 없었다. 테스트용 viewport 변경과 Miniflare를 정리했다.
지정 CommandCode DeepSeek 4.1 Flash high의 문서/레이아웃 제안을 검토해 반영했다.

FRONTEND_DESIGN.md(화면 source of truth)·프로토타입 README·제품 로드맵·이 기록을
갱신했다. API·DB 계약·SDK·의존성·위생 정책·CI/러너 변경은 없다. 백엔드는 변경이 없어
직전 커밋의 171/171 검증 결과를 재사용했다. lint는 명령이 없어 생략했다. 실제 운영
인증/원격 DB/운영 부하·배포는 미검증이고 푸시·배포·Sembom 연동은 하지 않았다.

## 2026-10-10 조회 기간 직접 선택

API 연결의 조회 기간에 직접 선택과 DateRangePicker를 추가했다. 프로젝트-local 오늘,
최근90일 보존/양끝 포함31일 한도를 기존 서버 규칙과 맞췄다. 입력 중엔 기존 결과와
CSV를 유지하고 미적용 안내를 내며 적용 때만 조회한다. 빈 값/잘못된 날짜/역순/미래/
보존·기간 초과를 거부한다. 실제 적용 값은 개요/이벤트/목표/속성별상세/비교/CSV의
조회 키에 함께 반영한다. 프로젝트/시간대/기본기간/재연결은 초기화하고 뷰/버전 변경은
적용 기간을 유지한다. 보존 범위 밖의 직전 비교는 요청 전에 막고 현재 결과를 유지하며
비교를 끄면 현재 CSV를 허용한다. 과거 기간에는 오늘 집계 중 안내를 표시하지 않는다.
Sample/설정 수집 진단 범위는 유지한다. 날짜 영속 저장·새 의존성·자동 폴링은 없다.

관리자 npm test94/94, npm run typecheck, npm run build, npm run test:sites4/4와
 git diff --check를 통과했다. 신규 날짜 테스트3개는 실제 core.queryDates와의 경계
일치, 정확히31일/90일 경계, 미래/역순/빈 값/유효하지 않은 날짜, 윤년/연말/DST와
프로젝트-local 오늘, 이전 비교 기간 보존 경계를 확인한다. 백엔드 코드는 변경하지 않아
이전171/171 결과를 재사용했다. 기존 JS500kB 초과 빌드 경고는 남았고 이번엔 번들
분리를 하지 않았다. lint는 등록 명령이 없어 생략했다.

로컬 Vite5180와 isolated in-memory Miniflare D15188에서 reader 조회를 확인했다.
단일10월9일을 적용해 전체75→62건과 해당 일별 차트, 직전10월8일 비교, 이벤트/목표/
속성별 완료율, 실제 CSV 파일의 current/previous from/to와62건을 확인했다. 입력 중에는
이전 결과를 유지했고31일 초과 오류와90일 경계의 비교 차단/현재 결과 보존을 확인했다.
브라우저 자동 입력에서는 date 값이 DOM에만 바뀌어 onChange가 반영되지 않았고,
날짜 칸을 onInput 처리로 바꾼 뒤 초안 안내/적용 동작을 확인했다. 기본7일 복귀와
다시 직접 선택 시 초기화,360px에서 페이지 가로 넘침 없음과 날짜 입력16px을 확인했다.
브라우저 콘솔 오류는 없었다. 검증 viewport와 실행한 개발/Miniflare 서버를 정리했다.
지정 CommandCode DeepSeek4.1 Flash high의 라벨/최소 폼 디자인/문서 초안을 검토해
반영했다. 첫 초안은 토큰 제한으로 잘려 같은 모델의 예산을 늘려 완전한 결과를 받았다.

제품 명세02-spec.md와 화면 source of truth FRONTEND_DESIGN.md·프로토타입README·
로드맵·이 기록을 갱신했다. API/DB·SDK·의존성·위생 정책·CI/러너 변경은 없다.
실제 운영 인증/원격 DB/운영 부하/배포는 미검증이다. 푸시·배포·Sembom 연동은 없다.

## 2026-10-10 작업 흐름 속성별 직전 기간 비교

목표의 등록 속성별 완료율에 직전 같은 길이 기간 비교를 연결했다. 기존 breakdown
API를 비교를 켰을 때만 추가 조회하고, 현재와 이전에 관찰된 값을 자료형대로 합쳐
시작·성공·완료율을 현재/이전 순서로 보여준다. 완료율 변화는 %p다. 관찰되지 않은
값의 건수는 0, 시작 0인 기간의 완료율과 그 차이는 null/—다. 현재·이전 조회와 재시도는
분리했고 취소한 요청의 응답은 버린다. 비교 조회 실패는 현재 표를 유지한다. CSV에는
이전 속성별 합계·일별 내역과 workflow_property_comparison 행을 더하고 metric 열로
시작·성공·완료율을 구별한다. 활성 비교가 미완료/실패하면 내보내기를 잠그며 비교를
끄면 현재 CSV를 허용한다. 이벤트 속성 비교와 값별 이전 일별 화면은 이번 범위 밖이다.

관리자 npm test 97/97, npm run typecheck, npm run build, npm run test:sites 4/4,
git diff --check를 통과했다. 신규 테스트 3개는 가중 완료율과 %p, false/숫자0 키,
두 기간 값 합집합·빈 결과·시작0·집계 중 상태, 다른 프로젝트/버전/시간대/분류/기간
거부, 이전 값별 일별 CSV와 현재에 없는 값·계산 불가 변화량·누락 비교 거부를 확인한다.
lint는 등록 명령이 없어 생략했다. 백엔드·API·DB는 변경하지 않아 백엔드 테스트는
반복하지 않았다. 기존 JS500kB 초과 빌드 경고는 남아 있다.

로컬 Vite5180와 격리된 in-memory Miniflare D15188의 reader 조회를 브라우저에서
확인했다. tool=loan의 시작20/10·성공16/6·완료율80%/60%·+20%p, grade/timer의
이전0건과 계산 불가 완료율을 확인했다. 이전 breakdown만 503으로 실패시켜 현재
속성 표 유지·CSV 잠금·비교 해제 시 내보내기 허용·비교 재시도 복구를 확인했다.
실제로 내려받은 CSV의 비교9행과 이전 데이터·metric·단위를 확인했다. 현재10월4~5일
0건/이전10월2~3일10건에서 이전에만 있는 loan 값이 0/10·0/6·—/60%로 남았다.
모바일 viewport360 설정 요청은 환경에서 실제400px로 적용됐고 페이지383px·표 내부
가로 스크롤을 확인했다. 360px 자체는 미검증이다. 콘솔 오류는 없었다. 비교 표 화면은
.tmp/prototype-qa/workflow-property-comparison.jpg에 저장했고 검증 서버와 탭을 정리했다.

CommandCode DeepSeek4.1 Flash high에 문서 갱신을 맡겨 결과를 코드와 대조했다.
제품 명세02-spec.md·화면 source of truth FRONTEND_DESIGN.md·프로토타입README·
로드맵·이 기록을 갱신했다. API/DB·SDK·의존성·위생 정책·CI/러너 변경은 없다.
실제 운영 인증·원격 DB·운영 부하·배포는 미검증이며 푸시·배포·Sembom 연동은 없다.

## 2026-10-10 이벤트 속성별 직전 기간 비교

이벤트 분석에서 등록 속성으로 분류하고 직전 기간 비교를 켜면 기존 event daily API로
같은 이벤트·속성·프로젝트·스키마·시간대의 직전 같은 길이 기간을 조회한다.
useEventPropertyComparison이 이전 조회의 상태·재시도·취소를 맡고, 별도
EventPropertyComparison 표는 현재/이전 건수·증감률(%)·비중·비중 변화(%p)를 보여준다.
비중의 분모는 각 기간의 선택한 이벤트 전체 건수다. 값의 자료형을 유지해 두 기간의
관찰 값 합집합을 비교한다. 없는 값의 건수는0, 전체 이벤트가 있으면 해당 비중은0,
전체가0이면 비중과 차이는null/—다. 이전 건수0의 증감률도null/—다.
분류 없는 상세에는 이전 속성 요청을 하지 않는다. 실패 시 현재 표와 차트는 유지하고
이전 속성만 다시 조회한다. 조건 변경·비교 해제·언마운트는 요청을 취소하고 늦은 응답을
버린다. 활성 분류 비교가 미완료/오류면 CSV를 잠근다. 비교 해제는 현재 기간 CSV를,
분류 해제는 전체 이벤트 기간 비교를 유지한 CSV를 허용한다. CSV는 이전 상세 합계·일별·
속성 값별 행과 property_comparison 행을 담는다.
metric=count/share, 변화 단위percent/percentage_point, 값 자료형과 계산 불가를 보존한다.

관리자 npm test101/101, npm run typecheck, npm run build, npm run test:sites4/4,
git diff --check를 통과했다. 신규 테스트4개는 건수 변화와 비중 차이의 구별, 새로 생긴/
사라진/null·false·숫자0 값, 빈 기간·0분모, 잘못된 메타/날짜/분류/합계 거부,
실제 ApiClient의 기존 조회 경로·그룹·기간·신호 전달과 취소/늦은 응답 거부,
이전 일별 CSV와 비중 변화·계산 불가·누락/잘못된 이전 데이터 거부를 확인한다.
lint는 등록 명령이 없어 생략했고 백엔드 코드는 변경하지 않아 재검증하지 않았다.
기존 JS500kB 초과 빌드 경고는 유지된다. LiveDashboard.tsx는41.7kB로 추후 분리 후보다.
이번 이전 조회 상태와 비교 표는 별도 파일로 두었다.

로컬 Vite5180와 격리된 in-memory Miniflare D15188의 reader 데이터로 확인했다.
tool_view의 loan12/10·+20%와 비중44.4%/66.7%·-22.2%p, grade10/5·+100%,
timer5/0·증감률계산불가·비중18.5%/0%를 확인했다. 실제 다운로드 CSV의 비교6행과
이전 값별 일별 행·숫자·단위가 화면과 일치했다. 이전 그룹 시계열만503으로 실패시켜
현재 표27건·차트 유지, CSV잠금, 비교·분류 해제 시 해제, 별도 재시도 복구를 확인했다.
직접 기간10월4~5일의 현재0건/이전10월2~3일에서 이전 loan·grade가 남고 -100%와
현재 비중/차이—를 표시했다. 브라우저 확대율을 반영한 실제 CSS320px에서 페이지303px,
표221px/내용575px로 표 내부만 스크롤하고 페이지 넘침은 없었다. 콘솔 오류는 없었다.
.tmp/prototype-qa/event-property-comparison.jpg에 화면을 저장했고 viewport·탭·검증
서버를 정리했다. 브라우저 확대율 자체는 변경하지 않았다.

CommandCode DeepSeek4.1 Flash high의 문서 갱신을 코드와 대조했다. 제품 명세02-spec.md·
화면source of truth FRONTEND_DESIGN.md·프로토타입README·로드맵·이 기록을 갱신했다.
API/DB·SDK·의존성·위생 정책·CI/러너 변경은 없다. 운영 인증·원격 DB·운영 부하·배포는
미검증이며 푸시·배포·Sembom 연동은 없다.
