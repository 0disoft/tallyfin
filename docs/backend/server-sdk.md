# 서버 SDK (packages/server)

상태: `@tallyfin/server`의 소스와 단위 테스트·빌드를 로컬에서 확인했고 런타임 의존성은
없다. 로컬 Node·Miniflare Worker·D1 통합도 확인했고, 원격 배포·실제 제공자 연결은
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
| schema | 예 | `{ version(1~2147483647), events, funnels? }`. 서버 출처로 검토한 정의만 넣고 브라우저 이벤트 정의·작업 흐름은 넣지 않는다. 직렬화 32KiB 이하다. |
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

`schema.funnels`는 선택이며 `{ [id]: { steps: (string | null)[], dimensions: string[] } }`
형태다. steps는 2~10개이고 문자열은 등록된 서버 이벤트 이름, null은 브라우저 단계의
위치만 나타낸다. 서버 투영 도구는 서버가 참여하는 퍼널만 추가하며 브라우저 이벤트의
이름·속성 규칙·label·purpose는 SDK에 넣지 않는다. 해당 퍼널이 없으면 funnels를 생략해
기존 정의 형태를 유지한다.

퍼널 차원의 enum 허용 값은 Core와 같이 순서와 무관한 집합으로 비교한다. 단계별로
`pdf, image`와 `image, pdf`를 사용해도 같은 규칙으로 인정한다. 내부 JSON 스냅샷만
정렬하므로 원본 스키마를 바꾸지 않으며, 중복·다른 값 집합·필수 여부와 종류의 불일치는 거부한다.

`host`는 선택이고 `now`·`monotonicNow`·`uuid`·`fetch`·`wait`를 모두 함수로 줘야 한다.
기본은 `Date.now`·`performance.now`·`crypto.randomUUID`·`globalThis.fetch`다.
선택적 `timer(callback, milliseconds)`는 취소 함수를 반환한다. 제공하면 자격증명·요청·
응답 본문·재시도 대기의 제한 시간에 모두 사용한다. `monotonicNow`·`wait`와 같은
가상 스케줄러로 구동하면 실제 시간 대기 없이 단위 테스트할 수 있다. 생략 시 기존
`setTimeout`/`clearTimeout` 동작을 유지한다.

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
  `eventId`·`occurredAt`·`funnel`만 받으며 저장해 둔 값을 넘길 수 있다. 다른 키는 거부한다.
- `occurredAt`은 현재 기준 과거 24시간~미래 5분만 허용한다. `properties`는 등록 규칙만
  받고 필수 속성이 빠지거나 종류·enum·범위가 틀리면 거부한다.
- 잘못된 입력은 `ServerInputError`(code `invalid_event`)다.
- 반환 객체는 입력을 복사해 속성·선택 funnel 링크까지 얼리고 속성 키를 정렬한다.
  프로세스가 다시 시작해도 `eventId`·`occurredAt`·속성·`funnel`을 저장해 두면 같은
  이벤트로 복원해 다시 보낼 수 있다.

## 작업 퍼널 연결

`ServerEvent`는 선택 `funnel: FunnelLink`를 지원한다. 링크는
`{ funnelId, runId, startedAt }` 세 키만 받는다. 등록된 서버 단계·UUIDv4·실제 UTC 시각을
검사하며 단계는 시작 뒤 24시간 이내, 첫 단계는 시작과 같은 시각이어야 한다.
`createEvent`·`createFunnelRun`의 잘못된 입력은 `ServerInputError`다.

`createFunnelRun(id)`는 첫 단계가 server인 퍼널만 시작한다. 새 UUID와 현재 시각으로
얼린 링크를 반환하며 첫 단계 `createEvent`에서 occurredAt을 생략하면 링크의 startedAt을
쓴다. 아래 이름과 속성은 호스트가 발행한 정의에 등록되어 있어야 한다.

```ts
const run = client.createFunnelRun('processing');
const started = client.createEvent('processing_started', { kind: 'pdf' }, { funnel: run });
await client.send([started]);
// 실제 작업 성공을 확인한 뒤 같은 연결 정보로 완료를 보냅니다.
const completed = client.createEvent('processing_completed', { kind: 'pdf' }, { funnel: run });
await client.send([completed]);
```

첫 단계가 browser이면 서버에서 새 run을 만들지 않고 실제 업무 요청에서 검증한
작업 컨텍스트의 링크를 받는다. 실제 완료를 확인한 서버 코드가
`createEvent(name, properties, { funnel: link })`로 완료를 발행한다. runId는 인증 수단이나
방문자 ID가 아니며 기존 발행자 인증·권한 검사를 그대로 사용한다. 브라우저 SDK의 퍼널
전송·관리자 SDK 코드 생성·퍼널 조회 API와 화면은 로컬 구현·검증을 마쳤다. 실제 서비스의
업무 요청에 이 작업 컨텍스트를 연결하는 일은 서비스별 연동에서 처리한다.

