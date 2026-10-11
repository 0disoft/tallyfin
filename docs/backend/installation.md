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

검증에서 걸리면 `installation_config_failed` 오류와 함께 어느 입력 항목인지 가리키는 `field`를
하나 돌려준다. 값은 `input`, `admin`, `collector`, `admin.accountId`, `admin.collectorWorkerName`,
`adminOrigin`, `login`, `login.issuer` 중 하나이고 그 밖의 입력값·URL·ID·내부 예외는 출력하지
않는다. 파일 읽기·인자·쓰기 오류처럼 검증 밖에서 난 실패는 기존 고정 오류 그대로이고 `field`를
붙이지 않는다.

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
이메일·브라우저 Origin을 subject로 추측하지 않는다. 최초 생성 권한은 신뢰된 운영자가
[원격 생성 권한 도구](./remote-creator-provisioning.md)의 미리보기와 계획 해시 적용으로
등록할 수 있다. 첫 프로젝트의 owner는 생성 API가 함께 부여한다. 기존 프로젝트 grant를
직접 등록하는 기존 CLI는 로컬만 지원한다. 첫 운영 적용에는 원격 D1 마이그레이션·정리
예약·백업/복구도 필요하며, 도구 구현과 실제 원격 권한 등록 완료를 구분한다.

현재 스키마의 복구 경로는 `npm run verify:restore`로 새 로컬 합성 DB에 연습할 수 있다.
실제 운영 백업·원격 복구와 RTO/RPO 확인은 [백업·복구 절차](../ops/backup-and-restore.md)를 따른다.

현재는 제공자 등록·CORS·JWT 발급·갱신·원격 Worker 연결을 검증하지 않았다.
설정 준비 완료와 운영 로그인 완료를 구분한다.

## 공개 제공자 확인 — `install:check`

```powershell
npm run install:check -- --dir .tmp/installation
```

준비한 설치 디렉터리의 다섯 파일을 다시 검증한 뒤 공개 OIDC discovery와 JWKS를
GET한다. token endpoint에는 진단용 OPTIONS만 보내고, 같은 출처이면 이 요청도 생략한다.
로그인·코드 교환·토큰 발급·갱신·클라이언트 등록·Cloudflare 조회·DB 접근·배포·파일 쓰기는
하지 않는다. 발행자 인증을 켰으면 설정된 발행자 JWKS도 읽는다.

요청은 HTTPS만 허용하고 쿼리·해시·주소의 사용자 정보를 거부한다. 쿠키·인증 헤더·
referrer 없이 보내며 리다이렉트를 따르지 않는다. 요청당 5초·CLI 전체 45초·본문 64KiB·
키 32개 상한을 적용한다. issuer 정확 일치·code 응답·PKCE S256·ID token 알고리즘을
확인하고 공개키를 실제 import한다. RSA는 2048비트 이상, ES256은 P-256이다.

교차 출처 discovery/JWKS GET은 관리자 출처 또는 `*`를 허용하는 CORS 헤더가 필요하다.
같은 출처에는 CORS 헤더를 요구하지 않는다. token OPTIONS 결과는 실제 POST·갱신의
증거가 아니고, 405나 확인 실패는 비차단 `unknown`으로 남긴다. 제공자의 클라이언트·
callback·scope·audience·token type 설정과 실제 로그인을 별도로 확인한다.

`publicChecksPassed`는 필수 공개 검사가 모두 pass일 때만 true다.
`operationalReadinessVerified`는 항상 false이고 `manualRequired` 목록을 함께 반환한다.
필수 검사 실패·미확인은 종료 코드 1이다. 입력·응답 본문·키·주소·식별자는 출력하지 않는다.
자세한 사용법은 [설치 검사 안내](../../tools/runtime/INSTALL-CHECK.md)에 있다.
기준은 [OIDC Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html),
[RFC 8414](https://www.rfc-editor.org/rfc/rfc8414.html),
[CORS 안내](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)를 참고한다.

## 원격 스키마 메타데이터 확인 — `install:database-check`

```powershell
npm run install:database-check -- --remote --dir .tmp/installation
```

준비한 설치 디렉터리의 다섯 파일을 다시 검증하고, 기준 마이그레이션을 이번 실행이 만든 새
인메모리 D1에 적용한 뒤 원격 D1의 `sqlite_master`를 한 번 조회해 테이블·인덱스·트리거의
이름과 정의를 비교한다. 기준은 현재 `0001`~`0008` 여덟 마이그레이션·16개 테이블이고,
발행자 이력 확장도 이 기준에 들어간다. 기존 원격 생성 권한 도구의 설치 Wrangler 전송을
그대로 쓰고 SQL 입력·환경 변수·추가 config 옵션은 받지 않는다.

보고서는 기준·관측 객체 수, 누락·변경 객체 이름(기준 객체만), 예상 밖 객체 개수, 스키마
SHA-256, 대상 해시, 기준 마이그레이션 목록을 담는다. SQL·주소·계정·DB ID·issuer·subject는
출력하지 않는다. `databaseSchemaMatches`가 true여도 `operationalReadinessVerified`는 false이고,
예상과 다르거나 확인하지 못하면 종료 코드 1이다.

원격 쓰기·상품 행 조회·로그인 토큰 발급·grant 부여·원격 마이그레이션·배포는 하지 않는다.
스키마 일치는 데이터 무결성·정리 Cron·백업·로그인을 확인한 결과가 아니다.
운영 설치 묶음이 아직 없어 실제 운영 DB 접속은 확인하지 않았고, 통과 여부는 원격 실행 뒤에 판단한다.
조회 명령은 [D1 Wrangler 안내](https://developers.cloudflare.com/d1/wrangler-commands/#d1-execute)를 따른다.
