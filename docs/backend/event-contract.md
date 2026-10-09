# 이벤트·집계 계약 v0.1

2026-10-08에 v0.1 설계 계약을 확정했다. 코어 검증과 D1 저장 어댑터, 최소 브라우저
수집기, 관리자 조회와 프로젝트 설정 변경(검증기 포트 포함)을 로컬에서 구현·검증했고
서버 수집·운영 배포는 아직 없다. 실제 인증 제공자와 grant provisioning도 후속이다.
원격에 적용한 마이그레이션과 운영 데이터도 없다. 구현 상태는
[수집기 구현](./collector.md)과 [관리자 조회·설정 경계](./administrator.md)에 정리한다. 형태는
[OpenAPI](../../api/openapi.yaml)·[DBML](../../db/schema.dbml), 결정은
[ADR 0005](../adr/0005-event-and-aggregation-contract.md)를 따른다.

일반 이벤트는 각 단계의 발생일에 세고, 완료율은 시작이 실제 수신된 시도 중 성공한
비율로 계산한다. 그래서 두 수치가 다를 수 있다. 입력 검증 오류는 고칠 수 있는
일반 이벤트이며 자동 종료 실패가 아니다. 원문과 영구 방문자 식별자는 저장하지 않는다.

## 등록 정의

프로젝트에는 활성 상태·정확한 오리진 목록·고정 IANA 시간대·분당 요청 한도·UTC
수신일당 신규 영수증 한도를 둔다. 기본 한도는 120회/분, 신규 ID 100,000개/일이다.
오리진은 scheme/host/port만 비교하며 경로·와일드카드·null은 금지한다. 운영은 HTTPS,
로컬 개발만 HTTP를 허용한다. 설정 등록과 변경은 owner 권한으로 검증한다. 프로젝트 생성·
불변 스키마 새 버전 발행·grant 관리는 별도 provisioning CLI가 맡는다. 기존 프로젝트
설정은 관리자 API에서도 변경할 수 있다([관리자 조회·설정 경계](./administrator.md)).

스키마 버전의 events/workflows는 불변이며 변경은 새 버전으로 발행한다. active만
수집하고 retired는 조회만 한다. 여러 active 버전으로 구형 클라이언트를 수용할 수 있다.
최대 이벤트 50종·흐름 10종, 최소 browser 이벤트 하나를 요구한다. server 정의는
예약할 수 있으나 v0.1 수집·조회는 browser만 지원한다. definitions_json은 32KiB 이하다.

속성은 최대 4개, boolean·고정 enum 1~32종·32가지 이하의 정수 범위만 허용한다.
optional 누락도 한 값 종류로 세어 가능한 조합의 곱을 이벤트/흐름 각각 256 이하로
제한한다. 자유 문자열·실수·중첩 객체·배열은 금지한다. 등록에는 purpose를 적고
개인정보 금지 목록을 검토한다. enum 등록으로 계정·주문·입력·결과 정보를 허용하지 않는다.

흐름의 시작·성공·선택 실패 이벤트는 서로 다르고 같은 browser 출처여야 한다.
각 이벤트는 최대 한 흐름의 한 단계에만 속한다. dimensions는 모든 단계에서 필수인
동일 타입/허용 값의 속성이고 한 시도 안에서 값이 바뀌면 거부한다. 고칠 수 있는
validation_error는 일반 이벤트로 둔다. 실패 단계가 없는 흐름도 허용한다.

## 전송·시간·재시도

POST /v1/projects/{projectId}/batches는 source·schemaVersion·events를 받는다.
최대 20개·16KiB UTF-8이며 application/json 또는 text/plain; charset=utf-8로 전송한다.
두 경우 모두 JSON으로 파싱해 같은 스키마로 검사하고 압축 Content-Encoding은 거부한다.
상위/이벤트 객체는 닫힌 필드 집합이고 properties는 등록 정의로 다시 검사한다.
Beacon용 중복 키는 헤더 대신 이벤트 내부에 둔다. Beacon 성공 반환은 저장 성공이 아니다.

eventId·attemptId는 암호학적 난수로 생성한 소문자 UUIDv4다. 생성 실패 시 보내지
않으며 한 이벤트/작업에만 사용한다. 원문·결과·파일·주문·사용자 ID, URL·리퍼러·DOM·
영구 식별자·분석 쿠키를 보내지 않는다. localStorage/sessionStorage도 쓰지 않는다.

