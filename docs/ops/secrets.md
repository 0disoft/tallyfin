# 시크릿

상태: 문서 전용 계약이다. 실제 운영 값·토큰 저장소·vault는 정하지 않았다(UNDECIDED). 소스와
파일 이름만 확인했고 토큰 평문 값이나 자격 증명·provider 명령은 열어 보거나 실행하지 않았다.
시크릿 스캔은 하지 않았으니 이 문서는 소스·파일 이름 검토 결과만 담는다.

## 공개 설정과 시크릿 구분

| 구분 | 예 | 다루는 곳 |
| --- | --- | --- |
| 공개 설정 | 프로젝트 ID, issuer·API audience·JWKS URL, 공개 OIDC clientId, 관리자 로그인 빌드 입력 | 설치 묶음·로그인 JSON |
| 시크릿 | 관리자 access·refresh token, 서버 발행자 bearer와 그 취득 자격 증명, 제공자 서명 개인키, Wrangler API/OAuth 인증 | 호스트 보관, 저장소 밖 |
| 제한 자료 | 운영 SQL 백업·관리자 감사 이력(토큰은 아니지만 접근 제한) | 접근 제한 저장소 |

브라우저 로그인 빌드 입력(VITE_ 값)은 공개 번들에 들어가도록 의도한 값이다. 반면 설치 묶음 전체는
계정·서비스·관리자 출처 같은 운영 대상 값을 담으므로 파일을 통째로 접근 제한한다.

- 설치 묶음은 닫힌 JSON이라 모르는 키와 시크릿·토큰·clientSecret 이름의 키를 거부한다. 다만
  허용된 문자열 필드(clientId·audience 등)에 시크릿 값을 붙여넣은 경우는 의미로 걸러내지 못한다.
  자동 시크릿 스캔은 없고 공개 필드 값 검토는 사람이 한다.
- 묶음 자체는 정적 자산 디렉터리에 두지 않는다.
- 관리자 로그인은 공개 클라이언트 Code+PKCE(S256)이고 client secret을 쓰지 않는다. Tallyfin은
  제공자의 JWKS 공개키만 검증하고 제공자 개인키를 저장하지 않는다.
- 서버 SDK는 토큰을 지속 저장하지 않고 시도마다 호스트의 getToken을 부른다. 그 토큰은 호스트가 얻은
  bearer이며 clientSecret이 Tallyfin으로 전달되지 않는다. 실제 발급자 선택과 자격 증명 발급은
  호스트 책임이다.

## 브라우저 토큰 보관

- 관리자 access·refresh token은 인스턴스 메모리 `#tokens`에만 둔다. 받아들이는 access token의
  `expires_in` 상한은 24시간이고 실제 만료는 제공자가 정한다. refresh token의 수명은 제공자가
  정하며 아래 갱신 규칙에 따라 회전을 요구한다.
- 저장소에 남는 유일한 쓰기는 sessionStorage 키 tallyfin.oidc.transaction.v1이다. state·nonce·
  PKCE verifier·설정·createdAt을 10분 TTL로 검증한다.
- 이 TTL은 검증용이며 예약 자동 삭제가 아니다. complete()가 콜백 await 전에, destroy()가 비울
  때 지운다. 콜백·destroy 없이 탭을 열어 두면 오래된 항목이 남을 수 있다.
- ApiClient.destroy는 #token·#getBearer·controllers를 비우고 onDestroy를 부른다. provider logout·
  폐기 endpoint는 없다. 참조 해제·중단은 OS 메모리 안전 삭제나 XSS·악성 확장 차단의 증거가
  아니다.
- 콜백 진입 코드는 주소에서 code·state·오류를 discovery·렌더 전에 지운다. 제공자·프록시 로그는
  우리가 지우지 못한다.
- PKCE verifier와 auth code는 민감한 일시 값이므로 보고서나 로그에 남기지 않는다. PKCE 거래의
  검증 유효기간은 10분이며 auth code의 수명은 제공자가 정한다.
- 갱신은 회전된 refresh_token을 요구하고 갱신 실패·불명확은 로컬 세션을 비우며 재생하지 않는다.
  제공자 전역 폐기 호출은 없다. 관리자 API 수동 bearer는 인스턴스 private 메모리다.

## 저장소·CI 차단

- .gitignore는 .env·.env.*·.dev.vars·.dev.vars.*·.tmp·.wrangler를 제외하고 .env.example은
  허용한다. 제외는 암호화가 아니고 이미 커밋된 이력을 지우지 않으며, 이미 추적 중인 파일이나
  이력에 남은 백업을 숨기지도 못한다.
