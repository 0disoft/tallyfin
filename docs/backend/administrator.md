# 관리자 조회·설정 경계 (apps/collector)

상태: 관리자 조회(GET)·프로젝트 설정 조회/변경(PATCH)·검증기 포트·OIDC JWT 서명 검증
어댑터를 로컬에서 구현·검증했다. 실제 인증 제공자·로그인 흐름·토큰 발급과 운영 설정은
아직 연결하지 않았다.

호스트는 `createWorker(verifyBearer)`로 신뢰하는 검증기를 연결한다. `verifyBearer`는
서명·신뢰하는 발급자·대상·유효기간을 확인한 뒤 `{ issuer, subject }`를 돌려주거나
null을 돌려준다. `apps/collector/src/index.ts`의 기본 export는 검증기 없이 만들어져
관리자 경로를 401로 닫는다. 검증기가 없거나 bearer·issuer·subject가 비면 401이다.
프로젝트 설정 경로는 GET·PATCH를 받고 그 밖은 405(Allow: GET, PATCH), 나머지 조회
경로는 GET이 아니면 405(Allow: GET)다.

저장소 루트의 호스트 어댑터 파일 예시다. `@tallyfin/collector` 패키지에는 `exports`가
없으므로 소스 경로로 가져온다. `hostVerify`는 호스트가 채워야 할 자리이고 이 저장소에는
구현이 없다.

```ts
// worker.ts (호스트 어댑터, 저장소 루트)
import { createWorker } from './apps/collector/src/index.ts';

export default createWorker(bearer => hostVerify(bearer));
```

일반 JWT access token 제공자에는 `createOidcWorker(options)`도 사용할 수 있다.
운영자가 issuer·API audience·HTTPS 공개키 주소를 지정한다. 지원 프로필과 캐시
갱신 한계는 [OIDC 어댑터](./oidc.md)에 설명한다.

검증된 issuer/subject로 매 조회마다 `project_grants`의 role(reader/owner)을 확인한다.
화면 선택·cursor·공개 projectId로 권한을 얻지 않는다. grant가 없으면 403, 정의·버전이
없으면 404, 저장소 오류는 503이다. 단순 JWT decode로 인증하지 않는다.

지원 조회 경로는 아래 GET이고, 쓰기는 프로젝트 설정 PATCH 하나뿐이다.

- `GET /v1/projects` — 접근 가능한 프로젝트 목록. limit 기본 25·최대 100, cursor 페이지.
- `GET /v1/projects/{projectId}` — 현재 설정과 settingsHash. reader/owner.
- `GET /v1/projects/{projectId}/schemas/{schemaVersion}` — 불변 레지스트리 스냅샷.
- `GET /v1/projects/{projectId}/summary` — 한 버전·기간의 이벤트별 건수.
- `GET /v1/projects/{projectId}/events/{eventName}/daily` — 일별 건수와 선택 속성 버킷.
- `GET /v1/projects/{projectId}/workflows/{workflowId}/daily` — 시작일 cohort.

집계 조회는 정확한 schemaVersion, 프로젝트 시간대의 from/to, 보존 90일 안에서 최대
31일을 요구한다. retired 버전과 paused 프로젝트도 같은 grant로 조회한다. 빈 날짜는 0으로
채우고, 흐름 완료율은 시작 cohort의 succeeded/started이며 실패 단계가 없으면
failedAttempts는 null, 날짜 끝 + 48시간까지 provisional=true다.

## 프로젝트 설정 조회·변경

`GET /v1/projects/{projectId}`는 reader/owner에게 `{project, allowedOrigins, limits,
settingsHash, canEdit}`를 돌려준다. `canEdit`는 요청을 보낸 검증된 principal이 그
프로젝트의 owner grant를 가졌는지 나타내는 snapshot boolean이라 reader에게는 false다.
paused 프로젝트도 조회하고 schemaVersion은 요구하지 않는다. settingsHash는
`project`·`allowedOrigins`·`limits`의 canonical JSON SHA-256이라
ingest_revision·집계·스키마는 해시에 들어가지 않고 `canEdit`도 해시에서 제외한다.

`PATCH /v1/projects/{projectId}`는 owner 전용이다. 본문은 UTF-8 16KiB 이하
`application/json` 또는 `text/plain`(identity 인코딩)이고 닫힌 JSON으로 검증한다.
`name`·`status(active/paused)`·`allowedOrigins`·`limits`만 바꿀 수 있고 보낸 limits
키만 병합한다. `expectedSettingsHash`와 변경할 항목이 최소 하나 필요하다. allowedOrigins는
정확한 HTTPS origin만 받고, 명시적으로 켠 `allowLocalHttp`에서만 loopback HTTP를
허용한다. `id`·`timeZone`·`schemas`·`grants`·`aggregates`는 바꿀 수 없고 이미
사용한 한도와 기존 스키마·데이터는 그대로 둔다.

`canEdit`는 조회 스냅샷의 표시용 값이라 저장 권한 판단에 그대로 쓰지 않는다. 변경은
저장 시점에 grant를 다시 확인하고 `expectedSettingsHash`를 현재 값과 비교해 원자
UPDATE로 반영한다. owner 자격이 회수되면 403, 해시가 오래됐거나 다른 설정 변경과
겹치면 `settings_conflict`(409)다. 수집만 일어나 ingest_revision이 올라간 경우는 충돌이
아니다. 설정 변경은 ingest_revision을 1 올려 진행 중인 수집의 충돌 검사와 맞물린다. 응답이
유실되거나 409를 받으면 현재 설정을 다시 읽어 비교한 뒤 재시도하고, 새 해시를 그대로
덮어쓰지 않는다.

프로젝트 생성·불변 스키마 새 버전 발행·grant 관리는 기존 provisioning CLI가 맡는다.
grant provisioning API, 인증 제공자 설정, 원격 배포는 후속이다. 요청·응답 형태는
[OpenAPI](../../api/openapi.yaml)를 따르고, 동작 의미는
[이벤트·집계 계약](./event-contract.md)을 따른다.