## 전송

`send(events, { signal? })`가 `DeliveryResult`를 돌려준다. 한 번에 1~20개, UTF-8 본문
16KiB 이하의 원자 배치 하나만 보낸다. 암묵적 큐·타이머·fire-and-forget·수명 주기
리스너를 만들지 않고, 대기 중 요청이 있을 때만 타이머를 만들고 정리한다.

- 이벤트·속성·funnel 링크를 다시 검사하고 복사·동결한 스냅샷으로 첫 시도 전에 본문을
  만든다. 재시도는 같은 본문을 쓰고 토큰은 시도마다 `getToken`으로 새로 받는다.
- 배열의 모든 위치에 직접 담긴 이벤트가 있어야 한다. 빈 칸·삭제된 항목·프로토타입에서
  가져온 항목·`undefined`·`null`은 `rejected`/`invalid_event`로 거부하며, 토큰 조회·HTTP
  요청·재시도 없이 `attempts: 0`을 반환한다. 같은 클라이언트로 정상 배치를 다시 보낼 수 있다.
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
- 대기는 `Retry-After`(초 또는 HTTP-date, 1초 하한)를 쓰고 없으면 지수 백오프다. HTTP-date는
  `Sun, 01 Nov 2026 10:00:00 GMT` 같은 29자 GMT 표준형만 받고, 없는 날짜·24:00·요일 불일치처럼
  `Date.parse`가 자동 보정하는 값이나 ISO 형식은 받지 않는다. 헤더가 잘못됐으면 지수 백오프로
  돌아간다. 기본 `maxAttempts` 3이면 시도 사이 대기는 1s·2s 두 번이다.
- 대기나 다음 시도가 `retryBudgetMs`를 넘으면 `unavailable`/`retry_deferred`로 미루고
  `retryable: true`로 알린다.

영수증(200)은 `Content-Type: application/json`(선택적 charset), 본문 1KiB 이하, 정확히
`accepted`·`duplicates` 두 정수이고 합이 배치 수와 같아야 한다. 다르면
`invalid_response`로 보고 재시도한다.

취소는 토큰 획득·요청·응답 읽기·재시도 대기를 모두 덮는다. 중간에 취소되면
`aborted`/`aborted`이고 `retryable: false`다.
호출자가 abort(reason)으로 전달한 원래 객체는 토큰 획득·전송·본문·대기 단계의
의존성 신호에도 그대로 전달한다. 공개 DeliveryResult에는 취소 이유 객체를 넣지 않는다.

토큰 획득은 호스트 함수라 동기 작업이면 이벤트 루프를 점유한다. 그래서 SDK는 요청을 보내기
전에 `host.monotonicNow()`로 시도 기한(`min(전체 재시도 기한, 시도 시작 + requestTimeoutMs)`)을
한 번 더 확인하고, 이미 지났으면 그 시도를 HTTP 요청 없이 끝낸다. 이 시도에서는 HTTP 요청
수를 늘리지 않으며 결과는 `unavailable`/`authentication_unavailable`에 `retryable: true`다.
시도에 넘긴 신호는 정리하며 취소한다. 동기 함수 자체를 중간에 끊지는 못하지만, 같은 이벤트로
새 `send`를 호출해 다시 시도할 수 있다.

응답 헤더를 받은 직후와 정상 영수증 본문을 읽은 뒤에도 같은 단조 시계 기한을 확인한다.
전송·본문 처리의 동기 작업으로 타이머가 늦어져도 기한 이후의 영수증은 성공으로 인정하지
않는다. 이미 전송한 시도는 `unavailable`/`transport_unavailable`로 처리하며, 남은 예산과
시도 횟수 안에서만 원래 배치를 재전송한다. 헤더가 늦으면 본문 정리도 요청한다.
서버에 저장됐을 수 있으므로 새 이벤트를 만들지 말고 기존 이벤트의 식별자와 본문을 유지한다.