occurredAt·startedAt은 실제 달력의 UTC RFC3339 Z 형식, 소수 초 0~3자리다. 내부는
밀리초로 정규화한다. occurredAt은 서버 수신 시각의 과거 24시간~미래 5분만 허용한다.
시작 단계는 occurredAt = startedAt, 종료는 startedAt 이상·24시간 이내다. 클라이언트
시각은 이벤트 진위 증명이 아니다.

SDK는 메모리 버퍼 40개, 20개마다 또는 5초마다 비동기 전송하며 숨김 시 남은 배치를
보내는 시도를 한다. 429·503·네트워크 실패만 최대 2회·총 10분 이내 재시도하며
원래 ID/시각/본문을 유지한다. Retry-After가 예산을 넘으면 버린다. 전송 완료를
업무/렌더링이 기다리지 않는다. 가득 찬 버퍼는 새 이벤트를 버리고, 시작을 버퍼에
넣지 못한 흐름은 종료도 생성하지 않는다. 버퍼 추가를 실제 전달로 판단하지 않는다.

## 중복·원자성

영수증 키는 프로젝트·source·eventId다. 해시는 프로젝트·버전·출처와 정규화된 이벤트
전체의 SHA-256이다. 키 정렬, typed 값/누락 구분, 밀리초 Z 정규화 후 해시한다.
같은 키/내용은 duplicates, 내용이 바뀌면 409로 전체 배치를 거부한다. 다른 버전에서
같은 ID를 재사용해도 409다. 배치 안 같은 ID 반복은 422다.

모든 이벤트를 검사한 뒤 영수증·시도·UTC 수신일 할당량·이벤트/목표 집계를 한 저장
트랜잭션에서 반영한다. 모두 반영하거나 모두 롤백한다. 응답 소실 후에는 원래 ID로
재전송한다. 동시 unique 충돌은 다시 읽어 중복/충돌을 판정하고 두 번 더하지 않는다.
배치 전체가 거부되면 부분 accepted 응답을 만들지 않는다.

호환되는 시도의 같은 단계가 새 eventId로 반복되어도 이미 센 단계는 duplicates다.
새 영수증은 저장하고 UTC 일별 신규 영수증 한도에 포함한다. 완전히 같은 재전송 ID는
새 영수증·집계·일별 한도를 늘리지 않는다. 분당 admission 한도는 중복/잘못된 요청도
포함한다. 성공 응답의 accepted + duplicates는 배치 이벤트 수와 같아야 한다.

저장 어댑터는 `projects.ingest_revision` 기반 CAS 가드로 경합을 한 번만 반영한다.
provisioning에서 활성 스키마 정의가 바뀌거나 관리자 설정 변경이 일어나면 revision이
올라가 fail-closed로 배치를 거부한다. 세부는 [수집기 구현](./collector.md)을 따른다.

## 목표와 날짜

흐름 단계에는 attempt = {workflowId, attemptId, startedAt}을 요구하고 일반 이벤트에는
금지한다. 시도 키는 프로젝트·source·attemptId다. 첫 수신 뒤 버전·흐름·시작 시각·
dimensions를 바꾸면 409다. 시작은 한 번, 종료는 첫 committed 결과만 유지한다.
다른 종료 결과가 뒤에 오면 409다. 동일 배치는 occurredAt·eventId 순으로 처리한다.

종료가 먼저 오면 pending 연결 상태만 두고 목표에는 더하지 않는다. 실제 시작이
도착한 트랜잭션에서 started와 해당 succeeded/failed를 함께 더한다. 시작이 끝내
없으면 목표에서 제외한다. 일반 이벤트 건수에는 각 수신 단계가 발생일에 반영되므로
미연결 종료도 이벤트 표에는 보일 수 있다.

목표 날짜는 프로젝트 시간대의 startedAt 날짜다. succeeded + failed <= started를
유지하며 pending = started - succeeded - failed다. 실패 단계가 없으면 failedAttempts는
null, pending은 started - succeeded다. 완료율은 그 시작 cohort의 succeeded / started
× 100이며 started=0이면 null이다. 날짜 끝 + 48시간까지 provisional=true다. 이후에도
전달 완전성이나 이벤트 진위를 증명하는 수치는 아니다.

