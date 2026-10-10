# 브라우저 SDK (packages/browser)

상태: `packages/browser` SDK(`cb3f2ff`)와 `examples/sembom` 예제·크기 검사(`f356d8a`)를 로컬 구현·검증했다. 예제는 실제 Sembom 저장소에 설치·활성화하지 않았고 API·DB 계약은 바뀌지 않았다. 기본 엔트리와 분리한 선택 프로필 `@tallyfin/browser/funnels`의 퍼널 연결 전송도 로컬 구현·검증했고, 관리자 연결 안내가 이 프로필 코드를 만드는 경로도 로컬 구현·검증했다. 전송 의미는 [이벤트·집계 계약](./event-contract.md), 수신 경계는 [수집기 구현](./collector.md)을 따른다.

## 경계
`createTallyfin({ endpoint, schema, allowLocalHttp?, enabled? }, host?)`가 `BrowserClient`를 돌려준다. SDK는 외부 런타임 의존성이 없고 서버 코어·D1 런타임을 번들에 넣지 않는다. 서비스별 이벤트 이름은 내장하지 않으며, 등록 스키마는 빌드 시점에 `tools/browser/schema.mjs`의 `projectBrowserSchema`로 레지스트리에서 압축 투영한다. 선택적 `BrowserPlatform`(`now`·`uuid`·`timer`·`send`, 선택 `beacon`·`onHidden`)으로 테스트나 명시적 어댑터를 붙인다.

내부 파일은 `types.ts`가 기존 공개 타입을, `common.ts`가 속성 검증·네이티브 어댑터·큐·재시도·숨김 전송·destroy 처리를, `index.ts`가 workflow 검증과 track/start 진입점을 맡는다.
내부 enqueue는 연결 필드를 공통으로 받도록 분리했으며 기존 workflow의 `{ attempt }` 형식과 공개 BrowserClient API는 유지한다. 브라우저 퍼널 모듈은 기본 엔트리와 분리한 선택 엔트리 `@tallyfin/browser/funnels`로 구현했고 기본 번들에는 넣지 않는다.

## 비활성·SSR·잘못된 설정
다음 경우 리스너 없이 무동작 클라이언트를 돌려준다. `enabled: false`, 커스텀 호스트 없이 브라우저 환경(`document`·`fetch`·`crypto`)을 사용할 수 없음, 잘못된 엔드포인트·스키마, 검사 중 예외다. 무동작 클라이언트는 `track`이 `false`, `start`가 `undefined`, `pending`이 0이다.

엔드포인트는 `/v1/projects/<id>/batches` 경로와 HTTPS를 요구하고 userinfo·쿼리·해시를 거부한다. `allowLocalHttp: true`를 명시하면 localhost·127.0.0.1·[::1]의 HTTP도 허용한다. 스키마는 `JSON.stringify(schema).length`가 32768을 넘으면 거부하며, 이 길이는 UTF-8 바이트 수가 아니라 JavaScript 문자열 길이다.

## 클라이언트 API
- `track(name, properties?)`: 일반 이벤트만 버퍼에 넣는다. 워크플로 단계 이름은 거부한다.
- `start(workflow, properties?)`: 시작 이벤트와 attemptId·startedAt을 만들고 `AttemptHandle`을 돌려준다. 시작을 넣지 못하면 핸들도 만들지 않는다.
- `AttemptHandle.succeed/fail(properties?)`: 24시간 안에 한 번만 종료를 넣는다. dimensions 값이 바뀌면 거부하고, 실패 단계가 없는 흐름은 `fail`이 `false`다.
- `AttemptHandle.cancel()`: 이후 종료 이벤트를 막는다. 이미 버퍼에 넣은 시작 이벤트는 유지한다.
- `flush()`: 다음 기회에 전송하도록 예약한다. 네트워크 완료를 기다리게 하지 않는다.
- `destroy()`: 리스너·타이머를 지우고 진행 중 I/O를 중단하며 메모리를 비운다. 늦은 응답은 반영하지 않고 두 번 호출해도 안전하다.
- `pending`: 버퍼와 진행 중/재시도 이벤트의 합이며 전달 완료 수가 아니다.