시간 초과나 호출 취소 뒤 늦게 도착한 응답은 본문 정리를 요청하고 폐기한다. 이전 시도의
응답이 현재 시도의 HTTP 상태·영수증을 바꾸지 않는다. 거부 응답·유효하지 않은 영수증의
본문과 중단된 reader도 정리하며, 정리 Promise가 실패하거나 멈춰도 결과 판단과 재시도
규칙을 바꾸지 않는다. 401·403·422 같은 거부는 바로 끝내고, 잘못된 영수증은 기존대로
`invalid_response`로 남긴다. 호스트가 취소를 무시하는 전송 구현을 주입했다면 SDK는
그 구현 자체의 종료까지 보장할 수 없다.

## 실패와 재전송

결과가 `rejected`·`unavailable`·`aborted`여도 서버가 이미 저장했을 수 있다. `send`는
영수증을 받은 경우에만 성공으로 보고하므로, 실패하면 보존한 `eventId`·`occurredAt`·본문을
그대로 다시 보낸다. 같은 이벤트의 중복은 서버가 `duplicates`로 세지만 SDK가 정확히 한 번만
전달한다고 보장하지 않는다.

- 지속 큐·아웃박스·재시도 스케줄러는 SDK에 없다. 저장과 재시도 시점은 호스트가 관리한다.
- `getToken`의 실제 발급자 선택과 자격증명 발급은 호스트 책임이다. M2M client secret을
  브라우저나 공개 번들에 넣지 않는다.
- 서버 정의만 있는 레지스트리와 서버 출처 조회 API·화면은 로컬에서 구현·검증했다.
- 실패 후 수동 재시도는 저장해 둔 `metadata`(`eventId`·`occurredAt`·선택 `funnel`)와
  속성을 그대로 넘겨 같은 이벤트로 보낸다.
- 실제 제공자 연결·운영 배포와 원격 D1 적용은 범위 밖이다.

로컬 Miniflare 루프백에서의 재전송 실험은 [서버 SDK 복구 확인](../../tools/runtime/SERVER-RECOVERY.md)에
있다. `npm run verify:server-recovery`가 SDK 기본 `fetch`로 보낸 같은 본문이 재시도되고
수집기가 중복을 정리하는지(before-commit accepted 2·dup 0, after-commit accepted 0·dup 2),
발행자 회수 뒤 `403`이 나는지를 종료 코드 0과 `verified: true`로 확인했다. 원격 D1·실제
OIDC·프로세스 재시작은 이 실험의 범위 밖이다. 최종 검사는 `event_daily_counts`의 이벤트별
`SUM(count)` 2, `funnel_runs` 2건과 두 run의 4단계 `step_times_json`까지 D1 SQL로 직접
확인한다.

## 보안

요청은 `Authorization: Bearer` 헤더와 `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`,
`redirect: 'manual'`, `cache: 'no-store'`를 쓴다. 쿠키·referrer·리다이렉트·캐시를 쓰지 않고,
토큰·원문 입력·원문 오류를 결과나 로그에 넣지 않는다.

리다이렉트 응답은 따라가지 않고 `unavailable`/`invalid_response`로 돌려준다. 이 응답은
자동 재시도하지 않는다. Node와 Worker의 기본 fetch에서 다른 주소로 토큰을 전달하지
않는지 통합 테스트로 확인한다.

[작업 서비스 예제](../../examples/server/README.md)는 검토한 등록 스키마의 서버 정의만
투영한다. 투영 도구는 빌드 시점에만 코어를 읽으며 SDK 번들에는 넣지 않는다.

관련: [서버 발행 이벤트](./server-events.md), [이벤트·집계 계약](./event-contract.md),
[검증](../../VALIDATION.md).

## 재시도 규칙 검증 — 2026-10-12

`retryDelay`의 HTTP-date 판정(`packages/server/src/index.ts`)과 새 회귀 테스트
`packages/server/test/retry-after.test.ts`를 로컬에서 확인했다. 잘못된 요일·없는 날짜(11월
31일·2월 30일)·`24:00`·ISO 형식 헤더 5종을 429·503에 대해 source와 minified SDK로 돌려
`Retry-After`를 무시하고 1s·2s 지수 백오프로 돌아가며 재전송 본문이 같은지 봤다. 수정 전
source·minified 회귀 2개가 실패했고 수정 뒤 `npm run test:server` 31/31이 통과했다. native
`fetch`로 임시 포트의 로컬 HTTP 서버에서 503을 받은 뒤 같은 본문을 다시 보내 중복 영수증까지
확인했고, `npm run build:server`(server SDK 8957 bytes·gzip 3678·런타임 의존성 0, 선언 `tsc`)도
통과했다. 범위는 단위 테스트와 로컬 HTTP 실험이고 실제 운영 OIDC·원격 D1 검사는 하지 않았다.
public API·DB·CI·의존성 변경은 없고 push·배포도 하지 않았다.

