# 서버 발행 이벤트 계약 (코어 슬라이스)

상태: 서버 이벤트의 코어 검증·정규화·해시와 `ServerBatch`·`ServerEvent` 계약까지
로컬에서 구현했다. HTTP 서버 발행 API·서버 인증·DB 저장 경로·서버 SDK·서버 출처
조회 화면은 아직 없다. 이 문서는 이번 슬라이스에서 확정한 것과 아직 계획인 것을 나눠
적는다.

형태는 [OpenAPI](../../api/openapi.yaml), 동작 의미는
[이벤트·집계 계약](./event-contract.md)을 따른다. 브라우저 수집 경로는
[수집기 구현](./collector.md)과 [브라우저 SDK](./browser-sdk.md)에 있다.

## 이번 슬라이스에 포함된 것

- 코어의 `parseServerBatch`·`prepareServerBatch`. 브라우저 `parseBatch`·`prepareBatch`와
  같은 규칙으로 배치 구조·시간 범위·등록 정의를 검사하고 이벤트를 정규화·정렬한다.
  `packages/core/src/batch.ts`·`types.ts`·`value.ts`에 둔다. `parseServerBatch`는
  계약 검증만 하며 발행자 인증과 프로젝트 권한 검사는 하지 않는다. 그 검사는 수집 HTTP
  경계의 몫이고 아직 구현하지 않았다.
- source별 payload hash. 영수증 키와 해시 입력에 출처가 들어가 server 이벤트가
  browser와 같은 해시 바이트를 쓰지 않는다. 브라우저 canonical 해시 입력은 바이트
  그대로 유지한다.
- `planIngest`의 서버 지원. 순수 함수로 영수증과 이벤트 일별 집계 delta만 만들고
  attempt·workflow 상태는 만들지 않는다.
- `ServerBatch`·`ServerEvent` 계약. OpenAPI 스키마·예제·테스트를 함께 둔다.

## 포함되지 않은 것

HTTP 서버 발행 API와 라우트, 서버 인증과 프로젝트 발행 권한 검사, D1 저장 경로
연결, 서버 SDK, 서버 출처 조회 API·화면. 아래 '다음 슬라이스'의 계획이며, 이번
슬라이스만으로 서버 수집이 운영에서 동작한다고 보지 않는다. 라우트 경로와 인증
audience도 정하지 않았으므로 지금은 이름을 확정하지 않는다.

## ServerEvent 계약

`ServerEvent`는 네 필드만 갖는 닫힌 객체다.

- `eventId` — 새 이벤트마다 새로 만드는 소문자 UUIDv4. 재시도는 원래 eventId·
  occurredAt·내용을 그대로 다시 보내며 새 ID를 만들지 않는다. 같은 ID를 다른 이벤트에
  재사용하지 않는다.
- `name` — 프로젝트에 등록된 이벤트 이름.
- `occurredAt` — 실제 달력의 UTC RFC3339 Z. 소수 초는 0~3자리이며 밀리초로
  정규화한다.
- `properties` — 등록 정의의 속성만. boolean·enum·integer와 이벤트당 4개 한도는
  browser와 같다.

`attempt`는 넣지 않는다. server 이벤트에 attempt가 있으면 배치 전체를 거부한다.
출처는 배치 하나로 정하고 `source`는 `server`다. 배치는 최대 20개·16KiB UTF-8이며
`occurredAt`은 수신 시각 기준 과거 24시간~미래 5분만 허용한다.

`name`은 source가 `server`인 등록 정의에서만 고른다. 브라우저 정의로 server 이벤트를
보내거나 server 정의로 browser 이벤트를 보내면 거부한다. v0.1 작업 흐름 정의는 browser
출처만 지원하므로 server 이벤트는 흐름 단계가 되지 않는다.

스키마 검증은 아직 최소 browser 이벤트 하나를 요구한다. 그래서 이번 코어 배치 단계는
server 정의가 섞인 레지스트리로 검증하고, server 정의만 있는 등록 허용은 인증·저장
연결 때 조정할 후속이다.

## 중복·해시

영수증 키는 프로젝트·source·eventId다. payload hash는 프로젝트·스키마 버전·출처와
정규화된 이벤트 전체의 SHA-256이다. canonical 입력 형식은 browser와 같고, server
이벤트는 마지막 attempt 슬롯을 null로 둔다. server 해시에는 attempt 식별자나 내용이
들어가지 않는다.

- 같은 키·같은 내용은 duplicates로 세고 새 영수증·집계를 만들지 않는다.
- 같은 키·다른 내용이나 다른 스키마 버전은 `event_conflict`(409)로 배치 전체를
  거부한다.
- 같은 배치 안에서 같은 eventId가 반복되면 `invalid_event`(422)다.
- 배치는 occurredAt·eventId 순으로 처리한다.

브라우저 canonical 해시 입력은 이번 슬라이스에서 바뀌지 않는다. 이미 저장된 browser
영수증과 비교해도 같은 값이 나온다.

## planIngest 범위

`planIngest`는 I/O 없는 순수 함수다. 입력 snapshot의 영수증을 event_id로 비교하므로
호출자가 그 프로젝트·source에 속한 영수증만 담아야 한다. server 배치에서는 영수증과
이벤트 일별 집계 delta만 만들고 attempt·workflow 상태는 만들지 않는다.

영수증 키에 source를 반영한 DB 저장·조회 연결은 아직 없다. 이번 슬라이스는 server
배치의 검증·정규화·해시와 ingest 계획 함수까지이며, source별 영속과 commit 시점 권한
재검사는 아래 다음 슬라이스에 남는다.

## 아직 정하지 않은 것

- 일일 신규 영수증 한도. 현재 저장 구조는 프로젝트·UTC 수신일 카운터 하나라 browser와
  server가 같은 분모를 쓴다. 서버 수집이 같은 일일 한도를 나눠 쓰는지, 서버에 별도
  분당 허용량을 두는지는 저장·인증 슬라이스에서 정한다.
- 프로젝트별 설정 limits를 browser와 server가 어떻게 나눠 갖는지. 지금은 프로젝트 한
  값을 공유하며, 출처별 한도를 둘지는 계획이다.
- 브라우저 시작과 서버 완료를 연결하는 전환율. 지금은 server 이벤트 건수만 다룰 수
  있고 browser/server 시도 연결은 별도 설계다.
- 서버 발행 인증 방식. 공개 프로젝트 ID와 허용 오리진을 서버 인증 수단으로 재사용하지
  않는다는 것만 정했고, 자격증명 종류·audience·발급 절차는 정하지 않았다.

## 다음 슬라이스

1. 별도 머신 principal 인증과 프로젝트 발행 권한 검사. 관리자 reader/owner grant로
   서버 발행 권한을 추론하지 않는다.
2. DB 저장 경로. source별 영수증과 `event_daily_counts`를 쓰고, commit 저장 시점에
   발행 권한을 다시 검사한다.
3. 전용 서버 발행 endpoint. 경로와 인증 audience는 1~2에서 확정한 뒤 정한다.
4. dependency-free server SDK.
5. 서버 출처 일별 조회 API와 화면. 현재 집계 조회는 `source`가 browser 고정이다.

관련: [이벤트·집계 계약](./event-contract.md), [수집기 구현](./collector.md),
[관리자 조회·설정 경계](./administrator.md), [OpenAPI](../../api/openapi.yaml).