`track`·`succeed`·`fail`의 `true`는 메모리 버퍼가 이벤트를 받았다는 뜻이다. 서버 저장 완료를 뜻하지 않는다.

이벤트는 넣기 전에 한 번 스냅샷하고 등록 규칙으로 검사한다. 알 수 없는 이름·키, 자유 문자열, 중첩 객체·배열은 버린다. 이벤트 ID는 `crypto.randomUUID`로 만들고 실패하면 보내지 않으며 약한 난수로 대체하지 않는다.

## 퍼널 프로필 (`@tallyfin/browser/funnels`)

기본 엔트리는 퍼널 코드를 넣지 않는다. 퍼널을 쓰는 서비스만 선택 엔트리 `@tallyfin/browser/funnels`에서 `createTallyfinFunnels(options, host?)`를 가져온다. `options`는 `FunnelSchema`(`version`·`events`·`funnels`)를 받고, `host`는 커스텀 호스트를 붙이는 기존 `BrowserPlatform` 선택 포트다. 버퍼·재시도·배치 전송·`flush`·`destroy`·`pending`은 기본 클라이언트와 같은 메모리 전송(`createTransport`)을 공유하며 별도 저장소나 추가 엔드포인트를 만들지 않는다.

`FunnelClient`는 `track`·`flush`·`destroy`·`pending`에 `createFunnelRun`·`trackFunnel`을 더하고 workflow 진입점 `start`는 두지 않는다. 퍼널 작업은 기본 workflow 시도와 다른 엔트리라서 한쪽에서 시작한 작업을 다른 쪽으로 이어받지 않는다.

- `createFunnelRun(id)`: 등록된 퍼널의 새 작업 컨텍스트를 만든다. 돌려주는 `{ funnelId, runId, startedAt }`는 동결된 값이고 이벤트를 넣지 않으며 네트워크도 쓰지 않는다. `runId`는 매번 새 UUIDv4이고 방문자 식별자로 재사용하지 않는다. 저장소·쿠키·`localStorage`를 쓰지 않는다. 첫 단계가 browser가 아닌 퍼널·미등록·비활성·destroy 뒤에는 `undefined`다. 그래서 브라우저에서는 browser로 시작하는 퍼널만 작업을 만들 수 있다.
- `trackFunnel(name, properties, link, occurredAt?)`: `link`를 복사해 검증한 뒤 단계 이벤트를 넣는다. `link`는 `funnelId`·`runId`(UUIDv4)·`startedAt`(엄격한 UTC)만 가진 불변이고 한 번 검증하면 바꾸지 않는다. 서버에서 시작해 브라우저로 넘어온 퍼널의 browser 단계도 이 경로로 받는다. 수동 재시도에는 원래 `occurredAt`을 넘겨 최초 논리 발생 시각을 유지한다.
- `track(name, properties?)`: 일반 이벤트만 넣는다. 등록된 퍼널 단계 이름이면 `false`로 거부한다.

퍼널 분류값(`dimensions`)은 단계마다 같은 등록 규칙을 쓰는 유한 값 집합이다. 단계 사이에서 분류 정의가 어긋나면 서버가 거부하므로 호스트는 연결이 살아 있는 동안 차원과 논리 발생 시각을 바꾸지 않아야 한다. 서버 단계는 빌드 시점 투영(`projectFunnelBrowserSchema`)에서 `null` 자리로만 남아 순서를 지키고, 브라우저 번들은 서버 정의를 싣지 않는다.

예시는 `examples/funnels/browser.ts`와 `examples/funnels/browser-schema.json`에 있다.

