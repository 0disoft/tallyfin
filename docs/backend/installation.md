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

## 관리자 빌드와 업로드 없는 검사

```powershell
npm run admin:build-configured -- --dir .tmp/installation
npm run admin:dry-run -- --config .tmp/installation/admin.wrangler.json
npm run collector:dry-run -- --config .tmp/installation/collector.wrangler.json
```

관리자 빌드는 `installation.json`에서 입력을 다시 검증하고 생성한 네 설정 파일을
다시 비교한다. 특정 파일만 수정했거나 디렉터리를 옮겨 절대 경로가 달라졌으면 빌드
전에 거부한다. 값을 바꾸려면 입력을 수정한 뒤 새 설치 디렉터리를 생성한다.
공개 login JSON만 Vite define으로 넣고 `.env`와 부모 프로세스의 `VITE_` 값을
읽지 않는다. production 모드로 빌드하고 개발용 proxy 설정도 적용하지 않는다.
근거는 [Vite 설정](https://vite.dev/config/shared-options.html)과 실제 빌드 검사다.

산출물은 생성한 config가 가리키는 `admin-assets`에만 쓰며 기존 앱의 `dist/client`나
다른 설치 묶음을 수정하지 않는다. 새 자산 디렉터리만 허용하고 성공한 뒤
`admin-build.json`을 남긴다. 실패한 빌드의 부분 파일은 보존한다. 기존/실패한 빌드를
덮어쓰려 하지 말고 새 설치 디렉터리를 준비한다. 다른 호스트에서 사용하려면 그
호스트에서 다시 설정을 생성하고 빌드한다.

`admin:dry-run`은 선택한 config 하나만 설치된 Wrangler에 전달하고 `--dry-run`을
고정한다. `--config`·`--outdir` 외 옵션과 중복 옵션은 거부한다. 기본 config는
타입/패키지 확인용이다. 성공은 로컬 패키징 확인이며 로그인·DNS·원격 바인딩·DB를
검증한 결과가 아니다. 실제 배포는 검토·승인한 후속 작업이다.

## 제공자와 운영 확인

`oidc-registration.json`을 기준으로 제공자에 public client·callback·관리자 CORS 출처를
등록한다. discovery·token·JWKS가 HTTPS이고 S256을 지원해야 한다. API에는 ID token이
아닌 등록 audience의 서명된 JWT access token을 발급해야 한다. refresh token을
사용하면 회전해야 하며, 없으면 만료 후 다시 로그인한다. [OIDC 정책](./oidc.md)을 따른다.

실제 로그인 뒤 관리자 화면의 `로그인 계정 확인`을 펼쳐 서버가 검증한 issuer/subject를
읽고 계정 정보 JSON을 복사한다. 프로젝트 권한이 없어도 자기 계정 조회는 가능하다.
복사한 식별자를 신뢰된 운영자가 확인한 뒤 필요한 생성 권한·관리자 grant를 부여한다. 공개 client ID·
이메일·브라우저 Origin을 subject로 추측하지 않는다. 첫 운영 적용에는 원격 D1
마이그레이션·최초 grant 제공 경로·정리 예약·백업/복구도 필요하다. 기존 등록 CLI는
로컬만 지원하므로 원격 권한 등록을 완료했다고 간주하지 않는다.

현재는 제공자 등록·CORS·JWT 발급·갱신·원격 Worker 연결을 검증하지 않았다.
설정 준비 완료와 운영 로그인 완료를 구분한다.
