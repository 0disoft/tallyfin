# 서버 SDK (packages/server)

상태: `@tallyfin/server`의 소스와 단위 테스트·빌드를 로컬에서 확인했고 런타임 의존성은
없다. 다음 슬라이스는 로컬 Miniflare Worker·D1 통합이고, 원격 배포·실제 제공자 연결은
범위 밖이다. 실측값과 전체 루트 검사 기록은 [검증 기록](../../VALIDATION.md)에 둔다.

런타임 의존성 없이 `fetch`·Web Crypto·`AbortController`만 쓰는 ESM 클라이언트다. DOM에
의존하지 않고 브라우저용 [브라우저 SDK](./browser-sdk.md)와 별개다. 발행자 토큰은 SDK가
저장하지 않으며 호스트가 시도마다 `getToken`으로 준다.

## 설정과 생성

`createTallyfinServer(options, host?)`가 클라이언트를 만든다. 설정이 규칙에 안 맞으면
생성 시점에 `TypeError`를 던지고 네트워크 요청을 보내지 않는다.

| 옵션 | 필수 | 규칙 |
| --- | --- | --- |
| endpoint | 예 | `/v1/projects/{projectId}/server-batches` 경로만. https, 또는 `allowLocalHttp`가 true이고 호스트가 루프백일 때 http. userinfo·쿼리·해시는 거부한다. |
| schema | 예 | `{ version(1~2147483647), events }`. 서버 출처로 검토한 정의만 넣고 브라우저 정의·작업 흐름은 넣지 않는다. 직렬화 32KiB 이하다. |
| getToken(signal) | 예 | 전용 발행자 자격증명을 돌려주는 함수. 문자열 또는 Promise이고 시도마다 새로 호출한다. |
| allowLocalHttp | 아니요 | 기본 false. |
| maxAttempts | 아니요 | 1~3, 기본 3. |
| requestTimeoutMs | 아니요 | 10~30000, 기본 5000. 토큰 획득·요청·응답 본문에 함께 적용한다. |
| retryBudgetMs | 아니요 | 10~600000, 기본 30000. 시도 사이 재시도 대기까지 포함한다. |

`schema.events`는 이벤트 이름→속성 규칙이다. 이름·속성 키는 `[a-z][a-z0-9_]{0,47}`이고
이벤트당 속성 4개·이벤트 50개까지다. 규칙은 `['boolean', required]`,
`['enum', required, values]`(허용 값 32종 이하, 중복 불가), `['integer', required, low, high]`
(±1000000)다. 속성별 선택지 32개, 이벤트별 조합 256개 이하다. 속성 값은 불리언·문자열·
정수만 받는다.

`host`는 선택이고 `now`·`monotonicNow`·`uuid`·`fetch`·`wait`를 모두 함수로 줘야 한다.
기본은 `Date.now`·`performance.now`·`crypto.randomUUID`·`globalThis.fetch`다.

### 연결 스켈레톤

```ts
import { createTallyfinServer } from '@tallyfin/server';
import type { ServerSchema } from '@tallyfin/server';

const schema: ServerSchema = {
  version: 1,
  events: {
    purchase_completed: {
      plan: ['enum', true, ['free', 'pro']],
      amount_bucket: ['integer', false, 0, 20],
    },
  },
};

const client = createTallyfinServer({
  endpoint: 'https://<collector-host>/v1/projects/<projectId>/server-batches',
  schema,
  // 호스트가 실제 발급 절차를 넣는다. 이 SDK는 토큰을 저장하지 않는다.
  getToken: signal => tokenProvider(signal),
  maxAttempts: 3,
});
```

`tokenProvider`는 호스트가 이미 쓰는 자격증명 발급 절차를 감싼 함수이고 SDK는 그 내용을
모른다. 실제 발급자·경로·값은 호스트가 정하며 문서나 코드에 자격증명을 넣지 않는다.

## 이벤트 만들기

`createEvent(name, properties?, metadata?)`가 얼린 `ServerEvent`를 만든다.

- `eventId`는 UUID v4 형식이고 `occurredAt`은 ms를 채운 UTC ISO 문자열이다. `metadata`의
  `eventId`·`occurredAt`으로 저장해 둔 값을 넘길 수 있고 다른 키는 거부한다.
- `occurredAt`은 현재 기준 과거 24시간~미래 5분만 허용한다. `properties`는 등록 규칙만
  받고 필수 속성이 빠지거나 종류·enum·범위가 틀리면 거부한다.
