# 브라우저 SDK (packages/browser)

상태: `packages/browser` SDK(`cb3f2ff`)와 `examples/sembom` 예제·크기 검사(`f356d8a`)를 로컬 구현·검증했다. 예제는 실제 Sembom 저장소에 설치·활성화하지 않았고 API·DB 계약은 바뀌지 않았다. 전송 의미는 [이벤트·집계 계약](./event-contract.md), 수신 경계는 [수집기 구현](./collector.md)을 따른다.

## 경계
`createTallyfin({ endpoint, schema, allowLocalHttp?, enabled? }, host?)`가 `BrowserClient`를 돌려준다. SDK는 외부 런타임 의존성이 없고 서버 코어·D1 런타임을 번들에 넣지 않는다. 서비스별 이벤트 이름은 내장하지 않으며, 등록 스키마는 빌드 시점에 `tools/browser/schema.mjs`의 `projectBrowserSchema`로 레지스트리에서 압축 투영한다. 선택적 `BrowserPlatform`(`now`·`uuid`·`timer`·`send`, 선택 `beacon`·`onHidden`)으로 테스트나 명시적 어댑터를 붙인다.

내부 파일은 `types.ts`가 기존 공개 타입을, `common.ts`가 속성 검증·네이티브 어댑터·큐·재시도·숨김 전송·destroy 처리를, `index.ts`가 workflow 검증과 track/start 진입점을 맡는다.
내부 enqueue는 연결 필드를 공통으로 받도록 분리했으며 기존 workflow의 `{ attempt }` 형식과 공개 BrowserClient API는 유지하고, 브라우저 퍼널 모듈은 후속으로 둔다.

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

`build:browser`는 esbuild 번들과 `tsc` 선언을 만들고, `check:browser-size`는 예제 스키마 투영 일치와 번들 경계, gzip 3KiB 예산을 검사한다. 실행 결과와 실측값은 [VALIDATION.md](../../VALIDATION.md)에 있다.

## 남은 검증
합성 화면의 실브라우저 초기 실행·동기 호출·전송과 수집기 종료 시 동작은
[측정 도구](../../tools/browser-bench/README.md)로 확인했다.
실제 Sembom 설치·활성화와 서비스 지연·처리량, 모바일·운영 환경, 원격 배포는 남았다.
서버 발행 수집과 실제 운영 관리자 인증 연결도 후속이다.
