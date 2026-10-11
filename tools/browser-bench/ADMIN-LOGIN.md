# 관리자 로그인 검증 — `verify:admin-login`

실제 관리자 앱 코드를 Vite로 띄우고 헤드리스 브라우저로 OIDC 로그인, 회전 갱신, 연결 해제를
끝까지 지나간다. 격리된 Miniflare 수집기·D1과 실행 중에 만든 서명 키만 쓰고 외부 네트워크는
열지 않는다. `npm run check`에는 연결하지 않았고 필요할 때만 돌린다. 통과 여부는 실행할 때마다
표준 출력으로 확인한다.

## 설치와 실행

Node 24 이상을 쓰고 루트와 측정 폴더 의존성을 각각 설치한다.

```powershell
npm ci --ignore-scripts
npm ci --prefix tools/browser-bench --ignore-scripts
npm run verify:admin-login
```

```powershell
npm run verify:admin-login -- --channel chrome
```

Playwright는 `tools/browser-bench`에만 설치되는 개발용 의존성(`^1`)이며 SDK·수집기와 기본
CI 검사에는 들어가지 않는다. Chromium을 쓰려면 [측정 도구 안내](./README.md)의 설치 명령으로
전용 브라우저를 먼저 내려받는다. 실행 중에 브라우저를 자동으로 설치하지 않고 개인 브라우저
프로필도 쓰지 않는다. 브라우저 실행 파일을 못 찾으면 채널을 고르거나 Chromium을 설치한다.

## 옵션

| 옵션 | 기본 | 뜻 |
| --- | --- | --- |
| `--channel` | `chromium` | `chromium`·`chrome`·`msedge` 중 하나만 받는다. 다른 값은 `arguments` 단계에서 실패한다. |
| `--help` | | 실행하지 않고 사용법만 출력한다. |

## 확인하는 항목

이 도구는 [Vite 관리자 앱](../../apps/admin/README.md)과 [브라우저 관리자 로그인](../../docs/backend/oidc.md#브라우저-관리자-로그인)
계약을 그대로 실행한다.

- 관리자 로그인 버튼에서 제공자 인가로 넘어가 `/auth/callback`으로 돌아온다. 인가 요청은
  PKCE S256이고 `code_verifier`를 싣지 않는다.
- 콜백의 code·state는 첫 렌더링 전에 주소에서 지워진다. code는 한 번만 교환되고 nonce가
  ID token과 맞으며 ID token 서명을 검증한다.
- 교환 뒤 각 단계에서 localStorage·sessionStorage·쿠키가 비어 있다.
- 관리자 bearer로 `/v1` 조회가 성공하고 설정 화면의 `저장소 읽기 확인`이 `GET /v1/health`를
  읽는다.
- 브라우저 벽시계만 access token의 갱신 시점까지 밀면 요청들이 한 번의 공유 갱신을 기다리고
  refresh token이 회전한다.
- refresh token이 실패하면 세션과 토큰을 지우고 재로그인을 요구한다. 제공자가 보낸 오류
  본문 문자열은 화면에 남지 않는다.
- state가 틀린 콜백은 code 교환 없이 거부한다.
- `연결 끊기`와 새로고침 뒤에는 토큰 저장소가 비어 있어 다시 로그인해야 한다.

## 격리

- 관리자 UI는 실제 소스(`apps/admin`, `vite.config.mjs`)를 Vite 개발 서버로 띄운다.
  `VITE_OIDC_*` 값은 실행할 때 주입한다. `.env`와 호출자의 로그인 값은 읽지 않고, 수집기
  프록시는 격리된 루프백으로 고정한다. 저장소의 운영 설정 파일은 건드리지 않는다.
- 제공자는 `https://identity.example.invalid`이고 discovery·JWKS·authorize·token 응답을
  브라우저 컨텍스트에서 직접 채운다. 그 밖의 출처 요청은 중단하고 앱은 루프백 주소에서만
  연다.
- RS256 서명 키와 refresh token은 메모리에서만 만들고 파일·로그에 남기지 않는다.
- 수집기는 실제 collector 런타임을 esbuild로 묶어 격리된 Miniflare workerd와 임시 D1에
  올린다. 예시 registry로 프로젝트를 등록하고 로그인 주체에 owner 권한을 준다. 대역의
  샘플링 로그 출력만 끄며 운영 수집기의 로깅 설정은 바꾸지 않는다.
- 임시 D1 디렉터리(`.tmp/admin-login-*`)는 성공·실패·Ctrl+C 어느 쪽이든 마지막에 지운다.

## 출력

표준 출력에 JSON 한 줄만 쓴다. 스크린샷·보고서 파일은 만들지 않는다.

성공하면 `verified: true`와 브라우저 버전, 고정 불리언(`pkceRedirect`, `signedApiAccess`,
`callbackScrubbed`, `sharedRotatingRefresh`, `refreshFailureClears`, `invalidStateRejected`,
`disconnectClears`, `relogin`, `reloadClears`, `storageEmpty`, `noAdminWrites`)과 `pageErrors`, 고정 횟수
(`authorizations`, `exchanges`, `refreshes`, `apiReads`)를 담는다. 실패하면
`{"verified":false,"stage":"..."}`만 출력하고 종료 코드 1을 낸다. `stage`는 `arguments`,
`setup`, `login`, `refresh`, `refresh-failure`, `disconnect`, `bad-state`, `relogin`, `reload`, `cleanup` 중
하나라 어느 지점에서 멈췄는지만 알린다. code·state·token·identity·요청 본문·주소는 성공과
실패 어느 쪽에도 넣지 않는다. 60초가 지나면 브라우저 작업을 중단하고 실패로 처리한다.
서버·브라우저·임시 DB 정리는 그 뒤에 수행하므로 실제 종료까지는 더 걸릴 수 있다.

## 남은 실제 제공자 확인

여기서 확인한 제공자는 실행 중에 만든 대역이다. 실제 제공자의 CORS 허용, discovery·JWKS
주소, JWT access token 발급, resource/audience 매핑, 실제 회전 갱신은 아직 확인하지 않았다.
원격 수집기·운영 배포·푸시·배포도 이 도구가 하는 일이 아니다. 빌드 변수와 제공자 등록 조건은
[OIDC 연결 문서](../../docs/backend/oidc.md#브라우저-관리자-로그인)와
[관리자 앱 안내](../../apps/admin/README.md)에 정리되어 있다.
