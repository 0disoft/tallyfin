# 인증 경계

상태: 검증기 포트·관리자 401 닫힘과 OIDC JWT 서명 검증 어댑터를 구현·로컬 검증했다.
실제 인증 제공자·브라우저 로그인·토큰 발급/갱신·운영 배포는 아직 연결하지 않았다.

관리자 bearer는 신뢰하는 검증기를 거쳐 issuer/subject로 변환한다. 검증기는
서명·신뢰하는 발급자·대상·유효기간을 확인해야 한다. 단순 decode로 인증하지 않는다.
인증 제공자/검증기가 설정되지 않은 배포는 관리자 API를 비공개로 닫는다.
호스트는 `createWorker(verifyBearer)`로 검증기를 연결하고, 기본 export는 검증기 없이
만들어져 관리자 경로를 401로 닫는다. Tallyfin이 자체 가입·토큰 발급 시스템을
구현한다고 가정하지 않는다. 호스트 연결과 조회 경로는
[관리자 조회 경계](./administrator.md)에 둔다.

호스트는 `createOidcWorker(options)`로 OIDC JWT access token 검증기를 연결할 수
있다. 설정·공개키 캐시·지원 프로필과 한계는 [OIDC 어댑터](./oidc.md)에 있다.

공개 browser 수집에는 관리자 토큰을 보내지 않으며 projectId·Origin은 인증이 아니다.
server 수집은 v0.1에서 거부하고 서버 자격증명 설계는 후속이다.
[이벤트 계약](./event-contract.md)을 참고한다.
