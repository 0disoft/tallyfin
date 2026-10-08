# 관리자 API 연결

상태: 계약만 확정, 프로토타입은 샘플 데이터 상태.

[OpenAPI](../../api/openapi.yaml)의 프로젝트 목록·스키마·이벤트 요약·일별 이벤트·
일별 목표 GET을 연결할 예정이다. 실제 연결 전 서버의 인증/프로젝트 grant를 구현한다.
기간은 프로젝트의 고정 시간대로 해석하고 정확한 schemaVersion을 함께 요청한다.
API meta의 timeZone·coverage·latestReceivedAt을 샘플 UI의 가짜 값으로 대체하지 않는다.

완료율은 workflow 응답을 사용하고 이벤트 합계끼리 나누지 않는다. 실패 단계 없는
목표는 failedAttempts=null, 분모 없는 완료율은 null이다. 401/403/503을 각각 표시하고
서로 다른 프로젝트/버전의 응답이 뒤늦게 화면을 덮어쓰지 않게 취소/세대 검사를 적용한다.
현재 React/Recharts 샘플 UI는 운영 인증이나 전환 집계가 구현됐다는 증거가 아니다.
