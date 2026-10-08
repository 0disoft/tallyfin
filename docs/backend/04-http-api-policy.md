# HTTP API 정책

상태: [OpenAPI](../../api/openapi.yaml) v0.1 계약, 서버 미구현.

공개 수집 POST는 20개/16KiB의 JSON 또는 JSON을 담은 text/plain만 받는다.
Origin을 정확히 허용 목록과 비교하고 CORS credentials를 허용하지 않는다.
OPTIONS는 POST와 Content-Type만 허용한다. 수집에 관리자 자격증명을 요구하거나
bearer로 공개 수집 권한을 높이지 않는다.

중복은 body의 eventId로 판정한다. 같은 ID/내용은 200 duplicates, 내용 충돌은
409이며 배치 전체가 거부된다. unknown field/event/property/version과 잘못된
시간/값을 조용히 건너뛰지 않는다. 일시 실패는 503이다.

관리자 GET은 검증된 주체의 프로젝트 grant를 매번 검사한다. 목록은 100개 이하,
날짜 조회는 보존 범위 안의 31일 이하, 버전/출처는 고정한다. 응답은 no-store이며
오류를 0으로 대신하지 않는다. [세부 계약](./event-contract.md)을 참고한다.