- 잘못된 입력은 `ServerInputError`(code `invalid_event`)다.
- 반환 객체는 얼려 있고 속성 키가 정렬되어 캐논컬하다. 프로세스가 다시 시작해도
  `eventId`·`occurredAt`·본문을 저장해 두면 같은 이벤트로 다시 보낼 수 있다.

## 전송

`send(events, { signal? })`가 `DeliveryResult`를 돌려준다. 한 번에 1~20개, UTF-8 본문
16KiB 이하의 원자 배치 하나만 보낸다. 암묵적 큐·타이머·fire-and-forget·수명 주기
리스너를 만들지 않고, 대기 중 요청이 있을 때만 타이머를 만들고 정리한다.

- 본문은 첫 시도 전에 만들어 시도마다 같은 스냅샷을 쓰고, 토큰은 시도마다 `getToken`으로
  새로 받는다.
- 검증·자격증명·전송 실패는 예외 대신 결과로 알린다. 다만 호스트가 넘긴 `ServerPlatform`은
  아래 계약을 지켜야 하고, 계약을 어기는 프로그래머 오류는 던져질 수 있다. `delivered`는
  `{accepted, duplicates, attempts}`, 그 밖은 `{reason, httpStatus, retryable, attempts}`다.
  `reason`은 `invalid_batch`·`invalid_event`·`authentication_unavailable`·
  `transport_unavailable`·`invalid_response`·`http_error`·`retry_deferred`·`aborted`다.
- `attempts`는 실제로 보낸 HTTP 요청 수다.

재시도 규칙:

- 재시도한다: 408·429·5xx, 네트워크·타임아웃, 200인데 영수증이 규칙에 안 맞을 때
  (`invalid_response`).
- 재시도하지 않는다: `getToken` 실패나 토큰 형식 오류는 그 시도에서 바로
  `authentication_unavailable`로 끝나고 SDK가 자동으로 다시 부르지 않는다. 401·403·409·422
  같은 나머지 4xx는 `rejected`/`http_error`다.
- 대기는 `Retry-After`(초 또는 HTTP-date, 1초 하한)를 쓰고 없으면 지수 백오프다. 기본
  `maxAttempts` 3이면 시도 사이 대기는 1s·2s 두 번이다.
- 대기나 다음 시도가 `retryBudgetMs`를 넘으면 `unavailable`/`retry_deferred`로 미루고
  `retryable: true`로 알린다.

영수증(200)은 `Content-Type: application/json`(선택적 charset), 본문 1KiB 이하, 정확히
`accepted`·`duplicates` 두 정수이고 합이 배치 수와 같아야 한다. 다르면
`invalid_response`로 보고 재시도한다.

취소는 토큰 획득·요청·응답 읽기·재시도 대기를 모두 덮는다. 중간에 취소되면
`aborted`/`aborted`이고 `retryable: false`다.

## 실패와 재전송

결과가 `rejected`·`unavailable`·`aborted`여도 서버가 이미 저장했을 수 있다. `send`는
영수증을 받은 경우에만 성공으로 보고하므로, 실패하면 보존한 `eventId`·`occurredAt`·본문을
그대로 다시 보낸다. 같은 이벤트의 중복은 서버가 `duplicates`로 세지만 SDK가 정확히 한 번만
전달한다고 보장하지 않는다.

- 지속 큐·아웃박스·재시도 스케줄러는 SDK에 없다. 저장과 재시도 시점은 호스트가 관리한다.
- `getToken`의 실제 발급자 선택과 자격증명 발급은 호스트 책임이다. M2M client secret을
  브라우저나 공개 번들에 넣지 않는다.
- 서버 정의만 있는 레지스트리 허용과 서버 출처 조회 API·화면은 아직 없다.
- 실패 후 수동 재시도는 저장해 둔 `metadata`(`eventId`·`occurredAt`)를 그대로 넘겨 같은
  이벤트로 보낸다.
- 실제 제공자 연결·운영 배포와 원격 D1 적용은 범위 밖이다.

## 보안

요청은 `Authorization: Bearer` 헤더와 `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`,
`redirect: 'error'`, `cache: 'no-store'`를 쓴다. 쿠키·referrer·리다이렉트·캐시를 쓰지 않고,
토큰·원문 입력·원문 오류를 결과나 로그에 넣지 않는다.

관련: [서버 발행 이벤트](./server-events.md), [이벤트·집계 계약](./event-contract.md),
[검증](../../VALIDATION.md).