- 추적되지 않는 .env를 지원하더라도 .env.example과 VITE_ 필드에는 시크릿을 넣지 않는다.
- admin:build-configured는 .env·주변 VITE_ 값을 읽지 않고(envDir false·envPrefix []) 검증한
  로그인 JSON만 쓴다. 출력은 배타적 admin-assets에만 둔다.
- 현재 체크아웃 .github에는 주석 처리된 CODEOWNERS와 issue·PR 템플릿만 있고 Actions 워크플로가
  없다. 원격 CI secret store나 rotate 도구는 점검하지 않았으니 그 상태는 UNDECIDED·미확인이다.
- VITE_ 값은 공개 번들에 들어가므로 시크릿을 넣지 않는다.
- 생성 파일에 지정한 mode 0600/0700으로 Windows ACL까지 보장하지 않는다. OS ACL·암호화는
  운영자가 따로 정하며 UNDECIDED다.

## 입력·로그 규칙

- install:access-check는 이미 발급된 bearer를 비대화형 표준 입력(--token-stdin)에서만 받는다.
  인자·파일·대화·보고서·로그에 남기지 않고 TTY 입력은 거부한다.
- 토큰·원문·오류 원문을 출력에 넣지 않는다. 노출된 시크릿 값은 붙여 넣지도, 해시로 남기지도
  않고, 비밀이 아닌 산출물 파일 해시·고정 코드·credential reference로만 다룬다.
- 완료 관측 로그 투영은 URL·쿼리·헤더·주체(principal)를 제거하고 고정 필드만 남긴다. 원문 시크릿
  값이나 시크릿 해시를 일반 로그 식별자로 쓰지 않는다.
- credential dump·shell 환경 덤프·자격 증명 목록 출력을 하지 않는다.

## 수명주기·인벤토리

- 인벤토리는 credential reference·owner·purpose·provider/audience/scope·만료·회전 시각만 접근
  제한하에, 최소 권한으로 둔다. 원문 시크릿이나 시크릿 해시를 일반 식별자로 쓰지 않는다. 준비
  묶음 같은 산출물 파일 SHA-256은 허용한다.
- 현재 소스 패키지는 API-key vault나 rotate scheduler를 갖지 않는다. 자동 회전·폐기 worker도 없다.
  없는 일정·운영자·자격 증명을 만들지 않는다.
- vault·KMS 같은 저장소 backend는 UNDECIDED다.
- 제공자별 토큰 명령이 필요하면 소스 문서를 먼저 확인한다. 이 문서는 새 CLI를 만들지 않고 provider
  책임을 기존 운영 런북에 연결한다.

## 노출 대응

- 확인된 노출은 이미 승인된 범위 안에서 먼저 멈춘다(노출 경로·writer·공유 중지).
- provider 토큰 폐기와 접근 확인, D1의 grant·발행자·생성 권한 확인을 따로 한다. 인증을 꺼서
  조사하지 않는다. 삭제한 public clientId가 이미 발급된 토큰을 무효화한다고 주장하지 않는다.
- 마지막 owner 하나만 침해됐으면 last_owner가 회수·강등을 막는다. 노출된 관리자 경로를 막고
  독립적으로 검증된 신뢰 owner를 먼저 세운 뒤 회수한다. 인증 비활성화나 불변식 우회로 풀지 않는다.
- JWKS 캐시 10분·쿨다운 30초 때문에 키 회전이 캐시된 토큰을 즉시 무효화하지 않고 로그아웃도
  폐기가 아니다. 기존 JWT는 provider 폐기·만료·캐시 키 정책 전까지 유효할 수 있고, D1 권한
  거부는 별개다. SQL 복원은 회수된 권한을 되살릴 수 있으니 트래픽 전환 전에 다시 확인한다.
- 최소 원문만 접근 제한으로 보존하고, 상세 절차는 [장애 대응](./incident-response.md)을 따른다.

## Owners

- Primary owner: UNASSIGNED
- Backup owner: UNASSIGNED
- Escalation path: UNDECIDED

## Validation

- 필수 검증 이름: [VALIDATION.md](../../VALIDATION.md)
- 릴리스 차단 여부: UNDECIDED
- 남은 운영 위험: UNDECIDED

## 근거

- [OIDC](../backend/oidc.md), [설치](../backend/installation.md), [서버 SDK](../backend/server-sdk.md)
- [장애 대응](./incident-response.md), [릴리스](./release.md), [백업·복구](./backup-and-restore.md)
