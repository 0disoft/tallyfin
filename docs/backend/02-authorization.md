# 프로젝트 권한

상태: grant 검사와 로컬 프로젝트 등록·권한 관리 CLI를 구현·로컬 검증했다.
실제 인증 제공자의 사용자 등록과 원격 운영 배포는 아직 없다.

자기 계정만 반환하는 `GET /v1/identity`는 검증된 관리자 bearer가 필요하며 프로젝트
grant는 요구하지 않는다. 이 경로는 DB 접근·다른 계정 조회·권한 부여를 하지 않는다.
프로젝트 관리자 조회마다 검증된 issuer/subject의 project_grants를 확인한다. D1 조회는 매
statement에 `EXISTS (project_grants ... role IN ('reader','owner'))` 조건을 붙이고
정의·버전 읽기와 집계를 한 배치 스냅샷으로 처리한다. reader와 owner는 조회 가능하고
설정 PATCH·스키마 발행 PUT은 owner만 사용할 수 있다. 프로젝트 생성 POST는
`project_creators`의 별도 권한·개수 한도를 요구하고 기존 owner에게서 추론하지 않는다.
생성자의 최초 owner 부여는 생성과 같은 원자 저장에서만 수행한다. 생성 권한 회수는
기존 project_grants를 지우지 않는다. 로컬 [등록·권한 관리 CLI](./provisioning.md)는
DB 파일 접근 권한이 있는 신뢰된 운영자가 실행하며 로그인과 owner 역할을 검사하지
않는다. 첫 owner 등록과 마지막 owner 보호를 지원한다. UI
선택·cursor·공개 projectId로 권한을 얻지 않는다. 프로젝트 목록은 접근 가능한 항목만
ID 오름차순으로 반환하며(limit 기본 25·최대 100, cursor) 모든 페이지에서 권한을 다시
적용한다. 누락/잘못된 인증은 401, 해당 프로젝트 grant 부족은 403, 정의·버전이 없으면
404, 저장소 오류는 503이다.

수집 경계는 프로젝트 활성 상태·등록 버전·browser 출처·오리진·한도를 검사한다.
공개 수집이므로 봇 진위는 보장하지 않으며 IP 악용 방지 정책은 활성화 전에 확정한다.
[관리자 조회 경계](./administrator.md)와 [이벤트 계약](./event-contract.md)을 참고한다.
