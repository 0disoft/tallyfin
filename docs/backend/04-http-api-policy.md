# HTTP API 정책

상태: [OpenAPI](../../api/openapi.yaml) v0.1 계약과 수집·관리자 서버를 로컬 구현·검증했다. 운영 배포는 아직 없다.

공개 수집 POST는 20개/16KiB의 JSON 또는 JSON을 담은 text/plain만 받는다.
Origin을 정확히 허용 목록과 비교하고 CORS credentials를 허용하지 않는다.
OPTIONS는 POST와 Content-Type만 허용한다. 수집에 관리자 자격증명을 요구하거나
bearer로 공개 수집 권한을 높이지 않는다.

서버 수집은 별도 `POST /v1/projects/{projectId}/server-batches`에서 발행자 bearer와
프로젝트 발행 권한을 admission 전에 확인한다. JSON 전용·20개/16KiB·POST 전용이며
쿼리·CORS·preflight를 제공하지 않는다. 기본은 인증을 끈 상태다.
[서버 이벤트 계약](./server-events.md)을 따른다.

중복은 body의 eventId로 판정한다. 같은 ID/내용은 200 duplicates, 내용 충돌은
409이며 배치 전체가 거부된다. unknown field/event/property/version과 잘못된
시간/값을 조용히 건너뛰지 않는다. 일시 실패는 503이다.

관리자 GET은 검증된 주체의 프로젝트 grant를 매번 검사한다. 목록은 100개 이하,
날짜 조회는 보존 범위 안의 31일 이하, 버전/출처는 고정한다. 응답은 no-store이며
오류를 0으로 대신하지 않는다. [세부 계약](./event-contract.md)을 참고한다.

관리자 프로젝트 생성 POST는 별도 생성 권한을 확인한 뒤 16KiB 이하 닫힌 JSON을 읽는다.
최초 owner는 인증된 생성자다. 프로젝트 ID·생성자·초기 요청 해시가 같으면 기존 생성
결과를 200으로 반환하며 현재 설정을 되돌리지 않는다. 설정 PATCH는 owner와 이전
설정 해시, 스키마 PUT은 owner와 최신 버전·개인정보 검토 확인을 요구한다.
모든 관리자 응답은 no-store이며 CORS 허용·쿠키 발급은 하지 않는다.
[관리자 API](./administrator.md)를 따른다.
