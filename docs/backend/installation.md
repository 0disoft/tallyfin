# 운영 설치 설정 준비

상태: 같은 출처 경로·OIDC 클라이언트·서버 검증기와 로컬 설정 도구는 구현했다.
실제 제공자·계정·도메인·D1 값과 원격 설치 검증은 아직 없다. 아래 명령은 로컬 파일만
준비한다. 등록·권한 부여·원격 DB 적용·배포를 자동 실행하지 않는다.

## 입력 준비

실제 값으로 채운 `.tmp/installation-input.json`을 만든다. JSON 최상위 키는 다음 네 개다.

| 키 | 값 |
| --- | --- |
| `adminOrigin` | 최종 관리자 HTTPS 출처. 경로·쿼리·해시·포트·끝 `/` 없이 입력한다. |
| `admin` | [관리자 타깃](./runtime.md#관리자-worker-배포-준비)의 `workerName`, `accountId`, `collectorWorkerName`, `workersDev`, 선택 `domain`. |
| `collector` | [수집기 타깃](./runtime.md#배포-준비)의 `workerName`, `accountId`, `databaseName`, `databaseId`, `workersDev`, `settings`. |
| `login` | 공개 OIDC 클라이언트의 `issuer`, `clientId`, `scope`, 선택 `resource`, `idTokenAlgorithm`. |

`admin.accountId`와 `collector.accountId`는 같고, `admin.collectorWorkerName`은
`collector.workerName`이어야 한다. 관리자 출처는 설정한 custom domain 또는 해당
관리자 Worker의 실제 workers.dev 주소여야 한다. 수집기의 `ADMIN_AUTH_MODE=oidc`,
`ALLOW_LOCAL_HTTP=false`, OIDC issuer·API audience·JWKS URI가 필수다.
`login.issuer`는 수집기의 `OIDC_ISSUER`와 끝 `/`까지 정확히 일치해야 한다.
scope에는 `openid`를 포함한다. ID token 서명 알고리즘과 access token 알고리즘은
서로 다른 설정이다. 제공자에 등록한 실제 값을 사용하고 임의로 추정하지 않는다.

클라이언트는 비밀값 없는 public client와 Code+PKCE(S256)다. 비밀키·토큰·client secret은
입력에 넣지 않는다. 설정은 32KiB 이하 닫힌 JSON이고 알려지지 않은 키는 거부한다.
`resource`와 API audience의 매핑은 제공자가 결정하므로 둘이 같다고 추정하지 않는다.
주소·ID의 문법 검사는 리소스 소유권·실제 존재를 확인하지 않는다.

## 설정 묶음 생성

```powershell
npm run install:prepare -- --file .tmp/installation-input.json --out .tmp/installation
```

출력 디렉터리는 새 경로여야 한다. 이미 있으면 파일을 수정하지 않고 실패한다.
검증을 모두 마친 뒤 디렉터리를 만들고 다음 파일을 쓴다.

| 파일 | 용도 |
| --- | --- |
| `collector.wrangler.json` | 실제 계정·D1·서버 OIDC 검증 설정. |
| `admin.wrangler.json` | 같은 계정 수집기 바인딩·관리자 route. 자산 경로는 이 묶음의 `admin-assets`. |
| `admin-login.json` | 공개 `VITE_OIDC_` 설정만 포함하는 관리자 빌드 입력. |
| `oidc-registration.json` | 제공자에 등록할 정확한 callback·CORS 출처·PKCE·access token 요구 값. |
| `installation.json` | 검증한 입력의 재현용 스냅샷. 자격 증명은 허용하지 않는다. |

서버/DB 설정을 프론트엔드 환경 변수로 복사하지 않는다. 생성 디렉터리는 공개 정적
자산 디렉터리에 넣지 않는다. 파일 쓰기 실패 시 이번 실행이 쓴 파일만 정리하고,
디렉터리에 다른 파일이 있으면 제거하지 않는다. 입력·예외 원문은 로그에 출력하지 않는다.

## 제공자와 운영 확인

`oidc-registration.json`을 기준으로 제공자에 public client·callback·관리자 CORS 출처를
등록한다. discovery·token·JWKS가 HTTPS이고 S256을 지원해야 한다. API에는 ID token이
아닌 등록 audience의 서명된 JWT access token을 발급해야 한다. refresh token을
사용하면 회전해야 하며, 없으면 만료 후 다시 로그인한다. [OIDC 정책](./oidc.md)을 따른다.

실제 로그인 뒤 확인한 issuer/subject로 관리자 grant를 부여한다. 공개 client ID·
이메일·브라우저 Origin을 subject로 추측하지 않는다. 첫 운영 적용에는 원격 D1
마이그레이션·최초 grant 제공 경로·정리 예약·백업/복구도 필요하다. 기존 등록 CLI는
로컬만 지원하므로 원격 권한 등록을 완료했다고 간주하지 않는다.

현재는 제공자 등록·CORS·JWT 발급·갱신·원격 Worker 연결을 검증하지 않았다.
설정 준비 완료와 운영 로그인 완료를 구분한다.