관리자 연결 안내는 이 프로필을 그대로 만든다. 브라우저 출처에서 작업 퍼널을 고르면
`sdkSetup(registry, origin, 'browser', { profile: 'funnels', funnelId })`가
`@tallyfin/browser/funnels` 팩토리와 `tools/browser/schema.mjs`의 퍼널 투영(브라우저
단계는 이름, 서버 단계는 `null` 자리)을 만들고, 고른 퍼널의 사용 예제를 주석으로 붙인다.
일반 프로필은 기존 `createTallyfin`·workflow 코드를 만들고, 퍼널 프로필은 일반 이벤트와
등록 단계만 싣고 작업 흐름 전용 이벤트는 스키마에서 뺀다. 예제는 자격 증명을 넣지 않고
첫 출처가 browser인 퍼널만 `createFunnelRun`을 쓰며 나머지는 호스트가 검증한 전달
컨텍스트를 쓴다.

빌드는 SDK 내부 Batch의 `__tfBatch` 예약 필드 6개만 짧게 만든다. 공개 SDK·HTTP 키는
이름을 유지한다. 고정 endpoint와 설정을 포함한 관리자 생성 코드의 로컬 번들은 gzip
3063 B이며 현재 SDK 실측은 기본 2743 B·Sembom 3022 B·퍼널 2912 B·참조 예제 3038 B다.

## 버퍼·재시도·전송
- 메모리 40개(진행 중 포함), 배치당 20개·16384 bytes, 20개가 모이거나 5초가 지나면 비동기 전송한다.
- 429·503·네트워크 실패만 최대 2회 재시도한다. Retry-After 정수 초를 존중하고, 배치는 시작 시각부터 10분이 지나면 버린다. 재시도는 원래 ID·시각·바디를 유지한다.
- 응답 본문은 저장·로그하지 않고 취소한다. 상태 코드만 사용한다.
- 네이티브 `sendBeacon`은 credentials를 강제로 포함하므로 쓰지 않는다. keepalive fetch로 `credentials: omit`, `cache: no-store`, `referrerPolicy: no-referrer`, `mode: cors`를 쓴다.
- 숨김 콜백은 진행 중 배치를 다시 보내지 않고 Retry-After를 건너뛰지 않으며, 아직 안 보낸 keepalive 배치를 최대 2개까지 즉시 시작한다. `BrowserPlatform.beacon`은 명시적 커스텀 호스트용 선택 포트로 남아 있고 `false`이거나 예외면 keepalive fetch로 넘어간다. beacon `true`는 브라우저 큐 수락이며 서버 저장 완료가 아니다.

원문 입력·결과, 금액, 이메일, 계정·주문·파일 ID, URL·리퍼러·DOM·영구 식별자·쿠키를 보내지 않고 `localStorage`/`sessionStorage`도 쓰지 않는다.

## 빌드·검사
```sh
npm run test:browser
npm run build:browser
npm run check:browser-size
```

`build:browser`는 esbuild 번들과 `tsc` 선언을 만들고, `check:browser-size`는 예제 스키마 투영 일치와 번들 경계, gzip 3KiB 예산을 검사한다. 퍼널 예제 투영 일치와 퍼널 번들 경계, 퍼널 SDK+예제 예산도 함께 본다. 현재 로컬 실측 gzip은 기본 SDK 2743 B·Sembom 3022 B·퍼널 SDK 2912 B·퍼널+참조 예제 3038 B다. 내부 필드 압축 뒤 브라우저 SDK·빌드·수집기 관련 48개 테스트와 루트 타입 검사·SDK 빌드를 통과했다. 서버 SDK·관리자 생성 코드 검증을 포함한 실행 기록은 [VALIDATION.md](../../VALIDATION.md)에 있다.

## 남은 검증
합성 화면의 실브라우저 초기 실행·동기 호출·전송과 수집기 종료 시 동작은
[측정 도구](../../tools/browser-bench/README.md)로 확인했다.
실제 Sembom 설치·활성화와 서비스 지연·처리량, 모바일·운영 환경, 원격 배포는 남았다.
퍼널 예제의 실제 서비스 적용과 관리자 퍼널 집계 연결도 남았다. 관리자 SDK 코드 생성은
표준·퍼널 프로필과 서버 설정을 만들도록 로컬 구현·검증했고, reader/owner 퍼널 조회 API와
집계 화면이 다음이다.
실제 운영 발행자·관리자 인증 연결도 후속이다.
