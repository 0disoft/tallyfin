# 프로젝트 권한

상태: grant 검사를 관리자 조회 경로에 구현·로컬 검증했다. 실제 grant provisioning과
운영 배포는 아직 없다.

관리자 조회마다 검증된 issuer/subject의 project_grants를 확인한다. D1 조회는 매
statement에 `EXISTS (project_grants ... role IN ('reader','owner'))` 조건을 붙이고
정의·버전 읽기와 집계를 한 배치 스냅샷으로 처리한다. reader와 owner는 조회 가능하고
owner만 별도 provisioning으로 설정을 등록한다. 설정 쓰기 HTTP API는 없다. UI
선택·cursor·공개 projectId로 권한을 얻지 않는다. 프로젝트 목록은 접근 가능한 항목만
ID 오름차순으로 반환하며(limit 기본 25·최대 100, cursor) 모든 페이지에서 권한을 다시
적용한다. 누락/잘못된 인증은 401, 해당 프로젝트 grant 부족은 403, 정의·버전이 없으면
404, 저장소 오류는 503이다.

수집 경계는 프로젝트 활성 상태·등록 버전·browser 출처·오리진·한도를 검사한다.
공개 수집이므로 봇 진위는 보장하지 않으며 IP 악용 방지 정책은 활성화 전에 확정한다.
[관리자 조회 경계](./administrator.md)와 [이벤트 계약](./event-contract.md)을 참고한다.
