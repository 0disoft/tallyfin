# 검증

상태: 코어·저장 어댑터·최소 수집기·브라우저 SDK의 로컬 검증과 v0.1 계약·샘플 UI 검증이 해당한다. 브라우저 SDK는 커밋 `cb3f2ff`(SDK 본체)와 뒤이은 예제·크기 검사·수집기 통합 테스트로 로컬 구현·검증했다. Sembom 예제는 저장소 안에만 두었고 실제 Sembom 저장소에 설치·활성화하지 않았다. 관리자 조회/인증·원격 DB 마이그레이션·실브라우저 측정은 아직 없다.

## 검증 이름

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

## 포맷·문서·스캐폴드
- `format`: `git diff --check`로 공백 오류를 확인한다.
- `docs`: 변경 문서의 상대 Markdown 링크와 계획/구현 상태의 일관성을 확인한다.
- `check`(스캐폴드): 외부 CLI의 `ssealed doctor . --strict`로 상태를 확인한다. 의도적인
  문서 수정은 `ssealed update . --yes`로 인정한 후 확인한다. 파일 내용을 덮어쓰는
  `--force`는 사용하지 않는다.

## 아직 실행하지 않음
- 브라우저 SDK 초기 실행 비용과 실브라우저 지연·처리량, 원격 배포
- 서버 발행 수집과 관리자 조회·프로젝트 권한 강제
- 원격 D1 마이그레이션과 운영 smoke
- 만료 정리 스케줄러와 운영 Worker·도메인·인증 제공자
- 쓰기 처리량·지연 성능 측정

서술(prose) 테스트는 작성하지 않는다.