서울 10월 8일 23:59:50 시작·10월 9일 00:00:10 완료라면 일반 이벤트 날짜는 다르지만
목표의 시작/완료는 모두 10월 8일이다. 새로고침하면 메모리 연결이 사라지며 서버
완료를 browser 시작에 연결하지 않는다. 예시는 [배치](../../api/examples/browser-batch.json)와
[목표 응답](../../api/examples/workflow-response.json)에 있다.

## 저장·보존

원시 이벤트와 방문자 테이블은 없다. 일반 이벤트는 날짜·프로젝트·버전·출처·이벤트·
검토된 속성 조합별 count, 목표는 시작일·프로젝트·버전·출처·흐름·dimensions별
시작/성공/실패 카운터만 저장한다. dimension_key는 정렬된 typed JSON이며 optional
누락과 false/0/문자열을 구분한다. 한 키는 512bytes 이하이며 해시만으로 속성을 저장하지 않는다.

- 영수증: receivedAt + 48시간.
- 최소 시도 상태: startedAt + 72시간. 삭제 지연 시 읽기에서도 만료를 검사한다.
- UTC 수신일 할당량: 해당 UTC 날짜 끝 + 72시간.
- 집계: 프로젝트-local 오늘과 앞 89일, 총 90개 날짜.
- 설정·grant: 명시적 제거 전까지. 해당 집계가 남은 스키마 정의를 먼저 삭제하지 않는다.

오래된 원래 이벤트는 시간 검사로 거부하므로 영수증 정리 뒤 다시 집계하지 않는다.
악성 입력이 ID의 시각을 새로 쓰는 것은 공개 수집의 한계다. 시간대 변경은 새
프로젝트로 처리한다. count가 안전한 정수 범위를 넘으면 트랜잭션을 중단한다.

## 조회·권한·운영

관리자는 신뢰하는 검증기가 bearer를 issuer/subject로 검증한 뒤 매 요청마다
project_grants를 확인한다. 단순 JWT decode와 화면의 프로젝트 선택은 권한이 아니다.
목록은 접근 가능한 프로젝트만 ID 오름차순으로 반환하며 cursor를 매번 검사한다.
인증 제공자·토큰 발급은 후속 구현이며 설정 없이는 관리자 API를 열지 않는다.
reader/owner는 조회할 수 있고 프로젝트 설정 변경과 provisioning은 owner만 한다.
설정 변경은 저장 시점에 grant를 다시 확인하고 `expectedSettingsHash`가 현재 canonical
해시와 다르면 `settings_conflict`(409)로 거부한다. 수집만 일어난 경우는 충돌이 아니다.
관리자 조회·설정 변경과 grant 조건 검사는 로컬에서 구현·검증했다.

집계 조회는 정확한 schemaVersion, 프로젝트-local from/to, 보존 90일 안에서 최대 31일,
from <= to <= 오늘을 요구한다. browser 한 출처/한 버전만 집계한다. 이벤트 표는
한 이벤트·선택 속성 하나로 그룹화하고 빈 날짜는 0, 빈 목표 날짜의 완료율은 null이다.
저장 실패·권한 거부를 0으로 위장하지 않는다. coverage는 observed-only이며
latestReceivedAt=null은 아직 신규 영수증을 받은 적이 없다는 뜻이다. 5분 클라이언트
시각 오차로 내일 날짜에 저장된 이벤트는 해당 날짜가 조회 범위에 들어올 때 보인다.

CORS는 허용 오리진만 정확히 반사하고 Vary: Origin, credentials=false로 처리한다.
공개 수집에 bearer로 권한을 높이는 경로는 없다. 응답은 no-store이며 분석 쿠키를
발급하지 않는다. 요청 원문·토큰·IP·Origin·전체 URL은 로그/분석 DB에 남기지 않는다.
진단에는 임시 requestId와 고정 오류 코드만 쓴다. 악용 방지용 IP 처리/보존·edge
rate-limit 구현은 활성화 전에 정한다. 이 계약만으로 봇 차단을 완료했다고 주장하지 않는다.
