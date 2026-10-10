# 서버 작업 이벤트 예제

`job-analytics.ts`는 `api/examples/job-registry.json`의 서버 정의를 투영한 예제다.
수집 대상은 작업의 성공/실패 분류와 재시도 여부이고 작업 ID·입력·결과 원문은 넣지 않는다.
이 예제는 서버 이벤트만 등록하고 브라우저 허용 출처와 작업 흐름은 빈 배열로 둔다.

설치한 서비스는 `@tallyfin/server`에서 가져온다. 이 저장소의 상대 경로 import는
체크아웃 안에서 예제를 검증하기 위해 사용한다. 실제 endpoint와 전용 발행자 토큰을
얻는 `getToken(signal)`은 서비스가 제공하고 토큰을 소스·로그에 넣지 않는다.

등록 정의가 바뀌면 `tools/server/schema.mjs`의 `projectServerSchema`로 서버 정의만
다시 투영한다. 이 도구는 Node의 빌드 단계에서 사용하며 런타임 SDK에 포함하지 않는다.
브라우저 이벤트 없이 서버 전용 프로젝트로 등록할 수 있다. 빈 허용 출처 목록은 브라우저
수집을 차단하며 서버 발행에는 전용 발행 권한·인증이 필요하다.

전송은 `await client.send([event], { signal })`로 결과를 확인한다. 실패 시 이미 저장됐을
수 있으므로 eventId·occurredAt·속성을 그대로 보존해 재전송한다. 새 이벤트를 만들면
별도 집계가 된다. SDK에는 영속 큐가 없고 재전송 저장·시점·업무 처리와의 분리는 서비스가
결정한다. 입력 시각은 최근 24시간 범위 안이어야 한다.

`apps/collector/test/server-sdk.test.ts`는 Node 기본 fetch와 실제 Worker 기본 fetch,
서명된 임시 테스트 토큰·발행 권한·로컬 D1 저장을 함께 확인한다. 응답 유실 재전송,
중복·내용 충돌, 리다이렉트 차단과 발행 권한 회수를 검사하고 로컬 서버를 정리한다.
실제 제공자·원격 DB·배포는 실행하지 않는다.

관련: [서버 SDK](../../docs/backend/server-sdk.md), [검증 기록](../../VALIDATION.md).
